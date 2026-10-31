import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IaService } from './ia.service';
import { IaController } from './ia.controller';
import { OllamaService } from './ollama.service';
import { EmbeddingService } from './embedding.service';
import { ProjectToolsService } from './project-tools.service';
import { ProjectContext } from './entities/project-context.entity';
import { ProjectChat } from './entities/project-chat.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectChatsService } from './project-chats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectContext, ProjectChat, ChatMessage]),
    ProjectsModule,
  ],
  providers: [
    IaService,
    OllamaService,
    EmbeddingService,
    ProjectToolsService,
    ProjectChatsService,
  ],
  controllers: [IaController],
  exports: [IaService],
})
export class IaModule implements OnModuleInit {
  private readonly logger = new Logger(IaModule.name);

  constructor(private dataSource: DataSource) {}

  /**
   * Al iniciar el módulo, configura pgvector:
   * 1. Crea la extensión vector si no existe
   * 2. Añade la columna embedding a project_contexts si no existe
   */
  async onModuleInit() {
    try {
      // Habilitar extensión pgvector
      await this.dataSource.query(
        `CREATE EXTENSION IF NOT EXISTS vector`,
      );
      this.logger.log('✅ Extensión pgvector habilitada');

      // Agregar columna vector si no existe
      const columnExists = await this.dataSource.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'project_contexts' AND column_name = 'embedding'
      `);

      if (columnExists.length === 0) {
        await this.dataSource.query(`
          ALTER TABLE project_contexts
          ADD COLUMN embedding vector(768)
        `);
        this.logger.log('✅ Columna embedding (vector 768d) creada');
      } else {
        this.logger.log('✅ Columna embedding ya existe');
      }
    } catch (error) {
      this.logger.error(
        `❌ Error configurando pgvector: ${error.message}`,
      );
      this.logger.warn(
        'Asegúrate de usar la imagen pgvector/pgvector:pg16 en Docker',
      );
    }
  }
}
