import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { ProjectMember } from './project-member.entity';
import {
  normalizeProjectLinks,
  ProjectLink,
} from '../project-link.util';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: () => "'{}'::jsonb",
  })
  context_data: Record<string, any>;

  @Column({
    type: 'jsonb',
    nullable: true,
    default: () => "'{}'::jsonb",
  })
  infrastructure_urls: Record<string, any>;

  /**
   * Enlaces humanos (staging, Jira, docs…): título + URL. Distinto del repo Git.
   */
  @Column({
    name: 'link_urls',
    type: 'jsonb',
    nullable: true,
    /** Postgres no acepta DEFAULT [] sin cast; null → [] en normalizeProjectLinks */
    transformer: {
      to: (value: ProjectLink[]) =>
        Array.isArray(value) ? value : [],
      from: (value: unknown) => normalizeProjectLinks(value),
    },
  })
  projectLinks: ProjectLink[];

  /** Repo Git (clone/pull): solo esta URL; sin token en BD. */
  @Column({ name: 'git_repository_url', type: 'text', nullable: true })
  gitRepositoryUrl: string | null;

  /** Rama a seguir (pull/checkout). */
  @Column({ name: 'git_default_branch', type: 'varchar', length: 256, default: 'main' })
  gitDefaultBranch: string;

  /**
   * Ruta absoluta a un clon en el host (desarrollo o volumen en Docker).
   * Si se define, el sync hace `git pull` aquí; tiene prioridad sobre clon bajo GIT_CLONE_BASE_PATH.
   */
  @Column({ name: 'local_repository_path', type: 'text', nullable: true })
  localRepositoryPath: string | null;

  @Column({ name: 'last_git_sync_at', type: 'timestamptz', nullable: true })
  lastGitSyncAt: Date | null;

  @Column({ name: 'last_git_commit_short', type: 'varchar', length: 64, nullable: true })
  lastGitCommitShort: string | null;

  @Column({ name: 'last_git_commit_message', type: 'text', nullable: true })
  lastGitCommitMessage: string | null;

  @Column({ name: 'last_git_branch', type: 'varchar', length: 256, nullable: true })
  lastGitBranch: string | null;

  @Column({ name: 'last_git_sync_error', type: 'text', nullable: true })
  lastGitSyncError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ProjectMember, (pm) => pm.project)
  members: ProjectMember[];
}
