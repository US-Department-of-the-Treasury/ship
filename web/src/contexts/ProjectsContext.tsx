import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface Project {
  id: string;
  name: string;
  prefix: string;
  color: string;
  archived_at: string | null;
  issue_count?: number;
  sprint_count?: number;
}

interface ProjectsContextValue {
  projects: Project[];
  loading: boolean;
  createProject: () => Promise<Project | null>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<Project | null>;
  refreshProjects: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const createProject = useCallback(async (): Promise<Project | null> => {
    try {
      const res = await fetch(`${API_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled' }),
      });
      if (res.ok) {
        const project = await res.json();
        setProjects(prev => [project, ...prev]);
        return project;
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    }
    return null;
  }, []);

  const updateProject = useCallback(async (id: string, updates: Partial<Project>): Promise<Project | null> => {
    try {
      // Map frontend field names to API field names (API uses 'title', returns as 'name')
      const apiUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) apiUpdates.title = updates.name;
      if (updates.color !== undefined) apiUpdates.color = updates.color;
      if (updates.archived_at !== undefined) apiUpdates.archived_at = updates.archived_at;

      const res = await fetch(`${API_URL}/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(apiUpdates),
      });
      if (res.ok) {
        const updated = await res.json();
        // Update the project in the shared state, preserving counts from existing data
        setProjects(prev => prev.map(p => p.id === id ? {
          ...p, // preserve existing fields like issue_count, sprint_count
          ...updated // apply updates from API
        } : p));
        return updated;
      }
    } catch (err) {
      console.error('Failed to update project:', err);
    }
    return null;
  }, []);

  return (
    <ProjectsContext.Provider value={{ projects, loading, createProject, updateProject, refreshProjects }}>
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
