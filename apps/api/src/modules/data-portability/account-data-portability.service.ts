import { AppError } from "../../lib/errors.js";
import {collectQaReportBinaries,type QaBinaryBundle} from "../qa-requests/qa-report.package.js";
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

      const qaBinaries=new Map<string,QaBinaryBundle>();let remaining=Math.max(0,8*1024*1024-(binaryAssets?.totalBytes || 0));
      for(const [index,project] of account.projects.entries())if(project.qaHistory){
        const bundle=await collectQaReportBinaries(userId,project.qaHistory,project.qaBinarySources || [],storage,now,remaining,`qa-files/project-${String(index+1).padStart(3,'0')}`);
        remaining-=bundle.totalBytes;qaBinaries.set(project.id,bundle);
      }
      return createAccountExportPackage(account, now(), binaryAssets,qaBinaries);
    },
  };
}

export const accountDataPortabilityService =
  createAccountDataPortabilityService({
    repository: accountDataPortabilityRepository,
    storage: assetStorage,
  });
