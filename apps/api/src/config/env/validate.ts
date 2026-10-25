import type { AppEnv } from "./load.js";
import type { EnvValidationContext } from "./types.js";
import { validateAiEnv, validateProductionAiEnv } from "./validation/ai.js";
import {
  validateAuthBounds,
  validateAuthShape,
  validateProductionAppOriginEnv,
  validateProductionAuthEnv,
  validateRegistrationEnv,
} from "./validation/auth.js";
import {
  validateProductionDatabaseEnv,
  validateProductionProxyEnv,
  validateProductionRuntimeEnv,
  validateRequestBodyEnv,
  validateRuntimeBasics,
} from "./validation/core.js";
import { validateEmailBounds, validateProductionEmailEnv } from "./validation/email.js";
import { validateRetentionEnv } from "./validation/retention.js";
import { validatePrivateAssetEnv } from "./validation/storage.js";
import { validateProductionUsageEnv } from "./validation/usage.js";

export function validateRuntimeEnv(config: AppEnv, context: EnvValidationContext) {
  if (config.qaManagedRoutingEnabled) {
    const keys = [config.qaManagedRoutingKey, config.qaManagedProjectKey, config.qaBrowserViewerSigningKey];
    if (!config.qaBrowserRuntimeEnabled || !/^[a-z][a-z0-9-]{0,63}$/.test(config.qaManagedHostId)
      || keys.some(key => !/^[a-f0-9]{64}$/.test(key)) || new Set(keys).size !== keys.length)
      throw new Error("Managed routing requires browser runtime, a host id and separate 256-bit routing/project/viewer keys.");
  }
  if (config.qaSavedLoginEnabled && (!config.qaManualLoginEnabled || !config.qaBrowserRuntimeEnabled || !config.qaBrowserVaultKeyringFile || !config.qaBrowserVaultRevocationFile)) throw new Error("Saved login requires manual/runtime gates and independent keyring/revocation files.");
  if (config.qaManualLoginEnabled && !config.qaBrowserRuntimeEnabled) throw new Error("Manual login requires the managed browser runtime.");
  if (config.qaBrowserRuntimeEnabled) {
    if (config.qaLegacyRunnerDispatchEnabled) throw new Error("Managed browser activation requires draining and disabling legacy Runner dispatch.");
    if (!config.qaExecutionV2Enabled || !/^[a-f0-9]{64}$/u.test(config.qaBrowserViewerSigningKey)) throw new Error("Browser runtime requires v2 and a dedicated 256-bit viewer signing key.");
    const viewer = new URL(config.qaBrowserViewerOrigin);
    if (viewer.protocol !== "https:" || viewer.origin !== config.qaBrowserViewerOrigin) throw new Error("QA_BROWSER_VIEWER_ORIGIN must be an exact HTTPS origin.");
  }
  if (config.nodeEnv === "production" && config.qaExecutionV2Enabled) {
    throw new Error("QA_EXECUTION_V2_ENABLED must remain false in production until browser isolation, supervision and confirmed Stop gates pass.");
  }
  validateRuntimeBasics(config);
  validateAiEnv(config);
  validateAuthShape(config);
  validateRequestBodyEnv(config);
  validateRegistrationEnv(config);
  validatePrivateAssetEnv(config);
  validateRetentionEnv(config);
  validateEmailBounds(config);
  validateAuthBounds(config);

  if (config.nodeEnv !== "production") return;

  validateProductionRuntimeEnv(config);
  validateProductionAuthEnv(config, context);
  validateProductionEmailEnv(config, context);
  validateProductionDatabaseEnv(config, context);
  validateProductionAppOriginEnv(config, context);
  validateProductionProxyEnv(config, context);
  validateProductionUsageEnv(config);
  validateProductionAiEnv(config);
}
