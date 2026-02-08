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

export const iaApi = {
  /** Ingesta el contexto del proyecto para RAG */
  ingest: (projectId: string, additionalContext?: string) =>
    api.post<IngestResponse>(`/ia/${projectId}/ingest`, {
      additionalContext,
    }),

  /** Chat sincrónico (respuesta completa) */
  chatSync: (projectId: string, question: string) =>
    api.post<{ answer: string; sourcesCount: number }>(
      `/ia/${projectId}/chat-sync`,
      { question },
    ),

  /** Estado de indexación del proyecto */
  getStatus: (projectId: string) =>
    api.get<IndexStatus>(`/ia/${projectId}/status`),

  /**
   * Chat con streaming: lee la respuesta token por token.
   * Retorna un ReadableStream para consumir incrementalmente.
   */
  chatStream: async (
    projectId: string,
    question: string,
    onToken: (token: string) => void,
    onDone: () => void,
  ) => {
    const token = localStorage.getItem('token');

    const response = await fetch(`/api/ia/${projectId}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || 'Error al obtener respuesta de la IA');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No se pudo leer el stream');

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      onToken(text);
    }

    onDone();
  },
};
