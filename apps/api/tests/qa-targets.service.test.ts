import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { targetDefinitionSchema } from "@oddpath/qa-execution-contract";
import { hashCanonicalJson } from "../src/lib/canonical-json.ts";
import { AppError } from "../src/lib/errors.ts";
import { challengeHash, isPublicProofAddress, selectProofAddress } from "../src/modules/qa-targets/qa-targets.proof.ts";
import { createQaTargetsService } from "../src/modules/qa-targets/qa-targets.service.ts";
import type { QaTargetsRepository, TargetVerificationRecord } from "../src/modules/qa-targets/qa-targets.types.ts";

const NOW = new Date("2026-10-10T12:00:00.000Z");
function fixture() {
  const definition = targetDefinitionSchema.parse({ baseUrl: "https://staging.example.com/app", environmentKind: "STAGING" });
  const revision = { id: "revision-1", targetId: "target-1", revision: 1, definition, targetHash: hashCanonicalJson(definition) };
  let proof: TargetVerificationRecord = { id: "proof-1", revisionId: revision.id, method: "DNS_TXT", challengeHash: challengeHash("token"), expiresAt: new Date(NOW.getTime() + 600_000), verifiedAt: null, validUntil: null };
  let clock = NOW;
  const calls: string[] = [];
  const repository: QaTargetsRepository = {
    async list() { calls.push("list"); return []; },
    async getRevision() { calls.push("revision"); return revision; },
    async create() { calls.push("create"); return { ...definition, revision: 1, revisionId: revision.id, targetId: revision.targetId, targetHash: revision.targetHash }; },
    async revise() { throw new Error("unused"); },
    async challenge(input) { calls.push("challenge"); proof = { ...proof, method: input.method, challengeHash: input.challengeHash, expiresAt: input.expiresAt }; return proof; },
    async getVerification() { calls.push("proof"); return proof; },
    async confirm(input) { calls.push("confirm"); proof = { ...proof, verifiedAt: input.verifiedAt, validUntil: input.validUntil }; },
  };
  const probe = { async dns(hostname: string) { calls.push(`dns:${hostname}`); return ["token"]; }, async https(url: string) { calls.push(`https:${url}`); return "token"; } };
  const access = { async assertProjectAccess(userId: string) { calls.push("access"); if (userId !== "owner") throw new AppError("Not found", 404, "PROJECT_NOT_FOUND"); } };
  return { calls, repository, revision, probe, access, now: () => clock, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); }, get proof() { return proof; }, setProof: (change: Partial<TargetVerificationRecord>) => { proof = { ...proof, ...change }; } };
}

describe("Owner-controlled targets and domain proof", () => {
  it("checks owner access before validation, repository reads or network calls", async () => {
    const f = fixture(), service = createQaTargetsService(f);
    for (const action of [() => service.list("other", "project"), () => service.create("other", "project", {}), () => service.revise("other", "project", "target-1", {}), () => service.challenge("other", "project", "target-1", {}), () => service.verify("other", "project", "target-1", "proof-1")]) await assert.rejects(action, { code: "PROJECT_NOT_FOUND" });
    assert.deepEqual(f.calls, Array(5).fill("access"));
  });
  it("requires explicit test authority rather than treating domain proof as permission", async () => {
    const f = fixture(), service = createQaTargetsService(f);
    await assert.rejects(service.create("owner", "project", { label: "Staging", definition: f.revision.definition }));
    assert.equal(f.calls.includes("create"), false);
    await service.create("owner", "project", { acknowledgeAuthority: true, label: "Staging", definition: f.revision.definition });
    assert.equal(f.calls.includes("create"), true);
  });
  for (const method of ["DNS_TXT", "HTTPS_FILE"] as const) {
    it(`stores only a challenge hash and returns its ${method} location once`, async () => {
      const f = fixture(), service = createQaTargetsService(f);
      const challenge = await service.challenge("owner", "project", "target-1", { expectedRevision: 1, method });
      assert.match(challenge.value, /^[a-f0-9]{64}$/u);
      assert.equal(f.proof.challengeHash, challengeHash(challenge.value));
      assert.equal(JSON.stringify(f.proof).includes(challenge.value), false);
      assert.equal(challenge.expiresAt, "2026-10-10T12:10:00.000Z");
      assert.equal(challenge.location, method === "DNS_TXT" ? "_oddpath-verify.staging.example.com" : "https://staging.example.com/.well-known/oddpath-verification/proof-1");
    });
    it(`verifies ${method} and never silently extends its 24-hour validity`, async () => {
      const f = fixture(); f.setProof({ method }); const service = createQaTargetsService(f);
      const result = await service.verify("owner", "project", "target-1", "proof-1");
      assert.equal(result.validUntil, "2026-10-11T12:00:00.000Z");
      f.advance(1_000);
      assert.equal((await service.verify("owner", "project", "target-1", "proof-1")).validUntil, result.validUntil);
      assert.equal(f.calls.filter(value => value === "confirm").length, 1);
      f.advance(86_400_000);
      await assert.rejects(service.verify("owner", "project", "target-1", "proof-1"), { code: "QA_TARGET_VERIFICATION_EXPIRED" });
    });
  }
  it("rejects an old-revision challenge or an expired challenge before probing", async () => {
    const f = fixture(), service = createQaTargetsService(f);
    f.setProof({ revisionId: "other" });
    await assert.rejects(service.verify("owner", "project", "target-1", "proof-1"), { code: "QA_TARGET_VERIFICATION_NOT_FOUND" });
    f.setProof({ revisionId: f.revision.id, expiresAt: NOW });
    await assert.rejects(service.verify("owner", "project", "target-1", "proof-1"), { code: "QA_TARGET_VERIFICATION_EXPIRED" });
    assert.equal(f.calls.some(value => value.startsWith("dns:")), false);
  });
  it("binds the advertised proof hostname to the requested current revision", async () => {
    const f = fixture(), service = createQaTargetsService(f);
    await assert.rejects(service.challenge("owner", "project", "target-1", { expectedRevision: 2, method: "HTTPS_FILE" }), { code: "QA_TARGET_VERSION_CONFLICT" });
    assert.equal(f.calls.includes("challenge"), false);
  });
  it("does not confirm mismatched proof or expose upstream error contents", async () => {
    const f = fixture(), service = createQaTargetsService(f);
    f.probe.dns = async () => ["wrong-token"];
    await assert.rejects(service.verify("owner", "project", "target-1", "proof-1"), { code: "QA_TARGET_VERIFICATION_FAILED" });
    f.probe.dns = async () => { throw new Error("private network / internal credentials"); };
    await assert.rejects(service.verify("owner", "project", "target-1", "proof-1"), error => error instanceof AppError && error.code === "QA_TARGET_VERIFICATION_FAILED" && !error.message.includes("credentials"));
    assert.equal(f.calls.includes("confirm"), false);
  });
  it("limits concurrent ownership probes and releases capacity after failure", async () => {
    const f = fixture(); let unblock!: (values: string[]) => void;
    const waiting = new Promise<string[]>(resolve => { unblock = resolve; });
    f.probe.dns = () => waiting;
    const service = createQaTargetsService(f);
    const one = service.verify("owner", "project", "target-1", "proof-1"), two = service.verify("owner", "project", "target-1", "proof-1");
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(service.verify("owner", "project", "target-1", "proof-1"), { code: "QA_TARGET_VERIFICATION_BUSY" });
    unblock(["wrong"]);
    await Promise.all([assert.rejects(one), assert.rejects(two)]);
    f.probe.dns = async () => ["token"];
    await service.verify("owner", "project", "target-1", "proof-1");
  });
});

describe("Public-address admission for HTTPS ownership files", () => {
  for (const address of ["0.0.0.0", "127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.254", "192.0.0.5", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1", "fe80::1", "fc00::1", "2001:db8::1", "2002:7f00:1::", "not-an-address"]) it(`blocks ${address}`, () => assert.equal(isPublicProofAddress(address), false));
  it("rejects mixed public/private DNS answers rather than picking the public one", () => {
    assert.throws(() => selectProofAddress(["8.8.8.8", "127.0.0.1"]), { code: "QA_TARGET_ADDRESS_BLOCKED" });
    assert.throws(() => selectProofAddress([]), { code: "QA_TARGET_ADDRESS_BLOCKED" });
    assert.deepEqual(selectProofAddress(["8.8.8.8", "2606:4700:4700::1111"]), { address: "8.8.8.8", family: 4 });
  });
});
