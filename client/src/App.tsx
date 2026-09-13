import { Suspense, lazy, type ComponentType } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { DeniedState, SkeletonCards, SkeletonChart } from './components/states';
import { PageHeader } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { DatasetsProvider } from './lib/datasets';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import Login from './pages/Login';

/* Route-level code splitting (SPEC §8: entry chunk under 450 kB). */
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Datasets = lazy(() => import('./pages/Datasets'));
const DatasetDetail = lazy(() => import('./pages/DatasetDetail'));
const Ingest = lazy(() => import('./pages/Ingest'));
const Lineage = lazy(() => import('./pages/Lineage'));
const Anomalies = lazy(() => import('./pages/Anomalies'));
const Engines = lazy(() => import('./pages/Engines'));
const Forecast = lazy(() => import('./pages/Forecast'));
const IsolationForest = lazy(() => import('./pages/IsolationForest'));
const Clusters = lazy(() => import('./pages/Clusters'));
const Correlation = lazy(() => import('./pages/Correlation'));
const PolicyCards = lazy(() => import('./pages/PolicyCards'));
const Funds = lazy(() => import('./pages/Funds'));
const Ask = lazy(() => import('./pages/Ask'));
const Simulate = lazy(() => import('./pages/Simulate'));
const Brief = lazy(() => import('./pages/Brief'));
const Audit = lazy(() => import('./pages/Audit'));
const Users = lazy(() => import('./pages/Users'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RouteFallback() {
  return (
    <div className="space-y-4" data-testid="route-fallback">
      <div className="skel h-6 w-64" />
      <SkeletonCards count={4} />
      <SkeletonChart />
    </div>
  );
}

/** Client-side mirror of the server RBAC check, with an explicit denied state. */
function Guard({ permission, title, children }: { permission: string; title: string; children: React.ReactNode }) {
  const { can, user } = useAuth();
  if (can(permission)) return <>{children}</>;
  return (
    <div data-testid="guarded-page">
      <PageHeader title={title} subtitle="Access to this view is governed by the same permission matrix the API enforces." />
      <DeniedState permission={permission} role={user?.role} />
    </div>
  );
}

function guarded(permission: string, title: string, Page: ComponentType) {
  return (
    <Guard permission={permission} title={title}>
      <Page />
    </Guard>
  );
}

function AuthedApp() {
  return (
    <AppShell>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={guarded('dashboard.view', 'Command dashboard', Dashboard)} />
          <Route path="/datasets" element={guarded('datasets.read', 'Datasets', Datasets)} />
          <Route path="/datasets/:id" element={guarded('datasets.read', 'Dataset detail', DatasetDetail)} />
          <Route path="/ingest" element={guarded('datasets.ingest', 'Ingest pipeline', Ingest)} />
          <Route path="/lineage" element={guarded('lineage.read', 'Lineage & PII', Lineage)} />
          <Route path="/anomalies" element={guarded('anomalies.read', 'Anomaly register', Anomalies)} />
          <Route path="/engines" element={guarded('policy.read', 'Engine registry', Engines)} />
          <Route path="/forecast" element={guarded('ai.run', 'Forecast ensemble', Forecast)} />
          <Route path="/isolation-forest" element={guarded('ai.run', 'Isolation forest', IsolationForest)} />
          <Route path="/clusters" element={guarded('ai.run', 'Clustering', Clusters)} />
          <Route path="/correlation" element={guarded('ai.run', 'Correlation & causality hints', Correlation)} />
          <Route path="/policy-cards" element={guarded('policy.read', 'Policy cards', PolicyCards)} />
          <Route path="/funds" element={guarded('funds.optimise', 'Fund optimiser', Funds)} />
          <Route path="/ask" element={guarded('ask.run', 'Ask CivicData', Ask)} />
          <Route path="/simulate" element={guarded('simulate.run', 'Policy simulator', Simulate)} />
          <Route path="/brief" element={guarded('brief.read', 'Executive brief', Brief)} />
          <Route path="/audit" element={guarded('audit.read', 'Audit chain', Audit)} />
          <Route path="/users" element={guarded('users.admin', 'User administration', Users)} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function Gate() {
  const { token } = useAuth();
  if (!token) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return <AuthedApp />;
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <HashRouter>
          <AuthProvider>
            <DatasetsProvider>
              <Gate />
            </DatasetsProvider>
          </AuthProvider>
        </HashRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
