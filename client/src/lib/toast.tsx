import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info' | 'warn';
export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastState {
  push: (kind: ToastKind, title: string, detail?: string) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      seq.current += 1;
      const id = seq.current;
      setToasts((t) => [...t.slice(-3), { id, kind, title, detail }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo<ToastState>(() => ({ push, toasts, dismiss }), [push, toasts, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const ICON = { success: CheckCircle2, error: XCircle, info: Info, warn: AlertTriangle } as const;
const TONE: Record<ToastKind, string> = {
  success: 'border-ok/50 text-ok',
  error: 'border-danger/50 text-danger',
  info: 'border-teal/50 text-teal',
  warn: 'border-warn/50 text-warn',
};

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[22rem]"
      data-testid="toast-viewport"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div
            key={t.id}
            data-testid={`toast-${t.kind}`}
            className={`pointer-events-auto flex animate-rise items-start gap-2.5 rounded-lg border bg-surface p-3 shadow-pop ${TONE[t.kind]}`}
          >
            <Icon size={17} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-ink">{t.title}</p>
              {t.detail ? <p className="mt-0.5 break-words text-2xs leading-relaxed text-muted">{t.detail}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-faint hover:text-ink"
              aria-label="Dismiss notification"
              data-testid="toast-dismiss"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
