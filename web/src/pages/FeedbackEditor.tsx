import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

/**
 * FeedbackEditorPage - Redirects to IssueEditor
 *
 * After consolidating feedback into issues, feedback items are now issues
 * with source='external'. This page redirects to the IssueEditor which
 * handles all issue types uniformly.
 */
export function FeedbackEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (id) {
      // Redirect to issue editor - feedback is now just an issue with source='external'
      navigate(`/documents/${id}`, { replace: true });
    } else {
      navigate('/issues', { replace: true });
    }
  }, [id, navigate]);

  return null;
}
