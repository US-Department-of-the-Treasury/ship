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

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}
