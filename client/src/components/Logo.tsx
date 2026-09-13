/**
 * CivicData Nexus mark — a hex "node" (civic data cell) whose three tapped
 * nodes converge on one saffron decision core. Geometric, monochrome-first,
 * legible at 20px and 200px, and drawn with `currentColor` so it inverts with
 * the theme. Matches client/public/favicon.svg.
 */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="CivicData Nexus logo"
      className={className}
      data-testid="logo-mark"
    >
      <path
        d="M16 3.6 25.9 9.3v11.4L16 26.4 6.1 20.7V9.3Z"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M16 15V9.2M16 15l5.1 3M16 15l-5.1 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <g fill="currentColor">
        <circle cx="16" cy="8.4" r="2" />
        <circle cx="21.9" cy="18.7" r="2" />
        <circle cx="10.1" cy="18.7" r="2" />
      </g>
      <circle cx="16" cy="15" r="2.8" className="fill-saffron" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 overflow-hidden" data-testid="wordmark">
      <span className="text-teal">
        <LogoMark size={26} />
      </span>
      {compact ? null : (
        <span className="min-w-0 leading-none">
          <span className="block truncate text-[0.95rem] font-extrabold tracking-tight text-ink">
            CivicData<span className="text-teal"> Nexus</span>
          </span>
          <span className="mt-0.5 block truncate text-2xs font-semibold uppercase tracking-[0.14em] text-faint">
            Decision Intelligence
          </span>
        </span>
      )}
    </span>
  );
}
