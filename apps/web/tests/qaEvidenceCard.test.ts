import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import type { QaEvidence } from "../src/features/qa/types.ts";

const source = await readFile(new URL("../src/features/qa/components/QaEvidenceCard.vue", import.meta.url), "utf8");
const descriptor = parse(source).descriptor;
const script = transpileModule(compileScript(descriptor, { id: "qa-evidence-card-test" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;

describe("QA evidence card links", () => {
  it("offers only credential-free HTTPS external references", () => {
    for (const value of [
      null, "", "not a URL", "/relative", "javascript:alert(1)", "data:text/html,test",
      "http://example.test/evidence", "file:///private/file", "https://user:password@example.test/evidence",
      "https://user@example.test/evidence", "https://user%40name:password@example.test/evidence",
    ]) {
      assert.equal(mount(value).externalUrl.value, "", `Unsafe reference: ${value}`);
    }
    assert.equal(mount("https://example.test/evidence?run=1#result").externalUrl.value, "https://example.test/evidence?run=1#result");
  });

  it("revalidates the external reference when the evidence record changes", () => {
    const state = mount("https://example.test/first");
    assert.equal(state.externalUrl.value, "https://example.test/first");
    state.props.evidence.externalReference = "javascript:alert(1)";
    assert.equal(state.externalUrl.value, "");
    state.props.evidence.externalReference = "https://example.test/second";
    assert.equal(state.externalUrl.value, "https://example.test/second");
  });

  it("keeps external references distinct from authorized stored-asset opening", () => {
    const template = descriptor.template!.content;
    assert.match(template, /v-if="externalUrl && !disabled"/);
    assert.match(template, /:href="externalUrl"/);
    assert.match(template, /rel="noopener noreferrer"/);
    assert.match(template, /externalEvidenceNote/);
    assert.match(template, /v-for="entry in evidence.assets"/);
    assert.match(template, /:disabled="disabled" @click="emit\('open', entry.asset.id\)"/);
    assert.match(template, /storedEvidence/);
    assert.doesNotMatch(source, /v-html|window\.open|getAssetDownloadUrl|:href="entry/);
  });
});

function mount(reference: string | null) {
  const evidence: QaEvidence = {
    id: "evidence", runId: "run", checklistItemId: null, requirementId: null,
    actorKind: "INTEGRATION", transport: "REST", kind: "REFERENCE", textContent: null,
    externalReference: reference, metadata: null, createdAt: "2026-09-21T00:00:00Z", assets: [],
  };
  const props = vue.reactive({ evidence, disabled: false });
  const modules: Record<string, unknown> = {
    vue,
    "../../../i18n/useI18n": { useI18n: () => ({ t: (key: string) => key }) },
  };
  const module = { exports: {} as { default?: { setup: (props: unknown, context: unknown) => { externalUrl: vue.ComputedRef<string> } } } };
  new Function("require", "exports", script)((id: string) => {
    assert.ok(id in modules, `Unexpected evidence-card dependency: ${id}`);
    return modules[id];
  }, module.exports);
  const state = module.exports.default!.setup(props, { expose: () => {}, emit: () => {} });
  return { ...state, props };
}
