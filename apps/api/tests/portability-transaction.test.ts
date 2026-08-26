import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PORTABILITY_CLEANUP_TRANSACTION_OPTIONS,
  PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS,
  PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS,
  withSerializableTransactionRetry,
} from "../src/modules/data-portability/portability-transaction.ts";

describe("portability transaction policy", () => {
  it("uses explicit bounded waits and timeouts for large import and snapshot transactions", () => {
    assert.deepEqual(PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS, {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 60_000,
    });
    assert.deepEqual(PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS, {
      isolationLevel: "RepeatableRead",
      maxWait: 10_000,
      timeout: 30_000,
    });
    assert.deepEqual(PORTABILITY_CLEANUP_TRANSACTION_OPTIONS, {
      maxWait: 10_000,
      timeout: 30_000,
    });
  });

  it("retries only serialization conflicts and keeps the attempt count bounded", async () => {
    let attempts = 0;
    const result = await withSerializableTransactionRetry(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error("serialization conflict"), {
          code: attempts === 1 ? "P2034" : "40001",
        });
      }
      return "committed";
    });

    assert.equal(result, "committed");
    assert.equal(attempts, 3);

    let domainAttempts = 0;
    await assert.rejects(
      () => withSerializableTransactionRetry(async () => {
        domainAttempts += 1;
        throw new Error("destination full");
      }),
      /destination full/
    );
    assert.equal(domainAttempts, 1);
  });
});
