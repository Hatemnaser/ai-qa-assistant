import type { CorsOptions } from "cors";

import { AppError } from "../lib/errors.js";
import { env } from "./env.js";

export function buildCorsOptions(): CorsOptions {
  return {
    credentials: true,
    origin(origin, callback) {
      if (!origin || env.corsOrigins.includes("*") || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new AppError(`Origin ${origin} is not allowed by CORS.`, 403, "CORS_FORBIDDEN"));
    },
  };
}
