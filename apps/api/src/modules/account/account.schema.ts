import { z } from "zod";

import { PASSWORD_MAX_LENGTH } from "../auth/auth.schema.js";

export const deleteAccountRequestSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Current password is required.")
    .max(PASSWORD_MAX_LENGTH, `Current password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`),
});
