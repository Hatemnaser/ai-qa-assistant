import { Router } from "express";
import { Pool, type PoolConfig } from "pg";

import { env } from "../../config/env.js";
import { logOperationalEvent } from "../../lib/operational-events.js";

const READINESS_TIMEOUT_MS = 2_000;
const DATABASE_PROBE_TIMEOUT_MS = 1_500;
const READINESS_SUCCESS_CACHE_MS = 1_000;
const READINESS_FAILURE_CACHE_MS = 1_000;

export interface HealthReadinessProbe {
  checkDatabase(): Promise<void>;
}

interface ClosableHealthReadinessProbe extends HealthReadinessProbe {
  close(): Promise<void>;
}

export interface ReadinessMetrics {
  cacheHits: number;
  coalescedRequests: number;
  failFastRequests: number;
  probesStarted: number;
}

export interface ReadinessProbeObservation extends ReadinessMetrics {
  durationMs: number;
  outcome: "ready" | "timeout" | "unavailable";
}

interface ReadinessResult {
  ready: boolean;
}

interface ActiveReadinessProbe {
  deadlinePassed: boolean;
  outcome: Promise<ReadinessResult>;
  raw: Promise<void>;
}

export function buildReadinessPoolConfig(databaseUrl: string): PoolConfig {
  return {
    allowExitOnIdle: true,
    application_name: "oddpath-readiness",
    connectionString: databaseUrl,
    connectionTimeoutMillis: DATABASE_PROBE_TIMEOUT_MS,
    idleTimeoutMillis: 10_000,
    max: 1,
    query_timeout: DATABASE_PROBE_TIMEOUT_MS,
    statement_timeout: DATABASE_PROBE_TIMEOUT_MS,
  };
}

export function createPostgresReadinessProbe(
  databaseUrl: string = env.databaseUrl
): ClosableHealthReadinessProbe {
  const pool = new Pool(buildReadinessPoolConfig(databaseUrl));

  // An idle-client network error must not become an uncaught process error.
  // The next readiness request will expose the dependency as unavailable.
  pool.on("error", () => undefined);

  return {
    async checkDatabase() {
      await pool.query("SELECT 1");
    },
    async close() {
      await pool.end();
    },
  };
}

const defaultReadinessProbe = createPostgresReadinessProbe();

export function closeDefaultReadinessProbe() {
  return defaultReadinessProbe.close();
}

export function createHealthRouter(
  probe: HealthReadinessProbe = defaultReadinessProbe,
  options: {
    failureCacheMs?: number;
    now?: () => number;
    onProbe?: (observation: ReadinessProbeObservation) => void;
    successCacheMs?: number;
    timeoutMs?: number;
  } = {}
) {
  const router = Router();
  const readiness = createReadinessCoordinator(probe, options);

  router.get("/", (_req, res) => {
    res.json({
      status: "ok",
      service: "oddpath-api",
      timestamp: new Date().toISOString(),
    });
  });

  router.get("/ready", async (_req, res) => {
    const result = await readiness.check();
    if (result.ready) {
      res.json({
        checks: {
          database: "ok",
        },
        service: "oddpath-api",
        status: "ready",
      });
      return;
    }

    res.status(503).json({
      checks: {
        database: "unavailable",
      },
      service: "oddpath-api",
      status: "not_ready",
    });
  });

  return router;
}

export const healthRouter = createHealthRouter();

export function createReadinessCoordinator(
  probe: HealthReadinessProbe,
  options: {
    failureCacheMs?: number;
    now?: () => number;
    onProbe?: (observation: ReadinessProbeObservation) => void;
    successCacheMs?: number;
    timeoutMs?: number;
  } = {}
) {
  const failureCacheMs = options.failureCacheMs ?? READINESS_FAILURE_CACHE_MS;
  const now = options.now ?? Date.now;
  const onProbe = options.onProbe ?? logReadinessObservation;
  const successCacheMs = options.successCacheMs ?? READINESS_SUCCESS_CACHE_MS;
  const timeoutMs = options.timeoutMs ?? READINESS_TIMEOUT_MS;
  const metrics: ReadinessMetrics = {
    cacheHits: 0,
    coalescedRequests: 0,
    failFastRequests: 0,
    probesStarted: 0,
  };
  let active: ActiveReadinessProbe | undefined;
  let cached: { expiresAt: number; result: ReadinessResult } | undefined;

  async function check(): Promise<ReadinessResult> {
    const checkedAt = now();
    if (cached && checkedAt < cached.expiresAt) {
      metrics.cacheHits += 1;
      return cached.result;
    }

    if (active) {
      if (active.deadlinePassed) {
        metrics.failFastRequests += 1;
      } else {
        metrics.coalescedRequests += 1;
      }
      return active.outcome;
    }

    const startedAt = now();
    metrics.probesStarted += 1;
    const raw = Promise.resolve().then(() => probe.checkDatabase());
    const current: ActiveReadinessProbe = {
      deadlinePassed: false,
      outcome: Promise.resolve({ ready: false }),
      raw,
    };

    current.outcome = settleProbe(raw, timeoutMs, () => {
      current.deadlinePassed = true;
    }).then((outcome) => {
      const result = { ready: outcome === "ready" };
      cached = {
        expiresAt:
          now() + (result.ready ? successCacheMs : failureCacheMs),
        result,
      };
      try {
        onProbe({
          ...metrics,
          durationMs: Math.max(0, now() - startedAt),
          outcome,
        });
      } catch {
        // Observability must never turn a valid readiness result into a 500.
      }
      return result;
    });
    active = current;

    // Keep the raw in-flight marker after the HTTP deadline. If the database
    // driver itself wedges, later probes fail fast instead of queueing more
    // work behind the pool's single connection. Normal driver/statement
    // timeouts eventually settle the raw promise and reopen the circuit.
    raw.then(
      () => clearActive(current),
      () => clearActive(current)
    );

    return current.outcome;
  }

  function clearActive(current: ActiveReadinessProbe) {
    if (active === current) active = undefined;
  }

  return {
    check,
    snapshot: (): ReadinessMetrics => ({ ...metrics }),
  };
}

function settleProbe(
  promise: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<ReadinessProbeObservation["outcome"]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: ReadinessProbeObservation["outcome"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(outcome);
    };
    const timeout = setTimeout(() => {
      onTimeout();
      finish("timeout");
    }, timeoutMs);

    promise.then(
      () => finish("ready"),
      () => finish("unavailable")
    );
  });
}

function logReadinessObservation(observation: ReadinessProbeObservation) {
  logOperationalEvent(observation.outcome === "ready" ? "info" : "warn", {
    ...observation,
    event: "readiness_probe",
  });
}
