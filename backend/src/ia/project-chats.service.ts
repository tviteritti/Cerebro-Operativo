import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectChat, ProjectChatKind } from './entities/project-chat.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ProjectsService } from '../projects/projects.service';
import { User } from '../users/entities/user.entity';

const MAX_RAW_MESSAGES = 96;
const MAX_PAIRS = 24;
const MAX_ASSISTANT_CHARS = 24_000;

/** Límite al inyectar el historial del chat fijo "Notas y contexto" en otras conversaciones. */
const MAX_PERSISTENT_CONTEXT_CHARS = 14_000;

@Injectable()
export class ProjectChatsService {
  constructor(
    @InjectRepository(ProjectChat)
    private chatRepo: Repository<ProjectChat>,
    @InjectRepository(ChatMessage)
    private messageRepo: Repository<ChatMessage>,
    private projectsService: ProjectsService,
  ) {}

  async list(projectId: string, user: Pick<User, 'id' | 'globalRole'>): Promise<ProjectChat[]> {
    const project = await this.projectsService.findById(projectId);
    await this.projectsService.assertCanAccessProject(user, project);
    await this.ensurePersistentChat(projectId, user.id);
    const rows = await this.chatRepo.find({
      where: { projectId, userId: user.id },
    });
    rows.sort((a, b) => {
      if (a.kind === 'persistent' && b.kind !== 'persistent') return -1;
      if (b.kind === 'persistent' && a.kind !== 'persistent') return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    return rows;
  }

  /** Garantiza el chat de notas/contexto (uno por usuario y proyecto). */
  async ensurePersistentChat(projectId: string, userId: string): Promise<ProjectChat> {
    const existing = await this.chatRepo.findOne({
      where: { projectId, userId, kind: 'persistent' },
    });
    if (existing) return existing;
    const chat = this.chatRepo.create({
      projectId,
      userId,
      kind: 'persistent',
      title: 'Notas y contexto',
    });
    return this.chatRepo.save(chat);
  }

  async create(
    projectId: string,
    user: Pick<User, 'id' | 'globalRole'>,
    kind: ProjectChatKind,
    title?: string,
  ): Promise<ProjectChat> {
    const project = await this.projectsService.findById(projectId);
    await this.projectsService.assertCanAccessProject(user, project);
    if (kind === 'persistent') {
      const dup = await this.chatRepo.findOne({
        where: { projectId, userId: user.id, kind: 'persistent' },
      });
      if (dup) {
        throw new ConflictException(
          'Ya existe un chat de notas/contexto; usá ese hilo o renombralo.',
        );
      }
    }
    const t = title?.trim()?.slice(0, 200);
    const chat = this.chatRepo.create({
      projectId,
      userId: user.id,
      kind,
      title:
        t ||
        (kind === 'persistent'
          ? 'Notas y contexto'
          : `Chat ${new Date().toLocaleString('es-AR', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}`),
    });
    return this.chatRepo.save(chat);
  }

  async updateTitle(
    projectId: string,
    chatId: string,
    user: Pick<User, 'id' | 'globalRole'>,
    title: string,
  ): Promise<ProjectChat> {
    const chat = await this.getChatOrThrow(projectId, chatId, user);
    chat.title = title.trim().slice(0, 200) || chat.title;
    return this.chatRepo.save(chat);
  }

  async remove(
    projectId: string,
    chatId: string,
    user: Pick<User, 'id' | 'globalRole'>,
  ): Promise<void> {
    const chat = await this.getChatOrThrow(projectId, chatId, user);
    await this.chatRepo.remove(chat);
  }

  async getChatOrThrow(
    projectId: string,
    chatId: string,
    user: Pick<User, 'id' | 'globalRole'>,
  ): Promise<ProjectChat> {
    const project = await this.projectsService.findById(projectId);
    await this.projectsService.assertCanAccessProject(user, project);
    const chat = await this.chatRepo.findOne({
      where: { id: chatId, projectId, userId: user.id },
    });
    if (!chat) {
      throw new NotFoundException('Chat no encontrado');
    }
    return chat;
  }

  /** Pares user→assistant ya cerrados (sin el mensaje actual). Últimos N turnos. */
  async listPriorTurns(
    chatId: string,
  ): Promise<{ user: string; assistant: string }[]> {
    const msgs = await this.messageRepo.find({
      where: { chatId },
      order: { createdAt: 'DESC' },
      take: MAX_RAW_MESSAGES,
    });
    msgs.reverse();
    const pairs: { user: string; assistant: string }[] = [];
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
        let a = msgs[i + 1].content;
        if (a.length > MAX_ASSISTANT_CHARS) {
          a =
            a.slice(0, MAX_ASSISTANT_CHARS) +
            '\n[... respuesta anterior truncada ...]';
        }
        pairs.push({ user: msgs[i].content, assistant: a });
        i++;
      }
    }
    return pairs.slice(-MAX_PAIRS);
  }

  async listMessagesRaw(chatId: string): Promise<ChatMessage[]> {
    return this.messageRepo.find({
      where: { chatId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Texto resumido del chat "Notas y contexto" (mismo usuario/proyecto) para
   * combinar con otros hilos: responsables, env, servidores, lo que no está en el repo.
   * Toma los mensajes más recientes que entren en maxChars. Si el chat no existe o está vacío, null.
   */
  async getPersistentChatContextBlock(
    projectId: string,
    userId: string,
    maxChars: number = MAX_PERSISTENT_CONTEXT_CHARS,
  ): Promise<string | null> {
    const chat = await this.chatRepo.findOne({
      where: { projectId, userId, kind: 'persistent' },
    });
    if (!chat) return null;
    const msgs = await this.listMessagesRaw(chat.id);
    if (msgs.length === 0) return null;
    const lines: string[] = [];
    let total = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const label = m.role === 'user' ? 'Usuario' : 'Asistente';
      const piece = `${label}: ${m.content}\n\n`;
      if (total + piece.length > maxChars) {
        if (lines.length === 0) {
          return (
            '--- Notas y contexto (resumen; mensaje largo recortado) ---\n\n' +
            `${label}: ${m.content.slice(0, Math.max(100, maxChars - 200))}...\n\n` +
            '--- Fin notas (truncado) ---\n'
          );
        }
        break;
      }
      lines.push(piece);
      total += piece.length;
    }
    lines.reverse();
    return (
      '--- Contenido del chat fijo "Notas y contexto" (puede no estar en el repositorio: equipo, entornos, despliegues, acuerdos) ---\n\n' +
      lines.join('') +
      '--- Fin "Notas y contexto" ---\n\n'
    );
  }

  async appendUserMessage(chatId: string, content: string): Promise<ChatMessage> {
    const row = this.messageRepo.create({
      chatId,
      role: 'user',
      content,
      meta: null,
    });
    await this.messageRepo.save(row);
    await this.chatRepo.update({ id: chatId }, { updatedAt: new Date() });
    return row;
  }

  async appendAssistantMessage(
    chatId: string,
    content: string,
    meta?: { agentEvents?: unknown[] } | null,
  ): Promise<ChatMessage> {
    const row = this.messageRepo.create({
      chatId,
      role: 'assistant',
      content,
      meta: meta ?? null,
    });
    await this.messageRepo.save(row);
    await this.chatRepo.update({ id: chatId }, { updatedAt: new Date() });
    return row;
  }
}
