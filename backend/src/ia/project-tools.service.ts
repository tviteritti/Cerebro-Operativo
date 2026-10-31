import { Injectable, BadRequestException } from '@nestjs/common';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { Project } from '../projects/entities/project.entity';
import { GitSyncService } from '../projects/git-sync.service';
import { OllamaService } from './ollama.service';
import { REPO_SKIP_DIRS, REPO_TEXT_FILE_RE } from './repository-text.util';

const READ_FILE_MAX = 150_000;
const LIST_MAX_ENTRIES = 400;
const SEARCH_MAX_MATCHES = 40;
const SEARCH_MAX_SCAN_BYTES = 2_000_000;

/** Acepta array real o string JSON; el modelo a veces envía el array serializado. */
function coerceToStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x));
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t) as unknown;
      if (Array.isArray(p)) return p.map((x) => String(x));
    } catch {
      // no es JSON de array: un solo término
    }
    return [t];
  }
  return [];
}

/**
 * Quita comillas que el LLM añade alrededor de cada término (p. ej. \"proyecto\"
 * o "proyecto" como subcadena buscable).
 */
function normalizeSearchToken(s: string): string {
  let x = s.trim();
  for (let n = 0; n < 4; n++) {
    if (x.length >= 2 && x[0] === '"' && x[x.length - 1] === '"') {
      x = x.slice(1, -1).replace(/\\"/g, '"').trim();
      continue;
    }
    if (x.length >= 2 && x[0] === "'" && x[x.length - 1] === "'") {
      x = x.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return x;
}

function filePathHasGlob(rel: string): boolean {
  const n = rel.replace(/\\/g, '/');
  const last = n.includes('/') ? n.split('/').pop()! : n;
  return /[*?]/.test(last);
}

function parseLastSegmentGlob(
  rel: string,
): { dirRel: string; pattern: string } | null {
  const n = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!filePathHasGlob(n)) return null;
  const lastSlash = n.lastIndexOf('/');
  const base = lastSlash === -1 ? n : n.slice(lastSlash + 1);
  const dir = lastSlash === -1 ? '.' : n.slice(0, lastSlash) || '.';
  return { dirRel: dir, pattern: base };
}

function matchSimpleFilenameGlob(fileName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i',
  );
  return re.test(fileName);
}

@Injectable()
export class ProjectToolsService {
  constructor(
    private readonly gitSyncService: GitSyncService,
    private readonly ollamaService: OllamaService,
  ) {}

  private resolveSafePath(
    repoRoot: string,
    rel: string | undefined,
  ): string {
    const root = path.resolve(repoRoot);
    const raw = (rel ?? '.').trim() || '.';
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) {
      throw new BadRequestException('Ruta inválida (no se permite ..)');
    }
    const joined = path.resolve(root, normalized);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (joined !== root && !joined.startsWith(rootWithSep)) {
      throw new BadRequestException('Ruta fuera del repositorio');
    }
    return joined;
  }

  private async listDir(repoRoot: string, rel: string): Promise<string> {
    const abs = this.resolveSafePath(repoRoot, rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) return `(No existe: ${rel || '.'})`;
    if (!st.isDirectory()) return `(No es un directorio: ${rel})`;
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const lines = entries
      .slice(0, LIST_MAX_ENTRIES)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`);
    let out = lines.join('\n');
    if (entries.length > LIST_MAX_ENTRIES) {
      out += `\n... y ${entries.length - LIST_MAX_ENTRIES} más (truncado)`;
    }
    return out || '(vacío)';
  }

  private async readSingleFileContent(
    repoRoot: string,
    rel: string,
    maxChars: number = READ_FILE_MAX,
  ): Promise<string> {
    const abs = this.resolveSafePath(repoRoot, rel);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st?.isFile()) {
      return `(No es un archivo legible: ${rel})`;
    }
    if (st.size > READ_FILE_MAX) {
      return `(Archivo demasiado grande: ${st.size} bytes; máximo ${READ_FILE_MAX})`;
    }
    const buf = await fsp.readFile(abs);
    let text = buf.toString('utf8');
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + '\n[... truncado por tamaño ...]';
    }
    return text;
  }

  private async readGlobMatchedFiles(
    repoRoot: string,
    rel: string,
  ): Promise<string> {
    const parsed = parseLastSegmentGlob(rel);
    if (!parsed) {
      return `Patrón glob poco claro: ${rel}. Usá p. ej. "supabase/migration/*.sql" (el * va en el nombre del archivo, no en carpetas anidadas con **).`;
    }
    const absDir = this.resolveSafePath(repoRoot, parsed.dirRel);
    const st = await fsp.stat(absDir).catch(() => null);
    if (!st) {
      return `(No existe el directorio del patrón: ${parsed.dirRel})`;
    }
    if (!st.isDirectory()) {
      return `El glob requiere un directorio existente; "${parsed.dirRel}" no es una carpeta.`;
    }
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .filter((e) => matchSimpleFilenameGlob(e.name, parsed.pattern))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    if (files.length === 0) {
      return (
        `Ningún archivo en "${parsed.dirRel}" coincide con "${parsed.pattern}". ` +
        `Listá la carpeta con list_directory en "${parsed.dirRel}" y leé un nombre concreto.`
      );
    }
    const capFiles = 8;
    const perFileMax = 35_000;
    const totalMax = 120_000;
    const pieces: string[] = [];
    let total = 0;
    const take = files.slice(0, capFiles);
    for (const name of take) {
      const subRel = path.join(parsed.dirRel, name).split(path.sep).join('/');
      const chunk = await this.readSingleFileContent(
        repoRoot,
        subRel,
        perFileMax,
      );
      if (chunk.startsWith('(No es un archivo legible:')) {
        pieces.push(`\n--- ${subRel} ---\n${chunk}`);
        continue;
      }
      if (total + chunk.length > totalMax) {
        pieces.push(
          '\n[... límite de salida alcanzado; leé el resto con read_file en archivos puntuales ...]',
        );
        break;
      }
      pieces.push(`\n--- ${subRel} ---\n${chunk}`);
      total += chunk.length;
    }
    let header = `Patrón "${rel}": ${files.length} coincidencia(s), leyendo ${take.length} (máx. ${capFiles} por llamada):\n`;
    if (files.length > capFiles) {
      header += `(... ${files.length - capFiles} archivos más coinciden con el patrón)\n`;
    }
    return header + pieces.join('\n');
  }

  private async readFileTool(repoRoot: string, rel: string): Promise<string> {
    const trimmed = rel.trim();
    if (filePathHasGlob(trimmed)) {
      return this.readGlobMatchedFiles(repoRoot, trimmed);
    }
    const abs = this.resolveSafePath(repoRoot, trimmed);
    const st = await fsp.stat(abs).catch(() => null);
    if (!st) {
      return `(No existe: ${rel})`;
    }
    if (st.isDirectory()) {
      const listed = await this.listDir(repoRoot, trimmed);
      return (
        `La ruta "${rel}" es un **directorio**, no un archivo. ` +
        `No se puede leer una carpeta con read_file: usá list_directory, o read_file con un patrón en el **nombre** del archivo, p. ej. "${trimmed === '.' ? 'supabase/migration' : trimmed}/*.sql".\n\n` +
        `Contenido (un nivel):\n${listed}\n\n` +
        `Siguiente paso: elegí un archivo de arriba (p. ej. un .sql) o usá un glob \`carpeta/*.sql\`.`
      );
    }
    if (!st.isFile()) {
      return `(No es un archivo legible: ${rel})`;
    }
    return this.readSingleFileContent(repoRoot, trimmed, READ_FILE_MAX);
  }

  private async searchRepo(
    repoRoot: string,
    queryOrQueries: string | string[],
    max: number,
  ) {
    const asArray = Array.isArray(queryOrQueries)
      ? queryOrQueries
      : [queryOrQueries];
    const queries = asArray
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 2);
    if (queries.length === 0) {
      throw new BadRequestException(
        'Se requiere al menos una subcadena de búsqueda (≥2 caracteres)',
      );
    }
    const cap = Math.min(Math.max(max || 30, 1), SEARCH_MAX_MATCHES);
    const base = path.resolve(repoRoot);
    const matches: string[] = [];
    let scanned = 0;

    async function walk(dir: string): Promise<void> {
      if (matches.length >= cap || scanned >= SEARCH_MAX_SCAN_BYTES) return;
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (matches.length >= cap || scanned >= SEARCH_MAX_SCAN_BYTES) return;
        if (REPO_SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!e.isFile() || e.name.startsWith('.')) continue;
        if (!REPO_TEXT_FILE_RE.test(e.name) && e.name !== 'Dockerfile') {
          continue;
        }
        const st = await fsp.stat(full).catch(() => null);
        if (!st?.isFile() || st.size > 500_000) continue;
        const raw = await fsp.readFile(full);
        scanned += raw.length;
        if (scanned > SEARCH_MAX_SCAN_BYTES) return;
        const t = raw.toString('utf8');
        const rel = path.relative(base, full);
        const lines = t.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const lineLower = lines[i].toLowerCase();
          if (queries.some((q) => lineLower.includes(q))) {
            const line = lines[i].trim().slice(0, 500);
            matches.push(`${rel}:${i + 1}: ${line}`);
            if (matches.length >= cap) return;
          }
        }
      }
    }

    await walk(base);
    if (matches.length === 0) {
      return `Sin coincidencias en los archivos rastreados. Búsqueda (OR, insensible a mayúsculas) para: ${queries.map((q) => `"${q}"`).join(', ')}.`;
    }
    return matches.join('\n');
  }

  /**
   * Pide al LLM un plan: qué leer (package.json, etc.) y qué subcadenas buscar, con variantes.
   * No toca el disco: solo razona sobre el objetivo.
   */
  private async planRepositoryInvestigation(goal: string): Promise<string> {
    if (goal.length < 2) {
      return 'Error: "goal" debe ser más concreto.';
    }
    const system = `Eres un planificador de inspección de repositorio. Responde SOLO con un JSON válido, sin bloques markdown, con esta forma exacta:
{"list_directories_first": ["carpetas para recorrer con list_directory, p. ej. supabase/migration o ."],
 "read_files_first": ["archivos concretos: package.json, supabase/migrations/001_foo.sql — NUNCA una carpeta sola"],
 "search_substrings": ["entre 2 y 12 subcadenas para búsqueda literal (grep) en archivos, incluyendo nombres de package npm, sinónimos y posibles typos/variantes (p. ej. tailwind, tailwindcss, @tailwind)"],
 "hint": "una o dos frases en español con la estrategia"}
Reglas:
- list_directories_first: usalo cuando haya dudas de nombres (migrations vs migration, etc.); read_file NO acepta directorios.
- read_files_first: **solo** rutas a ficheros. Si aún no conocéis el nombre, listá con list_directories_first y dejá read_files_first vacío o con nombres seguros.
- Para dependencias, estilos, frameworks, linters, tests: sugerir leer package.json (raíz y, si aplica, frontend/, apps/, packages/).
- **Si el usuario pregunta por "entidades", tablas, modelo de datos, base, Supabase, Prisma, ORM:** en list_directories_first poner al menos "supabase", "supabase/migration" o "supabase/migrations" (nombres habituales); en read_files_first poner .sql reales **solo** si un nombre obvio; si no, vacío. En search_substrings: create table, supabase, migration, etc.
- search_substrings debe servir para coincidencia literal por línea (no oraciones). Incluir variantes con y sin @, nombres cortos de paquetes.
- Si el objetivo es poco claro, igual ofrecer subcadenas razonablemente alineadas al tema.`;
    const raw = await this.ollamaService.chat([
      { role: 'system', content: system },
      { role: 'user', content: `Objetivo a investigar en el repositorio: ${goal}` },
    ]);
    let parsed: {
      list_directories_first?: unknown;
      read_files_first?: unknown;
      search_substrings?: unknown;
      hint?: unknown;
    };
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw) as typeof parsed;
    } catch {
      return (
        `No se pudo interpretar el JSON del plan. Texto recibido:\n\n${raw.slice(0, 2_500)}`
      );
    }
    const dirs = Array.isArray(parsed.list_directories_first)
      ? parsed.list_directories_first.map((d) => String(d)).filter(Boolean)
      : [];
    const files = Array.isArray(parsed.read_files_first)
      ? parsed.read_files_first.map((f) => String(f)).filter(Boolean)
      : [];
    const subs = Array.isArray(parsed.search_substrings)
      ? parsed.search_substrings.map((f) => String(f)).filter(Boolean)
      : [];
    const hint =
      typeof parsed.hint === 'string' && parsed.hint.trim()
        ? parsed.hint.trim()
        : 'Leé dependencias y luego buscá subcadenas puntuales.';
    const dirLines =
      dirs.length > 0
        ? dirs.map((d) => `- list_directory: "${d}"`).join('\n')
        : '- (si no listás, empezá con list_directory en "supabase" o ".")';
    const fileLines =
      files.length > 0
        ? files
            .map(
              (f) =>
                `- read_file: "${f}" (solo archivos) o un glob, p. ej. supabase/migration/*.sql`,
            )
            .join('\n')
        : '- (tras listar, read_file a un .sql o supabase/migration/*.sql; no leas la carpeta sin *)';
    const subLines =
      subs.length > 0
        ? subs.map((s) => `- ${s}`).join('\n')
        : `- (derivá términos del objetivo)`;
    return (
      `Estrategia: ${hint}\n\n` +
        `Carpetas a listar primero (list_directory; read_file no abre directorios solos):\n${dirLines}\n\n` +
        `Archivos a leer o patrones (read_file: solo ficheros, o p. ej. "supabase/migration/*.sql"):\n${fileLines}\n\n` +
        `Subcadenas sugeridas: usá search_in_repository con "queries" (OR):\n` +
        `${subLines}\n\n` +
        `Siguiente paso: list_directory en la ruta con migraciones, luego read_file a un .sql o \`carpeta/*.sql\`. **read_file nunca acepta una carpeta sola;** con carpetas, listar o glob. Luego: enumerá tablas (CREATE TABLE) al responder al usuario.`
    );
  }

  /**
   * Ejecuta una herramienta del agente con rutas acotadas al repo del proyecto.
   */
  async executeTool(
    project: Project,
    toolName: string,
    rawArgs: unknown,
  ): Promise<string> {
    const repoRoot = this.gitSyncService.getEffectivePath(project);
    const args =
      rawArgs && typeof rawArgs === 'object'
        ? (rawArgs as Record<string, unknown>)
        : {};

    const str = (k: string) =>
      args[k] != null ? String(args[k]) : undefined;
    const num = (k: string) => {
      const v = args[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10);
      return undefined;
    };

    try {
      switch (toolName) {
        case 'list_directory': {
          if (!repoRoot) {
            return 'No hay repositorio clonado o ruta local configurada para este proyecto.';
          }
          const p = str('path') ?? '.';
          return await this.listDir(repoRoot, p);
        }
        case 'read_file': {
          if (!repoRoot) {
            return 'No hay repositorio clonado o ruta local configurada para este proyecto.';
          }
          const p = str('path') ?? str('file');
          if (!p?.trim()) {
            return 'Error: falta el parámetro path (ruta relativa a un archivo, o un patrón p. ej. supabase/migration/*.sql).';
          }
          return await this.readFileTool(repoRoot, p.trim());
        }
        case 'search_in_repository': {
          if (!repoRoot) {
            return 'No hay repositorio clonado o ruta local configurada para este proyecto.';
          }
          const maxRes = num('max_results');
          const fromQueries = coerceToStringArray(args['queries']);
          const fromQ = coerceToStringArray(args['q']);
          const fromArr = [
            ...new Set(
              [...fromQueries, ...fromQ]
                .map(normalizeSearchToken)
                .filter((s) => s.length >= 2),
            ),
          ];
          const qStr = str('q')?.trim() ?? '';
          const qLooksLikeJsonArray = qStr.startsWith('[');
          const fromQuery = normalizeSearchToken(
            (str('query')?.trim() ??
              (fromArr.length === 0 && !qLooksLikeJsonArray ? qStr : '')) ||
              '',
          );
          let payload: string | string[];
          if (fromArr.length > 0) {
            payload = fromArr;
          } else if (fromQuery.length >= 2) {
            payload = fromQuery;
          } else {
            return (
              'Error: indicá "query" (un texto) o "queries" (varias cadenas, OR). ' +
              'Cada término debe ser una palabra o frase sin comillas de más; ' +
              'p. ej. "queries": ["entidad", "create table", "supabase"] y no ' +
              '["\\"entidad\\""]. Si "queries" viene vacío, puede que Ollama haya enviado un string en lugar de array: reintentá con términos sueltos.'
            );
          }
          return await this.searchRepo(repoRoot, payload, maxRes ?? 30);
        }
        case 'suggest_investigation_plan': {
          const g = str('goal')?.trim();
          if (!g) {
            return 'Error: parámetro "goal" requerido (qué queres investigar en el repo).';
          }
          return await this.planRepositoryInvestigation(g);
        }
        default:
          return `Herramienta no permitida: ${toolName}`;
      }
    } catch (e) {
      const msg =
        e instanceof BadRequestException
          ? (e.getResponse() as { message?: string }).message ?? e.message
          : e instanceof Error
            ? e.message
            : String(e);
      return `Error ejecutando ${toolName}: ${msg}`;
    }
  }
}
