import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OllamaService, OllamaChatMessage } from './ollama.service';
import { EmbeddingService } from './embedding.service';
import { ProjectsService } from '../projects/projects.service';
import { Response } from 'express';

@Injectable()
export class IaService {
  private readonly logger = new Logger(IaService.name);

  constructor(
    private ollamaService: OllamaService,
    private embeddingService: EmbeddingService,
    private projectsService: ProjectsService,
  ) {}

  /**
   * Ingesta el contexto de un proyecto: extrae datos, hace chunking,
   * genera embeddings y los almacena en pgvector.
   */
  async ingestProject(
    projectId: string,
    additionalContext?: string,
  ): Promise<{ chunksCreated: number }> {
    const project = await this.projectsService.findById(projectId);

    return this.embeddingService.ingestProjectContext(
      projectId,
      project.context_data || {},
      project.infrastructure_urls || {},
      project.description || '',
      additionalContext,
    );
  }

  /**
   * Construye el System Prompt para el RAG.
   */
  private buildSystemPrompt(projectName: string, contextChunks: string[]): string {
    const context = contextChunks.join('\n\n---\n\n');

    return `Eres el asistente experto del proyecto "${projectName}" dentro de la plataforma "Cerebro Operativo".

REGLAS ESTRICTAS:
1. Tu conocimiento se LIMITA EXCLUSIVAMENTE a la información proporcionada en el contexto del proyecto.
2. Si no encuentras la respuesta en el contexto, di claramente: "No tengo esa información en el contexto actual del proyecto."
3. NO inventes ni supongas información que no esté en el contexto.
4. Responde siempre en español.
5. Sé conciso, profesional y útil.
6. Si te preguntan algo fuera del ámbito del proyecto, redirige al contexto disponible.

CONTEXTO DEL PROYECTO:
${context || 'No hay contexto indexado para este proyecto. Informa al usuario que necesita indexar el contexto primero.'}`;
  }

  /**
   * Motor RAG completo (sin streaming):
   * 1. Embebe la pregunta
   * 2. Busca chunks similares en pgvector
   * 3. Construye prompt con contexto
   * 4. Genera respuesta con el LLM
   */
  async chat(
    projectId: string,
    question: string,
  ): Promise<{ answer: string; sourcesCount: number }> {
    const project = await this.projectsService.findById(projectId);

    // 1. Buscar contexto relevante vía similitud vectorial
    const relevantChunks = await this.embeddingService.searchSimilar(
      projectId,
      question,
      5,
    );

    this.logger.log(
      `RAG: ${relevantChunks.length} chunks encontrados para "${question.substring(0, 50)}..."`,
    );

    // 2. Construir mensajes para el LLM
    const systemPrompt = this.buildSystemPrompt(
      project.name,
      relevantChunks.map((c) => c.content),
    );

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ];

    // 3. Obtener respuesta del LLM
    const answer = await this.ollamaService.chat(messages);

    return {
      answer,
      sourcesCount: relevantChunks.length,
    };
  }

  /**
   * Motor RAG con streaming:
   * Igual que chat() pero envía la respuesta token por token al cliente.
   */
  async chatStream(
    projectId: string,
    question: string,
    res: Response,
  ): Promise<void> {
    const project = await this.projectsService.findById(projectId);

    // 1. Buscar contexto relevante
    const relevantChunks = await this.embeddingService.searchSimilar(
      projectId,
      question,
      5,
    );

    this.logger.log(
      `RAG Stream: ${relevantChunks.length} chunks para "${question.substring(0, 50)}..."`,
    );

    // 2. Construir prompt
    const systemPrompt = this.buildSystemPrompt(
      project.name,
      relevantChunks.map((c) => c.content),
    );

    const messages: OllamaChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: question },
    ];

    // 3. Configurar respuesta como stream
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Sources-Count', relevantChunks.length.toString());

    // 4. Streaming desde Ollama al cliente
    await this.ollamaService.chatStream(
      messages,
      (content: string) => {
        res.write(content);
      },
      () => {
        res.end();
      },
    );
  }

  /**
   * Obtiene el estado de indexación de un proyecto.
   */
  async getIndexStatus(projectId: string): Promise<{
    projectId: string;
    chunksIndexed: number;
    isIndexed: boolean;
  }> {
    await this.projectsService.findById(projectId);
    const count = await this.embeddingService.getContextCount(projectId);

    return {
      projectId,
      chunksIndexed: count,
      isIndexed: count > 0,
    };
  }
}
