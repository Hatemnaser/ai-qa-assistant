import type { z } from "zod";

import type { chatRequestSchema } from "./chat.schema.js";

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatRequestContext {
  sessionContext?: Record<string, unknown>;
  guestId?: string;
  ipAddress?: string;
  userId?: string;
}
