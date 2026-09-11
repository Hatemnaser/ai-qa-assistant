import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import { startAuthEmailOutboxLoop } from "./modules/auth/auth-email-outbox.worker.js";
import { closeDefaultReadinessProbe } from "./modules/health/health.routes.js";
import { qaProcessingHandlers } from "./modules/qa-requests/qa-processing.handlers.js";
import { startQaProcessingLoop } from "./modules/qa-requests/qa-processing.worker.js";

const app = createApp();

const server = app.listen(env.port, "0.0.0.0", () => {
  console.log(`Oddpath API listening on port ${env.port}.`);
});
const stopAuthEmailOutbox = env.emailProvider === "smtp"
  ? startAuthEmailOutboxLoop()
  : async () => {};
const stopQaProcessing = env.qaProcessingWorkerEnabled
  ? startQaProcessingLoop({ handlers: qaProcessingHandlers })
  : async () => {};
let authEmailOutboxStopPromise: Promise<void> | undefined;
let qaProcessingStopPromise: Promise<void> | undefined;

function requestAuthEmailOutboxStop() {
  authEmailOutboxStopPromise ??= stopAuthEmailOutbox();
  return authEmailOutboxStopPromise;
}

function requestQaProcessingStop() {
  qaProcessingStopPromise ??= stopQaProcessing();
  return qaProcessingStopPromise;
}

const shutdown = createGracefulShutdown({
  disconnectDatabase: async () => {
    await Promise.all([requestAuthEmailOutboxStop(), requestQaProcessingStop()]);
    await Promise.all([prisma.$disconnect(), closeDefaultReadinessProbe()]);
  },
  server,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Flip the worker's cooperative stop flag before waiting for active HTTP
    // requests, so shutdown waits for at most the current bounded SMTP call.
    void requestAuthEmailOutboxStop().catch(() => {});
    void requestQaProcessingStop().catch(() => {});
    void shutdown(signal);
  });
}
