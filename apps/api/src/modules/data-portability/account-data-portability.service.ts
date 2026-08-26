import { AppError } from "../../lib/errors.js";
import { assetStorage, type AssetStorage } from "../assets/assets.storage.js";
import { createAccountExportPackage } from "./account-export-package.js";
import { accountDataPortabilityRepository } from "./account-data-portability.repository.js";
import { collectPortableBinaryAssets } from "./binary-assets.js";
import type {
  AccountDataPortabilityRepository,
  AccountExportPackage,
} from "./account-data-portability.types.js";

export interface AccountDataPortabilityService {
  exportAccountData(userId: string): Promise<AccountExportPackage>;
}

export interface AccountDataPortabilityServiceDependencies {
  now?: () => Date;
  repository: AccountDataPortabilityRepository;
  storage?: Pick<AssetStorage, "readObject">;
}

export function createAccountDataPortabilityService({
  now = () => new Date(),
  repository,
  storage = assetStorage,
}: AccountDataPortabilityServiceDependencies): AccountDataPortabilityService {
  return {
    async exportAccountData(userId) {
      const account = await repository.findAccountExportData(userId);

      if (!account) {
        throw new AppError("Account was not found.", 404, "ACCOUNT_NOT_FOUND");
      }

      const binaryAssets =
        account.binaryAssets.length > 0
          ? await collectPortableBinaryAssets(
              userId,
              account.binaryAssets,
              storage
            )
          : undefined;

      return createAccountExportPackage(account, now(), binaryAssets);
    },
  };
}

export const accountDataPortabilityService =
  createAccountDataPortabilityService({
    repository: accountDataPortabilityRepository,
    storage: assetStorage,
  });
