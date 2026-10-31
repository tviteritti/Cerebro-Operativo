import * as path from 'node:path';
import * as fsp from 'node:fs/promises';

/** Directorios omitidos al leer/indexar código del repo (compartido con herramientas del agente). */
export const REPO_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  'venv',
  '__pycache__',
  '.nuxt',
  'target',
  'vendor',
  '.output',
  '.turbo',
]);

export const REPO_TEXT_FILE_RE =
  /\.(ts|tsx|mtsx|js|jsx|mjs|cjs|py|go|rs|java|kt|md|json|yml|yaml|sql|html|css|scss|sh|vue|svelte|toml|gradle)$/i;

const MAX_TOTAL_CHARS = 450_000;

/**
 * Resumen de archivos de código bajo un directorio (típico: clon Git) para RAG.
 */
export async function collectRepositoryText(
  root: string,
): Promise<string> {
  const base = path.resolve(root);
  let used = 0;
  const blocks: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (used >= MAX_TOTAL_CHARS) return;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (used >= MAX_TOTAL_CHARS) return;
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
      const stat = await fsp.stat(full);
      if (stat.size > 400_000) continue;
      const maxRead = Math.min(stat.size, 200_000);
      const raw = await fsp.readFile(full);
      const t = raw.subarray(0, maxRead).toString('utf8');
      const rel = path.relative(base, full);
      const block = `--- ${rel} ---\n${t}\n\n`;
      if (used + block.length > MAX_TOTAL_CHARS) {
        return;
      }
      blocks.push(block);
      used += block.length;
    }
  }

  await walk(base);
  return blocks.join('');
}
