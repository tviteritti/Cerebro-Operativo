import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ProjectChat } from './project-chat.entity';

@Entity('chat_messages')
@Index(['chatId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'chat_id' })
  chatId: string;

  @ManyToOne(() => ProjectChat, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat: ProjectChat;

  @Column({ type: 'varchar', length: 16 })
  role: 'user' | 'assistant';

  /** Pregunta o respuesta del modelo (texto plano). */
  @Column('text')
  content: string;

  /** Opcional: eventos del agente (NDJSON resumido) para la UI. */
  @Column({ type: 'jsonb', nullable: true })
  meta: { agentEvents?: unknown[] } | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
