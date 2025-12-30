// Auth types
export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export interface Session {
  id: string;
  userId: string;
  workspaceId: string;
  expiresAt: Date;
  lastActivity: Date;
}
