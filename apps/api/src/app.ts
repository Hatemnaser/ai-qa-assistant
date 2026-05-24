import cors from "cors";
import express from "express";

import { buildCorsOptions } from "./config/cors.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { chatHistoryRouter } from "./modules/chat-history/chat-history.routes.js";
import { chatRouter } from "./modules/chat/chat.routes.js";
import { healthRouter } from "./modules/health/health.routes.js";

export function createApp() {
  const app = express();

  app.use(cors(buildCorsOptions()));
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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
