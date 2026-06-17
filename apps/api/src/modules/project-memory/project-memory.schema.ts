import { z } from "zod";

import { PROJECT_MEMORY_MAX_CHARS } from "./project-memory.types.js";

export const projectMemoryInputSchema = z.object({
  content: z.string().trim().max(PROJECT_MEMORY_MAX_CHARS),
});
