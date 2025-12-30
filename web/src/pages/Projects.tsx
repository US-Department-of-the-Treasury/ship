import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { ProjectsListSkeleton } from '@/components/ui/Skeleton';

export function ProjectsPage() {
  const navigate = useNavigate();
  const { projects, loading, createProject } = useProjects();
  const [creating, setCreating] = useState(false);

  const handleCreateProject = async () => {
    if (creating) return;
    setCreating(true);

    try {
      const project = await createProject();
      if (project) {
        navigate(`/projects/${project.id}`);
      }
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <ProjectsListSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Projects</h1>
        <button
          onClick={handleCreateProject}
          disabled={creating}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'New Project'}
        </button>
      </div>

      {/* Projects Grid */}
      <div className="flex-1 overflow-auto p-6">
        {projects.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-muted">No projects yet</p>
              <button
                onClick={handleCreateProject}
                disabled={creating}
                className="mt-2 text-sm text-accent hover:underline disabled:opacity-50"
              >
                Create your first project
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const issueCount = project.issue_count ?? 0;
  const sprintCount = project.sprint_count ?? 0;

  return (
    <button
      onClick={onClick}
      className="flex flex-col rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-border/30"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: project.color }}
        >
          {project.prefix.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">{project.name}</h3>
          <p className="text-xs text-muted">{project.prefix}</p>
        </div>
      </div>

      <div className="mt-4 flex gap-4 text-xs text-muted">
        <span>{issueCount} issue{issueCount !== 1 ? 's' : ''}</span>
        <span>{sprintCount} sprint{sprintCount !== 1 ? 's' : ''}</span>
      </div>
    </button>
  );
}
