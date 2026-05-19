import type { z } from "zod";

import type { chatRequestSchema } from "./chat.schema.js";

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export interface ChatRequestContext {
  guestId?: string;
  ipAddress?: string;
  userId?: string;
}
