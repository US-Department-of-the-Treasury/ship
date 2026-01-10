import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient, queryPersister, loadPendingMutations } from '@/lib/queryClient';
import { initializeSyncHandlers } from '@/lib/syncHandlers';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DocumentsProvider } from '@/contexts/DocumentsContext';
import { ProgramsProvider } from '@/contexts/ProgramsContext';
import { IssuesProvider } from '@/contexts/IssuesContext';
import { ProjectsProvider } from '@/contexts/ProjectsContext';
import { ArchivedPersonsProvider } from '@/contexts/ArchivedPersonsContext';
import { LoginPage } from '@/pages/Login';
import { AppLayout } from '@/pages/App';
import { DocumentsPage } from '@/pages/Documents';
import { DocumentEditorPage } from '@/pages/DocumentEditor';
import { IssuesPage } from '@/pages/Issues';
import { IssueEditorPage } from '@/pages/IssueEditor';
import { ProgramsPage } from '@/pages/Programs';
import { ProgramEditorPage } from '@/pages/ProgramEditor';
import { ProgramViewPage } from '@/pages/ProgramView';
import { SprintEditorPage } from '@/pages/SprintEditor';
import { SprintViewPage } from '@/pages/SprintView';
import { TeamModePage } from '@/pages/TeamMode';
import { TeamDirectoryPage } from '@/pages/TeamDirectory';
import { PersonEditorPage } from '@/pages/PersonEditor';
import { FeedbackEditorPage } from '@/pages/FeedbackEditor';
import { PublicFeedbackPage } from '@/pages/PublicFeedback';
import { ProjectEditorPage } from '@/pages/ProjectEditor';
import { AdminDashboardPage } from '@/pages/AdminDashboard';
import { AdminWorkspaceDetailPage } from '@/pages/AdminWorkspaceDetail';
import { WorkspaceSettingsPage } from '@/pages/WorkspaceSettings';
import { InviteAcceptPage } from '@/pages/InviteAccept';
import { SetupPage } from '@/pages/Setup';
import { ToastProvider } from '@/components/ui/Toast';
import './index.css';

// Load pending mutations from IndexedDB on startup
loadPendingMutations();

// Initialize sync handlers for offline mutation processing
initializeSyncHandlers();

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[App] Service Worker registered:', registration.scope);
      })
      .catch((error) => {
        console.log('[App] Service Worker registration failed:', error);
      });
  });
}

function PlaceholderPage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <h1 className="text-xl font-medium text-foreground">{title}</h1>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
    </div>
  );
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/docs" replace />;
  }

  return <>{children}</>;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isSuperAdmin } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isSuperAdmin) {
    return <Navigate to="/docs" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      {/* Truly public routes - no AuthProvider wrapper */}
      <Route
        path="/feedback/:programId"
        element={<PublicFeedbackPage />}
      />
      {/* Routes that need AuthProvider (even if some are public) */}
      <Route
        path="/*"
        element={
          <WorkspaceProvider>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </WorkspaceProvider>
        }
      />
    </Routes>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/setup"
        element={<SetupPage />}
      />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/invite/:token"
        element={<InviteAcceptPage />}
      />
      <Route
        path="/admin"
        element={
          <SuperAdminRoute>
            <AdminDashboardPage />
          </SuperAdminRoute>
        }
      />
      <Route
        path="/admin/workspaces/:id"
        element={
          <SuperAdminRoute>
            <AdminWorkspaceDetailPage />
          </SuperAdminRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <ArchivedPersonsProvider>
              <DocumentsProvider>
                <ProgramsProvider>
                  <ProjectsProvider>
                    <IssuesProvider>
                      <AppLayout />
                    </IssuesProvider>
                  </ProjectsProvider>
                </ProgramsProvider>
              </DocumentsProvider>
            </ArchivedPersonsProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/docs" replace />} />
        <Route path="docs" element={<DocumentsPage />} />
        <Route path="docs/:id" element={<DocumentEditorPage />} />
        <Route path="issues" element={<IssuesPage />} />
        <Route path="issues/:id" element={<IssueEditorPage />} />
        <Route path="projects" element={<PlaceholderPage title="Projects" subtitle="Select a project from the sidebar or create a new one" />} />
        <Route path="projects/:id" element={<ProjectEditorPage />} />
        <Route path="programs" element={<ProgramsPage />} />
        <Route path="programs/:id" element={<ProgramEditorPage />} />
        <Route path="programs/:id/view" element={<ProgramViewPage />} />
        <Route path="sprints/:id" element={<SprintEditorPage />} />
        <Route path="sprints/:id/view" element={<SprintViewPage />} />
        <Route path="team" element={<Navigate to="/team/allocation" replace />} />
        <Route path="team/allocation" element={<TeamModePage />} />
        <Route path="team/directory" element={<TeamDirectoryPage />} />
        <Route path="team/:id" element={<PersonEditorPage />} />
        <Route path="feedback/:id" element={<FeedbackEditorPage />} />
        <Route path="settings" element={<WorkspaceSettingsPage />} />
      </Route>
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister: queryPersister }}
    >
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  </React.StrictMode>
);
