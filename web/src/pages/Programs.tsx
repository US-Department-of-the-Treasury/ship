import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { ProgramsListSkeleton } from '@/components/ui/Skeleton';

export function ProgramsPage() {
  const navigate = useNavigate();
  const { programs, loading, createProgram } = usePrograms();
  const [creating, setCreating] = useState(false);

  const handleCreateProgram = async () => {
    if (creating) return;
    setCreating(true);

    try {
      const program = await createProgram();
      if (program) {
        navigate(`/programs/${program.id}`);
      }
    } catch (err) {
      console.error('Failed to create program:', err);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <ProgramsListSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Programs</h1>
        <button
          onClick={handleCreateProgram}
          disabled={creating}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'New Program'}
        </button>
      </div>

      {/* Programs Grid */}
      <div className="flex-1 overflow-auto p-6">
        {programs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-muted">No programs yet</p>
              <button
                onClick={handleCreateProgram}
                disabled={creating}
                className="mt-2 text-sm text-accent hover:underline disabled:opacity-50"
              >
                Create your first program
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program) => (
              <ProgramCard
                key={program.id}
                program={program}
                onClick={() => navigate(`/programs/${program.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function ProgramCard({ program, onClick }: { program: Program; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-border/30"
    >
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: program.color }}
        >
          {program.prefix.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">{program.name}</h3>
          <p className="text-xs text-muted">{program.prefix}</p>
        </div>
      </div>

      {program.owner && (
        <div className="mt-4 flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-white">
            {getInitials(program.owner.name)}
          </div>
          <span className="text-xs text-muted truncate">{program.owner.name}</span>
        </div>
      )}
    </button>
  );
}
