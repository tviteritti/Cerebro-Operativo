import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './entities/project.entity';
import { ProjectMember } from './entities/project-member.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { UsersService } from '../users/users.service';

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
    const project = this.projectsRepository.create(createProjectDto);
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
