import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OddpathClient, type EvidenceUploadInitiation } from "../src/http-client.js";
import { executionReceipt, claimedExecution, managedClaimedExecution } from "./fixtures.js";

describe("Oddpath runner HTTP client", () => {
  it('requires the strict v2 registration receipt and authenticated project binding', async () => {
    const profile = managedClaimedExecution().task.profile;
    const registration = { schemaVersion: 2 as const, displayName: 'Remote', executorKeys: ['playwright' as const],
      instanceId: 'runner', profiles: [profile], protocolVersions: [2 as const], runnerVersion: 'test' };
    const receipt = { schemaVersion: 2, heartbeatAfterMs: 20_000, profiles: [profile], projectId: 'project-1',
      registeredAt: new Date().toISOString(), registrationId: 'registration' };
    for (const input of [receipt, { ...receipt, schemaVersion: 1 }, { ...receipt, projectId: undefined }, { ...receipt, extra: true }]) {
      const client = new OddpathClient({ protocolVersion: 2, serverUrl: 'https://api.example.test', token: 'fixture-only',
        fetch: fakeFetch([], () => jsonResponse(input)) });
      if (input === receipt) assert.equal((await client.registerV2(registration)).projectId, 'project-1');
      else await assert.rejects(client.registerV2(registration), { code: 'ODDPATH_PROTOCOL_INVALID' });
    }
  });
  it('keeps managed claims and receipts on v2 without falling back to a legacy task', async () => {
    const requests: CapturedRequest[] = [], task = managedClaimedExecution();
    const client = new OddpathClient({ protocolVersion: 2, serverUrl: 'http://127.0.0.1:5000', token: 'test-only',
      fetch: fakeFetch(requests, () => jsonResponse(requests.length === 1 ? task : { receipt: executionReceipt(1) })) });
    assert.equal((await client.claimV2({ instanceId: 'runner', registrationId: 'registration' }))?.task.schemaVersion, 2);
    await client.accept(task.task.executionId, task.claim);
    assert.ok(requests.every(value => value.url.includes('/runner/v2/')));
    const invalid = new OddpathClient({ protocolVersion: 2, serverUrl: 'http://127.0.0.1:5000', token: 'test-only', fetch: fakeFetch([], () => jsonResponse(claimedExecution())) });
    await assert.rejects(invalid.claimV2({ instanceId: 'runner', registrationId: 'registration' }));
  });
  it("parses the clean no-work claim response and authenticates only to Oddpath", async () => {
    const requests: CapturedRequest[] = [];
    const client = new OddpathClient({
      fetch: fakeFetch(requests, () => jsonResponse({ claim: null })),
      serverUrl: "http://127.0.0.1:5000",
      token: "odp_live_private-token",
    });

    const result = await client.claim({ instanceId: "runner-1", registrationId: "registration-1" });
    assert.equal(result, null);
    assert.equal(requests[0]?.url, "http://127.0.0.1:5000/api/integrations/v1/runner/v1/executions/claim");
    assert.equal(new Headers(requests[0]?.init.headers).get("authorization"), "Bearer odp_live_private-token");
  });

  it("sends lease and idempotency headers for result mutations", async () => {
    const requests: CapturedRequest[] = [];
    const client = new OddpathClient({
      fetch: fakeFetch(requests, () => jsonResponse({ receipt: executionReceipt(2) })),
      serverUrl: "http://127.0.0.1:5000",
      token: "odp_live_private-token",
    });

    await client.recordItem(
      "execution-1",
      "item-1",
      { claimId: "claim-1", leaseToken: "l".repeat(43) },
      {
        evidence: [{ kind: "TEXT", requirementId: null, textContent: "Observed result." }],
        expectedRunVersion: 1,
        observedResult: "Checkout completed.",
        status: "PASS",
      },
      "odp.runner.item.12345678"
    );

    const headers = new Headers(requests[0]?.init.headers);
    assert.equal(headers.get("idempotency-key"), "odp.runner.item.12345678");
    assert.equal(headers.get("x-oddpath-claim-id"), "claim-1");
    assert.equal(headers.get("x-oddpath-execution-lease"), "l".repeat(43));
  });

  it("never forwards the Oddpath bearer token to a signed evidence upload URL", async () => {
    const requests: CapturedRequest[] = [];
    const client = new OddpathClient({
      fetch: fakeFetch(requests, () => new Response(null, { status: 204 })),
      serverUrl: "http://127.0.0.1:5000",
      token: "odp_live_private-token",
    });
    const initiation: EvidenceUploadInitiation = {
      asset: { id: "asset-1" },
      upload: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        headers: {
          authorization: "Bearer response-controlled-token",
          cookie: "session=response-controlled-cookie",
          "content-type": "image/png",
          "x-oddpath-execution-lease": "response-controlled-lease",
          "x-upload-checksum": "checksum",
        },
        method: "PUT",
        url: "https://storage.example.test/signed?signature=private",
      },
    };

    await client.uploadEvidenceBytes(initiation, new Uint8Array([1, 2, 3]));
    const headers = new Headers(requests[0]?.init.headers);
    assert.equal(headers.get("authorization"), null);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("x-oddpath-execution-lease"), null);
    assert.equal(headers.get("x-upload-checksum"), "checksum");
  });
});

interface CapturedRequest {
  init: RequestInit;
  url: string;
}

function fakeFetch(
  requests: CapturedRequest[],
  responder: () => Response
): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({ init, url: String(input) });
    return responder();
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
