import { fmtCell, fmtCount, fmtNum, humanise , prettifyMoney } from '../lib/format';

/**
 * Renders an arbitrary lineage/engine `detail` payload as labelled UI instead of
 * dumping JSON on screen (a hard QA rule: no raw JSON anywhere in the app).
 */
export function DetailView({ detail, testid }: { detail: Record<string, unknown>; testid?: string }) {
  const entries = Object.entries(detail ?? {});
  if (entries.length === 0) return <p className="text-2xs text-faint">No further evidence recorded for this step.</p>;

  return (
    <div className="space-y-3" data-testid={testid}>
      {entries.map(([key, value]) => (
        <Field key={key} name={key} value={value} />
      ))}
    </div>
  );
}

function Field({ name, value }: { name: string; value: unknown }) {
  const label = humanise(name);

  if (value === null || value === undefined) {
    return <Scalar label={label} text="—" />;
  }
  if (typeof value === 'boolean') return <Scalar label={label} text={value ? 'yes' : 'no'} />;
  if (typeof value === 'number') return <Scalar label={label} text={Number.isInteger(value) ? fmtCount(value) : fmtNum(value, 4)} />;
  if (typeof value === 'string') return <Scalar label={label} text={prettifyMoney(value)} wrap={value.length > 48} />;

  if (Array.isArray(value)) {
    if (value.length === 0) return <Scalar label={label} text="none" />;
    const first = value[0];
    if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
      const cols = Array.from(new Set(value.flatMap((r) => Object.keys(r as Record<string, unknown>)))).slice(0, 6);
      return (
        <div>
          <p className="label">
            {label} · {fmtCount(value.length)} {value.length === 1 ? 'entry' : 'entries'}
          </p>
          <div className="overflow-auto rounded-lg border border-line" style={{ maxHeight: '15rem' }}>
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-raised">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="th">
                      {humanise(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(value as Record<string, unknown>[]).slice(0, 60).map((row, i) => (
                  <tr key={i} className="border-t border-line/60">
                    {cols.map((c) => {
                      const text = prettifyMoney(fmtCell(c, row[c]));
                      return (
                        <td key={c} className="td num max-w-[15rem] truncate" title={text}>
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div>
        <p className="label">
          {label} · {fmtCount(value.length)}
        </p>
        <ul className="flex flex-wrap gap-1.5">
          {(value as unknown[]).slice(0, 40).map((v, i) => (
            <li key={i} className="chip max-w-[16rem] truncate" title={prettifyMoney(String(v))}>
              {prettifyMoney(String(v))}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const nested = Object.entries(value as Record<string, unknown>);
  return (
    <div>
      <p className="label">{label}</p>
      <ul className="flex flex-wrap gap-1.5">
        {nested.slice(0, 24).map(([k, v]) => (
          <li key={k} className="chip max-w-[18rem] truncate" title={`${humanise(k)}: ${stringify(v)}`}>
            <span className="text-faint">{humanise(k)}</span>
            <span className="font-bold text-ink">{stringify(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Scalar({ label, text, wrap = false }: { label: string; text: string; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p className={`num text-[0.8rem] font-semibold leading-relaxed text-ink ${wrap ? 'break-words' : 'truncate'}`} title={text}>
        {text}
      </p>
    </div>
  );
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? fmtCount(v) : fmtNum(v, 4);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return `${v.length} items`;
  if (typeof v === 'object') return `${Object.keys(v as object).length} fields`;
  return prettifyMoney(String(v));
}
