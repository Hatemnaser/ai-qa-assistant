<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "../../i18n/useI18n";
import QaEvidenceCard from "../qa/components/QaEvidenceCard.vue";
import { qaChecklistEvidence, qaGeneralEvidence } from "../qa/workspacePresentation";
import type { QaRequestDetail } from "../qa/types";
import { qaEventLabelKey } from "../sessions/sessionActivityPresentation";

const props = defineProps<{ request: QaRequestDetail; disabled?: boolean }>();
const emit = defineEmits<{ "open-asset": [assetId: string] }>();
const { t, formatDate } = useI18n();
const root = ref<HTMLElement | null>(null);
const artifact = computed(() => props.request.artifacts.find(item => item.id === props.request.selectedArtifactId) || props.request.artifacts[0] || null);
const run = computed(() => props.request.runs[0] || null);
const rows = computed(() => qaChecklistEvidence(artifact.value, run.value).map(row => ({
  ...row,
  requirements: row.item.evidenceRequirements.map(requirement => ({
    requirement,
    attached: row.evidence.some(evidence => evidence.requirementId === requirement.id),
  })),
})));
const generalEvidence = computed(() => qaGeneralEvidence(artifact.value, run.value));
const showPlaywrightTextNote = computed(() => run.value?.executionMode === "PLAYWRIGHT"
  && run.value.evidence.some(evidence => evidence.kind === "TEXT"));
const expanded = ref(new Set<string>());
async function openMissing() {
  const first = rows.value.find(row => row.missingRequirements.length);
  if (!first) return;
  expanded.value = new Set([...expanded.value, first.item.id]);
  await nextTick();
  const element = root.value?.querySelector<HTMLElement>(".test-record__missing");
  element?.focus();
  element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
defineExpose({ openMissing });
</script>

<template>
  <section ref="root" class="test-record" tabindex="-1" :aria-label="t('testSessions.checks')">
    <header class="test-record__heading">
      <div><span class="test-session__eyebrow">{{ t('testSessions.system') }}</span><h2>{{ request.title }}</h2></div>
      <span class="qa-status-pill" :data-status="request.phase">{{ t(`projects.qa.focus.phase.${request.phase}`) }}</span>
    </header>
    <p>{{ request.objective }}</p>
    <dl class="test-record__context">
      <div v-if="request.target"><dt>{{ t('testSessions.target') }}</dt><dd>{{ request.target }}</dd></div>
      <div v-if="request.environment"><dt>{{ t('testSessions.environment') }}</dt><dd>{{ request.environment }}</dd></div>
    </dl>
    <p v-if="!run" class="workspace-note">{{ t('testSessions.notStarted') }}</p>
    <p v-if="run" class="workspace-note test-record__evidence-caution">{{ t('projects.qa.focus.proofNote') }}</p>
    <p v-if="showPlaywrightTextNote" class="workspace-note test-record__text-note">{{ t('testSessions.playwrightTextNote') }}</p>
    <p v-if="!rows.length">{{ t('testSessions.emptyChecks') }}</p>
    <details v-for="row in rows" :key="row.item.id" class="test-record__check"
      :open="expanded.has(row.item.id) || row.missingRequirements.length > 0 || ['FAIL', 'BLOCKED'].includes(row.result?.status || '')">
      <summary><strong>{{ row.item.title }}</strong><span class="qa-status-pill" :data-status="row.result?.status">{{ row.result?.status || t('testSessions.notRun') }}</span></summary>
      <dl><dt>{{ t('testSessions.expected') }}</dt><dd>{{ row.item.expectedResult }}</dd>
        <template v-if="row.result?.observedResult"><dt>{{ t('testSessions.observed') }}</dt><dd>{{ row.result.observedResult }}</dd></template>
        <template v-if="row.result?.notes"><dt>{{ t('testSessions.notes') }}</dt><dd>{{ row.result.notes }}</dd></template>
      </dl>
      <ol v-if="row.item.steps.length"><li v-for="(step, index) in row.item.steps" :key="index">{{ step }}</li></ol>
      <div v-if="row.requirements.length" class="test-record__requirements">
        <strong>{{ t('testSessions.evidenceRequirements') }}</strong>
        <ul><li v-for="{ requirement, attached } in row.requirements" :key="requirement.id">
          <span>{{ requirement.kind }} · {{ requirement.description }}</span><br />
          <small>{{ t(requirement.required ? 'testSessions.evidenceRequired' : 'testSessions.evidenceOptional') }}
            <template v-if="run?.artifactId === artifact?.id"> · {{ t(attached ? 'testSessions.evidenceAttached' : 'testSessions.evidenceNotAttached') }}</template>
          </small><br />
          <small>{{ t('testSessions.evidenceRequirementId') }} <code dir="ltr">{{ requirement.id }}</code></small>
        </li></ul>
      </div>
      <div v-if="row.missingRequirements.length" class="test-record__missing" tabindex="-1">
        <strong>{{ t('testSessions.missing') }}</strong>
        <ul><li v-for="requirement in row.missingRequirements" :key="requirement.id">{{ requirement.kind }} · {{ requirement.description }}</li></ul>
      </div>
      <QaEvidenceCard v-for="evidence in row.evidence" :key="evidence.id" :evidence="evidence" :disabled="disabled" @open="emit('open-asset', $event)" />
    </details>
    <details v-if="generalEvidence.length"><summary>{{ t('testSessions.runEvidence') }}</summary>
      <QaEvidenceCard v-for="evidence in generalEvidence" :key="evidence.id" :evidence="evidence" :disabled="disabled" @open="emit('open-asset', $event)" />
    </details>
    <details class="test-record__history"><summary>{{ t('testSessions.history') }}</summary>
      <ol><li v-for="event in request.events" :key="event.id"><strong>{{ t(qaEventLabelKey(event.type)) }}</strong> · {{ event.actorKind }} · {{ event.transport }}<br /><small>{{ formatDate(event.createdAt, { dateStyle: 'short', timeStyle: 'short' }) }}</small><details><summary>{{ t('sessionTools.activity.eventDetails') }}</summary><code>{{ event.type }} · {{ event.id }}</code></details></li></ol>
      <div v-for="operation in request.operations || []" :key="operation.operationId"><strong>{{ operation.kind }} · {{ operation.status }}</strong><p v-if="operation.errorCode">{{ operation.errorCode }}</p><code>{{ operation.operationId }}</code></div>
      <div v-for="review in request.reviews" :key="review.id"><strong>{{ review.decision }}</strong><p v-if="review.comment">{{ review.comment }}</p></div>
      <div v-for="recipe in request.executionRecipes || []" :key="recipe.id"><strong>{{ recipe.title }} · {{ recipe.revision }}</strong><code class="test-record__hash">{{ recipe.recipeHash }}</code></div>
    </details>
  </section>
</template>
