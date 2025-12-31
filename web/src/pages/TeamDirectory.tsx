import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

interface Person {
  id: string;
  name: string;
  email: string;
}

export function TeamDirectoryPage() {
  const navigate = useNavigate();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPeople() {
      try {
        const response = await fetch(`${API_URL}/api/team/people`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setPeople(data);
        }
      } catch (error) {
        console.error('Failed to fetch people:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchPeople();
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <h1 className="text-xl font-medium text-foreground">No team members</h1>
        <p className="mt-1 text-sm text-muted">Team members will appear here once added</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 items-center border-b border-border px-6">
        <h1 className="text-lg font-medium text-foreground">Team Directory</h1>
        <span className="ml-2 text-sm text-muted">({people.length} members)</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {people.map((person) => (
            <button
              key={person.id}
              onClick={() => navigate(`/team/${person.id}`)}
              className={cn(
                'flex items-center gap-3 rounded-lg border border-border p-4 text-left',
                'transition-colors hover:bg-border/30'
              )}
            >
              {/* Avatar */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/80 text-sm font-medium text-white">
                {person.name.charAt(0).toUpperCase()}
              </div>
              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{person.name}</div>
                <div className="truncate text-sm text-muted">{person.email}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
