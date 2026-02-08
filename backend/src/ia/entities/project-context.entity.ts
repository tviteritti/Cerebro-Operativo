import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Project } from '../../projects/entities/project.entity';

@Entity('project_contexts')
export class ProjectContext {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id' })
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Project;

  @Column('text')
  content: string;

  @Column({ type: 'int', default: 0 })
  chunkIndex: number;

  @CreateDateColumn()
  createdAt: Date;

  // Nota: La columna 'embedding' (tipo vector(768)) se gestiona via SQL raw
  // porque TypeORM no soporta el tipo vector de pgvector nativamente.
}
