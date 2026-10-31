import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ProjectContext } from './entities/project-context.entity';
import { OllamaService } from './ollama.service';
import { ProjectLink } from '../projects/project-link.util';

/** Evita ingestas que superen tiempo/memoria (p. ej. tras sync + repo grande). */
const MAX_CHUNKS_PER_INGEST = 600;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    @InjectRepository(ProjectContext)
    private contextRepository: Repository<ProjectContext>,
    private ollamaService: OllamaService,
    private dataSource: DataSource,
  ) {}

  /**
   * Divide un texto largo en fragmentos (chunks) con overlap.
   */
  chunkText(text: string, chunkSize = 500, overlap = 100): string[] {
    if (!text || text.trim().length === 0) return [];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const chunk = text.slice(start, end).trim();
      if (chunk.length > 20) {
        // Ignorar chunks muy pequeños
        chunks.push(chunk);
      }
      start += chunkSize - overlap;
    }

    return chunks;
  }

  /**
   * Convierte un objeto JSONB en texto legible para embeddings.
   */
  flattenJsonToText(obj: Record<string, any>, prefix = ''): string {
    if (!obj || typeof obj !== 'object') return '';

    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const label = prefix ? `${prefix} > ${key}` : key;

      if (typeof value === 'string') {
        lines.push(`${label}: ${value}`);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${label}: ${value}`);
      } else if (Array.isArray(value)) {
        lines.push(`${label}: ${value.join(', ')}`);
      } else if (typeof value === 'object' && value !== null) {
        lines.push(this.flattenJsonToText(value, label));
      }
    }

    return lines.filter(Boolean).join('\n');
  }

  /**
   * Ingesta completa: toma los datos de un proyecto, hace chunking,
   * genera embeddings y los guarda en la DB con pgvector.
   */
  async ingestProjectContext(
    projectId: string,
    contextData: Record<string, any>,
    infrastructureUrls: Record<string, any>,
    description: string,
    projectLinks: ProjectLink[] = [],
    additionalContext?: string,
    repositoryText?: string,
  ): Promise<{ chunksCreated: number }> {
    // 1. Eliminar contexto previo del proyecto
    await this.dataSource.query(
      `DELETE FROM project_contexts WHERE project_id = $1::uuid`,
      [projectId],
    );

    // 2. Construir texto completo del proyecto
    const textParts: string[] = [];

    if (description) {
      textParts.push(`Descripción del proyecto: ${description}`);
    }

    if (contextData && Object.keys(contextData).length > 0) {
      textParts.push(
        `Datos de contexto del proyecto:\n${this.flattenJsonToText(contextData)}`,
      );
    }

    if (infrastructureUrls && Object.keys(infrastructureUrls).length > 0) {
      textParts.push(
        `URLs de infraestructura:\n${this.flattenJsonToText(infrastructureUrls)}`,
      );
    }

    const links = Array.isArray(projectLinks) ? projectLinks : [];
    if (links.length > 0) {
      textParts.push(
        `Enlaces de referencia del proyecto (no son el código):\n${links
          .filter((p) => p?.url?.trim())
          .map((p) => `- ${p.label || 'Enlace'}: ${p.url.trim()}`)
          .join('\n')}`,
      );
    }

    if (repositoryText && repositoryText.trim().length > 0) {
      const clip =
        repositoryText.length > 480_000
          ? repositoryText.slice(0, 480_000) +
            '\n\n[... repositorio truncado para indexación ...]'
          : repositoryText;
      textParts.push(`Código y archivos del repositorio:\n${clip}`);
    }

    if (additionalContext) {
      textParts.push(`Contexto adicional:\n${additionalContext}`);
    }

    const fullText = textParts.join('\n\n');

    if (fullText.trim().length === 0) {
      this.logger.warn(`Proyecto ${projectId}: sin contenido para indexar`);
      return { chunksCreated: 0 };
    }

    // 3. Dividir en chunks
    let chunks = this.chunkText(fullText);
    if (chunks.length > MAX_CHUNKS_PER_INGEST) {
      this.logger.warn(
        `Proyecto ${projectId}: truncando chunks de ${chunks.length} a ${MAX_CHUNKS_PER_INGEST} (límite de seguridad)`,
      );
      chunks = chunks.slice(0, MAX_CHUNKS_PER_INGEST);
    }
    this.logger.log(
      `Proyecto ${projectId}: ${chunks.length} chunks generados`,
    );

    // 4. Generar embeddings y guardar
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await this.ollamaService.generateEmbedding(chunks[i]);
      const vectorStr = `[${embedding.join(',')}]`;

      // Insertar con embedding usando SQL raw (TypeORM no soporta tipo vector)
      await this.dataSource.query(
        `INSERT INTO project_contexts (id, project_id, content, "chunkIndex", embedding)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4::vector)`,
        [projectId, chunks[i], i, vectorStr],
      );

      this.logger.debug(
        `  Chunk ${i + 1}/${chunks.length} indexado (${chunks[i].length} chars)`,
      );
    }

    this.logger.log(
      `✅ Proyecto ${projectId}: ${chunks.length} chunks indexados exitosamente`,
    );

    return { chunksCreated: chunks.length };
  }

  /**
   * Búsqueda por similitud vectorial: encuentra los chunks más relevantes
   * para una consulta dada usando distancia coseno.
   */
  async searchSimilar(
    projectId: string,
    queryText: string,
    topK = 5,
  ): Promise<{ content: string; similarity: number }[]> {
    // 1. Generar embedding de la consulta
    const queryEmbedding = await this.ollamaService.generateEmbedding(queryText);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // 2. Buscar chunks más similares con distancia coseno
    let results = await this.dataSource.query(
      `SELECT content, 1 - (embedding <=> $1::vector) as similarity
       FROM project_contexts
       WHERE project_id = $2::uuid
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vectorStr, projectId, topK],
    );

    if (!results?.length) {
      const n = await this.getContextCount(projectId);
      if (n > 0) {
        this.logger.warn(
          `RAG: la búsqueda vectorial devolvió 0 filas pero hay ${n} chunks; usando fragmentos iniciales como respaldo`,
        );
        results = await this.dataSource.query(
          `SELECT content, 0::float as similarity
           FROM project_contexts
           WHERE project_id = $1::uuid
             AND embedding IS NOT NULL
           ORDER BY "chunkIndex" ASC
           LIMIT $2`,
          [projectId, topK],
        );
      }
    }

    return (results || []).map((r: any) => ({
      content: r.content,
      similarity: parseFloat(r.similarity),
    }));
  }

  /**
   * Cuenta cuántos chunks tiene un proyecto indexados.
   */
  async getContextCount(projectId: string): Promise<number> {
    const result = await this.dataSource.query(
      `SELECT COUNT(*)::int as count FROM project_contexts WHERE project_id = $1::uuid AND embedding IS NOT NULL`,
      [projectId],
    );
    return parseInt(result[0].count, 10);
  }
}
