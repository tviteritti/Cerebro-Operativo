import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Delete,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { GitSyncService } from './git-sync.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignMemberDto } from './dto/assign-member.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GlobalRole } from '../common/enums/global-role.enum';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProjectsController {
  constructor(
    private projectsService: ProjectsService,
    private gitSyncService: GitSyncService,
  ) {}

  @Post()
  @Roles(GlobalRole.ADMIN)
  async create(@Body() createProjectDto: CreateProjectDto) {
    return this.projectsService.create(createProjectDto);
  }

  @Get()
  async findAll(@Request() req) {
    if (req.user.globalRole === GlobalRole.ADMIN) {
      return this.projectsService.findAll();
    }
    return this.projectsService.findByUserId(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.projectsService.findById(id);
  }

  @Patch(':id')
  async update(
    @Request() req: { user: { id: string; globalRole: GlobalRole } },
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(req.user, id, dto);
  }

  @Post(':id/git-sync')
  async gitSync(
    @Request() req: { user: { id: string; globalRole: GlobalRole } },
    @Param('id') id: string,
  ) {
    const p = await this.projectsService.findById(id);
    await this.projectsService.assertCanAccessProject(req.user, p);
    const { repoPath } = await this.gitSyncService.syncAndPersist(p);
    const updated = await this.projectsService.findById(id);
    return {
      repoPath,
      lastGitSyncAt: updated.lastGitSyncAt,
      lastGitBranch: updated.lastGitBranch,
      lastGitCommitShort: updated.lastGitCommitShort,
      lastGitCommitMessage: updated.lastGitCommitMessage,
      lastGitSyncError: updated.lastGitSyncError,
    };
  }

  @Post(':id/members')
  @Roles(GlobalRole.ADMIN)
  async assignMember(
    @Param('id') projectId: string,
    @Body() assignMemberDto: AssignMemberDto,
  ) {
    return this.projectsService.assignMember(projectId, assignMemberDto);
  }

  @Get(':id/members')
  async getMembers(@Param('id') projectId: string) {
    return this.projectsService.getProjectMembers(projectId);
  }

  @Delete(':id/members/:userId')
  @Roles(GlobalRole.ADMIN)
  async removeMember(
    @Param('id') projectId: string,
    @Param('userId') userId: string,
  ) {
    return this.projectsService.removeMember(projectId, userId);
  }
}
