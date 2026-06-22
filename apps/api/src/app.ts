import cors from "cors";
import express from "express";

import { buildCorsOptions } from "./config/cors.js";
import { env } from "./config/env.js";
import { csrfProtection } from "./middleware/csrf.middleware.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { chatHistoryRouter } from "./modules/chat-history/chat-history.routes.js";
import { chatRouter } from "./modules/chat/chat.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";
import { memoryRouter } from "./modules/memory/memory.routes.js";
import { projectsRouter } from "./modules/projects/projects.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { usageRouter } from "./modules/usage/usage.routes.js";

export function createApp() {
  const app = express();

  app.use(cors(buildCorsOptions()));
  app.use(csrfProtection);
  app.use(express.json({ limit: env.requestBodyLimit }));

  app.get("/", (req, res) => {
    res.json({
      service: "AI QA Assistant API",
      status: "running",
    });
  });

  app.use("/api/health", healthRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/auth", authRouter);
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
