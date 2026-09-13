import { useState } from 'react';
import { ArrowRight, KeyRound, Loader2, ShieldCheck, WifiOff } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { ErrorState } from '../components/states';
import { api, errMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { useTheme } from '../lib/theme';
import type { DemoUser } from '../lib/types';

const ROLE_BLURB: Record<string, string> = {
  minister: 'Dashboard, policy cards, funds, simulator, brief, ask',
  analyst: 'Everything analytical + dataset ingestion and live telemetry',
  director: 'All analytical pages + user administration',
  auditor: 'Datasets (read), lineage, audit chain + verify, brief',
};

/** Fallback list — the seeded logins are also published by GET /api/auth/demo-users. */
const FALLBACK: DemoUser[] = [
  { email: 'minister@gov.in', password: 'Demo@1234', role: 'minister' },
  { email: 'analyst@gov.in', password: 'Demo@1234', role: 'analyst' },
  { email: 'director@gov.in', password: 'Demo@1234', role: 'director' },
  { email: 'auditor@gov.in', password: 'Demo@1234', role: 'auditor' },
];

export default function Login() {
  const { login } = useAuth();
  const { push } = useToast();
  const { theme, toggle } = useTheme();
  const [email, setEmail] = useState('director@gov.in');
  const [password, setPassword] = useState('Demo@1234');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const demo = useAutoRun<{ users: DemoUser[] }>(() => api<{ users: DemoUser[] }>('/api/auth/demo-users'), 'demo-users');
  const users: DemoUser[] = demo.data?.users?.length ? demo.data.users : FALLBACK;

  async function submit(e: DemoUser | { email: string; password: string }, tag: string) {
    setBusy(tag);
    setError(null);
    try {
      const user = await login(e.email, e.password);
      push('success', `Signed in as ${user.name ?? user.email}`, `Role ${user.role} · ${user.permissions.length} permissions granted`);
    } catch (err) {
      setError(err);
      push('error', 'Sign-in failed', errMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-bg lg:grid-cols-[1.05fr_1fr]" data-testid="login-page">
      {/* Brand panel */}
      <section className="hairline-grid relative hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <div className="flex items-center gap-3">
          <span className="text-teal">
            <LogoMark size={36} />
          </span>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-ink">
              CivicData<span className="text-teal"> Nexus</span>
            </p>
            <p className="text-2xs font-semibold uppercase tracking-[0.16em] text-faint">Team CivicNexus · SIH 2026 · PS SIH1682</p>
          </div>
        </div>

        <div className="max-w-xl">
          <h1 className="text-3xl font-extrabold leading-[1.12] tracking-tight text-ink">
            Efficient telemetry analysis and <span className="text-teal">automated decision intelligence</span> for public sector data.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Eight seeded government datasets, a ten-step ingestion pipeline with PII masking, eight hand-built analytics engines, an MCDA
            policy portfolio and a tamper-evident audit chain — all computed on this host.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-3 text-2xs">
            {[
              ['8 datasets', '6,400+ rows ingested through lineage'],
              ['8 engines', 'MAD, isolation forest, Holt, k-means, MCDA, knapsack, NLP'],
              ['46 API routes', 'RBAC on every route, audit entry on every mutation'],
              ['0 network calls', 'No API keys, no model downloads, no GPU'],
            ].map(([k, v]) => (
              <li key={k} className="rounded-lg border border-line bg-raised px-3 py-2.5">
                <p className="text-sm font-bold text-teal">{k}</p>
                <p className="mt-0.5 leading-relaxed text-muted">{v}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="flex items-center gap-2 text-2xs text-faint">
          <WifiOff size={13} aria-hidden /> Fully offline build · evidence: NITI Aayog data-silo findings, CAG unspent-funds audits, MoRTH
          IBMS bridge ratings
        </p>
      </section>

      {/* Form panel */}
      <section className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center justify-between gap-3 lg:hidden">
            <span className="flex items-center gap-2.5">
              <span className="text-teal">
                <LogoMark size={28} />
              </span>
              <span className="text-base font-extrabold tracking-tight text-ink">
                CivicData<span className="text-teal"> Nexus</span>
              </span>
            </span>
            <button type="button" className="btn px-2 py-1.5 text-2xs" onClick={toggle} data-testid="login-theme-toggle">
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>

          <h2 className="text-xl font-extrabold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-muted">
            The JWT is held in React state only — no localStorage, no cookies. Reloading returns you here.
          </p>

          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit({ email, password }, 'form');
            }}
          >
            <div>
              <label className="label" htmlFor="email">
                Official email
              </label>
              <input
                id="email"
                type="email"
                className="input"
                value={email}
                autoComplete="username"
                onChange={(e) => setEmail(e.target.value)}
                data-testid="login-email"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                data-testid="login-password"
                required
              />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy !== null} data-testid="login-submit">
              {busy === 'form' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <KeyRound size={15} aria-hidden />}
              {busy === 'form' ? 'Verifying…' : 'Sign in'}
            </button>
          </form>

          {error ? (
            <div className="mt-4">
              <ErrorState err={error} what="your session" />
            </div>
          ) : null}

          <div className="mt-7">
            <p className="label">One-click demo logins</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {users.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  className="group flex min-w-0 items-start gap-2 rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-teal/60 disabled:opacity-60"
                  onClick={() => void submit(u, u.role)}
                  disabled={busy !== null}
                  data-testid={`demo-login-${u.role}`}
                >
                  <span className="mt-0.5 shrink-0 text-teal">
                    {busy === u.role ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ShieldCheck size={15} aria-hidden />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-bold capitalize text-ink">
                      {u.role}
                      <ArrowRight size={12} className="opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </span>
                    <span className="mt-0.5 block truncate text-2xs text-faint" title={u.email}>
                      {u.email}
                    </span>
                    <span className="mt-1 block text-2xs leading-relaxed text-muted">{ROLE_BLURB[u.role] ?? 'Seeded demo account'}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-faint">
              All demo accounts use password <span className="font-mono text-muted">Demo@1234</span>. Permissions are enforced server-side;
              the sidebar only shows what your role may open.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
