import React from 'react';

export interface ProjectLinkRow {
  label: string;
  url: string;
}

interface ProjectLinksEditorProps {
  rows: ProjectLinkRow[];
  onChange: (rows: ProjectLinkRow[]) => void;
  compact?: boolean;
}

/**
 * Lista de enlaces con título + URL (dashboards, Jira, staging…).
 * No es el repositorio Git.
 */
const ProjectLinksEditor: React.FC<ProjectLinksEditorProps> = ({
  rows,
  onChange,
  compact,
}) => {
  const update = (i: number, patch: Partial<ProjectLinkRow>) => {
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  const remove = (i: number) => {
    onChange(rows.filter((_, j) => j !== i));
  };

  const inputCls = compact
    ? 'flex-1 min-w-[120px] px-3 py-2 border border-gray-300 rounded-xl text-sm'
    : 'flex-1 min-w-[140px] px-3 py-2 rounded-xl border border-gray-200 text-sm';

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-sm text-gray-500">
          Todavía no hay enlaces. Usá “Agregar” para añadir uno.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={row.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Título (ej. Staging)"
            className={inputCls}
            autoComplete="off"
          />
          <input
            type="url"
            value={row.url}
            onChange={(e) => update(i, { url: e.target.value })}
            placeholder="https://…"
            className={`${inputCls} min-w-[200px]`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="shrink-0 px-2 py-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg text-sm"
            aria-label="Quitar enlace"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { label: '', url: '' }])}
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        + Agregar enlace
      </button>
    </div>
  );
};

export default ProjectLinksEditor;
