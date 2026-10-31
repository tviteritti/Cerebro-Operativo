import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  iaApi,
  type AgentStreamEvent,
  type ChatMessageDTO,
  type ProjectChatDTO,
} from '../api/ia';

interface AgentLogRow {
  id: string;
  kind: 'meta' | 'round' | 'tool_call' | 'tool_result';
  title: string;
  detail?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  agentLog?: AgentLogRow[];
}

interface ChatPanelProps {
  projectId: string;
  projectName: string;
}

function formatToolArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  } catch {
    return '';
  }
}

function agentEventToRow(ev: AgentStreamEvent): AgentLogRow | null {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  switch (ev.type) {
    case 'meta':
      return {
        id,
        kind: 'meta',
        title: `Contexto RAG: ${ev.sourcesCount} fragmentos recuperados`,
      };
    case 'model_round':
      return {
        id,
        kind: 'round',
        title: `Paso ${ev.step}: modelo`,
        detail: 'Llamada a Ollama con herramientas disponibles',
      };
    case 'tool_call':
      return {
        id,
        kind: 'tool_call',
        title: `→ ${ev.name}`,
        detail: formatToolArgs(ev.arguments),
      };
    case 'tool_result':
      return {
        id,
        kind: 'tool_result',
        title: `← ${ev.name} · salida (${ev.totalChars} caracteres)`,
        detail: ev.preview,
      };
    default:
      return null;
  }
}

function metaToAgentLog(
  meta: ChatMessageDTO['meta'],
): AgentLogRow[] | undefined {
  const evs = meta?.agentEvents;
  if (!Array.isArray(evs) || !evs.length) return undefined;
  const rows: AgentLogRow[] = [];
  for (const ev of evs) {
    const r = agentEventToRow(ev as AgentStreamEvent);
    if (r) rows.push(r);
  }
  return rows.length ? rows : undefined;
}

function mapDtoToMessages(rows: ChatMessageDTO[]): Message[] {
  return rows.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    agentLog:
      m.role === 'assistant' ? metaToAgentLog(m.meta) : undefined,
  }));
}

const ChatPanel: React.FC<ChatPanelProps> = ({ projectId, projectName }) => {
  const [chats, setChats] = useState<ProjectChatDTO[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatsLoading, setChatsLoading] = useState(true);
  /** Error al cargar hilos (p. ej. backend 404 = imagen Docker antigua). */
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [input, setInput] = useState('');
  const [useAgentTools, setUseAgentTools] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    setChatsError(null);
    try {
      const { data } = await iaApi.listChats(projectId);
      setChats(data);
      setActiveChatId((prev) => {
        if (prev && data.some((c) => c.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch (e) {
      setChats([]);
      setActiveChatId(null);
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        setChatsError(
          'El backend no expone /api/ia/.../chats (404). Suele ser el contenedor o el build desactualizado. ' +
            'Reconstruí: docker compose build backend && docker compose up -d backend. ' +
            'En local (sin Docker): cd backend && npm run build && npm run start:dev (puerto 3000). ' +
            'Luego recargá la página.',
        );
      } else {
        const msg =
          axios.isAxiosError(e) && e.response?.data
            ? (typeof e.response.data === 'string'
                ? e.response.data
                : (e.response.data as { message?: string }).message)
            : e instanceof Error
              ? e.message
              : 'Error al cargar chats';
        setChatsError(msg ?? 'Error al cargar chats');
      }
    } finally {
      setChatsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (!activeChatId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    void (async () => {
      try {
        const { data } = await iaApi.getMessages(projectId, activeChatId);
        if (!cancelled) setMessages(mapDtoToMessages(data));
      } catch {
        if (!cancelled) setMessages([]);
      } finally {
        if (!cancelled) setMessagesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, activeChatId]);

  const handleNewEphemeral = async () => {
    setChatsError(null);
    try {
      const { data } = await iaApi.createChat(projectId, {
        kind: 'ephemeral',
      });
      setChats((prev) => {
        const rest = prev.filter((c) => c.id !== data.id);
        return [data, ...rest];
      });
      setActiveChatId(data.id);
      setMessages([]);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        setChatsError(
          'No se pudo crear el chat: backend sin ruta /chats (mismo 404). Reconstruí el backend (ver mensaje de arriba).',
        );
      }
    }
  };

  const handleRenameActive = async () => {
    if (!activeChatId) return;
    const chat = chats.find((c) => c.id === activeChatId);
    const next = window.prompt('Nombre del chat', chat?.title ?? '');
    if (next === null || !next.trim()) return;
    try {
      const { data } = await iaApi.renameChat(
        projectId,
        activeChatId,
        next.trim(),
      );
      setChats((prev) =>
        prev.map((c) => (c.id === data.id ? data : c)),
      );
    } catch {
      /* ignore */
    }
  };

  const handleDeleteActive = async () => {
    if (!activeChatId) return;
    const chat = chats.find((c) => c.id === activeChatId);
    const ok = window.confirm(
      `¿Eliminar el chat "${chat?.title ?? ''}"? Se borrarán todos los mensajes.`,
    );
    if (!ok) return;
    try {
      await iaApi.deleteChat(projectId, activeChatId);
      await loadChats();
      setMessages([]);
    } catch {
      /* ignore */
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !activeChatId) return;

    const question = input.trim();
    setInput('');

    const userMsg: Message = {
      id: `local-u-${Date.now()}`,
      role: 'user',
      content: question,
    };

    const assistantMsgId = `local-a-${Date.now() + 1}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    try {
      await iaApi.chatStream(
        projectId,
        activeChatId,
        question,
        (token: string) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + token }
                : msg,
            ),
          );
        },
        () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, isStreaming: false }
                : msg,
            ),
          );
          setIsLoading(false);
          // No recargar mensajes al instante: el GET puede llegar antes de que
          // el backend persista el asistente y pisa el estado con una lista vieja
          // (el mensaje “desaparece” hasta que cambiás de chat y volvés).
        },
        {
          useAgentTools,
          onAgentEvent: (ev) => {
            const row = agentEventToRow(ev);
            if (!row) return;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      agentLog: [...(msg.agentLog ?? []), row],
                    }
                  : msg,
              ),
            );
          },
        },
      );
    } catch {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content:
                  '❌ Error: No se pudo obtener respuesta. Verifica Ollama y el modelo.',
                isStreaming: false,
              }
            : msg,
        ),
      );
      setIsLoading(false);
    }

    inputRef.current?.focus();
  };

  const activeChat = chats.find((c) => c.id === activeChatId);

  return (
    <div className="flex h-full min-h-0 max-h-full bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Lista de chats */}
      <aside className="w-[112px] flex-shrink-0 flex flex-col border-r border-gray-100 bg-gray-50/90">
        <div className="p-2 border-b border-gray-100">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            Chats
          </p>
          {chatsError ? (
            <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2 text-[9px] text-amber-950 leading-snug">
              <p className="mb-1.5">{chatsError}</p>
              <button
                type="button"
                onClick={() => void loadChats()}
                className="w-full font-medium text-amber-900 underline"
              >
                Reintentar
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-1">
          {chatsLoading ? (
            <p className="text-[10px] text-gray-400 px-1">…</p>
          ) : (
            chats.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.title}
                onClick={() => setActiveChatId(c.id)}
                className={`w-full text-left rounded-lg px-2 py-1.5 text-[11px] leading-tight transition-colors ${
                  c.id === activeChatId
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-white text-gray-700 hover:bg-violet-50 border border-transparent hover:border-violet-100'
                }`}
              >
                <span className="mr-0.5 opacity-80" aria-hidden>
                  {c.kind === 'persistent' ? '📌' : '💬'}
                </span>
                <span className="line-clamp-3 break-words">{c.title}</span>
              </button>
            ))
          )}
        </div>
        <div className="p-1.5 border-t border-gray-100 space-y-1">
          <button
            type="button"
            onClick={() => void handleNewEphemeral()}
            className="w-full text-[10px] font-medium rounded-lg py-1.5 bg-white border border-violet-200 text-violet-700 hover:bg-violet-50"
          >
            + Nuevo chat
          </button>
        </div>
      </aside>

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-blue-50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-200 flex-shrink-0">
              <svg
                className="w-4 h-4 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-gray-900 text-xs truncate">
                {activeChat?.title ?? 'Chat'}
              </h3>
              <p className="text-[10px] text-gray-500 truncate">
                {activeChat?.kind === 'persistent'
                  ? 'Notas · persiste'
                  : 'Efímero · solo este hilo'}{' '}
                · {projectName}
              </p>
            </div>
          </div>
          <div className="flex gap-1 flex-shrink-0">
            <button
              type="button"
              title="Renombrar"
              onClick={() => void handleRenameActive()}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-white/80 text-[10px]"
            >
              ✏️
            </button>
            <button
              type="button"
              title="Eliminar chat"
              onClick={() => void handleDeleteActive()}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 text-[10px]"
            >
              🗑️
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-3 min-h-0">
          {messagesLoading && messages.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Cargando mensajes…
            </p>
          ) : null}
          {messages.length === 0 && !messagesLoading ? (
            <div className="flex flex-col items-center justify-center text-center py-6">
              <p className="text-xs text-gray-500">
                {activeChat?.kind === 'persistent'
                  ? 'Acá podés acumular contexto que no está en el repo.'
                  : 'Chat nuevo. El historial no se mezcla con otros hilos.'}
              </p>
            </div>
          ) : null}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[94%] rounded-2xl px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-800 rounded-bl-md'
                }`}
              >
                {msg.role === 'assistant' &&
                  msg.agentLog &&
                  msg.agentLog.length > 0 && (
                    <div className="mb-2 rounded-xl border border-violet-200 bg-white/90 p-2 shadow-sm">
                      <div className="flex items-center gap-2 mb-1.5 text-[10px] font-semibold text-violet-900">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-violet-600 text-[8px] text-white">
                          AI
                        </span>
                        Actividad del agente
                      </div>
                      <ul className="space-y-1.5 max-h-48 overflow-y-auto text-left">
                        {msg.agentLog.map((row) => (
                          <li
                            key={row.id}
                            className="border-l-2 border-violet-300 pl-2"
                          >
                            <div className="text-[10px] font-medium text-gray-900">
                              {row.title}
                            </div>
                            {row.detail ? (
                              <pre className="mt-0.5 max-h-28 overflow-y-auto text-[10px] leading-snug text-gray-600 whitespace-pre-wrap break-words font-mono">
                                {row.detail}
                              </pre>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                <p className="text-xs whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                  {msg.isStreaming && (
                    <span className="inline-block w-1.5 h-3 bg-violet-500 ml-0.5 animate-pulse rounded-sm" />
                  )}
                </p>
              </div>
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>

        <form
          onSubmit={handleSend}
          className="p-2 border-t border-gray-100 bg-gray-50/50"
        >
          <label className="flex items-start gap-2 mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useAgentTools}
              onChange={(e) => setUseAgentTools(e.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500 scale-90"
            />
            <span className="text-[10px] text-gray-600 leading-snug">
              <span className="font-medium text-gray-800">
                Lectura del repo
              </span>{' '}
              — leer y buscar en el clon local. Sin git: el pull es solo con
              &quot;Sincronizar repositorio&quot; o al indexar.
            </span>
          </label>
          <div className="flex gap-1.5">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
              chatsError
                ? 'Arreglá el backend y tocá Reintentar…'
                : activeChatId
                  ? 'Escribe tu pregunta…'
                  : 'Cargando chats…'
            }
            disabled={isLoading || !activeChatId}
              className="flex-1 min-w-0 px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim() || !activeChatId}
              className="px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-xl text-xs"
            >
              →
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChatPanel;
