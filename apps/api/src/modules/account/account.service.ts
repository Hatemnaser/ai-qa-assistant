import { AppError } from "../../lib/errors.js";
import { verifyPassword } from "../auth/auth.security.js";
import { accountRepository } from "./account.repository.js";
import type { AccountRepository, DeleteAccountRequest } from "./account.types.js";

export interface AccountDeletionSecurity {
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}

export interface AccountServiceDependencies {
  repository: AccountRepository;
  security?: AccountDeletionSecurity;
}

export function createAccountService({
  repository,
  security = { verifyPassword },
}: AccountServiceDependencies) {
  async function deleteAccount(userId: string, input: DeleteAccountRequest) {
    const account = await repository.findAccountCredentials(userId);

    if (!account) {
      throw new AppError("Authentication is required.", 401, "SESSION_REQUIRED");
    }

    if (!account.passwordHash) {
      throw new AppError(
        "Password confirmation is not available for this account.",
        409,
        "PASSWORD_CONFIRMATION_UNAVAILABLE"
      );
    }

    const passwordMatches = await security.verifyPassword(input.currentPassword, account.passwordHash);

    if (!passwordMatches) {
      throw new AppError("Current password is incorrect.", 403, "CURRENT_PASSWORD_INVALID");
    }

    await repository.deleteAccountData(userId);

    return { ok: true as const };
  }

  return {
    deleteAccount,
  };
}

export const accountService = createAccountService({
  repository: accountRepository,
});
