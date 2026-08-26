import { env } from "../../config/env.js";
import { countScopedUsage, getUsageIdentityScope, getUsageWindowStart } from "./usage.scope.js";
import {
  CHAT_MESSAGE_ACTION,
  type UsageEventRecord,
  type UsageIdentity,
  type UsageRepository,
} from "./usage.types.js";

export interface UsageInsightsDependencies {
  now?: () => Date;
  repository: UsageRepository;
}

export interface UsageInsightsSummary {
  identityType: "guest" | "user";
  limit: number;
  modelTotals: UsageInsightsModelTotal[];
  recentEvents: UsageInsightsEvent[];
  remaining: number;
  since: string;
  statusTotals: UsageInsightsStatusTotal[];
  unit: "credits";
  used: number;
  windowHours: number;
}

export interface UsageInsightsModelTotal {
  credits: number;
  model: string;
  provider: string;
  requests: number;
  totalTokens: number;
}

export interface UsageInsightsStatusTotal {
  credits: number;
  requests: number;
  status: string;
}

export interface UsageInsightsEvent {
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

export function createUsageInsightsService({ now = () => new Date(), repository }: UsageInsightsDependencies) {
  async function getChatCreditInsights(identity: UsageIdentity): Promise<UsageInsightsSummary> {
    const action = CHAT_MESSAGE_ACTION;
    const since = getUsageWindowStart(now());
    const scope = getUsageIdentityScope(identity);
    const used = await countScopedUsage(repository, {
      action,
      scope,
      since,
    });
    const events = dedupeUsageEvents(
      await repository.listUsageEvents({
        action,
        guestId: scope.guestId,
        ipHash: scope.ipHash,
        since,
        userId: scope.userId,
      })
    );

    return {
      identityType: scope.isSignedIn ? "user" : "guest",
      limit: scope.limit,
      modelTotals: summarizeModels(events),
      recentEvents: events.slice(0, 12).map(toUsageInsightsEvent),
      remaining: Math.max(scope.limit - used, 0),
      since: since.toISOString(),
      statusTotals: summarizeStatuses(events),
      unit: "credits",
      used,
      windowHours: env.usageWindowHours,
    };
  }

  return {
    getChatCreditInsights,
  };
}

function dedupeUsageEvents(events: UsageEventRecord[]) {
  const seen = new Set<string>();
  const deduped: UsageEventRecord[] = [];

  for (const event of events) {
    if (seen.has(event.id)) continue;

    seen.add(event.id);
    deduped.push(event);
  }

  return deduped;
}

function summarizeModels(events: UsageEventRecord[]): UsageInsightsModelTotal[] {
  const totals = new Map<string, UsageInsightsModelTotal>();

  for (const event of events) {
    const model = event.model || "unknown";
    const provider = event.provider || "unknown";
    const key = `${provider}:${model}`;
    const existing =
      totals.get(key) ||
      ({
        credits: 0,
        model,
        provider,
        requests: 0,
        totalTokens: 0,
      } satisfies UsageInsightsModelTotal);

    existing.credits += getEventCredits(event);
    existing.requests += 1;
    existing.totalTokens += event.totalTokens || 0;
    totals.set(key, existing);
  }

  return [...totals.values()].sort((a, b) => b.credits - a.credits || b.requests - a.requests);
}

function summarizeStatuses(events: UsageEventRecord[]): UsageInsightsStatusTotal[] {
  const totals = new Map<string, UsageInsightsStatusTotal>();

  for (const event of events) {
    const existing =
      totals.get(event.status) ||
      ({
        credits: 0,
        requests: 0,
        status: event.status,
      } satisfies UsageInsightsStatusTotal);

    existing.credits += getEventCredits(event);
    existing.requests += 1;
    totals.set(event.status, existing);
  }

  return [...totals.values()].sort((a, b) => b.credits - a.credits || a.status.localeCompare(b.status));
}

function toUsageInsightsEvent(event: UsageEventRecord): UsageInsightsEvent {
  return {
    attachments: event.attachmentCount,
    credits: getEventCredits(event),
    createdAt: event.createdAt.toISOString(),
    ...(event.mode ? { mode: event.mode } : {}),
    ...(event.model ? { model: event.model } : {}),
    ...(event.provider ? { provider: event.provider } : {}),
    status: event.status,
    ...(event.totalTokens ? { totalTokens: event.totalTokens } : {}),
    ...(event.workflowIntent ? { workflowIntent: event.workflowIntent } : {}),
  };
}

function getEventCredits(event: UsageEventRecord) {
  return event.creditsUsed ?? event.creditsReserved ?? event.units;
}
