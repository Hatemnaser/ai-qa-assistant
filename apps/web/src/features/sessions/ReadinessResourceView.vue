<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useI18n } from '../../i18n/useI18n';
import type { TranslationKey } from '../../i18n/messages';
import { useSessionResourceReader } from './useSessionResourceReader';
import { fetchReadiness, freezeReadiness, evaluateReadiness, fetchReadinessTargets, type ReadinessState, type ReadinessEvaluation } from './readinessApi';
import type { SessionResource } from './sessionResources';

const props = defineProps<{ resource: SessionResource; projectId: string; scopeKey: string; active: boolean }>();
const { t } = useI18n();
const label = (key: string) => t(key as TranslationKey);
const { detail, loading, failed, refresh } = useSessionResourceReader({ resource: () => props.resource, projectId: () => props.projectId, scopeKey: () => props.scopeKey, active: () => props.active });
const state = ref<ReadinessState>({ candidates: [], evaluations: [] }), targets = ref<Awaited<ReturnType<typeof fetchReadinessTargets>>>([]);
const candidateId = ref(''), runId = ref(''), targetId = ref(''), reference = ref(''), verifyDeployment = ref(false), freshnessHours = ref(24);
const optionalIds = ref<string[]>([]), risks = ref<Record<string, string>>({}), busy = ref(false), error = ref(false), loaded = ref(false);
const current = ref<ReadinessEvaluation | null>(null), time = ref(Date.now());
const candidate = computed(() => state.value.candidates.find(c => c.id === candidateId.value) || null);
const artifact = computed(() => detail.value?.artifacts.find(a => a.id === detail.value?.selectedArtifactId) || null);
const historical = computed(() => state.value.evaluations.find(e => e.snapshot.candidateId === candidateId.value) || null);
const evaluation = computed(() => current.value || historical.value);
const currentAssessment = computed(() => props.active && current.value && !candidate.value?.invalidatedAt && Date.parse(current.value.snapshot.validUntil) > time.value);
let epoch = 0, disposed = false;
const timer = setInterval(() => { time.value = Date.now(); }, 1000);
function guard() { const token = epoch, scope = props.scopeKey, requestId = props.resource.requestId; return () => !disposed && props.active && token === epoch && props.scopeKey === scope && props.resource.requestId === requestId; }
async function load() {
  if (!props.active || !props.resource.requestId || props.resource.scopeKey !== props.scopeKey || busy.value) return;
  const valid = guard(); busy.value = true; error.value = false;
  try {
    const [next, list] = await Promise.all([fetchReadiness(props.projectId, props.resource.requestId), fetchReadinessTargets(props.projectId)]);
    if (!valid()) return;
    state.value = next; targets.value = list; loaded.value = true;
    if (!next.candidates.some(c => c.id === candidateId.value)) candidateId.value = next.candidates[0]?.id || '';
    if (!list.some(t => t.targetId === targetId.value)) targetId.value = list[0]?.targetId || '';
  } catch { if (valid()) error.value = true; } finally { if (valid()) busy.value = false; }
}
async function freeze() {
  if (!props.active || busy.value || !loaded.value || !artifact.value || !props.resource.requestId) return;
  const valid = guard(); busy.value = true; error.value = false; current.value = null;
  try {
    const created = await freezeReadiness(props.projectId, props.resource.requestId, { artifactId: artifact.value.id, targetId: targetId.value, reference: reference.value, verifyDeployment: verifyDeployment.value, freshnessHours: freshnessHours.value, criteria: artifact.value.items.map(i => ({ itemId: i.id, mandatory: !optionalIds.value.includes(i.id) })) });
    if (!valid()) return;
    // Re-read authoritative invalidations of previous candidates after creation.
    const confirmed = await fetchReadiness(props.projectId, props.resource.requestId);
    if (!valid()) return;
    state.value = confirmed;
    candidateId.value = created.id; runId.value = ''; risks.value = {};
  } catch { if (valid()) error.value = true; } finally { if (valid()) busy.value = false; }
}
async function assess() {
  if (!props.active || busy.value || !candidate.value || !props.resource.requestId) return;
  const valid = guard(), selectedId = candidate.value.id; busy.value = true; error.value = false; current.value = null;
  try {
    const value = await evaluateReadiness(props.projectId, props.resource.requestId, selectedId, { runId: runId.value || null,
      acceptedRisks: candidate.value.definition.criteria.filter(c => !c.mandatory && risks.value[c.itemId]?.trim()).map(c => ({ itemId: c.itemId, reason: risks.value[c.itemId]!.trim() })) });
    if (valid() && candidateId.value === selectedId) {
      current.value = value;
      if (value.snapshot.reasons.includes('CANDIDATE_INVALIDATED') && candidate.value) candidate.value.invalidatedAt ||= value.snapshot.evaluatedAt;
    }
  } catch { if (valid()) error.value = true; } finally { if (valid()) busy.value = false; }
}
async function reload() { current.value = null; await Promise.all([load(), refresh()]); }
function download() {
  if (!evaluation.value || !candidate.value || !props.active) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, historicalOnly: true, candidate: candidate.value, evaluation: evaluation.value }, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'oddpath-readiness.json'; anchor.click(); URL.revokeObjectURL(url);
}
watch(() => [props.scopeKey, props.projectId, props.resource.id], () => {
  epoch++; current.value = null; busy.value = false; error.value = false; loaded.value = false;
  state.value = { candidates: [], evaluations: [] }; targets.value = []; candidateId.value = ''; runId.value = ''; targetId.value = ''; reference.value = ''; optionalIds.value = []; risks.value = {};
  if (props.active) void load();
}, { immediate: true, flush: 'sync' });
watch(() => props.active, active => {
  epoch++; current.value = null; busy.value = false; error.value = false;
  // Hide/tab selection disconnects the live assessment, not this owner's draft.
  if (active) void load();
}, { flush: 'sync' });
watch([candidateId, runId], () => { current.value = null; risks.value = {}; });
onScopeDispose(() => { disposed = true; epoch++; clearInterval(timer); });
</script>

<template>
  <section class="session-record-resource" :aria-busy="loading || busy || undefined">
    <h3>{{ t('readiness.title') }}</h3>
    <p class="workspace-note">{{ t('readiness.authority') }}</p>
    <p v-if="failed || error" role="alert">{{ t('readiness.error') }}</p>
    <button class="btn btn-secondary" type="button" :disabled="busy || !active" @click="reload">{{ t('testSessions.refresh') }}</button>
    <form v-if="detail && artifact" class="d-grid gap-2 my-3" @submit.prevent="freeze">
      <fieldset :disabled="busy || !active || !loaded">
        <legend>{{ t('readiness.freeze') }}</legend>
        <p>{{ t('readiness.freezeNote') }}</p>
        <label class="d-block">{{ t('readiness.target') }}<select v-model="targetId" class="form-select" required><option v-for="item in targets" :key="item.targetId" :value="item.targetId">{{ item.label }} · {{ item.baseUrl }}</option></select></label>
        <label class="d-block">{{ t('readiness.reference') }}<input v-model="reference" class="form-control" required maxlength="240" /></label>
        <label class="d-block">{{ t('readiness.freshness') }}<input v-model.number="freshnessHours" class="form-control" type="number" min="1" max="24" required /></label>
        <label class="d-block"><input v-model="verifyDeployment" type="checkbox" /> {{ t('readiness.verifyDeployment') }}</label>
        <p><code>/.well-known/oddpath-version</code> · <code>{"schemaVersion":1,"reference":"build-id"}</code></p>
        <p>{{ t('readiness.optionalNote') }}</p>
        <label v-for="item in artifact.items" :key="item.id" class="d-block"><input v-model="optionalIds" type="checkbox" :value="item.id" /> {{ t('readiness.optional') }} · {{ item.title }}</label>
        <button class="btn btn-primary mt-2" type="submit" :disabled="!targetId || !reference.trim() || optionalIds.length === artifact.items.length">{{ t('readiness.freeze') }}</button>
      </fieldset>
    </form>
    <template v-if="state.candidates.length">
      <label>{{ t('readiness.candidate') }}<select v-model="candidateId" class="form-select" :disabled="busy"><option v-for="item in state.candidates" :key="item.id" :value="item.id">{{ item.definition.reference }} · #{{ item.revision }} · {{ item.createdAt }}</option></select></label>
      <p v-if="candidate?.invalidatedAt" role="alert">{{ t('readiness.invalidated') }}</p>
      <p>{{ candidate?.definition.target.environmentKind }} · {{ candidate?.definition.target.baseUrl }}</p>
      <label>{{ t('sessionResources.run') }}<select v-model="runId" class="form-select" :aria-label="t('sessionResources.run')" :disabled="busy"><option value="">{{ t('readiness.noRun') }}</option><option v-for="run in detail?.runs || []" :key="run.id" :value="run.id">{{ run.id }} · {{ run.outcome }}</option></select></label>
      <label v-for="criterion in candidate?.definition.criteria.filter(c => !c.mandatory) || []" :key="criterion.itemId" class="d-block">{{ t('readiness.acceptRisk') }} · {{ artifact?.items.find(i => i.id === criterion.itemId)?.title || criterion.itemId }}<textarea v-model="risks[criterion.itemId]" class="form-control" minlength="10" maxlength="1000" :disabled="busy" /></label>
      <button class="btn btn-primary my-2" type="button" :disabled="busy || !active" @click="assess">{{ t('readiness.evaluate') }}</button>
    </template>
    <template v-if="evaluation">
      <h4>{{ currentAssessment ? evaluation.snapshot.decision : t('readiness.historical') + ' · ' + evaluation.snapshot.decision }}</h4>
      <p>{{ t('readiness.assessedAt') }} {{ evaluation.snapshot.evaluatedAt }} · {{ t('readiness.validUntil') }} {{ evaluation.snapshot.validUntil }}</p>
      <p>{{ t('readiness.pointInTime') }}</p>
      <p>{{ t('readiness.deployment') }}: {{ label('readiness.deployment.' + evaluation.snapshot.deployment.status) }}</p>
      <ul><li v-for="reason in evaluation.snapshot.reasons" :key="reason">{{ label('readiness.reason.' + reason) }}</li></ul>
      <ul><li v-for="criterion in evaluation.snapshot.criteria" :key="criterion.itemId">{{ artifact?.items.find(i => i.id === criterion.itemId)?.title || criterion.itemId }} · {{ label('readiness.check.' + criterion.reason) }}<p v-if="criterion.riskAcceptance">{{ criterion.riskAcceptance }}</p></li></ul>
      <button type="button" class="btn btn-secondary" :disabled="!active" @click="download">{{ t('readiness.export') }}</button>
    </template>
    <p v-else>{{ t('sessionResources.notEvaluated') }}</p>
  </section>
</template>
