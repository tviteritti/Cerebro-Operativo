import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsService } from './projects.service';
import { GitSyncService } from './git-sync.service';
import { ProjectsController } from './projects.controller';
import { Project } from './entities/project.entity';
import { ProjectMember } from './entities/project-member.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Project, ProjectMember]),
    UsersModule,
  ],
  providers: [ProjectsService, GitSyncService],
  controllers: [ProjectsController],
  exports: [ProjectsService, GitSyncService],
})
export class ProjectsModule {}
