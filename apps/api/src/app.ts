import cors from "cors";
import express from "express";

import { buildCorsOptions } from "./config/cors.js";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
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
  app.use("/api/chat", chatRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
