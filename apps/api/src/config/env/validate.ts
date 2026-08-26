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
