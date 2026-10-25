export interface AuthAbuseBudget {
  key: string;
  limit: number;
  windowMs: number;
}
export interface AuthAbuseDecision {
  limited: boolean;
  retryAfterSeconds: number;
}
export interface AuthAbuseRepository {
  consume(budgets: readonly AuthAbuseBudget[]): Promise<AuthAbuseDecision>;
  cleanup(): Promise<number>;
}
