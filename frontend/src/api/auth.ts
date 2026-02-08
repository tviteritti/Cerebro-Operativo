import api from './axios';

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    globalRole: 'ADMIN' | 'USER';
  };
}

export const authApi = {
  login: (data: LoginData) => api.post<AuthResponse>('/auth/login', data),
  register: (data: RegisterData) => api.post('/auth/register', data),
  getProfile: () => api.get('/auth/profile'),
};
