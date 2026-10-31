import api from './axios';

export interface IngestResponse {
  message: string;
  chunksCreated: number;
}

export interface IndexStatus {
  projectId: string;
  chunksIndexed: number;
  isIndexed: boolean;
}

/** Eventos del modo agente (stream NDJSON). Debe coincidir con el backend. */
export type AgentStreamEvent =
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

export interface ProjectChatDTO {
  id: string;
  projectId: string;
  userId: string;
  kind: 'persistent' | 'ephemeral';
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDTO {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  meta: { agentEvents?: AgentStreamEvent[] } | null;
  createdAt: string;
}

export const iaApi = {
  ingest: (
    projectId: string,
    options?: { additionalContext?: string; syncFromGit?: boolean },
  ) =>
    api.post<IngestResponse>(`/ia/${projectId}/ingest`, {
      additionalContext: options?.additionalContext,
      syncFromGit: options?.syncFromGit,
    }),

  getStatus: (projectId: string) =>
    api.get<IndexStatus>(`/ia/${projectId}/status`),

  listChats: (projectId: string) =>
    api.get<ProjectChatDTO[]>(`/ia/${projectId}/chats`),

  createChat: (
    projectId: string,
    body: { kind: 'persistent' | 'ephemeral'; title?: string },
  ) => api.post<ProjectChatDTO>(`/ia/${projectId}/chats`, body),

  renameChat: (projectId: string, chatId: string, title: string) =>
    api.patch<ProjectChatDTO>(`/ia/${projectId}/chats/${chatId}`, { title }),

  deleteChat: (projectId: string, chatId: string) =>
    api.delete(`/ia/${projectId}/chats/${chatId}`),

  getMessages: (projectId: string, chatId: string) =>
    api.get<ChatMessageDTO[]>(`/ia/${projectId}/chats/${chatId}/messages`),

  chatSync: (
    projectId: string,
    chatId: string,
    question: string,
    options?: { useAgentTools?: boolean },
  ) =>
    api.post<{ answer: string; sourcesCount: number }>(
      `/ia/${projectId}/chats/${chatId}/chat-sync`,
      { question, useAgentTools: options?.useAgentTools === true },
    ),

  chatStream: async (
    projectId: string,
    chatId: string,
    question: string,
    onToken: (token: string) => void,
    onDone: () => void,
    options?: {
      useAgentTools?: boolean;
      onAgentEvent?: (e: AgentStreamEvent) => void;
    },
  ) => {
    const token = localStorage.getItem('token');

    const response = await fetch(
      `/api/ia/${projectId}/chats/${chatId}/chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question,
          useAgentTools: options?.useAgentTools === true,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Error al obtener respuesta de la IA');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No se pudo leer el stream');

    const fmt = response.headers.get('X-Stream-Format');
    const contentType = response.headers.get('Content-Type') ?? '';
    const decoder = new TextDecoder();

    const isAgentNdjson =
      fmt === 'agent-ndjson' || contentType.includes('application/x-ndjson');

    if (isAgentNdjson) {
      let buf = '';
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let ev: AgentStreamEvent;
          try {
            ev = JSON.parse(trimmed) as AgentStreamEvent;
          } catch {
            continue;
          }
          options?.onAgentEvent?.(ev);
          if (ev.type === 'answer_delta') {
            onToken(ev.text);
          }
          if (ev.type === 'done') {
            sawDone = true;
            onDone();
            return;
          }
        }
      }
      if (buf.trim()) {
        try {
          const ev = JSON.parse(buf.trim()) as AgentStreamEvent;
          options?.onAgentEvent?.(ev);
          if (ev.type === 'answer_delta') onToken(ev.text);
          if (ev.type === 'done') sawDone = true;
        } catch {
          /* ignore */
        }
      }
      if (!sawDone) onDone();
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      onToken(text);
    }

    onDone();
  },
};
