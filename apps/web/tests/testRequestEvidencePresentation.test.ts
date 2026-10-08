import assert from "node:assert/strict";
import * as activity from "../src/features/sessions/sessionActivityPresentation";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, transpileModule } from "typescript";
import * as vue from "vue";
import { compileScript, parse } from "vue/compiler-sfc";

import type { QaEvidence, QaEvidenceRequirement, QaRequestDetail, QaRun } from "../src/features/qa/types.ts";
import * as presentation from "../src/features/qa/workspacePresentation.ts";
import * as i18n from "../src/i18n/useI18n.ts";

const source = await readFile(new URL("../src/features/test-sessions/TestRequestRecord.vue", import.meta.url), "utf8");
const descriptor = parse(source).descriptor;
const script = transpileModule(compileScript(descriptor, { id: "test-request-evidence-presentation" }).content, {
  compilerOptions: { module: ModuleKind.CommonJS },
}).outputText;
const scopes: vue.EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  i18n.setLocale("en");
});

describe("honest Test record evidence presentation", () => {
  it("keeps requested content and exact requirement IDs inspectable after entries are attached", () => {
    const record = request([evidence({ requirementId: "required-dom", checklistItemId: null })]);
    const before = JSON.stringify(record);
    const { state } = mount(record);
    const row = state.rows.value[0]!;
    assert.equal(row.result?.status, "PASS");
    assert.deepEqual(row.missingRequirements, []);
    assert.deepEqual(row.requirements.map(({ requirement, attached }) => ({
      id: requirement.id, description: requirement.description, required: requirement.required, attached,
    })), [
      { id: "required-dom", description: "Capture DOM attributes and validation errors", required: true, attached: true },
      { id: "optional-log", description: "Include detailed browser logs if available", required: false, attached: false },
    ]);
    assert.equal(row.evidence[0]?.textContent, "Login: PASS. 3 step(s) completed. All declared steps completed.");
    assert.equal(JSON.stringify(record), before, "presentation must not rewrite requirements, results or saved evidence");
  });

  it("does not mark a requirement attached from an item link or unrelated requirement ID", () => {
    const { state, props } = mount(request([evidence({ requirementId: "other-requirement" })]));
    assert.equal(state.rows.value[0]!.requirements[0]!.attached, false);
    assert.deepEqual(state.rows.value[0]!.missingRequirements.map(({ id }) => id), ["required-dom"]);
    props.request.runs[0]!.evidence.push(evidence({ id: "exact-entry", requirementId: "required-dom" }));
    assert.equal(state.rows.value[0]!.requirements[0]!.attached, true);
    assert.deepEqual(state.rows.value[0]!.missingRequirements, []);
  });

  it("shows requirements before execution and never attaches entries from another artifact", () => {
    const record = request([]);
    record.runs = [];
    const { state, props } = mount(record);
    assert.equal(state.rows.value[0]!.requirements.length, 2);
    assert.equal(state.rows.value[0]!.requirements[0]!.attached, false);
    assert.deepEqual(state.rows.value[0]!.missingRequirements, []);
    props.request.runs.push(run([evidence({ requirementId: "required-dom" })], { artifactId: "other-artifact" }));
    assert.equal(state.rows.value[0]!.requirements[0]!.attached, false);
    assert.equal(state.generalEvidence.value.length, 1);
  });

  it("keeps the missing-evidence shortcut without changing the saved record", async () => {
    const record = request([]);
    const before = JSON.stringify(record);
    const { state } = mount(record);
    await state.openMissing();
    assert.equal(state.expanded.value.has("check-login"), true);
    assert.equal(JSON.stringify(record), before);
  });

  it("scopes the TEXT explanation to Playwright runs with TEXT, not connected-agent evidence", () => {
    const { state, props } = mount(request([evidence()], { executionMode: "PLAYWRIGHT" }));
    assert.equal(state.showPlaywrightTextNote.value, true);
    props.request.runs[0]!.executionMode = "CONNECTED_AGENT";
    assert.equal(state.showPlaywrightTextNote.value, false);
    props.request.runs[0]!.executionMode = undefined;
    assert.equal(state.showPlaywrightTextNote.value, false);
    props.request.runs[0]!.executionMode = "PLAYWRIGHT";
    props.request.runs[0]!.evidence = [evidence({ kind: "SCREENSHOT", textContent: null })];
    assert.equal(state.showPlaywrightTextNote.value, false);
    props.request.runs[0]!.evidence.push(evidence({ checklistItemId: null }));
    assert.equal(state.showPlaywrightTextNote.value, true, "general TEXT evidence also warrants the Playwright note");
    props.request.runs = [];
    assert.equal(state.showPlaywrightTextNote.value, false);
  });

  it("renders all requirements and a visible structural caution for any run", () => {
    const template = descriptor.template!.content;
    assert.match(template, /<p v-if="run"[^>]*test-record__evidence-caution[^>]*>\{\{ t\('projects\.qa\.focus\.proofNote'\) \}\}/);
    assert.ok(template.indexOf("test-record__evidence-caution") < template.indexOf('v-for="row in rows"'));
    assert.match(template, /v-if="showPlaywrightTextNote"[^>]*>\{\{ t\('testSessions\.playwrightTextNote'\) \}\}/);
    assert.match(template, /v-if="row\.requirements\.length" class="test-record__requirements"/);
    assert.match(template, /v-for="\{ requirement, attached \} in row\.requirements"/);
    assert.match(template, /requirement\.description/);
    assert.match(template, /<code dir="ltr">\{\{ requirement\.id \}\}<\/code>/);
    assert.match(template, /t\(attached \? 'testSessions\.evidenceAttached' : 'testSessions\.evidenceNotAttached'\)/);
    assert.match(template, /v-if="run\?\.artifactId === artifact\?\.id"/);
    assert.match(template, /test-record__missing" tabindex="-1"/);
    assert.doesNotMatch(source, /fetch\(|qaApi|v-html|\.evidenceRequirements\s*=/);
  });

  it("localizes neutral attachment labels and the content-verification caution in every locale", () => {
    const expected = {
      en: { attached: "Required evidence entries attached", content: /does not verify the requested content/, passed: /checks passed/, note: /bundled Playwright Runner.*DOM, attributes or logs.*Connected agents/ },
      ar: { attached: "سجلات الأدلة الإلزامية مرفقة", content: /لا يثبت التحقّق من المحتوى المطلوب/, passed: /نجاح الفحوص/, note: /Runner المرفق.*DOM.*الوكلاء المتصلون/ },
      de: { attached: "Erforderliche Nachweiseinträge angehängt", content: /weder den angeforderten Inhalt/, passed: /bestandene Prüfungen/, note: /mitgelieferten Playwright-Runners.*DOM-Daten, Attribute oder Logs.*Verbundene Agenten/ },
    };
    for (const locale of ["en", "ar", "de"] as const) {
      i18n.setLocale(locale);
      assert.equal(i18n.t("projects.qa.focus.evidenceComplete"), expected[locale].attached);
      assert.match(i18n.t("projects.qa.focus.proofNote"), expected[locale].content);
      assert.match(i18n.t("projects.qa.focus.proofNote"), expected[locale].passed);
      assert.match(i18n.t("testSessions.playwrightTextNote"), expected[locale].note);
      for (const key of ["testSessions.evidenceRequirements", "testSessions.evidenceRequired", "testSessions.evidenceOptional", "testSessions.evidenceAttached", "testSessions.evidenceNotAttached", "testSessions.evidenceRequirementId"] as const) {
        assert.notEqual(i18n.t(key), key);
      }
    }
  });
});

type State = {
  rows: vue.ComputedRef<Array<presentation.QaChecklistEvidence & {
    requirements: Array<{ requirement: QaEvidenceRequirement; attached: boolean }>;
  }>>;
  generalEvidence: vue.ComputedRef<QaEvidence[]>;
  showPlaywrightTextNote: vue.ComputedRef<boolean>;
  expanded: vue.Ref<Set<string>>;
  openMissing(): Promise<void>;
};

function mount(record: QaRequestDetail) {
  const props = vue.reactive({ request: record });
  const modules: Record<string, unknown> = {
    vue,
    "../../i18n/useI18n": i18n,
    "../qa/components/QaEvidenceCard.vue": {},
    "../qa/workspacePresentation": presentation,
    "../sessions/sessionActivityPresentation": activity,
  };
  const module = { exports: {} as { default: { setup(props: unknown, context: unknown): State } } };
  new Function("require", "exports", script)((id: string) => {
    assert.ok(id in modules, `Unexpected Test record dependency: ${id}`);
    return modules[id];
  }, module.exports);
  const scope = vue.effectScope();
  scopes.push(scope);
  const state = scope.run(() => module.exports.default.setup(props, { expose: () => {}, emit: () => {} }))!;
  return { state, props };
}

const now = "2026-10-04T00:00:00Z";

function request(entries: QaEvidence[], overrides: Partial<QaRun> = {}): QaRequestDetail {
  return {
    id: "request", projectId: "project", title: "Login", objective: "Check login validation", phase: "READY_FOR_REVIEW", version: 1,
    createdAt: now, updatedAt: now, target: null, environment: null, acceptanceNotes: null, selectedArtifactId: "artifact",
    contextSnapshots: [], executionRecipes: [], operations: [], reviews: [], events: [],
    artifacts: [{
      id: "artifact", requestId: "request", revision: 1, origin: "ODDPATH_GENERATED", title: "Login checklist", lockedAt: now,
      createdAt: now, assessments: [], items: [{
        id: "check-login", artifactId: "artifact", ordinal: 0, clientRef: null, title: "Login validation", category: null,
        priority: null, preconditions: [], steps: ["Submit empty login form"], expectedResult: "Required fields report validation errors",
        createdAt: now, evidenceRequirements: [
          { id: "required-dom", checklistItemId: "check-login", ordinal: 0, kind: "TEXT", description: "Capture DOM attributes and validation errors", required: true, createdAt: now },
          { id: "optional-log", checklistItemId: "check-login", ordinal: 1, kind: "LOG", description: "Include detailed browser logs if available", required: false, createdAt: now },
        ],
      }],
    }],
    runs: [run(entries, overrides)],
  };
}

function run(entries: QaEvidence[], overrides: Partial<QaRun> = {}): QaRun {
  return {
    id: "run", requestId: "request", artifactId: "artifact", status: "RESULTS_SUBMITTED", outcome: "PASS", version: 1,
    sourceLabel: "Oddpath Playwright", externalRunRef: null, commitSha: null, startedAt: now, submittedAt: now, createdAt: now, updatedAt: now,
    executionMode: "PLAYWRIGHT", evidence: entries,
    results: [{ id: "result", runId: "run", checklistItemId: "check-login", status: "PASS", observedResult: "Assertions passed", notes: null, createdAt: now, updatedAt: now }],
    ...overrides,
  };
}

function evidence(overrides: Partial<QaEvidence> = {}): QaEvidence {
  return {
    id: "entry", runId: "run", checklistItemId: "check-login", requirementId: null, actorKind: "INTEGRATION", transport: "REST",
    kind: "TEXT", textContent: "Login: PASS. 3 step(s) completed. All declared steps completed.", externalReference: null,
    metadata: null, createdAt: now, assets: [], ...overrides,
  };
}
