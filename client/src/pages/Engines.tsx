import { Link } from 'react-router-dom';
import { ArrowRight, Cpu, Lock } from 'lucide-react';
import { ErrorState, SkeletonCards } from '../components/states';
import { Card, Badge, PageHeader, RunButton } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';

interface Engine {
  id: string;
  name: string;
  route: string;
  method: string;
  output: string;
  permission: string;
}

const PAGE_FOR: Record<string, string> = {
  'AI-1': '/anomalies',
  'AI-2': '/isolation-forest',
  'AI-3': '/forecast',
  'AI-4': '/clusters',
  'AI-5': '/correlation',
  'AI-6': '/policy-cards',
  'AI-7': '/funds',
  'AI-8': '/ask',
};

export default function Engines() {
  const { token, can, user } = useAuth();
  const { data, error, loading, run } = useAutoRun<{ engines: Engine[] }>(() => api<{ engines: Engine[] }>('/api/ai/engines', { token }), 'engines');

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics engines" subtitle="Loading the engine registry…" />
        <SkeletonCards count={8} height="h-40" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader title="Analytics engines" />
        <ErrorState err={error} onRetry={run} what="the engine registry" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="engines-page">
      <PageHeader
        title="Analytics engines"
        subtitle="Eight engines, all implemented from first principles in TypeScript with no ML dependency. Each one publishes the formula it used, the parameters it chose and the evidence rows behind every number."
        actions={<RunButton onClick={run} loading={loading} testid="engines-rerun" />}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.engines.map((e) => {
          const allowed = can(e.permission);
          const to = PAGE_FOR[e.id] ?? '/dashboard';
          return (
            <article key={e.id} className="card card-pad flex min-w-0 flex-col gap-2.5" data-testid={`engine-card-${e.id}`}>
              <div className="flex items-center gap-2">
                <Cpu size={15} className="shrink-0 text-teal" aria-hidden />
                <span className="font-mono text-2xs font-bold text-teal">{e.id}</span>
                {allowed ? null : (
                  <Badge kind="high" testid={`engine-locked-${e.id}`}>
                    <Lock size={9} aria-hidden /> locked
                  </Badge>
                )}
              </div>
              <h2 className="text-sm font-bold leading-snug text-ink">{e.name}</h2>
              <p className="text-2xs leading-relaxed text-muted">
                <span className="font-semibold text-faint">Method · </span>
                {e.method}
              </p>
              <p className="text-2xs leading-relaxed text-muted">
                <span className="font-semibold text-faint">Output · </span>
                {e.output}
              </p>
              <p className="break-all font-mono text-2xs text-faint">{e.route}</p>
              <div className="mt-auto pt-1">
                {allowed ? (
                  <Link to={to} className="btn w-full justify-center" data-testid={`engine-open-${e.id}`}>
                    Open <ArrowRight size={13} aria-hidden />
                  </Link>
                ) : (
                  <p className="text-2xs leading-relaxed text-faint">
                    Requires <span className="font-mono">{e.permission}</span> — the “{user?.role}” role does not carry it, so the API answers 403
                    and this page stays withheld.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <Card title="Why these are auditable" hint="Determinism and evidence are part of the contract" testid="card-engines-note">
        <ul className="list-inside list-disc space-y-1.5 text-[0.8rem] leading-relaxed text-muted">
          <li>Every random step is seeded from a stable string (dataset slug), so two runs on the same data produce identical output.</li>
          <li>Model choice is never assumed: the forecaster runs rolling-origin walk-forward validation and reports the MAPE of every candidate.</li>
          <li>Scores decompose — MCDA contributions sum to the impact score, isolation-forest ablation shares sum to 100%.</li>
          <li>When a method does not apply to a table, the API answers <span className="font-mono text-2xs">422 NOT_APPLICABLE</span> instead of drawing a plausible-looking line.</li>
        </ul>
      </Card>
    </div>
  );
}
