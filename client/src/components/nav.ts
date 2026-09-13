import {
  AlertTriangle,
  Boxes,
  Cpu,
  Database,
  FileText,
  GitBranch,
  LayoutDashboard,
  Layers,
  MessageSquare,
  Network,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Upload,
  UserCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Permission required to see and use the page (mirrors the server RBAC matrix). */
  permission: string;
  engine?: string;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Sidebar is filtered against `user.permissions`, i.e. the same strings the API enforces. */
export const NAV: NavGroup[] = [
  {
    group: 'Overview',
    items: [{ to: '/dashboard', label: 'Command dashboard', short: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' }],
  },
  {
    group: 'Data foundation',
    items: [
      { to: '/datasets', label: 'Datasets', short: 'Datasets', icon: Database, permission: 'datasets.read' },
      { to: '/ingest', label: 'Ingest pipeline', short: 'Ingest', icon: Upload, permission: 'datasets.ingest' },
      { to: '/lineage', label: 'Lineage & PII', short: 'Lineage', icon: GitBranch, permission: 'lineage.read' },
    ],
  },
  {
    group: 'Analytics engines',
    items: [
      { to: '/anomalies', label: 'Anomaly register', short: 'Anomalies', icon: AlertTriangle, permission: 'anomalies.read', engine: 'AI-1' },
      { to: '/engines', label: 'Engine registry', short: 'Engines', icon: Cpu, permission: 'policy.read' },
      { to: '/forecast', label: 'Forecast ensemble', short: 'Forecast', icon: TrendingUp, permission: 'ai.run', engine: 'AI-3' },
      { to: '/isolation-forest', label: 'Isolation forest', short: 'Isolation forest', icon: Radar, permission: 'ai.run', engine: 'AI-2' },
      { to: '/clusters', label: 'Clustering', short: 'Clusters', icon: Boxes, permission: 'ai.run', engine: 'AI-4' },
      { to: '/correlation', label: 'Correlation', short: 'Correlation', icon: Network, permission: 'ai.run', engine: 'AI-5' },
    ],
  },
  {
    group: 'Decision support',
    items: [
      { to: '/policy-cards', label: 'Policy cards', short: 'Policy cards', icon: Layers, permission: 'policy.read', engine: 'AI-6' },
      { to: '/funds', label: 'Fund optimiser', short: 'Funds', icon: Wallet, permission: 'funds.optimise', engine: 'AI-7' },
      { to: '/ask', label: 'Ask CivicData', short: 'Ask', icon: MessageSquare, permission: 'ask.run', engine: 'AI-8' },
      { to: '/simulate', label: 'Policy simulator', short: 'Simulator', icon: SlidersHorizontal, permission: 'simulate.run' },
      { to: '/brief', label: 'Executive brief', short: 'Brief', icon: FileText, permission: 'brief.read' },
    ],
  },
  {
    group: 'Governance',
    items: [
      { to: '/audit', label: 'Audit chain', short: 'Audit', icon: ShieldCheck, permission: 'audit.read' },
      { to: '/users', label: 'User administration', short: 'Users', icon: UserCog, permission: 'users.admin' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

export function navFor(permissions: string[]): NavGroup[] {
  return NAV.map((g) => ({ group: g.group, items: g.items.filter((i) => permissions.includes(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Page metadata for the top bar breadcrumb / document title. */
export function itemFor(pathname: string): NavItem | undefined {
  const path = pathname.replace(/\/$/, '') || '/dashboard';
  return ALL_NAV_ITEMS.find((i) => path === i.to || path.startsWith(`${i.to}/`));
}
