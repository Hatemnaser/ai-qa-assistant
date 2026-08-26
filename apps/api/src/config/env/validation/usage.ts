import { DEVELOPMENT_USAGE_IP_HASH_SALT } from "../constants.js";
import type { AppEnv } from "../load.js";

export function validateProductionUsageEnv(config: AppEnv) {
  if (
    config.usageIpHashSalt.length < 32 ||
    config.usageIpHashSalt === DEVELOPMENT_USAGE_IP_HASH_SALT
  ) {
    throw new Error(
      "Unsafe production usage configuration: USAGE_IP_HASH_SALT must be a strong secret of at least 32 characters."
    );
  }
}
