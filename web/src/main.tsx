import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient, queryPersister } from '@/lib/queryClient';
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
// DocumentEditorPage deprecated - using UnifiedDocumentPage via DocumentRedirect
import { IssuesPage } from '@/pages/Issues';
import { ProgramsPage } from '@/pages/Programs';
// ProgramEditorPage deprecated - using UnifiedDocumentPage via DocumentRedirect
// SprintEditorPage deprecated - using UnifiedDocumentPage via DocumentRedirect
// SprintViewPage deprecated - using UnifiedDocumentPage via DocumentRedirect
import { SprintPlanningPage } from '@/pages/SprintPlanningPage';
import { SprintsPage } from '@/pages/Sprints';
import { TeamModePage } from '@/pages/TeamMode';
import { TeamDirectoryPage } from '@/pages/TeamDirectory';
// PersonEditorPage deprecated - using UnifiedDocumentPage via DocumentRedirect
import { FeedbackEditorPage } from '@/pages/FeedbackEditor';
import { PublicFeedbackPage } from '@/pages/PublicFeedback';
import { ProjectsPage } from '@/pages/Projects';
// ProjectEditorPage deprecated - using UnifiedDocumentPage via DocumentRedirect
import { DashboardPage } from '@/pages/Dashboard';
import { AdminDashboardPage } from '@/pages/AdminDashboard';
import { AdminWorkspaceDetailPage } from '@/pages/AdminWorkspaceDetail';
import { WorkspaceSettingsPage } from '@/pages/WorkspaceSettings';
import { ConvertedDocumentsPage } from '@/pages/ConvertedDocuments';
import { UnifiedDocumentPage } from '@/pages/UnifiedDocumentPage';
import { MyWeekPage } from '@/pages/MyWeekPage';

import { InviteAcceptPage } from '@/pages/InviteAccept';
import { SetupPage } from '@/pages/Setup';
import { ToastProvider } from '@/components/ui/Toast';
import { MutationErrorToast } from '@/components/MutationErrorToast';
import './index.css';

/**
 * Redirect component for type-specific routes to canonical /documents/:id
 * Uses replace to ensure browser history only has one entry
 */
function DocumentRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/documents/${id}`} replace />;
}

/**
 * Redirect component for routes with optional tab parameter
 * e.g., /programs/:id/issues → /documents/:id/issues
 */
function DocumentRedirectWithTab({ tab }: { tab: string }) {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/documents/${id}/${tab}`} replace />;
}

/**
 * Redirect component for nested sprint routes within programs/projects
 * e.g., /programs/:id/sprints/:sprintId → /documents/:id/sprints/:sprintId
 */
function ProgramSprintRedirect() {
  const { id, sprintId } = useParams<{ id: string; sprintId: string }>();
  return <Navigate to={`/documents/${id}/sprints/${sprintId}`} replace />;
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
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="my-week" element={<MyWeekPage />} />
        <Route path="docs" element={<DocumentsPage />} />
        {/* Legacy wiki route redirects to /documents/:id */}
        <Route path="docs/:id" element={<DocumentRedirect />} />
        <Route path="documents/:id/*" element={<UnifiedDocumentPage />} />
        <Route path="issues" element={<IssuesPage />} />
        <Route path="issues/:id" element={<DocumentRedirect />} />
        <Route path="projects" element={<ProjectsPage />} />
        {/* Legacy project routes redirect to /documents/:id */}
        <Route path="projects/:id" element={<DocumentRedirect />} />
        <Route path="projects/:id/issues" element={<DocumentRedirectWithTab tab="issues" />} />
        <Route path="projects/:id/sprints" element={<DocumentRedirectWithTab tab="sprints" />} />
        <Route path="programs" element={<ProgramsPage />} />
        {/* Legacy program routes redirect to /documents/:id */}
        <Route path="programs/:id" element={<DocumentRedirect />} />
        <Route path="programs/:id/issues" element={<DocumentRedirectWithTab tab="issues" />} />
        <Route path="programs/:id/projects" element={<DocumentRedirectWithTab tab="projects" />} />
        <Route path="programs/:id/sprints" element={<DocumentRedirectWithTab tab="sprints" />} />
        <Route path="programs/:id/sprints/:sprintId" element={<ProgramSprintRedirect />} />
        <Route path="sprints" element={<SprintsPage />} />
        {/* Sprint routes - redirect legacy views to /documents/:id, keep planning workflow */}
        <Route path="sprints/:id" element={<DocumentRedirect />} />
        <Route path="sprints/:id/view" element={<DocumentRedirect />} />
        <Route path="sprints/:id/plan/:tab?" element={<SprintPlanningPage />} />
        <Route path="sprints/:id/planning" element={<DocumentRedirect />} />
        <Route path="sprints/:id/standups" element={<DocumentRedirect />} />
        <Route path="sprints/:id/review" element={<DocumentRedirect />} />
        <Route path="team" element={<Navigate to="/team/allocation" replace />} />
        <Route path="team/allocation" element={<TeamModePage />} />
        <Route path="team/directory" element={<TeamDirectoryPage />} />
        {/* Legacy team profile route redirects to /documents/:id */}
        <Route path="team/:id" element={<DocumentRedirect />} />
        <Route path="feedback/:id" element={<FeedbackEditorPage />} />
        <Route path="settings" element={<WorkspaceSettingsPage />} />
        <Route path="settings/conversions" element={<ConvertedDocumentsPage />} />
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
        <MutationErrorToast />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </PersistQueryClientProvider>
  </React.StrictMode>
);
