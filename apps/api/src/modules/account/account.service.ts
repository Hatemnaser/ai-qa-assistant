import { AppError } from "../../lib/errors.js";
import { env } from '../../config/env.js';
import { requestOwnerBrowserStop } from '../browser-runtime/browser-runtime.repository.js';
import { revokeSavedOwner } from '../browser-auth/browser-auth.repository.js';
import { verifyPassword } from "../auth/auth.security.js";
import { accountRepository } from "./account.repository.js";
import type { AccountRepository, DeleteAccountRequest } from "./account.types.js";

export interface AccountDeletionSecurity {
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}

export interface AccountServiceDependencies {
  requireBrowserStop?: (userId: string) => Promise<boolean>;
  repository: AccountRepository;
  security?: AccountDeletionSecurity;
}

export function createAccountService({
  requireBrowserStop = async () => true,
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

    if (!await requireBrowserStop(userId)) throw new AppError('Browser Stop must be confirmed before deleting this account. Retry after Stop.', 409, 'BROWSER_STOP_REQUIRED');
    await repository.deleteAccountData(userId);

    return { ok: true as const };
  }

  return {
    deleteAccount,
  };
}

export const accountService = createAccountService({
  repository: accountRepository,
  requireBrowserStop: async userId => {const confirmed=await requestOwnerBrowserStop(userId);await revokeSavedOwner(userId);return confirmed;},
});
