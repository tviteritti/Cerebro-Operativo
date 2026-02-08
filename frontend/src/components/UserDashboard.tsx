import React from 'react';
import { Project } from '../api/projects';

interface UserDashboardProps {
  projects: Project[];
}

const UserDashboard: React.FC<UserDashboardProps> = ({ projects }) => {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Mis Proyectos</h2>
        <p className="text-gray-500 mt-1">
          Proyectos a los que has sido asignado
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200">
          <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-gray-600">
            No tienes proyectos asignados
          </h3>
          <p className="text-gray-400 mt-1">
            Contacta a un administrador para que te asigne a un proyecto
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg hover:border-emerald-200 transition-all group cursor-pointer"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                </div>
                <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
                  {project.members?.length || 0} miembros
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 group-hover:text-emerald-600 transition-colors">
                {project.name}
              </h3>
              <p className="text-gray-500 text-sm mt-1 line-clamp-2">
                {project.description || 'Sin descripción'}
              </p>
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {new Date(project.createdAt).toLocaleDateString('es-MX')}
                </span>
                <span className="text-xs font-medium text-blue-500 bg-blue-50 px-2 py-1 rounded-lg">
                  Acceder
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserDashboard;
