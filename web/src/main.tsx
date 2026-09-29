import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { AdminDashboard } from './AdminDashboard.tsx';
import { App } from './App.tsx';
import './i18n/index.ts';
import { SharedView } from './SharedView.tsx';
import { PlannerProvider } from './state/PlannerContext.tsx';

registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// A shared-view link (/shared/:token) is a public, read-only page: it must
// render without an account or the signed-in PlannerContext, so it's routed
// here rather than as a state inside App.
const sharedMatch = window.location.pathname.match(/^\/shared\/([^/]+)$/);
// Same reasoning as the shared-view page above: /admin is its own standalone
// page (server-gated per request), not part of the signed-in PlannerContext.
const isAdminPath = window.location.pathname === '/admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {sharedMatch ? (
        <SharedView token={sharedMatch[1]!} />
      ) : isAdminPath ? (
        <AdminDashboard />
      ) : (
        <PlannerProvider>
          <App />
        </PlannerProvider>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
