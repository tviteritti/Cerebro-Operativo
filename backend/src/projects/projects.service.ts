import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { ProjectMember } from './entities/project-member.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { UsersService } from '../users/users.service';
import { GlobalRole } from '../common/enums/global-role.enum';
import { User } from '../users/entities/user.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private membersRepository: Repository<ProjectMember>,
    private usersService: UsersService,
  ) {}

  async create(createProjectDto: CreateProjectDto): Promise<Project> {
    const project = this.projectsRepository.create({
      ...createProjectDto,
      projectLinks: createProjectDto.projectLinks ?? [],
      gitDefaultBranch: createProjectDto.gitDefaultBranch || 'main',
    });
    if (createProjectDto.gitRepositoryUrl === '') {
      project.gitRepositoryUrl = null;
    }
    if (createProjectDto.localRepositoryPath === '') {
      project.localRepositoryPath = null;
    }
    return this.projectsRepository.save(project);
  }

  async assertCanAccessProject(
    user: Pick<User, 'id' | 'globalRole'>,
    project: Project,
  ): Promise<void> {
    if (user.globalRole === GlobalRole.ADMIN) {
      return;
    }
    const m = await this.membersRepository.findOne({
      where: { projectId: project.id, userId: user.id },
    });
    if (!m) {
      throw new ForbiddenException('Sin acceso a este proyecto');
    }
  }

  async update(
    user: Pick<User, 'id' | 'globalRole'>,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.findById(id);
    await this.assertCanAccessProject(user, project);
    if (dto.name !== undefined) {
      project.name = dto.name;
    }
    if (dto.description !== undefined) {
      project.description = dto.description;
    }
    if (dto.context_data !== undefined) {
      project.context_data = dto.context_data;
    }
    if (dto.infrastructure_urls !== undefined) {
      project.infrastructure_urls = dto.infrastructure_urls;
    }
    if (dto.projectLinks !== undefined) {
      project.projectLinks = dto.projectLinks;
    }
    if (dto.gitDefaultBranch !== undefined) {
      project.gitDefaultBranch = dto.gitDefaultBranch || 'main';
    }
    if (dto.gitRepositoryUrl !== undefined) {
      project.gitRepositoryUrl =
        dto.gitRepositoryUrl === '' ? null : dto.gitRepositoryUrl;
    }
    if (dto.localRepositoryPath !== undefined) {
      project.localRepositoryPath =
        dto.localRepositoryPath === '' ? null : dto.localRepositoryPath;
    }
    return this.projectsRepository.save(project);
  }

  async findAll(): Promise<Project[]> {
    return this.projectsRepository.find({
      relations: ['members', 'members.user'],
    });
  }

  async findById(id: string): Promise<Project> {
    const project = await this.projectsRepository.findOne({
      where: { id },
      relations: ['members', 'members.user'],
    });
    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }
    return project;
  }

  async findByUserId(userId: string): Promise<Project[]> {
    const memberships = await this.membersRepository.find({
      where: { userId },
      relations: ['project', 'project.members', 'project.members.user'],
    });
    return memberships.map((m) => m.project);
  }

  async assignMember(
    projectId: string,
    assignMemberDto: AssignMemberDto,
  ): Promise<ProjectMember> {
    const project = await this.findById(projectId);

    const user = await this.usersService.findById(assignMemberDto.userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const existingMember = await this.membersRepository.findOne({
      where: { projectId, userId: assignMemberDto.userId },
    });

    if (existingMember) {
      throw new BadRequestException(
        'El usuario ya es miembro de este proyecto',
      );
    }

    const member = this.membersRepository.create({
      projectId: project.id,
      userId: assignMemberDto.userId,
      projectRole: assignMemberDto.projectRole,
    });

    return this.membersRepository.save(member);
  }

  async getProjectMembers(projectId: string): Promise<ProjectMember[]> {
    await this.findById(projectId);
    return this.membersRepository.find({
      where: { projectId },
      relations: ['user'],
    });
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    const member = await this.membersRepository.findOne({
      where: { projectId, userId },
    });
    if (!member) {
      throw new NotFoundException('Miembro no encontrado en el proyecto');
    }
    await this.membersRepository.remove(member);
  }
}
