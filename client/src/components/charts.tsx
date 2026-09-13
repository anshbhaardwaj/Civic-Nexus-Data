import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { ReactNode } from 'react';
import { chartPalette, useTheme } from '../lib/theme';
import { fmtAxis, fmtNum } from '../lib/format';

/** Shared axis/tooltip styling so every chart reads the same in both themes. */
function useChart() {
  const { theme } = useTheme();
  return chartPalette(theme);
}

function TooltipBox({ p, rows, title }: { p: ReturnType<typeof chartPalette>; rows: { name: string; value: ReactNode; color?: string }[]; title: string }) {
  return (
    <div className="rounded-lg border border-line px-2.5 py-2 text-2xs shadow-pop" style={{ background: p.tooltipBg }}>
      <p className="mb-1 font-bold text-ink">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.name} className="num flex items-center gap-2 text-muted">
            {r.color ? <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.color }} /> : null}
            <span className="text-faint">{r.name}</span>
            <span className="ml-auto font-semibold text-ink">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SeriesPoint {
  label: string;
  [k: string]: string | number | null | undefined;
}

/**
 * Time series with optional forecast interval bands. `bands` expects the
 * lo/hi keys already present on the rows (forecast rows only).
 */
export function TrendChart({
  data,
  series,
  bands,
  height = 280,
  unit,
  testid,
}: {
  data: SeriesPoint[];
  series: { key: string; name: string; dashed?: boolean; colorIndex?: number }[];
  /**
   * Forecast interval bands drawn as stacked areas: `base` (transparent) plus
   * `span` (= hi - lo, filled). The page precomputes both keys.
   */
  bands?: { base: string; span: string; name: string; opacity?: number }[];
  height?: number;
  unit?: string;
  testid?: string;
}) {
  const p = useChart();
  return (
    <div style={{ width: '100%', height }} data-testid={testid}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={p.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: p.axis, fontSize: 10 }} stroke={p.grid} minTickGap={24} tickMargin={6} />
          <YAxis tick={{ fill: p.axis, fontSize: 10 }} stroke={p.grid} tickFormatter={fmtAxis} width={46} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload && payload.length ? (
                <TooltipBox
                  p={p}
                  title={`${String(label)}${unit ? ` · ${unit}` : ''}`}
                  rows={payload
                    .filter((x) => x.value !== null && x.value !== undefined)
                    .map((x) => ({ name: String(x.name), value: fmtNum(Number(x.value), 2), color: String(x.color ?? '') }))}
                />
              ) : null
            }
          />
          {bands?.flatMap((b) => [
            <Area
              key={b.base}
              type="monotone"
              dataKey={b.base}
              stackId={b.name}
              name={`${b.name} floor`}
              stroke="none"
              fill="none"
              fillOpacity={0}
              activeDot={false}
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
            />,
            <Area
              key={b.span}
              type="monotone"
              dataKey={b.span}
              stackId={b.name}
              name={b.name}
              stroke="none"
              fill={p.band}
              fillOpacity={b.opacity ?? 0.16}
              activeDot={false}
              isAnimationActive={false}
              tooltipType="none"
            />,
          ])}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={p.series[(s.colorIndex ?? i) % p.series.length]}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 11, color: p.text }} iconSize={9} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal ranked bars — used for rankings, contributions, histograms. */
export function RankedBars({
  data,
  valueKey = 'value',
  labelKey = 'label',
  height = 280,
  unit,
  colorIndex = 0,
  colorBy,
  testid,
  vertical = false,
}: {
  data: SeriesPoint[];
  valueKey?: string;
  labelKey?: string;
  height?: number;
  unit?: string;
  colorIndex?: number;
  colorBy?: (row: SeriesPoint, i: number) => string;
  testid?: string;
  vertical?: boolean;
}) {
  const p = useChart();
  return (
    <div style={{ width: '100%', height }} data-testid={testid}>
      <ResponsiveContainer>
        <BarChart data={data} layout={vertical ? 'horizontal' : 'vertical'} margin={{ top: 6, right: 18, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={p.grid} strokeDasharray="2 4" horizontal={!vertical ? false : true} vertical={vertical ? false : true} />
          {vertical ? (
            <>
              <XAxis dataKey={labelKey} tick={{ fill: p.axis, fontSize: 10 }} stroke={p.grid} interval={0} tickMargin={6} />
              <YAxis tick={{ fill: p.axis, fontSize: 10 }} stroke={p.grid} tickFormatter={fmtAxis} width={44} />
            </>
          ) : (
            <>
              <XAxis type="number" tick={{ fill: p.axis, fontSize: 10 }} stroke={p.grid} tickFormatter={fmtAxis} />
              <YAxis type="category" dataKey={labelKey} tick={{ fill: p.axis, fontSize: 10 }} stroke={p.grid} width={124} interval={0} />
            </>
          )}
          <Tooltip
            cursor={{ fill: p.grid, fillOpacity: 0.25 }}
            content={({ active, payload }) =>
              active && payload && payload.length ? (
                <TooltipBox
                  p={p}
                  title={String((payload[0]?.payload as SeriesPoint | undefined)?.[labelKey] ?? '')}
                  rows={[{ name: unit ?? 'Value', value: fmtNum(Number(payload[0]?.value), 2) }]}
                />
              ) : null
            }
          />
          <Bar dataKey={valueKey} radius={vertical ? [3, 3, 0, 0] : [0, 3, 3, 0]} isAnimationActive={false} maxBarSize={26}>
            {data.map((row, i) => (
              <Cell key={i} fill={colorBy ? colorBy(row, i) : p.series[colorIndex % p.series.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cluster scatter: x = first feature, y = second, colour = cluster. */
export function ClusterScatter({
  groups,
  xName,
  yName,
  height = 300,
  testid,
}: {
  groups: { name: string; points: { x: number; y: number; label: string }[] }[];
  xName: string;
  yName: string;
  height?: number;
  testid?: string;
}) {
  const p = useChart();
  return (
    <div style={{ width: '100%', height }} data-testid={testid}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
          <CartesianGrid stroke={p.grid} strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="x"
            name={xName}
            tick={{ fill: p.axis, fontSize: 10 }}
            stroke={p.grid}
            tickFormatter={fmtAxis}
            label={{ value: xName, position: 'insideBottom', offset: -10, fill: p.axis, fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yName}
            tick={{ fill: p.axis, fontSize: 10 }}
            stroke={p.grid}
            tickFormatter={fmtAxis}
            width={48}
          />
          <ZAxis range={[70, 70]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const pt = payload[0]?.payload as { label: string; x: number; y: number };
              return (
                <TooltipBox
                  p={p}
                  title={pt.label}
                  rows={[
                    { name: xName, value: fmtNum(pt.x, 2) },
                    { name: yName, value: fmtNum(pt.y, 2) },
                  ]}
                />
              );
            }}
          />
          {groups.map((g, i) => (
            <Scatter key={g.name} name={g.name} data={g.points} fill={p.series[i % p.series.length]} isAnimationActive={false} />
          ))}
          <Legend wrapperStyle={{ fontSize: 11, color: p.text }} iconSize={9} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Correlation heatmap in plain CSS — no chart library needed, always legible. */
export function CorrelationHeatmap({
  metrics,
  matrix,
  testid,
}: {
  metrics: string[];
  matrix: number[][];
  testid?: string;
}) {
  const cell = (r: number) => {
    const a = Math.min(1, Math.abs(r));
    const positive = r >= 0;
    const bg = positive ? `rgb(var(--c-teal) / ${0.12 + a * 0.72})` : `rgb(var(--c-saffron) / ${0.12 + a * 0.72})`;
    return { background: bg, color: a > 0.55 ? 'rgb(var(--c-navy))' : 'rgb(var(--c-ink))' };
  };
  return (
    <div className="overflow-auto" data-testid={testid}>
      <table className="border-collapse text-2xs">
        <thead>
          <tr>
            <th className="th sticky left-0 z-10 bg-surface" />
            {metrics.map((m) => (
              <th key={m} className="th px-1.5 text-center">
                <span className="inline-block max-w-[5.5rem] truncate align-bottom" title={m}>
                  {m}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map((m, i) => (
            <tr key={m}>
              <th className="th sticky left-0 z-10 bg-surface">
                <span className="inline-block max-w-[7rem] truncate align-middle" title={m}>
                  {m}
                </span>
              </th>
              {metrics.map((n, j) => (
                <td key={n} className="border border-surface p-0">
                  <div
                    className="num flex h-8 w-[4.6rem] items-center justify-center font-bold"
                    style={cell(matrix[i]?.[j] ?? 0)}
                    title={`${m} vs ${n}: r = ${fmtNum(matrix[i]?.[j] ?? 0, 4)}`}
                  >
                    {fmtNum(matrix[i]?.[j] ?? 0, 2)}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
