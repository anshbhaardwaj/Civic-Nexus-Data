import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Theme is kept in React state (no storage — SPEC §2 forbids client persistence). */
type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.dataset['theme'] = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#06101A' : '#F0F4F9');
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo<ThemeState>(() => ({ theme, toggle, set: setTheme }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Chart colours resolved per theme so Recharts never inherits a wrong contrast. */
export function chartPalette(theme: Theme) {
  return theme === 'dark'
    ? {
        grid: '#1E374F',
        axis: '#6C869E',
        text: '#E2ECF5',
        series: ['#2DD4BF', '#FF9933', '#7DD3FC', '#A78BFA', '#F87171', '#34D399', '#FBBF24', '#F472B6'],
        band: '#2DD4BF',
        tooltipBg: '#0C1B2A',
      }
    : {
        grid: '#D5E0EB',
        axis: '#4F6780',
        text: '#0A2138',
        series: ['#0D7C7A', '#C86A08', '#1D6FA5', '#6D4AB8', '#B92D2D', '#14764A', '#B06A06', '#B3407A'],
        band: '#0D7C7A',
        tooltipBg: '#FFFFFF',
      };
}
