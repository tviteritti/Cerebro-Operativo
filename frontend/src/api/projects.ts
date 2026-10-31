import api from './axios';

export interface ProjectLink {
  label: string;
  url: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  context_data: Record<string, any>;
  infrastructure_urls: Record<string, any>;
  projectLinks?: ProjectLink[];
  gitRepositoryUrl?: string | null;
  gitDefaultBranch?: string;
  localRepositoryPath?: string | null;
  lastGitSyncAt?: string | null;
  lastGitCommitShort?: string | null;
  lastGitCommitMessage?: string | null;
  lastGitBranch?: string | null;
  lastGitSyncError?: string | null;
  createdAt: string;
  members?: ProjectMember[];
}

export interface ProjectMember {
  id: string;
  projectRole: string;
  user: {
    id: string;
    email: string;
    globalRole: string;
  };
}

export interface CreateProjectData {
  name: string;
  description?: string;
  context_data?: Record<string, any>;
  infrastructure_urls?: Record<string, any>;
  projectLinks?: ProjectLink[];
  gitRepositoryUrl?: string;
  gitDefaultBranch?: string;
  localRepositoryPath?: string;
}

export type UpdateProjectData = {
  name?: string;
  description?: string;
  context_data?: Record<string, any>;
  infrastructure_urls?: Record<string, any>;
  projectLinks?: ProjectLink[];
  gitRepositoryUrl?: string;
  gitDefaultBranch?: string;
  localRepositoryPath?: string;
};

export interface GitSyncResponse {
  repoPath: string;
  lastGitSyncAt: string | null;
  lastGitBranch: string | null;
  lastGitCommitShort: string | null;
  lastGitCommitMessage: string | null;
  lastGitSyncError: string | null;
}

export interface AssignMemberData {
  userId: string;
  projectRole: string;
}

export const projectsApi = {
  getAll: () => api.get<Project[]>('/projects'),
  getById: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (data: CreateProjectData) => api.post<Project>('/projects', data),
  update: (id: string, data: UpdateProjectData) =>
    api.patch<Project>(`/projects/${id}`, data),
  gitSync: (id: string) =>
    api.post<GitSyncResponse>(`/projects/${id}/git-sync`, {}),
  assignMember: (projectId: string, data: AssignMemberData) =>
    api.post(`/projects/${projectId}/members`, data),
  getMembers: (projectId: string) =>
    api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
};
