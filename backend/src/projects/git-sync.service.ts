import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { Project } from './entities/project.entity';

const execFileP = promisify(execFile);

@Injectable()
export class GitSyncService {
  private readonly logger = new Logger(GitSyncService.name);

  constructor(
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    private config: ConfigService,
  ) {}

  getCloneBasePath(): string {
    return this.config.get<string>(
      'GIT_CLONE_BASE_PATH',
      path.join(process.cwd(), '.cerebro-git-workspaces'),
    );
  }

  private getGitToken(): string | undefined {
    return this.config.get<string>('GIT_PERSONAL_ACCESS_TOKEN')?.trim() || undefined;
  }

  getEffectivePath(project: Project): string | null {
    if (project.localRepositoryPath?.trim()) {
      return project.localRepositoryPath.trim();
    }
    if (project.gitRepositoryUrl?.trim()) {
      return path.join(this.getCloneBasePath(), project.id);
    }
    return null;
  }

  private withHttpsToken(remoteUrl: string, token: string | undefined): string {
    if (!token || !remoteUrl.startsWith('https://')) {
      return remoteUrl;
    }
    try {
      const u = new URL(remoteUrl);
      if (u.hostname.includes('github.com')) {
        u.username = 'oauth2';
        u.password = token;
        return u.toString();
      }
      u.username = 'x-token-auth';
      u.password = token;
      return u.toString();
    } catch {
      return remoteUrl;
    }
  }

  private async assertLocalPathIsGitRepo(absolute: string): Promise<void> {
    const allow = this.config.get<string>('ALLOW_ABSOLUTE_LOCAL_REPO', 'true');
    if (allow !== 'true') {
      const base = path.resolve(this.getCloneBasePath());
      const resolved = path.resolve(absolute);
      if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        throw new BadRequestException(
          'Ruta no permitida: usá un subdirectorio de GIT_CLONE_BASE_PATH o activá ALLOW_ABSOLUTE_LOCAL_REPO=true (solo en desarrollo de confianza).',
        );
      }
    }
    const stat = await fsp.stat(absolute).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new BadRequestException(
        'La ruta del repositorio no existe o no es una carpeta.',
      );
    }
    const gitDir = path.join(absolute, '.git');
    const g = await fsp.stat(gitDir).catch(() => null);
    if (!g) {
      throw new BadRequestException('La carpeta no es un repositorio Git (.git ausente).');
    }
  }

  private async runGit(
    args: string[],
    cwd: string,
    maxMs = 180_000,
  ): Promise<string> {
    this.logger.log(`git ${args.join(' ')} (cwd=${cwd})`);
    const { stdout, stderr } = await execFileP('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: maxMs,
    });
    if (stderr) {
      this.logger.debug(`git stderr: ${stderr}`);
    }
    return stdout;
  }

  private async getGitHeadMeta(
    repoPath: string,
  ): Promise<{
    lastGitCommitShort: string;
    lastGitCommitMessage: string;
    lastGitBranch: string;
  }> {
    const short = (
      await this.runGit(['rev-parse', '--short=12', 'HEAD'], repoPath)
    )
      .trim();
    const msg = (
      await this.runGit(['log', '-1', '--format=%B'], repoPath)
    )
      .trim()
      .slice(0, 2_000);
    const br = (await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath))
      .trim();
    return {
      lastGitCommitShort: short,
      lastGitCommitMessage: msg,
      lastGitBranch: br,
    };
  }

  private async updateProjectAfterSuccess(
    project: Project,
    meta: {
      lastGitCommitShort: string;
      lastGitCommitMessage: string;
      lastGitBranch: string;
    },
  ): Promise<void> {
    project.lastGitSyncAt = new Date();
    project.lastGitSyncError = null;
    project.lastGitCommitShort = meta.lastGitCommitShort;
    project.lastGitCommitMessage = meta.lastGitCommitMessage;
    project.lastGitBranch = meta.lastGitBranch;
    await this.projectRepo.save(project);
  }

  async setSyncError(project: Project, message: string): Promise<void> {
    project.lastGitSyncError = message.slice(0, 2_000);
    await this.projectRepo.save(project);
  }

  /**
   * Checkout de la rama configurada; si no existe (p. ej. main vs master), prueba la alternativa y guarda el proyecto.
   */
  private async checkoutPreferredBranch(
    repoPath: string,
    project: Project,
    preferred: string,
  ): Promise<string> {
    const pref = preferred?.trim() || 'main';
    const candidates: string[] = [pref];
    if (pref === 'main') {
      candidates.push('master');
    } else if (pref === 'master') {
      candidates.push('main');
    }

    for (const b of candidates) {
      try {
        await this.runGit(['checkout', b], repoPath);
        if (b !== pref && (pref === 'main' || pref === 'master')) {
          project.gitDefaultBranch = b;
          await this.projectRepo.save(project);
          this.logger.log(
            `Rama del remoto: '${b}' (ajustamos gitDefaultBranch desde '${pref}').`,
          );
        }
        return b;
      } catch {
        continue;
      }
    }

    const head = (
      await this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath)
    ).trim();
    this.logger.warn(
      `No existe la rama '${pref}' ni alternativa típica; se deja '${head}'.`,
    );
    return head;
  }

  async syncAndPersist(project: Project): Promise<{ repoPath: string }> {
    const local = project.localRepositoryPath?.trim();
    if (local) {
      await this.assertLocalPathIsGitRepo(local);
      const branch = project.gitDefaultBranch?.trim() || 'main';
      let lastErr: unknown;
      const tryWithRemote = async () => {
        await this.runGit(['fetch', 'origin'], local);
        const useBranch = await this.checkoutPreferredBranch(
          local,
          project,
          branch,
        );
        await this.runGit(
          ['pull', '--ff-only', 'origin', useBranch],
          local,
        );
      };
      try {
        await tryWithRemote();
      } catch (e) {
        lastErr = e;
        try {
          await this.runGit(['pull', '--ff-only'], local);
        } catch (e2) {
          const msg = messageChain(lastErr, e2);
          await this.setSyncError(project, msg);
          throw new BadRequestException(
            `No se pudo actualizar el repositorio local (¿sin remoto o sin red?). ${msg}`,
          );
        }
      }
      const meta = await this.getGitHeadMeta(local);
      await this.updateProjectAfterSuccess(project, meta);
      return { repoPath: local };
    }

    const remote = project.gitRepositoryUrl?.trim();
    if (!remote) {
      throw new BadRequestException(
        'Nada que sincronizar: configurá repositorio remoto (URL https) o ruta local a un clon de Git (en ajustes del proyecto).',
      );
    }
    if (!project.gitDefaultBranch) {
      project.gitDefaultBranch = 'main';
    }
    const branch = project.gitDefaultBranch;
    const token = this.getGitToken();
    const authUrl = this.withHttpsToken(remote, token);
    if (!token && remote.startsWith('https://')) {
      this.logger.warn('GIT_PERSONAL_ACCESS_TOKEN ausente: clone/pull a HTTPS privado fallará');
    }
    const base = this.getCloneBasePath();
    const target = path.join(base, project.id);
    await fsp.mkdir(base, { recursive: true });
    const hasGit = await fsp
      .stat(path.join(target, '.git'))
      .then((s) => s.isFile() || s.isDirectory())
      .catch(() => false);
    if (!hasGit) {
      if (remote.startsWith('https://') && !token) {
        throw new BadRequestException(
          'Repositorio HTTPS privado: en el servidor definí GIT_PERSONAL_ACCESS_TOKEN (PAT) en variables de entorno. No se almacena en Cerebro.',
        );
      }
      const tmp = `${target}.__cloning__`;
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => null);
      try {
        // Sin -b: usa la rama por defecto del remoto (master/main/etc.)
        await this.runGit(['clone', authUrl, tmp], base, 300_000);
        await this.checkoutPreferredBranch(tmp, project, branch);
        await fsp.rm(target, { recursive: true, force: true }).catch(() => null);
        await fsp.rename(tmp, target);
      } catch (e1) {
        await fsp.rm(tmp, { recursive: true, force: true }).catch(() => null);
        const msg = e1 instanceof Error ? e1.message : 'clone failed';
        await this.setSyncError(project, msg);
        if (!token && remote.startsWith('https://')) {
          throw new BadRequestException(
            'No se pudo clonar. Si el repo es privado, añadí GIT_PERSONAL_ACCESS_TOKEN. Detalle: ' +
              msg,
          );
        }
        throw new BadRequestException(`Clon no disponible. ${msg}`);
      }
    } else {
      await this.runGit(['remote', 'set-url', 'origin', authUrl], target).catch(
        async () => {
          await this.runGit(['remote', 'add', 'origin', authUrl], target);
        },
      );
      try {
        await this.runGit(['fetch', 'origin'], target);
        const useBranch = await this.checkoutPreferredBranch(
          target,
          project,
          branch,
        );
        await this.runGit(
          ['pull', '--ff-only', 'origin', useBranch],
          target,
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : 'pull';
        await this.setSyncError(project, m);
        throw new BadRequestException('git pull en el clon: ' + m);
      }
    }
    const meta = await this.getGitHeadMeta(target);
    await this.updateProjectAfterSuccess(project, meta);
    return { repoPath: target };
  }
}

function messageChain(
  a: unknown,
  b: unknown,
): string {
  const a1 = a instanceof Error ? a.message : '';
  const b1 = b instanceof Error ? b.message : '';
  return [a1, b1].filter(Boolean).join(' | ') || 'error';
}
