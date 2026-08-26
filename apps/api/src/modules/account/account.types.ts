import type { z } from "zod";

import type { deleteAccountRequestSchema } from "./account.schema.js";

export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;

export interface AccountCredentialsRecord {
  id: string;
  passwordHash: string | null;
}

export interface AccountRepository {
  deleteAccountData(userId: string): Promise<void>;
  findAccountCredentials(userId: string): Promise<AccountCredentialsRecord | null>;
}
