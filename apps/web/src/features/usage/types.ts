export interface UsageSummary {
  identityType: "guest" | "user";
  limit: number;
  modelTotals: UsageModelTotal[];
  recentEvents: UsageEvent[];
  remaining: number;
  since: string;
  statusTotals: UsageStatusTotal[];
  unit: "credits";
  used: number;
  windowHours: number;
}

export interface UsageModelTotal {
  credits: number;
  model: string;
  provider: string;
  requests: number;
  totalTokens: number;
}

export interface UsageStatusTotal {
  credits: number;
  requests: number;
  status: string;
}

export interface UsageEvent {
  attachments: number;
  credits: number;
  createdAt: string;
  mode?: string;
  model?: string;
  provider?: string;
  status: string;
  totalTokens?: number;
  workflowIntent?: string;
}
