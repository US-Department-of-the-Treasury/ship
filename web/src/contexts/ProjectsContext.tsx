/**
 * @deprecated Use useUnifiedDocuments from '@/hooks/useUnifiedDocuments' instead.
 *
 * This context is maintained for backward compatibility but should not be used
 * for new code. The unified document model treats all document types consistently
 * through a single hook.
 *
 * Migration:
 *   Before: const { projects } = useProjects()
 *   After:  const { byType: { project: projects } } = useUnifiedDocuments({ type: 'project' })
 */
import { createContext, useContext, ReactNode } from 'react';
import { useProjects as useProjectsQuery, Project, CreateProjectOptions } from '@/hooks/useProjectsQuery';

export type { Project, CreateProjectOptions };

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  createProject: (options: CreateProjectOptions) => Promise<Project | null>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;
  refreshProjects: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const projectsData = useProjectsQuery();

  return (
    <ProjectsContext.Provider value={projectsData}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error('useProjects must be used within ProjectsProvider');
  }
  return context;
}
