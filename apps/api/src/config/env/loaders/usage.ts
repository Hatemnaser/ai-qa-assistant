import {
  parseNumber,
  parsePositiveInteger,
} from "../parsers.js";
import { DEVELOPMENT_USAGE_IP_HASH_SALT } from "../constants.js";
import type { EnvLoadContext } from "../types.js";

export function loadUsageEnv({ source }: EnvLoadContext) {
  return {
    guestDailyCredits: parseNumber(source.GUEST_DAILY_CREDITS, 20),
    userDailyCredits: parseNumber(source.USER_DAILY_CREDITS, 100),
    usageTokensPerCredit: parseNumber(source.USAGE_TOKENS_PER_CREDIT, 1000),
    usageImageCredits: parseNumber(source.USAGE_IMAGE_CREDITS, 4),
    usageTextFileCredits: parseNumber(source.USAGE_TEXT_FILE_CREDITS, 1),
    usageRouterCredits: parseNumber(source.USAGE_ROUTER_CREDITS, 1),
    usageWindowHours: parseNumber(source.USAGE_WINDOW_HOURS, 24),
    usageStaleReservedMinutes: parsePositiveInteger(
      source.USAGE_STALE_RESERVED_MINUTES,
      30
    ),
    maxMessageChars: parseNumber(source.MAX_MESSAGE_CHARS, 3000),
    maxHistoryMessages: parseNumber(source.MAX_HISTORY_MESSAGES, 10),
    maxHistoryTotalChars: parsePositiveInteger(source.MAX_HISTORY_TOTAL_CHARS, 20_000),
    usageIpHashSalt: source.USAGE_IP_HASH_SALT || DEVELOPMENT_USAGE_IP_HASH_SALT,
  };
}
