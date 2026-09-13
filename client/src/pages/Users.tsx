import { useState } from 'react';
import { ShieldCheck, UserPlus, UserX } from 'lucide-react';
import { ErrorState, SkeletonCards, SkeletonTable } from '../components/states';
import { Badge, Card, DataTable, Kpi, PageHeader, RunButton } from '../components/ui';
import { api, errMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { fmtCount, fmtDate } from '../lib/format';

interface ManagedUser {
  id: number;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: string;
  permissions: string[];
}

const ROLES = ['minister', 'analyst', 'director', 'auditor'] as const;

export default function Users() {
  const { token, user } = useAuth();
  const { push } = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('analyst');
  const [password, setPassword] = useState('Demo@1234');
  const [busy, setBusy] = useState(false);

  const { data, error, loading, run } = useAutoRun<{ users: ManagedUser[] }>(() => api<{ users: ManagedUser[] }>('/api/users', { token }), 'users');

  async function create() {
    setBusy(true);
    try {
      await api('/api/users', { token, method: 'POST', body: { email, name, role, password } });
      push('success', `Created ${email}`, `Role ${role} · the creation is now an audit-chain entry.`);
      setEmail('');
      setName('');
      await run();
    } catch (err) {
      push('error', 'Could not create the user', errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setRoleFor(u: ManagedUser, next: string) {
    try {
      await api(`/api/users/${u.id}`, { token, method: 'PATCH', body: { role: next } });
      push('success', `${u.email} is now ${next}`, 'Permissions take effect on their next request; the change is audited.');
      await run();
    } catch (err) {
      push('error', 'Role change rejected', errMessage(err));
    }
  }

  async function toggleActive(u: ManagedUser) {
    try {
      await api(`/api/users/${u.id}`, { token, method: 'PATCH', body: { active: !u.active } });
      push('success', `${u.email} ${u.active ? 'deactivated' : 'reactivated'}`, 'Deactivated accounts cannot obtain a token.');
      await run();
    } catch (err) {
      push('error', 'Could not change the account state', errMessage(err));
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Users & roles" subtitle="Loading the account register…" />
        <SkeletonCards count={4} />
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="Users & roles" />
        <ErrorState err={error} onRetry={run} what="the user register" />
      </div>
    );
  }

  const users = data.users;
  const canSubmit = email.includes('@') && email.length >= 5 && name.trim().length >= 2 && password.length >= 8;

  return (
    <div className="space-y-4" data-testid="users-page">
      <PageHeader
        title="Users & roles"
        subtitle="Only the director role carries users.admin. Permissions are fixed per role and enforced on the server for every request — the sidebar simply hides what the API would refuse anyway."
        actions={<RunButton onClick={run} loading={loading} testid="users-rerun" />}
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Accounts" value={fmtCount(users.length)} detail={`${fmtCount(users.filter((u) => u.active).length)} active`} testid="kpi-users" />
        {ROLES.slice(0, 3).map((r) => (
          <Kpi key={r} label={`${r} accounts`} value={fmtCount(users.filter((u) => u.role === r).length)} detail={`${users.find((u) => u.role === r)?.permissions.length ?? 0} permissions each`} testid={`kpi-role-${r}`} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Accounts" hint="Change a role or deactivate an account — both are audited" testid="card-users" pad={false}>
          <div className="p-3">
            <DataTable
              testid="table-users"
              rows={users}
              rowKey={(u) => u.id}
              maxHeight="26rem"
              columns={[
                {
                  key: 'name',
                  header: 'Account',
                  render: (u) => (
                    <span className="block max-w-[15rem] truncate" title={u.email}>
                      <span className="font-semibold text-ink">{u.name}</span>
                      <span className="block truncate text-2xs text-faint">{u.email}</span>
                    </span>
                  ),
                },
                {
                  key: 'role',
                  header: 'Role',
                  render: (u) => (
                    <select
                      className="input w-[7.5rem] py-1 text-2xs"
                      value={u.role}
                      onChange={(e) => void setRoleFor(u, e.target.value)}
                      data-testid={`user-role-${u.id}`}
                      aria-label={`Role for ${u.email}`}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ),
                },
                { key: 'permissions', header: 'Permissions', align: 'right', render: (u) => fmtCount(u.permissions.length) },
                { key: 'created_at', header: 'Created', render: (u) => <span className="text-muted">{fmtDate(u.created_at)}</span> },
                { key: 'active', header: 'State', render: (u) => <Badge kind={u.active ? 'acknowledged' : 'dismissed'}>{u.active ? 'active' : 'inactive'}</Badge> },
                {
                  key: 'actions',
                  header: 'Actions',
                  align: 'right',
                  render: (u) => (
                    <button
                      type="button"
                      className="btn px-2 py-1 text-2xs"
                      onClick={() => void toggleActive(u)}
                      disabled={u.email === user?.email}
                      title={u.email === user?.email ? 'You cannot deactivate the account you are signed in with' : undefined}
                      data-testid={`user-toggle-${u.id}`}
                    >
                      <UserX size={11} aria-hidden /> {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  ),
                },
              ]}
            />
          </div>
        </Card>

        <Card title="Create an account" hint="Password must be at least 8 characters; it is stored salted and hashed" testid="card-create-user">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="new-email">
                Email
              </label>
              <input id="new-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@gov.in" data-testid="new-user-email" />
            </div>
            <div>
              <label className="label" htmlFor="new-name">
                Full name
              </label>
              <input id="new-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Joint Secretary (Analytics)" data-testid="new-user-name" />
            </div>
            <div>
              <label className="label" htmlFor="new-role">
                Role
              </label>
              <select id="new-role" className="input" value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])} data-testid="new-user-role">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="new-password">
                Initial password
              </label>
              <input id="new-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="new-user-password" />
            </div>
            <button type="button" className="btn-primary w-full" onClick={() => void create()} disabled={!canSubmit || busy} data-testid="create-user-submit">
              <UserPlus size={14} aria-hidden /> {busy ? 'Creating…' : 'Create account'}
            </button>
            <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-faint">
              <ShieldCheck size={12} className="mt-0.5 shrink-0 text-teal" aria-hidden />
              Deactivation is a soft delete — the account row and its audit history are retained so past actions stay attributable.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Permission matrix" hint="What each role can actually do, straight from the server's role table" testid="card-matrix">
        <div className="space-y-3">
          {ROLES.map((r) => {
            const sample = users.find((u) => u.role === r);
            return (
              <div key={r} className="min-w-0 border-b border-line/60 pb-2.5 last:border-0 last:pb-0">
                <p className="flex items-center gap-2">
                  <Badge kind="medium">{r}</Badge>
                  <span className="text-2xs text-faint">{fmtCount(sample?.permissions.length ?? 0)} permissions</span>
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {(sample?.permissions ?? []).map((p) => (
                    <span key={p} className="chip font-mono">
                      {p}
                    </span>
                  ))}
                </p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
