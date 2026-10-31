import { Injectable, Logger } from '@nestjs/common';
import {
  OllamaService,
  OllamaChatMessage,
  OllamaChatMessageTool,
} from './ollama.service';
import { EmbeddingService } from './embedding.service';
import { ProjectsService } from '../projects/projects.service';
import { ProjectToolsService } from './project-tools.service';
import { GitSyncService } from '../projects/git-sync.service';
import { PROJECT_AGENT_TOOLS } from './project-agent.tools';
import { collectRepositoryText } from './repository-text.util';
import { Response } from 'express';
import { User } from '../users/entities/user.entity';
import { ProjectChatsService } from './project-chats.service';

const RAG_CHARS_PER_FRAGMENT = 4500;
const MAX_AGENT_STEPS = 20;
const ANSWER_STREAM_CHUNK = 72;

/** Eventos NDJSON del modo agente (una línea JSON por evento). */
export type AgentNdJsonEvent =
  | { type: 'meta'; sourcesCount: number }
  | { type: 'model_round'; step: number }
  | {
      type: 'tool_call';
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      name: string;
      preview: string;
      totalChars: number;
    }
  | { type: 'answer_delta'; text: string }
  | { type: 'done' };

function chunkUtf8(text: string, size: number): string[] {
  if (!text) return [''];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

function clipFragment(text: string): string {
  if (!text) return '';
  if (text.length <= RAG_CHARS_PER_FRAGMENT) return text;
  return (
    text.slice(0, RAG_CHARS_PER_FRAGMENT) +
    '\n[... fragmento truncado por tamaño ...]'
  );
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      return typeof p === 'object' && p !== null && !Array.isArray(p)
        ? (p as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(
    private ollamaService: OllamaService,
    private embeddingService: EmbeddingService,
    private projectsService: ProjectsService,
    private gitSyncService: GitSyncService,
    private projectTools: ProjectToolsService,
    private projectChatsService: ProjectChatsService,
  ) {}

  /**
   * Ingesta el contexto de un proyecto: extrae datos, hace chunking,
   * genera embeddings y los almacena en pgvector.
   */
  async ingestProject(
    projectId: string,
    additionalContext?: string,
    options?: { syncFromGit?: boolean },
  ): Promise<{ chunksCreated: number }> {
    let project = await this.projectsService.findById(projectId);
    if (options?.syncFromGit) {
      try {
        await this.gitSyncService.syncAndPersist(project);
      } catch (e) {
        this.logger.warn(
          `syncFromGit: ${e instanceof Error ? e.message : e}`,
        );
        throw e;
      }
      project = await this.projectsService.findById(projectId);
    }
    const repoPath = this.gitSyncService.getEffectivePath(project);
    let repositoryText: string | undefined;
    if (repoPath) {
      try {
        repositoryText = await collectRepositoryText(repoPath);
      } catch (e) {
        this.logger.warn(
          `Lectura de repositorio omitida: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    const links = Array.isArray(project.projectLinks)
      ? project.projectLinks
      : [];
    return this.embeddingService.ingestProjectContext(
      projectId,
      project.context_data || {},
      project.infrastructure_urls || {},
      project.description || '',
      links,
      additionalContext,
      repositoryText,
    );
  }

  /**
   * Mensajes para Ollama: el contexto indexado va en el mensaje **user** para que no lo recorte
   * el límite del system prompt y el modelo lo priorice junto a la pregunta.
   */
  private buildRagMessages(
    projectName: string,
    contextChunks: string[],
    question: string,
    options?: {
      agentTools?: boolean;
      chatKind?: 'persistent' | 'ephemeral';
      priorTurns?: { user: string; assistant: string }[];
      /** Bloque inyectado desde "Notas y contexto" cuando el hilo actual es otro (p. ej. efímero + agente) */
      persistentChatNotesContext?: string | null;
    },
  ): OllamaChatMessage[] {
    const blocks =
      contextChunks.length > 0
        ? contextChunks
            .map(
              (c, i) =>
                `--- Fragmento ${i + 1} ---\n${clipFragment(c)}`,
            )
            .join('\n\n')
        : '(No se recuperaron fragmentos de contexto.)';

    let systemContent: string;
    if (options?.agentTools) {
      systemContent =
        `Eres el asistente del proyecto "${projectName}" en Cerebro Operativo. ` +
        `Responde en español.\n\n` +
        `--- Modo lectura de repositorio (herramientas) ---\n` +
        `Podés apoyarte en: (1) el bloque "CONTEXTO INDEXADO" del usuario (RAG, similitud semántica limitada), (2) el **código en el clon** vía list_directory, read_file, search_in_repository y, si hace falta, **suggest_investigation_plan** (decidir qué leer y qué términos buscar, con variantes/typos), (3) si se incluyó "Notas y contexto", usalo como fuente fiable para acuerdos del equipo, entornos, responsables o datos que el usuario dejó anotados y no están en el repo.\n\n` +
        `Normas:\n` +
        `• No digas "no figura en el contexto indexado" como conclusión general de la pregunta si aún no usaste herramientas para leer o buscar en el repo. Esa frase describe solo los **fragmentos RAG**, no "todo el proyecto".\n` +
        `• La búsqueda \`search_in_repository\` sigue siendo **literal** (subcadena). Para preguntas abiertas (p. ej. "qué stack de estilos usa el front") **usá primero** \`suggest_investigation_plan\` con el objetivo: devuelve archivos a leer (p. ej. package.json) y subcadenas/variantes (typos, nombres de paquetes) para luego leer o buscar.\n` +
        `• **"Entidades" del proyecto (dominio, tablas, modelo de datos):** no alcanza con buscar la palabra "entidad" o "entity" en el repo. Las tablas suelen definirse en **migraciones SQL** (p. ej. \`supabase/migration(s)\`, \`db/migrate\`, \`**/*.sql\`) con \`CREATE TABLE\`, o en un schema Prisma/TypeORM. **Hacé** \`suggest_investigation_plan\` con objetivo "listar tablas/entidades de la base de datos en este repositorio", o \`list_directory\` en \`.\` y en \`supabase\` si existe, luego \`read_file\` en \`.sql\` relevantes. **Prohibido** afirmar rutas que no listó una herramienta (p. ej. archivos bajo \`.github/\` que no aparezcan en \`list_directory\`).\n` +
        `• **Cierre: el usuario quiere el dato, no el comentario meta.** Si la pregunta pide **qué entidades/tablas** tiene el proyecto (o un inventario similar) y ya tenés en el historial la salida de \`read_file\` / \`search_in_repository\` con \`CREATE TABLE\`, Prisma \`model\`, etc., la **respuesta final (texto que escribís al usuario, sin más tools)** debe incluir **una lista explícita** de nombres: tablas, \`model\`, o lo que corresponda, **extraídos de ese texto**. **Prohibido** cerrar solo con "acá están las entidades", "estos archivos dan una visión", "parece que la estructura es", "habría que investigar más" o "sería útil revisar" **sin** enumerar lo pedido. Si falta leer un \`.sql\` concreto, llamá \`read_file\` una vez más; si ya leíste el archivo, **no** pospongas: sintetizá la lista.\n` +
        `• Con herramientas, podés afirmar lo que muestre su salida. Si \`search_in_repository\` no devuelve líneas, decí explícitamente que **no hubo coincidencias** para la búsqueda literal (no "falta en el índice" como sinónimo). Podés combinar \`queries\` (OR) o varias búsquedas. \`suggest_investigation_plan\` sugiere términos que aún no escribiste. Los parámetros de búsqueda van **sin comillas escapadas** en cada término (cadenas planas en el array).\n` +
        `• Si hace falta, listá directorios o leé archivos típicos (README, .github, scripts) antes de concluir que "no hay pipeline": los nombres en código no suelen ser la palabra "pipeline" exacta.\n` +
        `• \`read_file\` **solo acepta un archivo o un patrón con \`*\`/\`?\` en el último tramo** (p. ej. \`supabase/migration/*.sql\`). **No** uses \`read_file\` en una carpeta: si el resultado empieza por "es un directorio" o te lista nombres, abrí un \`.sql\` concreto o un glob en esa carpeta. Nunca inventes rutas bajo \`src/\` sin un \`list_directory\` previo en ese padre.\n` +
        `• Rutas relativas al raíz del clon. \`read_file\` / búsqueda: solo lo ya presente en disco. ` +
        `Prohibido git pull, fetch, checkout o tocar .git: el usuario usa "Sincronizar repositorio" o indexar cuando haga falta.`;
    } else {
      systemContent =
        `Eres el asistente del proyecto "${projectName}" en Cerebro Operativo. ` +
        `Responde en español.\n\n` +
        `Normas obligatorias:\n` +
        `1) Solo podés afirmar cosas que aparezcan de forma explícita en el CONTEXTO INDEXADO del mensaje del usuario. ` +
        `Si algo no está en esos fragmentos, decí "No figura en el contexto indexado que recibí" y no lo completes.\n` +
        `2) Prohibido inventar, inferir arquitectura, entidades, pipelines, integraciones o detalles que no estén escritos en los fragmentos.\n` +
        `3) Prohibido usar frases como "es probable", "podría haber", "típicamente", "otras entidades como...", listas supuestas o ejemplos hipotéticos.\n` +
        `4) Si la pregunta pide un inventario completo (p. ej. todas las entidades) y el contexto solo muestra parte, enumerá solo lo que aparece y aclará que el índice puede no incluir todo el código.\n` +
        `5) Si no alcanza el contexto, pedí que re-indexen o reformulen; no rellenes vacíos con suposiciones.`;
    }

    if (options?.chatKind === 'persistent') {
      systemContent +=
        `\n\n--- Hilo de notas ---\n` +
        `Este chat persiste entre sesiones: podés acumular información que no está en el repositorio o en el índice. ` +
        `Las respuestas anteriores en este mismo hilo forman parte del contexto de conversación (además del RAG por mensaje).`;
    }

    if (options?.chatKind === 'ephemeral') {
      if (options?.agentTools && options?.persistentChatNotesContext) {
        systemContent +=
          `\n\n--- Hilo efímero + lectura de repositorio ---\n` +
          `El historial de **este** hilo no se comparte con otros chats; en cambio, para la **lectura de repo** se te adjunta el resumen del chat fijo "Notas y contexto" del mismo proyecto (si había mensajes), para no perder acuerdos de equipo, entornos o responsables.`;
      } else {
        systemContent +=
          `\n\n--- Hilo efímero ---\n` +
          `Este hilo solo existe aquí: el contexto de conversación no se comparte con otros chats del proyecto.`;
      }
    }

    const out: OllamaChatMessage[] = [{ role: 'system', content: systemContent }];

    for (const t of options?.priorTurns ?? []) {
      out.push({ role: 'user', content: t.user });
      out.push({ role: 'assistant', content: t.assistant });
    }

    const notesBlock = options?.persistentChatNotesContext?.trim()
      ? `${options.persistentChatNotesContext}\n`
      : '';

    const ragEmptyAgentHint =
      options?.agentTools && contextChunks.length === 0
        ? '\n[Atención: el RAG devolvió 0 fragmentos. No te quedes con búsquedas de palabras sueltas: listá el repo, usá suggest_investigation_plan si aplica, y para datos mirá supabase/migrations o *.sql con create table.]\n'
        : '';

    const userContextBlock = options?.agentTools
      ? `${notesBlock}CONTEXTO INDEXADO (RAG; el índice no cubre necesariamente todo el repositorio):\n\n${blocks}\n\n---\n\nPREGUNTA:\n${question}\n\n(Con lectura de repo: completá con herramientas; no basta con este bloque para afirmar que "no existe" algo en el clon.)${ragEmptyAgentHint}\n`
      : `${notesBlock}CONTEXTO INDEXADO:\n\n${blocks}\n\n---\n\nPREGUNTA:\n${question}`;

    out.push({
      role: 'user',
      content: userContextBlock,
    });

    return out;
  }

  /**
   * Núcleo del agente: LLM + tools. Si `emit` está definido, emite eventos (p. ej. NDJSON al cliente).
   */
  private async executeAgentToolLoopCore(
    projectId: string,
    seedMessages: OllamaChatMessage[],
    sourceChunks: number,
    emit?: (e: AgentNdJsonEvent) => void,
  ): Promise<string> {
    emit?.({ type: 'meta', sourcesCount: sourceChunks });

    let messages: OllamaChatMessageTool[] = seedMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const project = await this.projectsService.findById(projectId);

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      emit?.({ type: 'model_round', step: step + 1 });

      const { message } = await this.ollamaService.chatOnceWithTools(
        messages,
        PROJECT_AGENT_TOOLS as unknown as Record<string, unknown>[],
      );

      const toolCalls = message.tool_calls;
      if (!toolCalls?.length) {
        const text = (message.content ?? '').trim();
        const final =
          text ||
          '(El modelo no devolvió texto ni llamadas a herramientas.)';
        if (emit) {
          for (const part of chunkUtf8(final, ANSWER_STREAM_CHUNK)) {
            emit({ type: 'answer_delta', text: part });
          }
          emit({ type: 'done' });
        }
        return final;
      }

      messages.push({
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call.function?.name;
        if (!name) continue;
        const args = parseToolArguments(call.function?.arguments);
        this.logger.log(
          `Agent tool: ${name} ${JSON.stringify(args).slice(0, 200)}`,
        );
        emit?.({ type: 'tool_call', name, arguments: args });

        const result = await this.projectTools.executeTool(project, name, args);
        const preview =
          result.length > 1_800
            ? `${result.slice(0, 1_800)}\n… [${result.length} caracteres total]`
            : result;
        emit?.({
          type: 'tool_result',
          name,
          preview,
          totalChars: result.length,
        });

        messages.push({
          role: 'tool',
          tool_name: name,
          content: result,
        });
      }
    }

    const limitMsg =
      'Se alcanzó el límite de pasos del agente; probá una pregunta más acotada.';
    if (emit) {
      for (const part of chunkUtf8(limitMsg, ANSWER_STREAM_CHUNK)) {
        emit({ type: 'answer_delta', text: part });
      }
      emit({ type: 'done' });
    }
    return limitMsg;
  }

  /** Variante sincrónica sin streaming de eventos. */
  private async runAgentToolLoop(
    projectId: string,
    seedMessages: OllamaChatMessage[],
    sourceChunks: number,
  ): Promise<string> {
    return this.executeAgentToolLoopCore(
      projectId,
      seedMessages,
      sourceChunks,
      undefined,
    );
  }

  private writeNdjson(res: Response, evt: AgentNdJsonEvent): void {
    res.write(`${JSON.stringify(evt)}\n`);
  }

  /**
   * Chat RAG por hilo (historial solo dentro de este chat).
   */
  async chatInThread(
    projectId: string,
    chatId: string,
    user: Pick<User, 'id' | 'globalRole'>,
    question: string,
    options?: { useAgentTools?: boolean },
  ): Promise<{ answer: string; sourcesCount: number }> {
    const chat = await this.projectChatsService.getChatOrThrow(
      projectId,
      chatId,
      user,
    );
    const priorTurns = await this.projectChatsService.listPriorTurns(chat.id);
    await this.projectChatsService.appendUserMessage(chat.id, question);

    const project = await this.projectsService.findById(projectId);
    const relevantChunks = await this.embeddingService.searchSimilar(
      projectId,
      question,
      8,
    );

    this.logger.log(
      `RAG: ${relevantChunks.length} fragmentos para "${question.substring(0, 50)}..."`,
    );

    let persistentChatNotesContext: string | null = null;
    if (options?.useAgentTools && chat.kind === 'ephemeral') {
      persistentChatNotesContext =
        await this.projectChatsService.getPersistentChatContextBlock(
          projectId,
          user.id,
        );
    }

    const messages = this.buildRagMessages(
      project.name,
      relevantChunks.map((c) => c.content),
      question,
      {
        agentTools: options?.useAgentTools === true,
        chatKind: chat.kind,
        priorTurns,
        persistentChatNotesContext,
      },
    );

    const answer =
      options?.useAgentTools === true
        ? await this.runAgentToolLoop(
            projectId,
            messages,
            relevantChunks.length,
          )
        : await this.ollamaService.chat(messages);

    await this.projectChatsService.appendAssistantMessage(chat.id, answer, null);

    return {
      answer,
      sourcesCount: relevantChunks.length,
    };
  }

  /**
   * Streaming por hilo; persiste user + assistant al terminar.
   */
  async chatStreamInThread(
    projectId: string,
    chatId: string,
    user: Pick<User, 'id' | 'globalRole'>,
    question: string,
    res: Response,
    options?: { useAgentTools?: boolean },
  ): Promise<void> {
    const chat = await this.projectChatsService.getChatOrThrow(
      projectId,
      chatId,
      user,
    );
    const priorTurns = await this.projectChatsService.listPriorTurns(chat.id);
    await this.projectChatsService.appendUserMessage(chat.id, question);

    const project = await this.projectsService.findById(projectId);
    const relevantChunks = await this.embeddingService.searchSimilar(
      projectId,
      question,
      8,
    );

    this.logger.log(
      `RAG Stream: ${relevantChunks.length} fragmentos para "${question.substring(0, 50)}..."`,
    );

    let persistentChatNotesContext: string | null = null;
    if (options?.useAgentTools && chat.kind === 'ephemeral') {
      persistentChatNotesContext =
        await this.projectChatsService.getPersistentChatContextBlock(
          projectId,
          user.id,
        );
    }

    const messages = this.buildRagMessages(
      project.name,
      relevantChunks.map((c) => c.content),
      question,
      {
        agentTools: options?.useAgentTools === true,
        chatKind: chat.kind,
        priorTurns,
        persistentChatNotesContext,
      },
    );

    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Sources-Count', relevantChunks.length.toString());

    if (options?.useAgentTools === true) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('X-Stream-Format', 'agent-ndjson');
      const agentEvents: AgentNdJsonEvent[] = [];
      const answer = await this.executeAgentToolLoopCore(
        projectId,
        messages,
        relevantChunks.length,
        (evt) => {
          if (evt.type !== 'answer_delta' && evt.type !== 'done') {
            agentEvents.push(evt);
          }
          this.writeNdjson(res, evt);
        },
      );
      await this.projectChatsService.appendAssistantMessage(chat.id, answer, {
        agentEvents,
      });
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');

    let buf = '';
    await this.ollamaService.chatStream(
      messages,
      (content: string) => {
        buf += content;
        res.write(content);
      },
      async () => {
        try {
          await this.projectChatsService.appendAssistantMessage(
            chat.id,
            buf,
            null,
          );
        } catch (e) {
          this.logger.error(`No se pudo guardar mensaje assistant: ${e}`);
        }
        res.end();
      },
    );
  }

  /**
   * Obtiene el estado de indexación de un proyecto.
   */
  async getIndexStatus(projectId: string): Promise<{
    projectId: string;
    chunksIndexed: number;
    isIndexed: boolean;
  }> {
    await this.projectsService.findById(projectId);
    const count = await this.embeddingService.getContextCount(projectId);

    return {
      projectId,
      chunksIndexed: count,
      isIndexed: count > 0,
    };
  }
}
