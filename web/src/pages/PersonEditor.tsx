import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments } from '@/contexts/DocumentsContext';
import { useAutoSave } from '@/hooks/useAutoSave';
import { GitHubActivityFeed } from '@/components/GitHubActivityFeed';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface PersonDocument {
  id: string;
  title: string;
  content: unknown;
  document_type: string;
  properties?: {
    email?: string | null;
    role?: string | null;
    capacity_hours?: number | null;
    github_username?: string | null;
  };
}

interface SprintMetric {
  committed: number;
  completed: number;
}

interface SprintInfo {
  number: number;
  name: string;
  isCurrent: boolean;
}

interface SprintMetricsResponse {
  sprints: SprintInfo[];
  metrics: Record<number, SprintMetric>;
  averageRate: number;
}

export function PersonEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { createDocument } = useDocuments();
  const [person, setPerson] = useState<PersonDocument | null>(null);
  const [loading, setLoading] = useState(true);

  // Create sub-document (for slash commands) - creates a wiki doc linked to this person
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
  const [sprintMetrics, setSprintMetrics] = useState<SprintMetricsResponse | null>(null);
  const [metricsVisible, setMetricsVisible] = useState(false);

  useEffect(() => {
    async function fetchPerson() {
      if (!id) return;
      try {
        const response = await fetch(`${API_URL}/api/documents/${id}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.document_type === 'person') {
            setPerson(data);
          } else {
            // Not a person document, redirect to directory
            navigate('/team/directory');
          }
        } else {
          navigate('/team/directory');
        }
      } catch (error) {
        console.error('Failed to fetch person:', error);
        navigate('/team/directory');
      } finally {
        setLoading(false);
      }
    }
    fetchPerson();
  }, [id, navigate]);

  // Fetch sprint metrics (only visible to self or admins)
  useEffect(() => {
    async function fetchSprintMetrics() {
      if (!id) return;
      try {
        const response = await fetch(`${API_URL}/api/team/people/${id}/sprint-metrics`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setSprintMetrics(data);
          setMetricsVisible(true);
        } else if (response.status === 403) {
          // User not authorized to see metrics - that's fine
          setMetricsVisible(false);
        }
      } catch (error) {
        console.error('Failed to fetch sprint metrics:', error);
      }
    }
    fetchSprintMetrics();
  }, [id]);

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (newTitle: string) => {
      if (!id) return;
      const title = newTitle || 'Untitled';
      await fetch(`${API_URL}/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title }),
      });
    },
  });

  const handleDelete = useCallback(async () => {
    if (!id || !confirm('Delete this person? This cannot be undone.')) return;

    try {
      const response = await fetch(`${API_URL}/api/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        navigate('/team/directory');
      }
    } catch (error) {
      console.error('Failed to delete person:', error);
    }
  }, [id, navigate]);

  // Update person properties
  const handleUpdateProperties = useCallback(async (propertyUpdates: Partial<NonNullable<PersonDocument['properties']>>) => {
    if (!id) return;
    try {
      await fetch(`${API_URL}/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ properties: propertyUpdates }),
      });
      // Optimistically update local state
      setPerson(prev => prev ? {
        ...prev,
        properties: { ...prev.properties, ...propertyUpdates }
      } : null);
    } catch (error) {
      console.error('Failed to update person properties:', error);
    }
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!person || !id) {
    return null;
  }

  return (
    <Editor
      documentId={id}
      userName={user?.name || 'Anonymous'}
      initialTitle={person.title}
      onTitleChange={throttledTitleSave}
      onBack={() => navigate('/team/directory')}
      backLabel="Team Directory"
      roomPrefix="person"
      placeholder="Add bio, contact info, skills..."
      onDelete={handleDelete}
      onCreateSubDocument={handleCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Email">
            <div className="text-sm text-foreground">
              {person.title.toLowerCase().replace(/\s+/g, '.')}@example.com
            </div>
          </PropertyRow>
          <PropertyRow label="Role">
            <div className="text-sm text-muted">Not set</div>
          </PropertyRow>
          <PropertyRow label="Department">
            <div className="text-sm text-muted">Not set</div>
          </PropertyRow>

          <PropertyRow label="GitHub Username">
            <input
              type="text"
              placeholder="e.g. octocat"
              value={person.properties?.github_username || ''}
              onChange={(e) => handleUpdateProperties({ github_username: e.target.value || null })}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </PropertyRow>

          {/* GitHub Activity - shows when user has linked their GitHub */}
          {person.properties?.github_username && (
            <div className="mt-4 border-t border-border pt-4">
              <label className="mb-2 block text-xs font-medium text-muted">GitHub Activity</label>
              <GitHubActivityFeed
                authorLogin={person.properties.github_username}
                limit={5}
                compact
                emptyMessage="No recent PR activity"
              />
            </div>
          )}

          {metricsVisible && sprintMetrics && (
            <SprintHistory metrics={sprintMetrics} />
          )}
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

function SprintHistory({ metrics }: { metrics: SprintMetricsResponse }) {
  const { sprints, metrics: sprintMetrics, averageRate } = metrics;

  // Calculate completion rates for each sprint
  const rates = sprints.map(sprint => {
    const m = sprintMetrics[sprint.number];
    if (!m || m.committed === 0) return null;
    return Math.round((m.completed / m.committed) * 100);
  });

  // Find max rate for scaling the trend line
  const validRates = rates.filter((r): r is number => r !== null);
  const maxRate = Math.max(...validRates, 100);

  return (
    <div className="mt-6 border-t border-border pt-4">
      <label className="mb-3 block text-xs font-medium text-muted">Sprint History</label>

      {/* Trend line SVG */}
      <div className="mb-3">
        <svg viewBox="0 0 200 60" className="h-12 w-full">
          {/* Background grid */}
          <line x1="0" y1="30" x2="200" y2="30" stroke="currentColor" strokeOpacity="0.1" />
          <line x1="0" y1="15" x2="200" y2="15" stroke="currentColor" strokeOpacity="0.05" />
          <line x1="0" y1="45" x2="200" y2="45" stroke="currentColor" strokeOpacity="0.05" />

          {/* 60% threshold line */}
          <line
            x1="0"
            y1={60 - (60 / maxRate) * 60}
            x2="200"
            y2={60 - (60 / maxRate) * 60}
            stroke="#f97316"
            strokeOpacity="0.3"
            strokeDasharray="4"
          />

          {/* Trend line */}
          {validRates.length > 1 && (
            <polyline
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              points={rates
                .map((rate, i) => {
                  if (rate === null) return null;
                  const x = (i / (sprints.length - 1)) * 180 + 10;
                  const y = 55 - (rate / maxRate) * 50;
                  return `${x},${y}`;
                })
                .filter(Boolean)
                .join(' ')}
            />
          )}

          {/* Data points */}
          {rates.map((rate, i) => {
            if (rate === null) return null;
            const x = (i / Math.max(sprints.length - 1, 1)) * 180 + 10;
            const y = 55 - (rate / maxRate) * 50;
            const isLow = rate < 60;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r="4"
                fill={isLow ? '#f97316' : '#8b5cf6'}
              />
            );
          })}
        </svg>
      </div>

      {/* Sprint metrics list */}
      <div className="space-y-1">
        {sprints.map(sprint => {
          const m = sprintMetrics[sprint.number];
          const committed = m?.committed || 0;
          const completed = m?.completed || 0;
          const rate = committed > 0 ? Math.round((completed / committed) * 100) : null;
          const isLow = rate !== null && rate < 60;

          return (
            <div
              key={sprint.number}
              className={`flex items-center justify-between text-xs ${
                sprint.isCurrent ? 'font-medium' : ''
              }`}
            >
              <span className="text-muted">
                {sprint.name}
                {sprint.isCurrent && ' (current)'}
              </span>
              <span className={isLow ? 'text-orange-500' : 'text-foreground'}>
                {committed > 0 ? `${completed}/${committed}h (${rate}%)` : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Average */}
      <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
        <span className="font-medium text-muted">Average</span>
        <span className={`font-medium ${averageRate < 60 ? 'text-orange-500' : 'text-foreground'}`}>
          {averageRate}%
        </span>
      </div>
    </div>
  );
}
