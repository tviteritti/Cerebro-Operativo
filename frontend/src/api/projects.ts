import api from './axios';

export interface Project {
  id: string;
  name: string;
  description: string;
  context_data: Record<string, any>;
  infrastructure_urls: Record<string, any>;
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
}

export interface AssignMemberData {
  userId: string;
  projectRole: string;
}

export const projectsApi = {
  getAll: () => api.get<Project[]>('/projects'),
  getById: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (data: CreateProjectData) => api.post<Project>('/projects', data),
  assignMember: (projectId: string, data: AssignMemberData) =>
    api.post(`/projects/${projectId}/members`, data),
  getMembers: (projectId: string) =>
    api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  removeMember: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
};
