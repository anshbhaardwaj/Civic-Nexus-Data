import { useCallback, useEffect, useRef, useState } from 'react';

export interface AutoRun<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** Number of completed runs — used by tests to prove "exactly once on mount". */
  runs: number;
  run: () => Promise<void>;
}

/**
 * Runs an API call exactly once per `key` (SPEC §8: "every analysis page
 * auto-runs once on mount so no page is ever empty; one request per page,
 * guarded by a ref").
 *
 * `key` changes (e.g. the dataset switcher) trigger exactly one further run.
 * `run()` re-runs on demand. Out-of-order responses are discarded by ticket.
 */
export function useAutoRun<T>(runner: () => Promise<T>, key: string, enabled = true): AutoRun<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [runs, setRuns] = useState(0);

  const runnerRef = useRef(runner);
  runnerRef.current = runner;
  const lastKey = useRef<string | null>(null);
  const ticket = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    const mine = ticket.current + 1;
    ticket.current = mine;
    setLoading(true);
    setError(null);
    try {
      const result = await runnerRef.current();
      if (!mounted.current || ticket.current !== mine) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!mounted.current || ticket.current !== mine) return;
      setError(err);
    } finally {
      if (mounted.current && ticket.current === mine) {
        setLoading(false);
        setRuns((n) => n + 1);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (lastKey.current === key) return;
    lastKey.current = key;
    void run();
  }, [key, enabled, run]);

  return { data, error, loading, runs, run };
}

/** Debounces a rapidly-changing value (simulator sliders → one API call). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Tracks a media query (used to collapse the sidebar below 1024px). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
