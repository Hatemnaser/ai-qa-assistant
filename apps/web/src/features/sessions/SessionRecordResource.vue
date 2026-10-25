<script setup lang="ts">
import { computed, ref, onScopeDispose, watch } from 'vue';
import { useI18n } from '../../i18n/useI18n';
import { getAssetDownloadUrl } from '../assets/assetsApi';
import TestRequestRecord from '../test-sessions/TestRequestRecord.vue';
import QaEvidenceCard from '../qa/components/QaEvidenceCard.vue';
import { useSessionResourceReader } from './useSessionResourceReader';
import type { SessionResource } from './sessionResources';
import { qaChecklistEvidence } from '../qa/workspacePresentation';
import {downloadQaReport,type QaReportFormat} from '../qa/qaReportDownload';

const props = defineProps<{ resource: SessionResource; projectId: string; scopeKey: string; active: boolean }>();
const { t } = useI18n();
const reader = useSessionResourceReader({ resource: () => props.resource, projectId: () => props.projectId, scopeKey: () => props.scopeKey, active: () => props.active });
const { detail, run, runId, loading, failed } = reader;
const assetFailed = ref(false), missingRun = computed(() => !!runId.value && !run.value);
const exportFormat=ref<QaReportFormat>('ZIP'),exportBusy=ref(false),exportFailed=ref(false);
let exportGeneration=0;
watch(()=>[props.scopeKey,props.active,props.resource.id,runId.value],()=>{exportGeneration++;exportBusy.value=false;exportFailed.value=false;},{flush:'sync'});
async function exportReport(){
  if(!props.active||!detail.value||exportBusy.value||missingRun.value)return;
  const generation=++exportGeneration;exportBusy.value=true;exportFailed.value=false;
  const current=()=>!disposed&&props.active&&generation===exportGeneration;
  try{await downloadQaReport(props.projectId,detail.value.id,runId.value,exportFormat.value,current);}
  catch{if(current())exportFailed.value=true;}finally{if(current())exportBusy.value=false;}
}
let disposed = false;
onScopeDispose(() => { disposed = true; });
watch(runId, () => { assetFailed.value = false; });
const recordDetail = computed(() => detail.value ? { ...detail.value, selectedArtifactId: run.value?.artifactId || detail.value.selectedArtifactId, runs: run.value ? [run.value] : [] } : null);
const missing = computed(() => qaChecklistEvidence(detail.value?.artifacts.find(item => item.id === run.value?.artifactId) || null, run.value).flatMap(row => row.missingRequirements));
async function openAsset(id: string) {
  const scope = props.scopeKey, resourceId = props.resource.id, selectedRun = runId.value;
  if (!props.active || !run.value?.evidence.some(item => item.assets.some(entry => entry.asset.id === id && entry.asset.status === 'READY'))) return;
  // Open only after a scoped, owner-authorized download URL is returned.
  try { const url = await getAssetDownloadUrl(id); if (!disposed && props.active && props.scopeKey === scope && props.resource.id === resourceId && runId.value === selectedRun) window.open(url, '_blank', 'noopener,noreferrer'); }
  catch { if (!disposed && props.active && props.scopeKey === scope) assetFailed.value = true; }
}
</script>

<template>
  <section class="session-record-resource" :aria-busy="loading || undefined">
    <p v-if="loading" role="status">{{ t('sessionTools.activity.loading') }}</p>
    <div v-if="failed" role="alert"><p>{{ t('sessionTools.activity.readError') }}</p><button class="btn btn-secondary" type="button" @click="reader.refresh">{{ t('sessionTools.activity.retry') }}</button></div>
    <template v-if="detail && !failed">
      <p class="workspace-note">{{ t('sessionResources.readerNote') }}</p>
      <div v-if="resource.kind !== 'readiness'" class="d-flex flex-wrap gap-2 align-items-center">
        <label>{{ t('sessionResources.exportFormat') }} <select v-model="exportFormat" class="form-select" :disabled="exportBusy"><option value="JSON">JSON</option><option value="MARKDOWN">Markdown</option><option value="ZIP">ZIP</option></select></label>
        <button type="button" class="btn btn-secondary" :disabled="!active || exportBusy || missingRun" @click="exportReport">{{ t('sessionResources.exportReport') }}</button>
      </div>
      <p v-if="exportFailed" role="alert">{{ t('sessionResources.exportFailed') }}</p>
      <label v-if="detail.runs.length">{{ t('sessionResources.run') }}
        <select v-model="runId" class="form-select"><option v-for="item in detail.runs" :key="item.id" :value="item.id">{{ item.id }} · {{ item.outcome }}</option></select>
      </label>
      <button type="button" class="btn btn-link" :disabled="loading || !active" @click="reader.refresh">{{ t('testSessions.refresh') }}</button>
      <p v-if="missingRun" role="alert">{{ t('sessionResources.missingRun') }}</p>
      <p v-if="assetFailed" role="alert">{{ t('sessionTools.previewFailed') }}</p>
      <TestRequestRecord v-if="resource.kind === 'results' && recordDetail && !missingRun" :request="recordDetail" :disabled="!active" @open-asset="openAsset" />
      <template v-else-if="resource.kind === 'evidence'">
        <h3>{{ detail.title }}</h3><p>{{ t('projects.qa.focus.proofNote') }}</p>
        <section v-if="missing.length"><h4>{{ t('testSessions.missing') }}</h4><ul><li v-for="item in missing" :key="item.id">{{ item.kind }} · {{ item.description }}</li></ul></section>
        <p v-if="!run?.evidence.length">{{ t('sessionResources.noEvidence') }}</p>
        <QaEvidenceCard v-for="item in run?.evidence || []" :key="item.id" :evidence="item" :disabled="!active" @open="openAsset" />
      </template>
      <template v-else-if="resource.kind === 'readiness'">
        <h3>{{ t('sessionResources.notEvaluated') }}</h3><p>{{ t('sessionResources.readinessNote') }}</p>
        <dl><dt>{{ t('testSessions.target') }}</dt><dd>{{ detail.target || '—' }}</dd><dt>{{ t('testSessions.environment') }}</dt><dd>{{ detail.environment || '—' }}</dd><dt>{{ t('sessionResources.build') }}</dt><dd>{{ run?.commitSha || t('sessionResources.unknownBuild') }}</dd></dl>
      </template>
    </template>
  </section>
</template>
