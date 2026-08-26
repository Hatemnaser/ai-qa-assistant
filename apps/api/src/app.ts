import { randomUUID } from "node:crypto";

import cors from "cors";
import express from "express";

import { buildCorsOptions } from "./config/cors.js";
import { env } from "./config/env.js";
import { csrfProtection } from "./middleware/csrf.middleware.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { accountRouter } from "./modules/account/account.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { assetsRouter } from "./modules/assets/assets.routes.js";
import { authPreBodyIpRateLimit } from "./modules/auth/auth.rateLimit.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { chatHistoryRouter } from "./modules/chat-history/chat-history.routes.js";
import { enforceChatPreBodyGate } from "./modules/chat/chat.pre-body-rate-limit.middleware.js";
import { chatRouter } from "./modules/chat/chat.routes.js";
import { dataPortabilityRouter } from "./modules/data-portability/data-portability.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { memoryRouter } from "./modules/memory/memory.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { usageRouter } from "./modules/usage/usage.routes.js";

export interface CreateAppOptions {
  nodeEnv?: string;
  trustProxyHops?: number;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const nodeEnv = options.nodeEnv ?? env.nodeEnv;
  const trustProxyHops = options.trustProxyHops ?? env.trustProxyHops;

  app.disable("x-powered-by");

  if (trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
  }

  app.use((_req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");

    if (nodeEnv === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    next();
  });

  app.use(cors(buildCorsOptions()));
  app.use(csrfProtection);
  app.use("/api/portability", dataPortabilityRouter);
  app.use(
    "/api/auth",
    authPreBodyIpRateLimit,
    express.json({ limit: "16kb" }),
    authRouter
  );
  app.use(
    "/api/chat",
    enforceChatPreBodyGate,
    express.json({ limit: env.requestBodyLimit })
  );
  app.use(express.json({ limit: "5mb" }));

  app.get("/", (_req, res) => {
    res.json({
      service: "Oddpath API",
      status: "running",
    });
  });

  app.use("/api/health", healthRouter);
  app.use("/api/account", accountRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/assets", assetsRouter);
  app.use("/api/chats", chatHistoryRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/memories", memoryRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/usage", usageRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
