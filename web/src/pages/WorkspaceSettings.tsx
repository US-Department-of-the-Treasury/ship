import { useState, useEffect } from 'react';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { api, WorkspaceMember, WorkspaceInvite, AuditLog } from '@/lib/api';
import { cn } from '@/lib/cn';

type Tab = 'members' | 'invites' | 'audit';

export function WorkspaceSettingsPage() {
  const { currentWorkspace, isWorkspaceAdmin } = useWorkspace();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('members');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!currentWorkspace) return;
    loadData();
  }, [currentWorkspace]);

  async function loadData() {
    if (!currentWorkspace) return;
    setLoading(true);

    const [membersRes, invitesRes, logsRes] = await Promise.all([
      api.workspaces.getMembers(currentWorkspace.id),
      api.workspaces.getInvites(currentWorkspace.id),
      api.workspaces.getAuditLogs(currentWorkspace.id, { limit: 50 }),
    ]);

    if (membersRes.success && membersRes.data) setMembers(membersRes.data.members);
    if (invitesRes.success && invitesRes.data) setInvites(invitesRes.data.invites);
    if (logsRes.success && logsRes.data) setAuditLogs(logsRes.data.logs);
    setLoading(false);
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkspace || !inviteEmail.trim()) return;

    setInviting(true);
    const res = await api.workspaces.createInvite(currentWorkspace.id, {
      email: inviteEmail.trim(),
      role: inviteRole,
    });
    if (res.success && res.data) {
      const { invite } = res.data;
      setInvites(prev => [...prev, invite]);
      setInviteEmail('');
    }
    setInviting(false);
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!currentWorkspace) return;
    const res = await api.workspaces.revokeInvite(currentWorkspace.id, inviteId);
    if (res.success) {
      setInvites(prev => prev.filter(i => i.id !== inviteId));
    }
  }

  async function handleUpdateRole(userId: string, newRole: 'admin' | 'member') {
    if (!currentWorkspace) return;

    // Check if this is the last admin
    const admins = members.filter(m => m.role === 'admin');
    if (admins.length === 1 && admins[0].userId === userId && newRole === 'member') {
      alert('Cannot demote the last admin. Promote another member first.');
      return;
    }

    const res = await api.workspaces.updateMember(currentWorkspace.id, userId, { role: newRole });
    if (res.success) {
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: newRole } : m));
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!currentWorkspace) return;

    // Check if this is the last admin
    const admins = members.filter(m => m.role === 'admin');
    const member = members.find(m => m.userId === userId);
    if (member?.role === 'admin' && admins.length === 1) {
      alert('Cannot remove the last admin. Promote another member first.');
      return;
    }

    if (!confirm('Are you sure you want to remove this member? They will immediately lose access.')) return;

    const res = await api.workspaces.removeMember(currentWorkspace.id, userId);
    if (res.success) {
      setMembers(prev => prev.filter(m => m.userId !== userId));
    }
  }

  if (!currentWorkspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">No workspace selected</div>
      </div>
    );
  }

  if (!isWorkspaceAdmin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h1 className="text-xl font-medium text-foreground">Workspace Settings</h1>
        <p className="text-muted">You don't have permission to manage this workspace.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <h1 className="text-lg font-semibold text-foreground">
          Workspace Settings: {currentWorkspace.name}
        </h1>
      </header>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex px-6">
          <TabButton active={activeTab === 'members'} onClick={() => setActiveTab('members')}>
            Members
          </TabButton>
          <TabButton active={activeTab === 'invites'} onClick={() => setActiveTab('invites')}>
            Pending Invites
          </TabButton>
          <TabButton active={activeTab === 'audit'} onClick={() => setActiveTab('audit')}>
            Audit Logs
          </TabButton>
        </nav>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-muted">Loading...</div>
          </div>
        ) : (
          <>
            {activeTab === 'members' && (
              <MembersTab
                members={members}
                currentUserId={user?.id}
                onUpdateRole={handleUpdateRole}
                onRemoveMember={handleRemoveMember}
              />
            )}
            {activeTab === 'invites' && (
              <InvitesTab
                invites={invites}
                inviteEmail={inviteEmail}
                setInviteEmail={setInviteEmail}
                inviteRole={inviteRole}
                setInviteRole={setInviteRole}
                inviting={inviting}
                onInvite={handleInvite}
                onRevoke={handleRevokeInvite}
              />
            )}
            {activeTab === 'audit' && (
              <AuditTab auditLogs={auditLogs} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
        active
          ? 'border-accent text-foreground'
          : 'border-transparent text-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function MembersTab({
  members,
  currentUserId,
  onUpdateRole,
  onRemoveMember,
}: {
  members: WorkspaceMember[];
  currentUserId?: string;
  onUpdateRole: (userId: string, role: 'admin' | 'member') => void;
  onRemoveMember: (userId: string) => void;
}) {
  const adminCount = members.filter(m => m.role === 'admin').length;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-border/30">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Name</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Email</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Role</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Joined</th>
            <th className="px-4 py-3 text-right text-sm font-medium text-muted">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {members.map((member) => {
            const isLastAdmin = member.role === 'admin' && adminCount === 1;
            const isSelf = member.userId === currentUserId;

            return (
              <tr key={member.id}>
                <td className="px-4 py-3 text-sm text-foreground font-medium">
                  {member.name}
                  {isSelf && <span className="ml-2 text-muted">(you)</span>}
                </td>
                <td className="px-4 py-3 text-sm text-muted">{member.email}</td>
                <td className="px-4 py-3 text-sm">
                  <select
                    value={member.role}
                    onChange={(e) => onUpdateRole(member.userId, e.target.value as 'admin' | 'member')}
                    disabled={isLastAdmin}
                    className={cn(
                      'px-2 py-1 rounded text-sm bg-background border border-border',
                      isLastAdmin && 'opacity-50 cursor-not-allowed'
                    )}
                    title={isLastAdmin ? 'Workspace must have at least one admin' : undefined}
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-sm text-muted">
                  {new Date(member.joinedAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {!isSelf && !isLastAdmin && (
                    <button
                      onClick={() => onRemoveMember(member.userId)}
                      className="text-sm text-red-500 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InvitesTab({
  invites,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviting,
  onInvite,
  onRevoke,
}: {
  invites: WorkspaceInvite[];
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviteRole: 'admin' | 'member';
  setInviteRole: (v: 'admin' | 'member') => void;
  inviting: boolean;
  onInvite: (e: React.FormEvent) => void;
  onRevoke: (id: string) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopyLink(invite: WorkspaceInvite) {
    if (!invite.token) {
      console.error('Invite token is missing:', invite);
      return;
    }
    const url = `${window.location.origin}/invite/${invite.token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <form onSubmit={onInvite} className="flex gap-3">
        <input
          type="email"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          placeholder="Email address"
          className="flex-1 max-w-md px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
          className="px-3 py-2 bg-background border border-border rounded-md text-foreground"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          disabled={inviting || !inviteEmail.trim()}
          className="px-4 py-2 bg-accent text-white rounded-md hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {inviting ? 'Inviting...' : 'Send Invite'}
        </button>
      </form>

      {/* Pending invites */}
      {invites.length === 0 ? (
        <div className="text-muted text-sm">No pending invites</div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-border/30">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Email</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Role</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-muted">Expires</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td className="px-4 py-3 text-sm text-foreground">{invite.email}</td>
                  <td className="px-4 py-3 text-sm text-muted capitalize">{invite.role}</td>
                  <td className="px-4 py-3 text-sm text-muted">
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button
                      onClick={() => handleCopyLink(invite)}
                      className={cn(
                        "text-sm transition-colors",
                        copiedId === invite.id
                          ? "text-green-500"
                          : "text-accent hover:text-accent/80"
                      )}
                    >
                      {copiedId === invite.id ? 'Copied!' : 'Copy Link'}
                    </button>
                    <button
                      onClick={() => onRevoke(invite.id)}
                      className="text-sm text-red-500 hover:text-red-400 transition-colors"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AuditTab({ auditLogs }: { auditLogs: AuditLog[] }) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-border/30">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Time</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Actor</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Action</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-muted">Resource</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {auditLogs.map((log) => (
            <tr key={log.id}>
              <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-sm text-foreground">
                {log.actorName || log.actorEmail}
              </td>
              <td className="px-4 py-3 text-sm text-muted">{log.action}</td>
              <td className="px-4 py-3 text-sm text-muted">
                {log.resourceType ? `${log.resourceType}:${log.resourceId?.slice(0, 8)}...` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
