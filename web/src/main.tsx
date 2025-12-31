import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { DocumentsProvider } from '@/contexts/DocumentsContext';
import { ProgramsProvider } from '@/contexts/ProgramsContext';
import { IssuesProvider } from '@/contexts/IssuesContext';
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
                <ProgramsProvider>
                  <IssuesProvider>
                    <AppLayout />
                  </IssuesProvider>
                </ProgramsProvider>
              </DocumentsProvider>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/docs" replace />} />
          <Route path="docs" element={<DocumentsPage />} />
          <Route path="docs/:id" element={<DocumentEditorPage />} />
          <Route path="issues" element={<IssuesPage />} />
          <Route path="issues/:id" element={<IssueEditorPage />} />
          <Route path="programs" element={<ProgramsPage />} />
          <Route path="programs/:id" element={<ProgramEditorPage />} />
          <Route path="programs/:id/view" element={<ProgramViewPage />} />
          <Route path="sprints/:id" element={<SprintEditorPage />} />
          <Route path="sprints/:id/view" element={<SprintViewPage />} />
          <Route path="team" element={<Navigate to="/team/allocation" replace />} />
          <Route path="team/allocation" element={<TeamModePage />} />
          <Route path="team/directory" element={<TeamDirectoryPage />} />
          <Route path="team/:id" element={<PersonEditorPage />} />
          <Route path="feedback/new" element={<FeedbackEditorPage />} />
          <Route path="feedback/:id" element={<FeedbackEditorPage />} />
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
