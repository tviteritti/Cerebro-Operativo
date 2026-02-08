import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { IaService } from './ia.service';
import { ChatQueryDto } from './dto/chat-query.dto';
import { IngestContextDto } from './dto/ingest-context.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('ia')
@UseGuards(JwtAuthGuard)
export class IaController {
  constructor(private iaService: IaService) {}

  /**
   * POST /api/ia/:projectId/ingest
   * Ingesta el contexto del proyecto: extrae datos, genera embeddings
   * y los almacena en pgvector para RAG.
   */
  @Post(':projectId/ingest')
  async ingestContext(
    @Param('projectId') projectId: string,
    @Body() ingestDto: IngestContextDto,
  ) {
    const result = await this.iaService.ingestProject(
      projectId,
      ingestDto.additionalContext,
    );
    return {
      message: `Contexto indexado exitosamente`,
      ...result,
    };
  }

  /**
   * POST /api/ia/:projectId/chat
   * Chat RAG: busca contexto relevante y genera respuesta con IA.
   * Soporta streaming (respuesta token por token).
   */
  @Post(':projectId/chat')
  async chat(
    @Param('projectId') projectId: string,
    @Body() chatQueryDto: ChatQueryDto,
    @Res() res: Response,
  ) {
    await this.iaService.chatStream(projectId, chatQueryDto.question, res);
  }

  /**
   * POST /api/ia/:projectId/chat-sync
   * Chat RAG sin streaming (respuesta completa de una vez).
   */
  @Post(':projectId/chat-sync')
  async chatSync(
    @Param('projectId') projectId: string,
    @Body() chatQueryDto: ChatQueryDto,
  ) {
    return this.iaService.chat(projectId, chatQueryDto.question);
  }

  /**
   * GET /api/ia/:projectId/status
   * Estado de indexación del proyecto.
   */
  @Get(':projectId/status')
  async getStatus(@Param('projectId') projectId: string) {
    return this.iaService.getIndexStatus(projectId);
  }
}
