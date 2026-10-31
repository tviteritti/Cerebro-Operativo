/**
 * Esquemas de herramientas para Ollama (/api/chat `tools`).
 * Solo lectura sobre el clon local. No hay git pull/checkout: eso lo hace el usuario (Sincronizar / indexar).
 */
export const PROJECT_AGENT_TOOLS: Record<string, unknown>[] = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'Lista archivos y carpetas (un nivel) en una ruta relativa al raíz del repositorio. Usa "." para la raíz.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Ruta relativa, p. ej. "src" o "." (vacío se interpreta como ".")',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Lee un **archivo** de texto (ruta relativa al raíz del repo). ' +
        'No funciona con **carpetas solas** (usá list_directory); si pasás un directorio, la herramienta te devuelve el listado y te indica el siguiente paso. ' +
        'Acepta **un patrón en el último segmento**: p. ej. "supabase/migration/*.sql" lee varios .sql de esa carpeta (coincidencias de nombre, sin ** en subcarpetas).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Ruta a un archivo, o patrón con * o ? solo en el nombre final, p. ej. "migrations/*.sql"',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_investigation_plan',
      description:
        'Antes de buscar a ciegas: pide al modelo un plan para el objetivo. Devuelve archivos a leer primero (p. ej. package.json) y listas de subcadenas para búsqueda literal, con sinónimos y posibles typos. ' +
        'Usala para preguntas abiertas: "qué stack de estilos usa el front", "cómo se hace el deploy", "dónde está el CI", etc.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description:
              'Qué se quiere averiguar en el repositorio (misma intención que la pregunta del usuario, en lenguaje natural o técnico)',
          },
        },
        required: ['goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_in_repository',
      description:
        'Búsqueda **literal** por subcadena (estilo grep, insensible a mayúsculas), no semántica. ' +
        'Con "queries" (varias cadenas) la línea matchea si contiene **cualquiera** (OR) — útil con términos sugeridos por suggest_investigation_plan o para typos. ' +
        'Excluye node_modules, .git, etc. Devuelve archivo:línea.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Una sola subcadena (si no usás "queries")',
          },
          q: {
            type: 'string',
            description:
              'Alias de query, o a veces un array en string JSON: ambos aceptan búsqueda OR si parsea a lista de términos',
          },
          queries: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Cadenas planas para búsqueda OR (p. ej. "create table", "supabase", "migration"). ' +
              'No envolver cada ítem con comillas escapadas ni con JSON anidado; Ollama debe recibir un array de strings reales. Si una palabra "falla", probá términos de migraciones o nombres de archivos, no oraciones completas.',
          },
          max_results: {
            type: 'integer',
            description: 'Máximo de coincidencias (por defecto 30)',
          },
        },
        required: [],
      },
    },
  },
];
