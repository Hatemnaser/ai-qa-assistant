import {
  runnerRegistrationV1Schema,
  type RunnerRegistrationReceiptV1,
  type RunnerRegistrationV1,
} from "@oddpath/qa-execution-contract";

import {
  buildPublicManifest,
  type RunnerConfig,
} from "./config.js";
import {
  executeClaim,
  type ExecutionLogger,
} from "./execution.js";
import {
  OddpathApiError,
  type OddpathClient,
} from "./http-client.js";
import type { SemanticBrowserSession } from "./interpreter.js";

export const RUNNER_VERSION = "0.1.0";

type RunnerClient = Pick<
  OddpathClient,
  | "accept"
  | "claim"
  | "completeEvidenceUpload"
  | "fail"
  | "finish"
  | "heartbeat"
  | "initiateEvidenceUpload"
  | "recordItem"
  | "register"
  | "uploadEvidenceBytes"
>;

export interface OddpathRunnerOptions {
  allowProduction: boolean;
  client: RunnerClient;
  config: RunnerConfig;
  createSession: (profile: RunnerConfig["profiles"][number]) => Promise<SemanticBrowserSession>;
  logger?: ExecutionLogger;
}

export class OddpathRunner {
  readonly #allowProduction: boolean;
  readonly #client: RunnerClient;
  readonly #config: RunnerConfig;
  readonly #createSession: OddpathRunnerOptions["createSession"];
  readonly #logger: ExecutionLogger;

  constructor({
    allowProduction,
    client,
    config,
    createSession,
    logger = console,
  }: OddpathRunnerOptions) {
    this.#allowProduction = allowProduction;
    this.#client = client;
    this.#config = config;
    this.#createSession = createSession;
    this.#logger = logger;
  }

  async run(signal: AbortSignal) {
    const registration = buildRegistration(this.#config);
    const initialReceipt = await this.#client.register(registration);
    assertRegistrationReceipt(registration, initialReceipt);
    const keeper = new RegistrationKeeper(
      this.#client,
      registration,
      initialReceipt,
      this.#logger
    );
    keeper.start();
    this.#logger.info(`Oddpath runner ${this.#config.instanceId} is connected.`);

    try {
      while (!signal.aborted) {
        keeper.assertHealthy();
        let claimed;
        try {
          claimed = await this.#client.claim({
            instanceId: this.#config.instanceId,
            registrationId: keeper.registrationId,
          });
        } catch (error) {
          if (isFatalProtocolError(error)) throw error;
          this.#logger.warn("Oddpath claim polling failed; the runner will retry.");
          await abortableDelay(this.#config.pollIntervalMs, signal);
          continue;
        }

        // If shutdown arrived while the claim request was in flight, finish any
        // returned claim so it is never abandoned with a live lease.
        if (claimed) {
          await executeClaim(claimed, {
            allowProduction: this.#allowProduction,
            client: this.#client,
            createSession: this.#createSession,
            logger: this.#logger,
            profiles: this.#config.profiles,
          });
          continue;
        }
        await abortableDelay(this.#config.pollIntervalMs, signal);
      }
    } finally {
      await keeper.stop();
      this.#logger.info("Oddpath runner stopped accepting new executions.");
    }
  }
}

export function buildRegistration(config: RunnerConfig): RunnerRegistrationV1 {
  return runnerRegistrationV1Schema.parse({
    displayName: config.displayName,
    executorKeys: ["playwright"],
    instanceId: config.instanceId,
    profiles: config.profiles.map(buildPublicManifest),
    protocolVersions: [1],
    runnerVersion: RUNNER_VERSION,
    schemaVersion: 1,
  });
}

function assertRegistrationReceipt(
  registration: RunnerRegistrationV1,
  receipt: RunnerRegistrationReceiptV1
) {
  const expected = new Map(
    registration.profiles.map((profile) => [profile.profileKey, profile.manifestHash])
  );
  if (
    receipt.profiles.length !== expected.size
    || receipt.profiles.some((profile) => expected.get(profile.profileKey) !== profile.manifestHash)
  ) {
    throw new OddpathApiError(
      "Oddpath registered a different public profile manifest.",
      409,
      "RUNNER_REGISTRATION_MISMATCH"
    );
  }
}

class RegistrationKeeper {
  readonly #client: Pick<OddpathClient, "register">;
  readonly #controller = new AbortController();
  readonly #logger: ExecutionLogger;
  readonly #registration: RunnerRegistrationV1;
  #fatalError: Error | null = null;
  #heartbeatAfterMs: number;
  #loop: Promise<void> | null = null;
  #registrationId: string;

  constructor(
    client: Pick<OddpathClient, "register">,
    registration: RunnerRegistrationV1,
    receipt: RunnerRegistrationReceiptV1,
    logger: ExecutionLogger
  ) {
    this.#client = client;
    this.#heartbeatAfterMs = receipt.heartbeatAfterMs;
    this.#logger = logger;
    this.#registration = registration;
    this.#registrationId = receipt.registrationId;
  }

  get registrationId() {
    return this.#registrationId;
  }

  start() {
    this.#loop ||= this.#run();
  }

  assertHealthy() {
    if (this.#fatalError) throw this.#fatalError;
  }

  async stop() {
    this.#controller.abort();
    await this.#loop;
  }

  async #run() {
    while (!this.#controller.signal.aborted) {
      const continued = await abortableDelay(this.#heartbeatAfterMs, this.#controller.signal);
      if (!continued) return;
      try {
        const receipt = await this.#client.register(this.#registration);
        assertRegistrationReceipt(this.#registration, receipt);
        this.#heartbeatAfterMs = receipt.heartbeatAfterMs;
        this.#registrationId = receipt.registrationId;
      } catch (error) {
        if (isFatalProtocolError(error)) {
          this.#fatalError = error instanceof Error ? error : new Error("Runner registration failed.");
          return;
        }
        this.#logger.warn("Runner registration heartbeat failed; it will retry.");
        this.#heartbeatAfterMs = Math.min(this.#heartbeatAfterMs, 5_000);
      }
    }
  }
}

function isFatalProtocolError(error: unknown) {
  return error instanceof OddpathApiError
    && (error.status >= 400 && error.status < 500)
    && ![408, 409, 429].includes(error.status);
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
