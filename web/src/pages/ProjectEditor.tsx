import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { usePrograms } from '@/contexts/ProgramsContext';
import { useDocuments } from '@/contexts/DocumentsContext';
import { cn, getContrastTextColor } from '@/lib/cn';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { EmojiPickerPopover } from '@/components/EmojiPicker';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { computeICEScore } from '@ship/shared';

const API_URL = import.meta.env.VITE_API_URL ?? '';

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

// ICE score range (1-5)
const ICE_VALUES = [1, 2, 3, 4, 5] as const;

export function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projects, loading, updateProject: contextUpdateProject } = useProjects();
  const { programs } = usePrograms();
  const { createDocument } = useDocuments();
  const [people, setPeople] = useState<Person[]>([]);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  // Get the current project from context
  const project = projects.find(p => p.id === id) || null;

  // Fetch team members for owner selection (filter out pending users)
  useEffect(() => {
    fetch(`${API_URL}/api/team/people`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((data: Person[]) => setPeople(data.filter(p => p.user_id)))
      .catch(console.error);
  }, []);

  // Redirect if project not found after loading
  // Skip redirect for temp IDs (pending offline creation)
  useEffect(() => {
    if (!loading && id && !project && !id.startsWith('temp-')) {
      navigate('/projects');
    }
  }, [loading, id, project, navigate]);

  // Update handler using shared context
  const handleUpdateProject = useCallback(async (updates: Partial<Project>) => {
    if (!id) return;
    await contextUpdateProject(id, updates);
  }, [id, contextUpdateProject]);

  // Create sub-document (for slash commands)
  const handleCreateSubDocument = useCallback(async () => {
    if (!id) return null;
    const newDoc = await createDocument(id);
    if (newDoc) {
      return { id: newDoc.id, title: newDoc.title };
    }
    return null;
  }, [createDocument, id]);

  // Navigate to document (for slash commands and mentions)
  const handleNavigateToDocument = useCallback((docId: string) => {
    navigate(`/docs/${docId}`);
  }, [navigate]);

  // Throttled title save
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await handleUpdateProject({ title });
    },
  });

  if (loading) {
    return <EditorSkeleton />;
  }

  // For temp IDs (offline-created projects), create a placeholder
  const displayProject = project || (id?.startsWith('temp-') ? {
    id: id,
    title: 'Untitled',
    impact: 3,
    confidence: 3,
    ease: 3,
    ice_score: 27,
    color: '#6366f1',
    emoji: null,
    program_id: null,
    owner: null,
    sprint_count: 0,
    issue_count: 0,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _pending: true,
  } : null);

  if (!displayProject || !user) {
    return null;
  }

  const handleOwnerChange = (ownerId: string | null) => {
    if (!ownerId) {
      setOwnerError('Owner is required');
      return;
    }
    setOwnerError(null);
    handleUpdateProject({ owner_id: ownerId } as Partial<Project>);
  };

  // Compute ICE score from current values
  const iceScore = computeICEScore(displayProject.impact, displayProject.confidence, displayProject.ease);

  return (
    <Editor
      documentId={displayProject.id}
      userName={user.name}
      initialTitle={displayProject.title}
      onTitleChange={throttledTitleSave}
      onBack={() => navigate('/projects')}
      roomPrefix="project"
      placeholder="Describe this project..."
      onCreateSubDocument={handleCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      sidebar={
        <div className="space-y-4 p-4">
          {/* ICE Score Display */}
          <div className="rounded-lg border border-border bg-accent/10 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">ICE Score</span>
              <span className="text-2xl font-bold text-accent tabular-nums">{iceScore}</span>
            </div>
            <div className="text-xs text-muted">
              {displayProject.impact} × {displayProject.confidence} × {displayProject.ease} = {iceScore}
            </div>
          </div>

          {/* Impact Slider */}
          <PropertyRow label="Impact">
            <p className="text-xs text-muted mb-2">How much value will this deliver?</p>
            <ICESlider
              value={displayProject.impact}
              onChange={(value) => handleUpdateProject({ impact: value })}
              aria-label="Impact"
            />
          </PropertyRow>

          {/* Confidence Slider */}
          <PropertyRow label="Confidence">
            <p className="text-xs text-muted mb-2">How sure are we about the outcome?</p>
            <ICESlider
              value={displayProject.confidence}
              onChange={(value) => handleUpdateProject({ confidence: value })}
              aria-label="Confidence"
            />
          </PropertyRow>

          {/* Ease Slider */}
          <PropertyRow label="Ease">
            <p className="text-xs text-muted mb-2">How easy is this to implement?</p>
            <ICESlider
              value={displayProject.ease}
              onChange={(value) => handleUpdateProject({ ease: value })}
              aria-label="Ease"
            />
          </PropertyRow>

          {/* Owner (Required) */}
          <PropertyRow label="Owner">
            <PersonCombobox
              people={people}
              value={displayProject.owner?.id || null}
              onChange={handleOwnerChange}
              placeholder="Select owner... (required)"
            />
            {ownerError && (
              <p className="mt-1 text-xs text-red-500">{ownerError}</p>
            )}
            {!displayProject.owner && !ownerError && (
              <p className="mt-1 text-xs text-yellow-500">Owner is required for accountability</p>
            )}
          </PropertyRow>

          {/* Icon (Emoji) */}
          <PropertyRow label="Icon">
            <EmojiPickerPopover
              value={displayProject.emoji}
              onChange={(emoji) => handleUpdateProject({ emoji })}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg text-lg cursor-pointer hover:ring-2 hover:ring-accent transition-all"
                style={{ backgroundColor: displayProject.color, color: getContrastTextColor(displayProject.color) }}
              >
                {displayProject.emoji || displayProject.title?.[0]?.toUpperCase() || '?'}
              </div>
            </EmojiPickerPopover>
            <p className="mt-1 text-xs text-muted">Click to change</p>
          </PropertyRow>

          {/* Color */}
          <PropertyRow label="Color">
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleUpdateProject({ color: c })}
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform',
                    displayProject.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Select ${c} color`}
                />
              ))}
            </div>
          </PropertyRow>

          {/* Program (Optional) */}
          <PropertyRow label="Program">
            <select
              value={displayProject.program_id || ''}
              onChange={(e) => handleUpdateProject({ program_id: e.target.value || null })}
              className="w-full h-9 text-sm bg-transparent border border-border rounded-md px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">No program</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.emoji ? `${program.emoji} ` : ''}{program.name}
                </option>
              ))}
            </select>
          </PropertyRow>

          {/* Stats */}
          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Sprints</span>
              <span className="text-foreground">{displayProject.sprint_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Issues</span>
              <span className="text-foreground">{displayProject.issue_count}</span>
            </div>
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

// ICE Slider component (1-5 segmented buttons)
function ICESlider({
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  'aria-label': string;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={ariaLabel}>
      {ICE_VALUES.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            'flex-1 py-1.5 text-sm font-medium rounded transition-colors',
            value === v
              ? 'bg-accent text-white'
              : 'bg-border/50 text-muted hover:bg-border hover:text-foreground'
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
