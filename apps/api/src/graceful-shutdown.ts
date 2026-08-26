import type { Server } from "node:http";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface GracefulShutdownOptions {
  disconnectDatabase(): Promise<void>;
  logger?: Pick<Console, "error" | "log">;
  server: Pick<Server, "close">;
  setExitCode?: (code: number) => void;
}

export function createGracefulShutdown(options: GracefulShutdownOptions) {
  const logger = options.logger ?? console;
  const setExitCode = options.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  let shutdownPromise: Promise<void> | undefined;

  return function shutdown(signal: ShutdownSignal) {
    if (shutdownPromise) return shutdownPromise;

    logger.log(`Received ${signal}; stopping new requests.`);
    shutdownPromise = new Promise<void>((resolve) => {
      let completionStarted = false;

      const completeShutdown = async (serverError?: Error) => {
        if (completionStarted) return;
        completionStarted = true;
        let failed = Boolean(serverError);

        if (serverError) {
          logger.error("HTTP server shutdown failed.");
        }

        try {
          await options.disconnectDatabase();
        } catch {
          logger.error("Database disconnect failed during shutdown.");
          failed = true;
        }

        if (failed) setExitCode(1);
        resolve();
      };

      try {
        options.server.close((error) => {
          void completeShutdown(error);
        });
      } catch (error) {
        void completeShutdown(error instanceof Error ? error : new Error("HTTP server shutdown failed."));
      }
    });

    return shutdownPromise;
  };
}
