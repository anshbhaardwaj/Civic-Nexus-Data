import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { useAutoRun } from './hooks';
import type { DatasetSummary } from './types';

/**
 * Global dataset switcher state. Every analysis page reads `selected` and puts
 * it in its auto-run key, so switching the dataset re-runs exactly one request.
 */
interface DatasetsState {
  datasets: DatasetSummary[];
  loading: boolean;
  error: unknown;
  selected: string;
  select: (slug: string) => void;
  reload: () => Promise<void>;
  byslug: (slug: string) => DatasetSummary | undefined;
  /** Datasets that have a time column — the only ones AI-3 can forecast. */
  timeSeries: DatasetSummary[];
  /**
   * Datasets whose time column is a repeating reporting period (month, date,
   * quarter) rather than a one-off event date or a single financial year, so
   * walk-forward validation has at least eight points to work with.
   */
  forecastable: DatasetSummary[];
}

const DatasetsContext = createContext<DatasetsState | null>(null);

export function DatasetsProvider({ children }: { children: ReactNode }) {
  const { token, can } = useAuth();
  const [selected, setSelected] = useState<string>('');
  const enabled = Boolean(token) && can('datasets.read');

  const { data, error, loading, run } = useAutoRun<{ datasets: DatasetSummary[] }>(
    () => api<{ datasets: DatasetSummary[] }>('/api/datasets', { token }),
    `datasets:${token ? 'auth' : 'anon'}`,
    enabled,
  );

  const datasets = useMemo(() => data?.datasets ?? [], [data]);
  const effective = selected && datasets.some((d) => d.slug === selected) ? selected : (datasets[0]?.slug ?? '');

  const select = useCallback((slug: string) => setSelected(slug), []);
  const byslug = useCallback((slug: string) => datasets.find((d) => d.slug === slug), [datasets]);
  const timeSeries = useMemo(() => datasets.filter((d) => d.roles.time.length > 0), [datasets]);
  const forecastable = useMemo(
    () => timeSeries.filter((d) => d.roles.time.some((t) => /^(month|date|period|week|quarter|yearmonth)$/i.test(t))),
    [timeSeries],
  );

  const value = useMemo<DatasetsState>(
    () => ({ datasets, loading, error, selected: effective, select, reload: run, byslug, timeSeries, forecastable }),
    [datasets, loading, error, effective, select, run, byslug, timeSeries, forecastable],
  );
  return <DatasetsContext.Provider value={value}>{children}</DatasetsContext.Provider>;
}

export function useDatasets(): DatasetsState {
  const ctx = useContext(DatasetsContext);
  if (!ctx) throw new Error('useDatasets must be used inside <DatasetsProvider>');
  return ctx;
}

/** First metric that suits a chart, preferring rates/averages over raw sums. */
export function preferredMetric(ds: DatasetSummary | undefined): string {
  if (!ds) return '';
  const metrics = ds.roles.metrics;
  const rate = metrics.find((m) => /_min$|_pct$|index|rating|speed/i.test(m));
  return rate ?? metrics[0] ?? '';
}

/** Averages are correct for rates/indices; sums for counts and money. */
export function preferredAggregation(metric: string): 'sum' | 'avg' {
  return /_min$|_pct$|index|rating|speed|score/i.test(metric) ? 'avg' : 'sum';
}
