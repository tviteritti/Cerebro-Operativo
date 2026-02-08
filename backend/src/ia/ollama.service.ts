import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class OllamaService implements OnModuleInit {
  private readonly logger = new Logger(OllamaService.name);
  private client: AxiosInstance;
  private chatModel: string;
  private embedModel: string;

  constructor(private configService: ConfigService) {
    const baseURL = this.configService.get<string>(
      'OLLAMA_BASE_URL',
      'http://localhost:11434',
    );
    this.chatModel = this.configService.get<string>(
      'OLLAMA_CHAT_MODEL',
      'llama3.2',
    );
    this.embedModel = this.configService.get<string>(
      'OLLAMA_EMBED_MODEL',
      'nomic-embed-text',
    );

    this.client = axios.create({
      baseURL,
      timeout: 120000, // 2 min para respuestas largas
    });
  }

  async onModuleInit() {
    try {
      await this.client.get('/api/tags');
      this.logger.log(
        `✅ Ollama conectado | Chat: ${this.chatModel} | Embed: ${this.embedModel}`,
      );
    } catch {
      this.logger.warn(
        '⚠️  Ollama no disponible. Inicia Ollama y descarga los modelos necesarios.',
      );
    }
  }

  /**
   * Genera un embedding vector para un texto dado.
   * Usa el modelo nomic-embed-text (768 dimensiones).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.client.post('/api/embed', {
        model: this.embedModel,
        input: text,
      });
      // La API retorna { embeddings: [[...]] } para /api/embed
      return response.data.embeddings[0];
    } catch (error) {
      this.logger.error(`Error generando embedding: ${error.message}`);
      throw new Error('No se pudo generar el embedding. ¿Está Ollama corriendo?');
    }
  }

  /**
   * Genera embeddings en lote para múltiples textos.
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text);
      embeddings.push(embedding);
    }
    return embeddings;
  }

  /**
   * Chat con el LLM (respuesta completa, sin streaming).
   */
  async chat(messages: OllamaChatMessage[]): Promise<string> {
    try {
      const response = await this.client.post('/api/chat', {
        model: this.chatModel,
        messages,
        stream: false,
      });
      return response.data.message.content;
    } catch (error) {
      this.logger.error(`Error en chat: ${error.message}`);
      throw new Error('No se pudo obtener respuesta del LLM. ¿Está Ollama corriendo?');
    }
  }

  /**
   * Chat con streaming: devuelve un stream de la respuesta del LLM.
   * Cada chunk es un objeto { content: string, done: boolean }.
   */
  async chatStream(
    messages: OllamaChatMessage[],
    onChunk: (content: string) => void,
    onDone: () => void,
  ): Promise<void> {
    try {
      const response = await this.client.post(
        '/api/chat',
        {
          model: this.chatModel,
          messages,
          stream: true,
        },
        { responseType: 'stream' },
      );

      const stream = response.data;

      stream.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              onChunk(parsed.message.content);
            }
            if (parsed.done) {
              onDone();
            }
          } catch {
            // Ignorar líneas no-JSON
          }
        }
      });

      stream.on('error', (err: Error) => {
        this.logger.error(`Stream error: ${err.message}`);
        onDone();
      });
    } catch (error) {
      this.logger.error(`Error en chatStream: ${error.message}`);
      throw new Error('No se pudo iniciar streaming con el LLM.');
    }
  }
}
