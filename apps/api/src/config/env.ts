import dotenv from "dotenv";

import { buildEnv, buildEnvValidationContext } from "./env/load.js";
import type { EnvSource } from "./env/types.js";
import { validateRuntimeEnv } from "./env/validate.js";

dotenv.config({ quiet: true });

export type { AppEnv } from "./env/load.js";
export type { RegistrationMode } from "./env/types.js";
export { validateRuntimeEnv } from "./env/validate.js";

export function loadEnv(source: EnvSource = process.env) {
  const loadedEnv = buildEnv(source);
  validateRuntimeEnv(loadedEnv, buildEnvValidationContext(source));
  return loadedEnv;
}

export const env = loadEnv();
