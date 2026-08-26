import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { createGracefulShutdown } from "./graceful-shutdown.js";
import { startAuthEmailOutboxLoop } from "./modules/auth/auth-email-outbox.worker.js";
import { closeDefaultReadinessProbe } from "./modules/health/health.routes.js";

const app = createApp();

const server = app.listen(env.port, "0.0.0.0", () => {
  console.log(`Oddpath API listening on port ${env.port}.`);
});
const stopAuthEmailOutbox = env.emailProvider === "smtp"
  ? startAuthEmailOutboxLoop()
  : async () => {};
let authEmailOutboxStopPromise: Promise<void> | undefined;

function requestAuthEmailOutboxStop() {
  authEmailOutboxStopPromise ??= stopAuthEmailOutbox();
  return authEmailOutboxStopPromise;
}

const shutdown = createGracefulShutdown({
  disconnectDatabase: async () => {
    await requestAuthEmailOutboxStop();
    await Promise.all([prisma.$disconnect(), closeDefaultReadinessProbe()]);
  },
  server,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    // Flip the worker's cooperative stop flag before waiting for active HTTP
    // requests, so shutdown waits for at most the current bounded SMTP call.
    void requestAuthEmailOutboxStop().catch(() => {});
    void shutdown(signal);
  });
}
