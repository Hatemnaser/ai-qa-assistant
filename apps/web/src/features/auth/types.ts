export interface AuthUser {
  createdAt: string;
  email: string;
  id: string;
  locale: string;
  name: string | null;
}

export interface AuthResponse {
  session: {
    expiresAt: string;
  };
  user: AuthUser;
}

export interface LoginInput {
  email: string;
  password: string;
  remember: boolean;
}

export interface RegisterInput {
  email: string;
  locale?: string;
  name: string;
  password: string;
}
