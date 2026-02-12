import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '@/lib/api';

const INDENT_PX = 24;

interface PersonData {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  role?: string | null;
  reportsTo?: string | null;
  isArchived?: boolean;
  isPending?: boolean;
}

interface OrgTreeNode {
  personId: string;
  userId: string | null;
  name: string;
  email: string;
  role: string | null;
  children: OrgTreeNode[];
}

interface FlatRow {
  node: OrgTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
}

function buildTree(people: PersonData[]): OrgTreeNode[] {
  // Map user_id → person for parent lookup
  const byUserId = new Map<string, PersonData>();
  for (const p of people) {
    if (p.user_id) byUserId.set(p.user_id, p);
  }

  // Build node map
  const nodeMap = new Map<string, OrgTreeNode>();
  for (const p of people) {
    nodeMap.set(p.id, {
      personId: p.id,
      userId: p.user_id,
      name: p.name,
      email: p.email,
      role: p.role || null,
      children: [],
    });
  }

  const roots: OrgTreeNode[] = [];

  for (const p of people) {
    const node = nodeMap.get(p.id)!;
    if (p.reportsTo) {
      // Find parent by matching reportsTo (a user_id) to a person's user_id
      const parent = byUserId.get(p.reportsTo);
      if (parent) {
        const parentNode = nodeMap.get(parent.id);
        if (parentNode) {
          parentNode.children.push(node);
          continue;
        }
      }
    }
    // No reportsTo or parent not found → this is a root
    roots.push(node);
  }

  // Sort children alphabetically at each level
  function sortChildren(nodes: OrgTreeNode[]) {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  return roots;
}

function flattenTree(nodes: OrgTreeNode[], expandedIds: Set<string>, depth = 0): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    const isExpanded = expandedIds.has(node.personId);
    const hasChildren = node.children.length > 0;
    rows.push({ node, depth, isExpanded, hasChildren });
    if (isExpanded && hasChildren) {
      rows.push(...flattenTree(node.children, expandedIds, depth + 1));
    }
  }
  return rows;
}

function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

// Collect all ancestor personIds for a set of matching nodes
function collectAncestorIds(people: PersonData[], matchIds: Set<string>): Set<string> {
  const byUserId = new Map<string, PersonData>();
  for (const p of people) {
    if (p.user_id) byUserId.set(p.user_id, p);
  }

  const ancestorIds = new Set<string>();
  for (const p of people) {
    if (!matchIds.has(p.id)) continue;
    // Walk up the chain
    let current = p;
    while (current.reportsTo) {
      const parent = byUserId.get(current.reportsTo);
      if (!parent || ancestorIds.has(parent.id)) break;
      ancestorIds.add(parent.id);
      current = parent;
    }
  }
  return ancestorIds;
}

export function OrgChartPage() {
  const navigate = useNavigate();
  const [people, setPeople] = useState<PersonData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [preSearchExpanded, setPreSearchExpanded] = useState<Set<string> | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const treeRef = useRef<HTMLUListElement>(null);

  // Fetch people
  useEffect(() => {
    async function fetchPeople() {
      try {
        const res = await apiGet('/api/team/people');
        if (res.ok) {
          const data = await res.json();
          setPeople(data.filter((p: PersonData) => !p.isPending && !p.isArchived));
        }
      } catch (err) {
        console.error('Failed to fetch people:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchPeople();
  }, []);

  // Build tree
  const tree = useMemo(() => buildTree(people), [people]);

  // Set default expanded (first 2 levels) once tree is built
  useEffect(() => {
    if (tree.length > 0 && expandedIds.size === 0) {
      const defaultExpanded = new Set<string>();
      for (const root of tree) {
        defaultExpanded.add(root.personId);
        for (const child of root.children) {
          defaultExpanded.add(child.personId);
        }
      }
      setExpandedIds(defaultExpanded);
    }
  }, [tree]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search: find matching people and auto-expand ancestors
  const searchMatches = useMemo(() => {
    if (!debouncedQuery.trim()) return null;
    const q = debouncedQuery.toLowerCase();
    const matchIds = new Set<string>();
    for (const p of people) {
      if (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) {
        matchIds.add(p.id);
      }
    }
    return matchIds;
  }, [debouncedQuery, people]);

  // Auto-expand ancestors when searching
  useEffect(() => {
    if (searchMatches !== null) {
      // Save pre-search state on first search (whether or not there are matches)
      if (!preSearchExpanded) {
        setPreSearchExpanded(new Set(expandedIds));
      }
      if (searchMatches.size > 0) {
        const ancestorIds = collectAncestorIds(people, searchMatches);
        setExpandedIds(new Set([...ancestorIds, ...searchMatches]));
      }
    } else if (preSearchExpanded) {
      // Search cleared — restore previous state
      setExpandedIds(preSearchExpanded);
      setPreSearchExpanded(null);
    }
  }, [searchMatches]);

  // Flatten tree for rendering, filtering to matches + ancestors during search
  const flatRows = useMemo(() => {
    const rows = flattenTree(tree, expandedIds);
    if (searchMatches === null) return rows; // No active search — show all
    if (searchMatches.size === 0) return []; // Search with no matches — show empty state
    const ancestorIds = collectAncestorIds(people, searchMatches);
    const visibleIds = new Set([...searchMatches, ...ancestorIds]);
    return rows.filter(row => visibleIds.has(row.node.personId));
  }, [tree, expandedIds, searchMatches, people]);

  const toggleExpand = useCallback((personId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const rows = flatRows;
    if (rows.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, rows.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
        break;
      case 'ArrowRight': {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row && row.hasChildren && !row.isExpanded) {
          toggleExpand(row.node.personId);
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row && row.isExpanded) {
          toggleExpand(row.node.personId);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const row = rows[focusedIndex];
        if (row) navigate(`/team/${row.node.personId}`);
        break;
      }
    }
  }, [flatRows, focusedIndex, toggleExpand, navigate]);

  // Scroll focused item into view
  useEffect(() => {
    if (treeRef.current) {
      const items = treeRef.current.querySelectorAll('[role="treeitem"]');
      items[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-10 items-center border-b border-border px-4">
          <h1 className="text-sm font-medium text-foreground">Org Chart</h1>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted">Loading...</p>
        </div>
      </div>
    );
  }

  const matchCount = searchMatches?.size ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 items-center gap-3 border-b border-border px-4">
        <h1 className="text-sm font-medium text-foreground">Org Chart</h1>
        <span className="text-xs text-muted">{people.length} people</span>
      </header>

      {/* Search */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search people..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
          />
          {matchCount !== null && (
            <span className="text-xs text-muted">
              {matchCount === 0 ? 'No results' : `${matchCount} result${matchCount !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-auto p-2">
        {flatRows.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted">
              {searchMatches ? 'No matching people found' : 'No reporting hierarchy configured'}
            </p>
          </div>
        ) : (
          <ul
            ref={treeRef}
            role="tree"
            aria-label="Organization chart"
            onKeyDown={handleKeyDown}
            className="space-y-px"
          >
            {flatRows.map((row, index) => {
              const { node, depth, isExpanded, hasChildren } = row;
              const isFocused = index === focusedIndex;
              const isMatch = searchMatches?.has(node.personId);

              return (
                <li
                  key={node.personId}
                  role="treeitem"
                  aria-expanded={hasChildren ? isExpanded : undefined}
                  aria-level={depth + 1}
                  tabIndex={isFocused ? 0 : -1}
                  onFocus={() => setFocusedIndex(index)}
                  className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
                    isFocused ? 'bg-border/50' : 'hover:bg-border/30'
                  } ${isMatch ? 'ring-1 ring-accent/50' : ''}`}
                  style={{ paddingLeft: depth * INDENT_PX + 8 }}
                >
                  {/* Expand/collapse chevron */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleExpand(node.personId); }}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-transform ${
                      hasChildren ? 'text-muted hover:text-foreground' : 'invisible'
                    }`}
                    tabIndex={-1}
                    aria-hidden="true"
                  >
                    <svg
                      className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                    </svg>
                  </button>

                  {/* Avatar */}
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-white">
                    {getInitials(node.name)}
                  </div>

                  {/* Two-line content area */}
                  <div className="min-w-0 flex-1">
                    {/* Line 1: Name + Role */}
                    <div className="flex items-baseline gap-2">
                      <button
                        onClick={() => navigate(`/team/${node.personId}`)}
                        className="truncate font-medium text-foreground hover:text-accent hover:underline"
                        tabIndex={-1}
                      >
                        {searchMatches && debouncedQuery ? (
                          <HighlightedText text={node.name} query={debouncedQuery} />
                        ) : (
                          node.name
                        )}
                      </button>
                      {node.role && (
                        <span className="truncate text-xs text-muted">
                          {searchMatches && debouncedQuery ? (
                            <HighlightedText text={node.role} query={debouncedQuery} />
                          ) : (
                            node.role
                          )}
                        </span>
                      )}
                      {hasChildren && (
                        <span className="ml-auto shrink-0 rounded bg-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                          {node.children.length} report{node.children.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {/* Line 2: Email */}
                    <div className="text-xs text-muted">
                      {searchMatches && debouncedQuery ? (
                        <HighlightedText text={node.email} query={debouncedQuery} />
                      ) : (
                        node.email
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerText.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-500/20 text-foreground">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
