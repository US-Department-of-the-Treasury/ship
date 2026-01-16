import { cn, getContrastTextColor } from '@/lib/cn';
import { EmojiPickerPopover } from '@/components/EmojiPicker';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { Tooltip } from '@/components/ui/Tooltip';
import { computeICEScore } from '@ship/shared';

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

const ICE_VALUES = [1, 2, 3, 4, 5] as const;

interface Project {
  id: string;
  title: string;
  impact: number;
  confidence: number;
  ease: number;
  ice_score?: number;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string } | null;
  owner_id?: string | null;
  sprint_count?: number;
  issue_count?: number;
  converted_from_id?: string | null;
}

interface Program {
  id: string;
  name: string;
  emoji?: string | null;
}

interface ProjectSidebarProps {
  project: Project;
  programs: Program[];
  people: Person[];
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
}

export function ProjectSidebar({
  project,
  programs,
  people,
  onUpdate,
  onConvert,
  onUndoConversion,
  isConverting = false,
  isUndoing = false,
}: ProjectSidebarProps) {
  // Compute ICE score from current values
  const iceScore = computeICEScore(project.impact, project.confidence, project.ease);

  return (
    <div className="space-y-4 p-4">
      {/* Undo Conversion Banner */}
      {project.converted_from_id && onUndoConversion && (
        <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
          <p className="mb-2 text-sm text-blue-300">This project was promoted from an issue.</p>
          <button
            onClick={onUndoConversion}
            disabled={isUndoing}
            className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isUndoing ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Undoing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Undo Conversion
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-blue-300/70 text-center">Restore the original issue</p>
        </div>
      )}

      {/* ICE Score Display */}
      <div className="rounded-lg border border-border bg-accent/10 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted uppercase tracking-wide">ICE Score</span>
          <span className="text-2xl font-bold text-accent tabular-nums">{iceScore}</span>
        </div>
        <div className="text-xs text-muted">
          {project.impact} × {project.confidence} × {project.ease} = {iceScore}
        </div>
      </div>

      {/* Impact Slider */}
      <PropertyRow
        label="Impact"
        tooltip={`Expected value in next 12 months:\n5 - More than $1b\n4 - More than $100m\n3 - More than $10m\n2 - More than $1m\n1 - More than $100k`}
      >
        <p className="text-xs text-muted mb-2">How much value will this deliver?</p>
        <ICESlider
          value={project.impact}
          onChange={(value) => onUpdate({ impact: value })}
          aria-label="Impact"
        />
      </PropertyRow>

      {/* Confidence Slider */}
      <PropertyRow
        label="Confidence"
        tooltip={`How likely is this to succeed?\n5 - 100% certain, trivial complexity\n4 - 80% certain, familiar territory\n3 - 60% certain, somewhat complex\n2 - 40% certain, somewhat novel\n1 - 20% certain, pathfinding required`}
      >
        <p className="text-xs text-muted mb-2">How sure are we about the outcome?</p>
        <ICESlider
          value={project.confidence}
          onChange={(value) => onUpdate({ confidence: value })}
          aria-label="Confidence"
        />
      </PropertyRow>

      {/* Ease Slider */}
      <PropertyRow
        label="Ease"
        tooltip={`Labor hours to deliver:\n5 - Less than 1 week\n4 - Less than 1 month\n3 - Less than 1 quarter\n2 - Less than 1 year\n1 - More than 1 year`}
      >
        <p className="text-xs text-muted mb-2">How easy is this to implement?</p>
        <ICESlider
          value={project.ease}
          onChange={(value) => onUpdate({ ease: value })}
          aria-label="Ease"
        />
      </PropertyRow>

      {/* Owner */}
      <PropertyRow label="Owner">
        <PersonCombobox
          people={people}
          value={project.owner?.id || null}
          onChange={(ownerId) => onUpdate({ owner_id: ownerId } as Partial<Project>)}
          placeholder="Select owner..."
        />
      </PropertyRow>

      {/* Icon (Emoji) */}
      <PropertyRow label="Icon">
        <EmojiPickerPopover
          value={project.emoji}
          onChange={(emoji) => onUpdate({ emoji })}
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-lg cursor-pointer hover:ring-2 hover:ring-accent transition-all"
            style={{ backgroundColor: project.color, color: getContrastTextColor(project.color) }}
          >
            {project.emoji || project.title?.[0]?.toUpperCase() || '?'}
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
              onClick={() => onUpdate({ color: c })}
              className={cn(
                'h-6 w-6 rounded-full transition-transform',
                project.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'
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
          value={project.program_id || ''}
          onChange={(e) => onUpdate({ program_id: e.target.value || null })}
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
          <span className="text-foreground">{project.sprint_count ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted">Issues</span>
          <span className="text-foreground">{project.issue_count ?? 0}</span>
        </div>
      </div>

      {/* Document Conversion */}
      {onConvert && (
        <div className="pt-4 mt-4 border-t border-border">
          <button
            onClick={onConvert}
            disabled={isConverting}
            className="w-full rounded bg-border px-3 py-2 text-sm font-medium text-muted hover:bg-border/80 hover:text-foreground disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {isConverting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Converting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L9.414 11H13a1 1 0 100-2H9.414l1.293-1.293z" clipRule="evenodd" />
                </svg>
                Convert to Issue
              </>
            )}
          </button>
          <p className="mt-1 text-xs text-muted text-center">Convert this project into an issue</p>
        </div>
      )}
    </div>
  );
}

function PropertyRow({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label className="text-xs font-medium text-muted">{label}</label>
        {tooltip && (
          <Tooltip content={tooltip} side="right" delayDuration={200}>
            <button
              type="button"
              className="text-muted/60 hover:text-muted transition-colors"
              aria-label={`More info about ${label}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
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
  value: number | null;
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
