import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Database, LogOut, Menu, Moon, PanelLeftClose, Sun, X } from 'lucide-react';
import { LogoMark, Wordmark } from './Logo';
import { navFor, itemFor } from './nav';
import { useAuth } from '../lib/auth';
import { useDatasets } from '../lib/datasets';
import { useTheme } from '../lib/theme';
import { useMediaQuery } from '../lib/hooks';
import { fmtCount } from '../lib/format';

const ROLE_TONE: Record<string, string> = {
  minister: 'border-saffron/50 bg-saffron/10 text-saffron',
  analyst: 'border-teal/50 bg-teal/10 text-teal',
  director: 'border-ok/50 bg-ok/10 text-ok',
  auditor: 'border-line bg-raised text-muted',
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { datasets, selected, select } = useDatasets();
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  const groups = navFor(user?.permissions ?? []);
  const current = itemFor(location.pathname);

  useEffect(() => {
    setDrawer(false);
  }, [location.pathname]);

  useEffect(() => {
    document.title = current ? `${current.short} · CivicData Nexus` : 'CivicData Nexus';
  }, [current]);

  const railWidth = collapsed && isDesktop ? 'lg:w-[4.5rem]' : 'lg:w-[15.5rem]';

  return (
    <div className="flex min-h-screen w-full bg-bg">
      {/* ------------------------------------------------------------ sidebar */}
      {drawer && !isDesktop ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-navy/70 backdrop-blur-sm lg:hidden"
          onClick={() => setDrawer(false)}
          data-testid="sidebar-scrim"
        />
      ) : null}

      <aside
        data-testid="sidebar"
        data-collapsed={collapsed && isDesktop ? 'true' : 'false'}
        className={`fixed inset-y-0 left-0 z-40 flex w-[15.5rem] shrink-0 flex-col border-r border-line bg-surface transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:transition-[width] ${railWidth} ${
          drawer ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <NavLink to="/dashboard" className="min-w-0" data-testid="brand-link">
            <Wordmark compact={collapsed && isDesktop} />
          </NavLink>
          <button
            type="button"
            className="rounded-md p-1.5 text-faint hover:text-ink lg:hidden"
            onClick={() => setDrawer(false)}
            aria-label="Close navigation"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Primary">
          {groups.map((g) => (
            <div key={g.group} className="mb-3">
              {collapsed && isDesktop ? (
                <div className="mx-2 mb-1.5 border-t border-line/70" />
              ) : (
                <p className="px-2 pb-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-faint">{g.group}</p>
              )}
              <ul className="space-y-0.5">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      data-testid={`nav-${item.to.slice(1)}`}
                      title={collapsed && isDesktop ? item.label : undefined}
                      className={({ isActive }) =>
                        `group flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-semibold transition-colors ${
                          isActive ? 'bg-teal/12 text-teal ring-1 ring-inset ring-teal/30' : 'text-muted hover:bg-raised hover:text-ink'
                        } ${collapsed && isDesktop ? 'justify-center' : ''}`
                      }
                    >
                      <item.icon size={17} className="shrink-0" aria-hidden />
                      {collapsed && isDesktop ? null : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{item.short}</span>
                          {item.engine ? <span className="shrink-0 font-mono text-2xs text-faint">{item.engine}</span> : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-line p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="hidden w-full items-center gap-2 rounded-lg px-2 py-2 text-2xs font-bold uppercase tracking-wider text-faint hover:bg-raised hover:text-ink lg:flex"
            data-testid="sidebar-collapse"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={15} aria-hidden /> : <PanelLeftClose size={15} aria-hidden />}
            {collapsed ? null : <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ------------------------------------------------------------- main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/95 px-3 backdrop-blur sm:px-4"
          data-testid="topbar"
        >
          <button
            type="button"
            className="rounded-md p-2 text-muted hover:bg-raised hover:text-ink lg:hidden"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            data-testid="sidebar-open"
          >
            <Menu size={18} aria-hidden />
          </button>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className="text-teal lg:hidden">
              <LogoMark size={22} />
            </span>
            <p className="truncate text-sm font-bold text-ink" data-testid="topbar-title">
              {current?.label ?? 'CivicData Nexus'}
            </p>
          </div>

          <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
            {datasets.length > 0 ? (
              <label className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1.5">
                <Database size={14} className="shrink-0 text-teal" aria-hidden />
                <span className="sr-only">Active dataset</span>
                <select
                  className="num max-w-[8.5rem] truncate bg-transparent text-2xs font-semibold text-ink focus:outline-none sm:max-w-[13rem] sm:text-xs"
                  value={selected}
                  onChange={(e) => select(e.target.value)}
                  data-testid="dataset-switcher"
                  aria-label="Active dataset"
                >
                  {datasets.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name} · {fmtCount(d.rows)} rows
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <button
              type="button"
              onClick={toggle}
              className="rounded-lg border border-line bg-raised p-2 text-muted hover:text-teal"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              data-testid="theme-toggle"
              data-theme={theme}
            >
              {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
            </button>

            <span
              className={`hidden items-center gap-1.5 rounded-lg border px-2 py-1.5 text-2xs font-bold uppercase tracking-wider sm:inline-flex ${
                ROLE_TONE[user?.role ?? ''] ?? 'border-line bg-raised text-muted'
              }`}
              data-testid="role-badge"
            >
              {user?.role ?? 'guest'}
            </span>

            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-line bg-raised p-2 text-muted hover:border-danger/50 hover:text-danger"
              aria-label="Sign out"
              title={user?.email}
              data-testid="logout-button"
            >
              <LogOut size={15} aria-hidden />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-4 sm:py-5" data-testid="main-content">
          <div className="mx-auto w-full max-w-[104rem]">{children}</div>
        </main>

        <footer className="shrink-0 border-t border-line px-4 py-3 text-2xs leading-relaxed text-faint" data-testid="footer">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-muted">CivicData Nexus</span>
            <span aria-hidden>·</span>
            <span>Team CivicNexus · SIH 2026 · PS SIH1682</span>
            <span aria-hidden>·</span>
            <span>Fully offline: every figure computed on this host from seeded SQLite data</span>
          </p>
        </footer>
      </div>
    </div>
  );
}

/** Small back-link used by nested pages (dataset detail). */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink to={to} className="inline-flex items-center gap-1 text-2xs font-bold uppercase tracking-wider text-faint hover:text-teal" data-testid="back-link">
      <ChevronLeft size={13} aria-hidden />
      {children}
    </NavLink>
  );
}
