import { useEffect, useRef, useState } from 'react';
import { MessagesSquare, Send, Sparkles } from 'lucide-react';
import { RankedBars } from '../components/charts';
import { DetailView } from '../components/DetailView';
import { Caveat, ErrorState, SkeletonText } from '../components/states';
import { Badge, Card, DataTable, Formula, KeyValues, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAutoRun } from '../lib/hooks';
import { fmtCell, fmtCount, fmtNum, fmtPct, humanise, metricUnit, prettifyMoney } from '../lib/format';
import type { AskResponse } from '../lib/types';

const INTENTS = ['rank', 'compare', 'trend', 'anomaly', 'correlate', 'total'];

export default function Ask() {
  const { token } = useAuth();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<AskResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { data: examples } = useAutoRun<{ engine: string; examples: string[] }>(
    () => api<{ engine: string; examples: string[] }>('/api/ai/ask/examples', { token }),
    'ask-examples',
  );

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<AskResponse>('/api/ai/ask', { token, method: 'POST', body: { question: text } });
      setHistory((h) => [res, ...h].slice(0, 8));
      setQuestion('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  // Auto-run exactly once: the page opens with a worked answer rather than an
  // empty box, using the engine's own first example so nothing is hard-coded.
  const seeded = useRef(false);
  useEffect(() => {
    const first = examples?.examples?.[0];
    if (!first || seeded.current) return;
    seeded.current = true;
    void ask(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examples]);

  const latest = history[0];

  return (
    <div className="space-y-4" data-testid="ask-page">
      <PageHeader
        title="Ask CivicData"
        engine="AI-8 · deterministic NLP → engine → NLG"
        subtitle="No language model is involved. The question is tokenised, scored against six intents, resolved to a dataset, metric and dimension, executed against the real tables and then rendered back into a sentence from a template — so every answer is reproducible and traceable."
      />

      <Card title="Ask a question" hint="Plain English about any ingested dataset" testid="card-ask">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <label className="sr-only" htmlFor="question">
            Your question
          </label>
          <input
            id="question"
            className="input flex-1"
            placeholder="Which districts have the lowest utilisation_pct?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            data-testid="ask-input"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={busy || !question.trim()} data-testid="ask-submit">
            <Send size={14} aria-hidden /> {busy ? 'Resolving…' : 'Ask'}
          </button>
        </form>

        <div className="mt-3">
          <p className="label">Try one of the engine's own examples</p>
          <div className="flex flex-wrap gap-1.5">
            {(examples?.examples ?? []).map((ex, i) => (
              <button
                key={ex}
                type="button"
                className="chip max-w-full truncate hover:border-teal/60 hover:text-teal"
                onClick={() => void ask(ex)}
                data-testid={`ask-example-${i}`}
                title={ex}
              >
                <Sparkles size={10} aria-hidden /> {ex}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error ? <ErrorState err={error} what="the answer" /> : null}
      {busy && !latest ? (
        <Card title="Working" testid="card-ask-loading">
          <SkeletonText lines={4} />
        </Card>
      ) : null}

      {latest ? (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.3fr_1fr]">
          <Card title="Answer" hint={`Question: “${latest.question}”`} testid="card-answer">
            <p className="text-[0.95rem] font-semibold leading-relaxed text-ink" data-testid="ask-answer">
              {prettifyMoney(latest.answer)}
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-2">
              <Badge kind="acknowledged">intent: {latest.interpretation.intent}</Badge>
              <Badge kind="medium">confidence {fmtPct(latest.confidence * 100, 0)}</Badge>
              <span className="chip">{latest.engineUsed}</span>
              {latest.interpretation.dataset ? <span className="chip">{latest.interpretation.dataset.name}</span> : null}
            </p>

            {Array.isArray(latest.data.rows) && latest.data.rows.length > 0 ? (
              <div className="mt-4 space-y-3">
                <RankedBars
                  data={latest.data.rows.map((r) => ({ label: r.key, value: r.value }))}
                  unit={latest.interpretation.metric ? metricUnit(latest.interpretation.metric) : 'value'}
                  height={Math.max(180, latest.data.rows.length * 30)}
                  testid="chart-answer"
                />
                <DataTable
                  testid="table-answer"
                  rows={latest.data.rows}
                  rowKey={(r) => r.key}
                  maxHeight="18rem"
                  columns={[
                    { key: 'key', header: humanise(latest.interpretation.dimension ?? 'key'), render: (r) => <span className="font-semibold text-ink">{r.key}</span> },
                    {
                      key: 'value',
                      header: humanise(latest.interpretation.metric ?? 'value'),
                      align: 'right',
                      render: (r) => fmtCell(latest.interpretation.metric ?? 'value', r.value),
                    },
                    { key: 'n', header: 'Rows behind it', align: 'right', render: (r) => (r.n === undefined ? '—' : fmtCount(r.n)) },
                  ]}
                />
              </div>
            ) : (
              <div className="mt-4">
                <DetailView detail={latest.data as Record<string, unknown>} testid="ask-data" />
              </div>
            )}

            <div className="mt-3">
              <Formula label="Computation">{latest.formula}</Formula>
            </div>
            <Caveat>
              The engine answers from the ingested tables only. If it could not resolve part of your question it lists the words it ignored, so an
              answer is never quietly about the wrong dataset.
            </Caveat>
          </Card>

          <Card title="How the question was understood" hint="Every resolution step is published" testid="card-interpretation">
            <KeyValues
              cols={1}
              items={[
                { k: 'Intent chosen', v: latest.interpretation.intent },
                { k: 'Dataset resolved', v: latest.interpretation.dataset?.name ?? 'none — answered from the whole catalogue' },
                { k: 'Metric', v: latest.interpretation.metric ? humanise(latest.interpretation.metric) : '—' },
                { k: 'Second metric', v: latest.interpretation.secondMetric ? humanise(latest.interpretation.secondMetric) : '—' },
                { k: 'Grouped by', v: latest.interpretation.dimension ? humanise(latest.interpretation.dimension) : '—' },
                { k: 'Entities named', v: latest.interpretation.entities.length ? latest.interpretation.entities.join(', ') : 'none' },
                { k: 'Direction / top N', v: `${latest.interpretation.direction} · top ${fmtCount(latest.interpretation.topN)}` },
              ]}
            />

            <div className="mt-3">
              <p className="label">Intent scores</p>
              <div className="flex flex-wrap gap-1.5">
                {INTENTS.map((i) => {
                  const score = latest.interpretation.intentScores[i] ?? 0;
                  return (
                    <span key={i} className={`chip ${i === latest.interpretation.intent ? 'border-teal/60 text-teal' : ''}`} data-testid={`intent-${i}`}>
                      {i} <span className="font-bold">{fmtNum(score, 0)}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <p className="label">Keywords matched</p>
              <div className="flex flex-wrap gap-1.5">
                {latest.interpretation.matchedKeywords.length === 0 ? (
                  <span className="text-2xs text-faint">none — the intent fell back to a total</span>
                ) : (
                  latest.interpretation.matchedKeywords.map((k) => (
                    <span key={k} className="chip font-mono">
                      {k}
                    </span>
                  ))
                )}
              </div>
            </div>

            {latest.interpretation.unresolved.length > 0 ? (
              <div className="mt-3">
                <p className="label">Words it could not resolve</p>
                <div className="flex flex-wrap gap-1.5" data-testid="ask-unresolved">
                  {latest.interpretation.unresolved.map((u) => (
                    <span key={u} className="chip border-saffron/50 text-saffron">
                      {u}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {history.length > 1 ? (
        <Card title="This session" hint="Earlier questions and the intent each resolved to" testid="card-ask-history">
          <ul className="space-y-2" data-testid="ask-history">
            {history.slice(1).map((h, i) => (
              <li key={`${h.question}-${i}`} className="flex min-w-0 items-start gap-2.5 border-b border-line/60 pb-2 last:border-0 last:pb-0">
                <MessagesSquare size={13} className="mt-0.5 shrink-0 text-teal" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-[0.8rem] font-semibold text-ink" title={h.question}>
                    {h.question}
                  </p>
                  <p className="line-clamp-2 text-2xs leading-relaxed text-muted">{h.answer}</p>
                </div>
                <Badge kind="low">{h.interpretation.intent}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
