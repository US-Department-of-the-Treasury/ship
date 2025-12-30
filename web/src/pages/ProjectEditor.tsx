import { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { cn } from '@/lib/cn';

const PROJECT_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

export function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects, loading, updateProject: contextUpdateProject } = useProjects();

  // Get the current project from context
  const project = projects.find(p => p.id === id) || null;

  useEffect(() => {
    // If projects are loaded but this project isn't found, redirect
    if (!loading && id && !project) {
      navigate('/projects');
    }
  }, [loading, id, project, navigate]);

  const handleUpdateProject = useCallback(async (updates: Partial<Project>) => {
    if (!id) return;
    await contextUpdateProject(id, updates);
  }, [id, contextUpdateProject]);

  const handleTitleChange = useCallback((newTitle: string) => {
    handleUpdateProject({ name: newTitle });
  }, [handleUpdateProject]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!project || !user) {
    return null;
  }

  return (
    <Editor
      documentId={project.id}
      userName={user.name}
      initialTitle={project.name}
      onTitleChange={handleTitleChange}
      onBack={() => navigate('/projects')}
      roomPrefix="project"
      placeholder="Describe this project..."
      headerBadge={
        <div
          className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
          style={{ backgroundColor: project.color }}
        >
          {project.prefix.slice(0, 2)}
        </div>
      }
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Prefix">
              <input
                type="text"
                value={project.prefix}
                disabled
                className="w-full rounded bg-border/50 px-2 py-1 text-sm font-mono text-muted cursor-not-allowed"
              />
              <p className="mt-1 text-xs text-muted">Cannot be changed</p>
            </PropertyRow>

            <PropertyRow label="Color">
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleUpdateProject({ color: c })}
                    className={cn(
                      'h-6 w-6 rounded-full transition-transform',
                      project.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </PropertyRow>

            <div className="border-t border-border pt-4">
              <button
                onClick={() => navigate(`/projects/${project.id}/view`)}
                className="w-full rounded-md bg-border px-3 py-2 text-sm text-foreground hover:bg-border/80 transition-colors"
              >
                View Issues & Sprints
              </button>
            </div>
        </div>
      }
    />
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
