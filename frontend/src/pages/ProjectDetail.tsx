import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { projectsApi, Project } from '../api/projects';
import { iaApi, IndexStatus } from '../api/ia';
import ChatPanel from '../components/ChatPanel';

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestMessage, setIngestMessage] = useState('');

  useEffect(() => {
    if (id) {
      loadProject();
      loadIndexStatus();
    }
  }, [id]);

  const loadProject = async () => {
    try {
      const response = await projectsApi.getById(id!);
      setProject(response.data);
    } catch {
      navigate('/dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  const loadIndexStatus = async () => {
    try {
      const response = await iaApi.getStatus(id!);
      setIndexStatus(response.data);
    } catch {
      // Si falla, asumimos no indexado
    }
  };

  const handleIngest = async () => {
    setIsIngesting(true);
    setIngestMessage('');
    try {
      const response = await iaApi.ingest(id!);
      setIngestMessage(
        `✅ ${response.data.chunksCreated} fragmentos indexados exitosamente`,
      );
      loadIndexStatus();
    } catch (error: any) {
      setIngestMessage(
        `❌ Error: ${error.response?.data?.message || 'No se pudo indexar. ¿Está Ollama corriendo?'}`,
      );
    } finally {
      setIsIngesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/dashboard')}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <svg
                  className="w-5 h-5 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  {project.name}
                </h1>
                <p className="text-xs text-gray-500">Cerebro Operativo</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500 hidden sm:block">
                {user?.email}
              </span>
              <button
                onClick={logout}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Content — Two columns */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Project Info */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8">
          <div className="max-w-3xl">
            {/* Description */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
              <h2 className="text-lg font-bold text-gray-900 mb-3">
                Descripción
              </h2>
              <p className="text-gray-600 leading-relaxed">
                {project.description || 'Sin descripción'}
              </p>
            </div>

            {/* Context Data */}
            {project.context_data &&
              Object.keys(project.context_data).length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-3">
                    Datos de Contexto
                  </h2>
                  <pre className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 overflow-x-auto">
                    {JSON.stringify(project.context_data, null, 2)}
                  </pre>
                </div>
              )}

            {/* Infrastructure URLs */}
            {project.infrastructure_urls &&
              Object.keys(project.infrastructure_urls).length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-3">
                    URLs de Infraestructura
                  </h2>
                  <pre className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700 overflow-x-auto">
                    {JSON.stringify(project.infrastructure_urls, null, 2)}
                  </pre>
                </div>
              )}

            {/* Members */}
            {project.members && project.members.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-3">
                  Equipo
                </h2>
                <div className="space-y-3">
                  {project.members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.user.email}
                        </p>
                        <p className="text-xs text-gray-500">
                          {member.user.globalRole}
                        </p>
                      </div>
                      <span className="text-xs font-medium bg-blue-100 text-blue-700 px-2.5 py-1 rounded-lg">
                        {member.projectRole}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* IA Index Status & Ingest */}
            <div className="bg-gradient-to-br from-violet-50 to-blue-50 rounded-2xl border border-violet-200 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center">
                  <svg
                    className="w-5 h-5 text-white"
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
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    Motor IA (RAG)
                  </h2>
                  <p className="text-sm text-gray-600">
                    {indexStatus?.isIndexed
                      ? `${indexStatus.chunksIndexed} fragmentos indexados`
                      : 'Proyecto no indexado aún'}
                  </p>
                </div>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Indexa el contexto del proyecto para que la IA pueda responder
                preguntas sobre él. Esto genera embeddings vectoriales del
                contenido.
              </p>

              <button
                onClick={handleIngest}
                disabled={isIngesting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-violet-200"
              >
                {isIngesting ? (
                  <>
                    <svg
                      className="animate-spin h-4 w-4"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Indexando...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    {indexStatus?.isIndexed
                      ? 'Re-indexar contexto'
                      : 'Indexar contexto'}
                  </>
                )}
              </button>

              {ingestMessage && (
                <p className="mt-3 text-sm font-medium text-gray-700">
                  {ingestMessage}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Chat Panel */}
        <div className="w-full lg:w-[420px] border-l border-gray-200 flex flex-col hidden lg:flex">
          <ChatPanel projectId={id!} projectName={project.name} />
        </div>
      </div>

      {/* Mobile Chat Toggle (floating button for small screens) */}
      <MobileChatToggle projectId={id!} projectName={project.name} />
    </div>
  );
};

/**
 * Chat flotante para dispositivos móviles
 */
const MobileChatToggle: React.FC<{
  projectId: string;
  projectName: string;
}> = ({ projectId, projectName }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="lg:hidden">
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-violet-600 hover:bg-violet-700 text-white rounded-full shadow-2xl shadow-violet-300 flex items-center justify-center transition-all z-50"
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </button>
      )}

      {/* Mobile chat overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between p-4 border-b">
            <span className="font-bold text-gray-900">Asistente IA</span>
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-gray-100 rounded-xl"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ChatPanel projectId={projectId} projectName={projectName} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectDetail;
