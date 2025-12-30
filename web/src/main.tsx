import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DocumentsProvider } from '@/contexts/DocumentsContext';
import { ProjectsProvider } from '@/contexts/ProjectsContext';
import { IssuesProvider } from '@/contexts/IssuesContext';
import { LoginPage } from '@/pages/Login';
import { AppLayout } from '@/pages/App';
import { DocumentsPage } from '@/pages/Documents';
import { DocumentEditorPage } from '@/pages/DocumentEditor';
import { IssuesPage } from '@/pages/Issues';
import { IssueEditorPage } from '@/pages/IssueEditor';
import { ProjectsPage } from '@/pages/Projects';
import { ProjectEditorPage } from '@/pages/ProjectEditor';
import { ProjectViewPage } from '@/pages/ProjectView';
import { SprintEditorPage } from '@/pages/SprintEditor';
import { SprintViewPage } from '@/pages/SprintView';
import { TeamModePage } from '@/pages/TeamMode';
import './index.css';

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

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DocumentsProvider>
                <ProjectsProvider>
                  <IssuesProvider>
                    <AppLayout />
                  </IssuesProvider>
                </ProjectsProvider>
              </DocumentsProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/docs" replace />} />
          <Route path="docs" element={<DocumentsPage />} />
          <Route path="docs/:id" element={<DocumentEditorPage />} />
          <Route path="issues" element={<IssuesPage />} />
          <Route path="issues/:id" element={<IssueEditorPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectEditorPage />} />
          <Route path="projects/:id/view" element={<ProjectViewPage />} />
          <Route path="sprints/:id" element={<SprintEditorPage />} />
          <Route path="sprints/:id/view" element={<SprintViewPage />} />
          <Route path="team" element={<TeamModePage />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" subtitle="Coming soon" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
