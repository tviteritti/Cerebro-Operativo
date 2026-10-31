import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  projectsApi,
  Project,
  type UpdateProjectData,
} from '../api/projects';
import { iaApi, IndexStatus } from '../api/ia';
import ChatPanel from '../components/ChatPanel';
import ProjectLinksEditor, {
  type ProjectLinkRow,
} from '../components/ProjectLinksEditor';

const ProjectDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout, isAdmin } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestMessage, setIngestMessage] = useState('');
  const [syncFromGitOnIngest, setSyncFromGitOnIngest] = useState(false);
  const [formProjectLinks, setFormProjectLinks] = useState<ProjectLinkRow[]>(
    [],
  );
  const [formGitUrl, setFormGitUrl] = useState('');
  const [formBranch, setFormBranch] = useState('main');
  const [formLocalPath, setFormLocalPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    if (id) {
      loadProject();
      loadIndexStatus();
    }
  }, [id]);

  useEffect(() => {
    if (!project) return;
    const pl = project.projectLinks;
    if (pl && pl.length > 0) {
      setFormProjectLinks(
        pl.map((p) => ({
          label: p.label ?? '',
          url: p.url ?? '',
        })),
      );
    } else {
      setFormProjectLinks([]);
    }
    setFormGitUrl(project.gitRepositoryUrl || '');
    setFormBranch(project.gitDefaultBranch || 'main');
    setFormLocalPath(project.localRepositoryPath || '');
  }, [
    project?.id,
    project?.gitRepositoryUrl,
    project?.projectLinks,
    project?.localRepositoryPath,
  ]);

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

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSettingsMsg('');
    const projectLinks = formProjectLinks
      .filter((r) => r.url.trim())
      .map((r) => ({
        label: (r.label.trim() || 'Enlace').slice(0, 160),
        url: r.url.trim(),
      }));
    const payload: UpdateProjectData = {
      projectLinks,
      gitDefaultBranch: formBranch.trim() || 'main',
      gitRepositoryUrl: formGitUrl.trim() || '',
      localRepositoryPath: formLocalPath.trim() || '',
    };
    try {
      const { data } = await projectsApi.update(id!, payload);
      setProject(data);
      setSettingsMsg('Cambios guardados.');
    } catch (err: any) {
      setSettingsMsg(
        err.response?.data?.message || 'No se pudo guardar la configuración.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleGitSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { data } = await projectsApi.gitSync(id!);
      setProject((p) =>
        p
          ? {
              ...p,
              lastGitSyncAt: data.lastGitSyncAt,
              lastGitBranch: data.lastGitBranch,
              lastGitCommitShort: data.lastGitCommitShort,
              lastGitCommitMessage: data.lastGitCommitMessage,
              lastGitSyncError: data.lastGitSyncError,
            }
          : p,
      );
      await loadProject();
      setSyncMsg('Repositorio actualizado. Podés re-indexar para mezclar el código al RAG.');
    } catch (err: any) {
      setSyncMsg(
        err.response?.data?.message || 'Error al sincronizar con Git.',
      );
    } finally {
      setSyncing(false);
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
      const response = await iaApi.ingest(id!, {
        syncFromGit: syncFromGitOnIngest,
      });
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
    <div className="h-screen max-h-[100dvh] overflow-hidden bg-gray-50 flex flex-col">
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

      {/* Content — Two columns (min-h-0 evita que la columna derecha estire la página sin límite) */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Project Info */}
        <div className="flex-1 overflow-y-auto min-h-0 p-6 lg:p-8">
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

            <form
              onSubmit={saveSettings}
              className="bg-white rounded-2xl border border-gray-200 p-6 mb-6 space-y-6"
            >
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  Configuración del proyecto
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Hay <strong className="text-gray-700">dos cosas distintas</strong>:
                  enlaces útiles (web) y el <strong className="text-gray-700">repo Git</strong>{' '}
                  para bajar código. El token de GitHub/Bitbucket va solo en el servidor
                  (<code className="text-xs bg-gray-100 px-1 rounded">GIT_PERSONAL_ACCESS_TOKEN</code>
                  ), no aquí.
                </p>
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-2">
                <h3 className="text-base font-semibold text-gray-900">
                  Enlaces de referencia
                </h3>
                <p className="text-sm text-gray-500">
                  Dashboards, staging, Jira, docs… Solo texto para el contexto de la IA.
                  No sirven para hacer <code className="text-xs">git pull</code>.
                </p>
                <ProjectLinksEditor
                  rows={formProjectLinks}
                  onChange={setFormProjectLinks}
                />
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <h3 className="text-base font-semibold text-gray-900">
                  Repositorio Git (código)
                </h3>
                <p className="text-sm text-gray-500">
                  Es la dirección que usa el servidor para <strong>clonar o actualizar</strong>{' '}
                  el proyecto. Guardá acá y después usá{' '}
                  <strong>Sincronizar repositorio</strong> para hacer pull (o marcá sincronizar
                  al indexar).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      URL del repo (https, sin token)
                    </label>
                    <input
                      type="url"
                      value={formGitUrl}
                      onChange={(e) => setFormGitUrl(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      placeholder="https://github.com/org/repo.git"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Rama a seguir
                    </label>
                    <input
                      value={formBranch}
                      onChange={(e) => setFormBranch(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      placeholder="main"
                    />
                  </div>
                </div>
              </div>

              <details className="border border-dashed border-gray-200 rounded-xl p-4 bg-gray-50/80">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">
                  Opciones avanzadas — carpeta Git en tu PC
                </summary>
                <p className="text-sm text-gray-500 mt-2 mb-2">
                  Solo si ya tenés el repo clonado en disco y querés que el sync haga{' '}
                  <code className="text-xs">git pull</code> ahí en lugar del clon del servidor.
                  Si solo configurás la URL de arriba, el sistema descarga solo en el servidor;
                  no necesitás esta ruta.
                </p>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ruta absoluta al clon (opcional)
                </label>
                <input
                  value={formLocalPath}
                  onChange={(e) => setFormLocalPath(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono bg-white"
                  placeholder="Vacío = usar solo el clon del servidor"
                />
              </details>
              {settingsMsg && (
                <p
                  className={
                    settingsMsg.startsWith('Cambios')
                      ? 'text-sm text-emerald-600'
                      : 'text-sm text-red-600'
                  }
                >
                  {settingsMsg}
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={handleGitSync}
                  disabled={syncing}
                  className="px-4 py-2 border border-indigo-200 text-indigo-800 text-sm font-medium rounded-xl hover:bg-indigo-50 disabled:opacity-50"
                >
                  {syncing ? 'Sincronizando…' : 'Sincronizar repositorio (git)'}
                </button>
              </div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
                <p>
                  <span className="font-medium text-slate-900">Última sync:</span>{' '}
                  {project.lastGitSyncAt
                    ? new Date(project.lastGitSyncAt).toLocaleString('es-AR')
                    : 'nunca'}
                </p>
                {project.lastGitBranch && (
                  <p>
                    <span className="font-medium text-slate-900">Rama:</span>{' '}
                    {project.lastGitBranch}
                  </p>
                )}
                {project.lastGitCommitShort && (
                  <p>
                    <span className="font-medium text-slate-900">Commit:</span>{' '}
                    {project.lastGitCommitShort}{' '}
                    {project.lastGitCommitMessage
                      ? `— ${project.lastGitCommitMessage.split('\n')[0]}`
                      : null}
                  </p>
                )}
                {project.lastGitSyncError && (
                  <p className="text-red-600">
                    <span className="font-medium">Error:</span>{' '}
                    {project.lastGitSyncError}
                  </p>
                )}
                {syncMsg && (
                  <p className="text-indigo-700 font-medium pt-1">{syncMsg}</p>
                )}
              </div>
            </form>

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
                preguntas sobre él. Incluye enlaces, metadatos y, si tenés
                repositorio sincronizado, una muestra de código.
              </p>
              <label className="flex items-center gap-2 mb-4 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={syncFromGitOnIngest}
                  onChange={(e) => setSyncFromGitOnIngest(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Sincronizar repositorio (git pull) antes de indexar
              </label>

              <button
                type="button"
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

        {/* Right: Chat Panel — altura limitada al viewport; scroll interno en ChatPanel */}
        <div className="w-full lg:w-[min(36rem,100%)] border-l border-gray-200 flex flex-col min-h-0 max-h-full hidden lg:flex">
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
