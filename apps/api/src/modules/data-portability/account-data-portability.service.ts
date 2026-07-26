import { AppError } from "../../lib/errors.js";
import { createAccountExportPackage } from "./account-export-package.js";
import {
  accountDataPortabilityRepository,
  type AccountDataPortabilityRepository,
} from "./account-data-portability.repository.js";
import type { AccountExportPackage } from "./account-data-portability.types.js";

export interface AccountDataPortabilityService {
  exportAccountData(userId: string): Promise<AccountExportPackage>;
}

export interface AccountDataPortabilityServiceDependencies {
  now?: () => Date;
  repository: AccountDataPortabilityRepository;
}

export function createAccountDataPortabilityService({
  now = () => new Date(),
  repository,
}: AccountDataPortabilityServiceDependencies): AccountDataPortabilityService {
  return {
    async exportAccountData(userId) {
      const account = await repository.findAccountExportData(userId);

      if (!account) {
        throw new AppError("Account was not found.", 404, "ACCOUNT_NOT_FOUND");
      }

      return createAccountExportPackage(account, now());
    },
  };
}

export const accountDataPortabilityService =
  createAccountDataPortabilityService({
    repository: accountDataPortabilityRepository,
  });
