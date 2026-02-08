import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { GlobalRole } from '../../common/enums/global-role.enum';
import { ProjectMember } from '../../projects/entities/project-member.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({
    type: 'enum',
    enum: GlobalRole,
    default: GlobalRole.USER,
  })
  globalRole: GlobalRole;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ProjectMember, (pm) => pm.user)
  projectMemberships: ProjectMember[];
}
