import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Res,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { IaService } from './ia.service';
import { ChatQueryDto } from './dto/chat-query.dto';
import { IngestContextDto } from './dto/ingest-context.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { PatchChatDto } from './dto/patch-chat.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProjectChatsService } from './project-chats.service';
import { User } from '../users/entities/user.entity';

@Controller('ia')
@UseGuards(JwtAuthGuard)
export class IaController {
  constructor(
    private iaService: IaService,
    private projectChatsService: ProjectChatsService,
  ) {}

  /**
   * POST /api/ia/:projectId/ingest
   */
  @Post(':projectId/ingest')
  async ingestContext(
    @Param('projectId') projectId: string,
    @Body() ingestDto: IngestContextDto,
  ) {
    const result = await this.iaService.ingestProject(
      projectId,
      ingestDto.additionalContext,
      { syncFromGit: ingestDto.syncFromGit === true },
    );
    return {
      message: `Contexto indexado exitosamente`,
      ...result,
    };
  }

  /** Lista hilos del proyecto (usuario actual). Crea el chat de notas si no existe. */
  @Get(':projectId/chats')
  async listChats(
    @Param('projectId') projectId: string,
    @Request() req: { user: User },
  ) {
    return this.projectChatsService.list(projectId, req.user);
  }

  @Post(':projectId/chats')
  async createChat(
    @Param('projectId') projectId: string,
    @Request() req: { user: User },
    @Body() dto: CreateChatDto,
  ) {
    return this.projectChatsService.create(projectId, req.user, dto.kind, dto.title);
  }

  @Patch(':projectId/chats/:chatId')
  async renameChat(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Request() req: { user: User },
    @Body() dto: PatchChatDto,
  ) {
    return this.projectChatsService.updateTitle(
      projectId,
      chatId,
      req.user,
      dto.title,
    );
  }

  @Delete(':projectId/chats/:chatId')
  async deleteChat(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Request() req: { user: User },
  ) {
    await this.projectChatsService.remove(projectId, chatId, req.user);
    return { ok: true };
  }

  @Get(':projectId/chats/:chatId/messages')
  async listMessages(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Request() req: { user: User },
  ) {
    await this.projectChatsService.getChatOrThrow(projectId, chatId, req.user);
    return this.projectChatsService.listMessagesRaw(chatId);
  }

  /**
   * POST /api/ia/:projectId/chats/:chatId/chat — streaming (text/plain o NDJSON agente).
   */
  @Post(':projectId/chats/:chatId/chat')
  async chatStream(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Body() chatQueryDto: ChatQueryDto,
    @Res() res: Response,
    @Request() req: { user: User },
  ) {
    await this.iaService.chatStreamInThread(
      projectId,
      chatId,
      req.user,
      chatQueryDto.question,
      res,
      {
        useAgentTools: chatQueryDto.useAgentTools === true,
      },
    );
  }

  @Post(':projectId/chats/:chatId/chat-sync')
  async chatSync(
    @Param('projectId') projectId: string,
    @Param('chatId') chatId: string,
    @Body() chatQueryDto: ChatQueryDto,
    @Request() req: { user: User },
  ) {
    return this.iaService.chatInThread(
      projectId,
      chatId,
      req.user,
      chatQueryDto.question,
      {
        useAgentTools: chatQueryDto.useAgentTools === true,
      },
    );
  }

  @Get(':projectId/status')
  async getStatus(@Param('projectId') projectId: string) {
    return this.iaService.getIndexStatus(projectId);
  }
}
