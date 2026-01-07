import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { CardGrid } from '@/components/CardGrid';
import { OfflineEmptyState, useOfflineEmptyState } from '@/components/OfflineEmptyState';
import { getContrastTextColor } from '@/lib/cn';

export function ProgramsPage() {
  const navigate = useNavigate();
  const { programs, loading, createProgram } = usePrograms();
  const isOfflineEmpty = useOfflineEmptyState(programs, loading);
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

  // Show offline empty state when offline with no cached data
  if (isOfflineEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <OfflineEmptyState resourceName="programs" />
      </div>
    );
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
        <CardGrid
          items={programs}
          loading={loading}
          columns={{ sm: 1, md: 2, lg: 3, xl: 3 }}
          renderCard={(program) => <ProgramCard program={program} />}
          onItemClick={(program) => navigate(`/programs/${program.id}`)}
          emptyState={
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
          }
        />
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

function ProgramCard({ program }: { program: Program }) {
  // Show emoji if set, otherwise show first letter of name
  const badge = program.emoji || program.name?.[0]?.toUpperCase() || '?';

  return (
    <div className="flex flex-col rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-border/30">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
        >
          {badge}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground truncate">{program.name}</h3>
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
    </div>
  );
}
