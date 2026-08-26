import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildUsageListWhere } from "../src/modules/usage/usage.repository.ts";

describe("usage event listing scope", () => {
  const base = {
    action: "chat_message",
    since: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("uses the guest cookie exclusively when an IP hash is also present", () => {
    const where = buildUsageListWhere({
      ...base,
      guestId: "guest-a",
      ipHash: "shared-nat-hash",
    });

    assert.equal("guestId" in where ? where.guestId : undefined, "guest-a");
    assert.equal("ipHash" in where, false);
    assert.equal("OR" in where, false);
  });

  it("uses the IP hash only as an anonymous fallback", () => {
    const where = buildUsageListWhere({
      ...base,
      ipHash: "anonymous-ip-hash",
    });

    assert.equal("ipHash" in where ? where.ipHash : undefined, "anonymous-ip-hash");
    assert.equal("guestId" in where, false);
  });
});
