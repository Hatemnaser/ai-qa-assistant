import { z } from "zod";

export const projectInstructionInputSchema = z.object({
  content: z.string().trim().max(12000),
});
