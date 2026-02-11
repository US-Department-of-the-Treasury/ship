// User types
export interface User {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  lastWorkspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
