import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { StateBlock } from '../components/states';

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div data-testid="not-found-page">
      <PageHeader title="Page not found" subtitle="That route does not exist in this build." />
      <StateBlock title={`Nothing is mapped to “${pathname}”`} tone="warn" testid="state-not-found" icon={<Compass size={18} aria-hidden />}>
        <p>
          Routes in this build are hash-based, so a stale bookmark or a typed URL fragment lands here rather than on a blank screen. Nothing was
          lost: your session is still active and every dataset, engine result and audit entry is exactly where it was.
        </p>
        <p>
          The sidebar lists every route your role can reach — the permission matrix hides only what the API would refuse anyway. Head back to the{' '}
          <Link to="/dashboard" className="font-semibold text-teal hover:underline" data-testid="notfound-dashboard-link">
            command dashboard
          </Link>{' '}
          to start again.
        </p>
      </StateBlock>
    </div>
  );
}
