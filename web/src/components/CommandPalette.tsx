import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '');

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const runCommand = useCallback((command: () => void) => {
    onOpenChange(false);
    command();
  }, [onOpenChange]);

  const createIssue = async () => {
    try {
      // Get the first program to create the issue in
      const programsRes = await fetch(`${API_URL}/api/programs`, { credentials: 'include' });
      if (!programsRes.ok) return;
      const programs = await programsRes.json();
      if (programs.length === 0) return;

      const res = await fetch(`${API_URL}/api/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: 'Untitled',
          program_id: programs[0].id,
        }),
      });

      if (res.ok) {
        const issue = await res.json();
        navigate(`/issues/${issue.id}`);
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
  };

  const createDocument = async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled', document_type: 'wiki' }),
      });

      if (res.ok) {
        const doc = await res.json();
        navigate(`/docs/${doc.id}`);
      }
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
      />

      {/* Command dialog */}
      <div className="absolute left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2">
        <Command
          className="rounded-lg border border-border bg-background shadow-2xl"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onOpenChange(false);
          }}
        >
          <div className="border-b border-border p-3">
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Type a command or search..."
              className="w-full bg-transparent text-base text-foreground placeholder:text-muted focus:outline-none"
              autoFocus
            />
          </div>

          <Command.List className="max-h-[300px] overflow-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted">
              No results found.
            </Command.Empty>

            <Command.Group heading="Create" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
              <CommandItem onSelect={() => runCommand(createIssue)}>
                <PlusIcon />
                <span>Create Issue</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(createDocument)}>
                <DocIcon />
                <span>Create Document</span>
              </CommandItem>
            </Command.Group>

            <Command.Group heading="Navigate" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted">
              <CommandItem onSelect={() => runCommand(() => navigate('/docs'))}>
                <DocIcon />
                <span>Go to Documents</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/issues'))}>
                <IssueIcon />
                <span>Go to Issues</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/programs'))}>
                <ProgramIcon />
                <span>Go to Programs</span>
              </CommandItem>
              <CommandItem onSelect={() => runCommand(() => navigate('/teams'))}>
                <TeamIcon />
                <span>Go to Teams</span>
              </CommandItem>
            </Command.Group>
          </Command.List>

          <div className="border-t border-border px-3 py-2 text-xs text-muted">
            <kbd className="rounded bg-border px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd>
            <span className="ml-1">to navigate</span>
            <kbd className="ml-3 rounded bg-border px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
            <span className="ml-1">to select</span>
            <kbd className="ml-3 rounded bg-border px-1.5 py-0.5 font-mono text-[10px]">esc</kbd>
            <span className="ml-1">to close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function CommandItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm',
        'data-[selected=true]:bg-accent data-[selected=true]:text-white'
      )}
    >
      {children}
    </Command.Item>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function ProgramIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
