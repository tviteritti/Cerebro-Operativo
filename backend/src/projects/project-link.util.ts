export interface ProjectLink {
  label: string;
  url: string;
}

/**
 * Compatibilidad: antes `link_urls` era string[]; ahora son objetos con título + URL.
 */
export function normalizeProjectLinks(raw: unknown): ProjectLink[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const out: ProjectLink[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const url = item.trim();
      if (url) out.push({ label: 'Enlace', url });
      continue;
    }
    if (item && typeof item === 'object') {
      const url = String((item as { url?: string }).url ?? '').trim();
      if (!url) continue;
      let label = String((item as { label?: string }).label ?? '').trim();
      if (!label) label = 'Enlace';
      out.push({
        label: label.slice(0, 160),
        url: url.slice(0, 2048),
      });
    }
  }
  return out;
}
