<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../../../i18n/useI18n";
import type { QaEvidence } from "../types";

const props = defineProps<{ evidence: QaEvidence; disabled?: boolean }>();
const emit = defineEmits<{ open: [assetId: string] }>();
const { t } = useI18n();
const externalUrl = computed(() => {
  try {
    const url = new URL(props.evidence.externalReference || "");
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
});
</script>

<template>
  <article class="qa-evidence-item">
    <div><span class="qa-evidence-kind">{{ evidence.kind }}</span><small>{{ evidence.transport }} · {{ evidence.actorKind }}</small></div>
    <p v-if="evidence.textContent">{{ evidence.textContent }}</p>
    <details v-if="evidence.provenance">
      <summary>{{ t('sessionResources.evidenceOrigin') }}</summary>
      <dl>
        <dt>{{ t('testSessions.target') }}</dt><dd>{{ evidence.provenance.target.url || '—' }} · {{ evidence.provenance.target.environment || '—' }}</dd>
        <dt>{{ t('sessionResources.build') }}</dt><dd>{{ evidence.provenance.build.reference || t('sessionResources.unknownBuild') }} · {{ t('sessionResources.buildDeclared') }}</dd>
        <dt>{{ t('sessionResources.expected') }}</dt><dd>{{ evidence.provenance.expectedResult || '—' }}</dd>
        <dt>{{ t('sessionResources.executor') }}</dt><dd>{{ evidence.provenance.executor.kind }} · {{ evidence.provenance.executor.transport }}</dd>
        <dt>{{ t('sessionResources.recordedAt') }}</dt><dd>{{ evidence.provenance.recordedAt }}</dd>
        <template v-if="evidence.provenance.observation"><dt>{{ t('sessionResources.observationTime') }}</dt><dd>{{ evidence.provenance.observation.startedAt }} — {{ evidence.provenance.observation.finishedAt }}</dd><dt>{{ t('sessionResources.steps') }}</dt><dd>{{ evidence.provenance.observation.completedStepRefs.join(', ') }} {{ evidence.provenance.observation.failedStepRef || '' }}</dd></template>
      </dl><p>{{ t('sessionResources.observationDeclared') }}</p>
    </details>
    <a v-if="externalUrl && !disabled" class="qa-evidence-link" :href="externalUrl" rel="noopener noreferrer" target="_blank">
      {{ t('projects.qa.focus.externalEvidence') }} <small>{{ t('projects.qa.focus.externalEvidenceNote') }}</small>
    </a>
    <template v-for="entry in evidence.assets" :key="entry.id">
    <p v-if="entry.asset.status !== 'READY'" role="status">{{ entry.asset.originalName }} · {{ t(entry.asset.status === 'EXPIRED' ? 'sessionResources.evidenceExpired' : 'sessionResources.evidenceUnavailable') }}</p>
    <button v-else class="qa-evidence-link" type="button" :disabled="disabled" @click="emit('open', entry.asset.id)">
      {{ t('projects.qa.focus.openAsset', { name: entry.asset.originalName }) }} <small>{{ t('projects.qa.focus.storedEvidence') }}</small>
    </button>
    </template>
  </article>
</template>
