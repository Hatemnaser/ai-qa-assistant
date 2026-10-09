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
    <a v-if="externalUrl && !disabled" class="qa-evidence-link" :href="externalUrl" rel="noopener noreferrer" target="_blank">
      {{ t('projects.qa.focus.externalEvidence') }} <small>{{ t('projects.qa.focus.externalEvidenceNote') }}</small>
    </a>
    <button v-for="entry in evidence.assets" :key="entry.asset.id" class="qa-evidence-link" type="button" :disabled="disabled" @click="emit('open', entry.asset.id)">
      {{ t('projects.qa.focus.openAsset', { name: entry.asset.originalName }) }} <small>{{ t('projects.qa.focus.storedEvidence') }}</small>
    </button>
  </article>
</template>
