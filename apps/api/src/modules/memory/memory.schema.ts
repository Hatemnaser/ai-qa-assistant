import { z } from "zod";

export const memoryInputSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});
