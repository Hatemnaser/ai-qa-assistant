<script setup lang="ts">
import { ref, watch } from "vue";

import { getAssetDownloadUrl } from "./assetsApi";

const props = defineProps<{
  alt: string;
  assetId: string;
}>();

const source = ref("");
let generation = 0;
let hasRetried = false;

watch(
  () => props.assetId,
  () => {
    hasRetried = false;
    void loadSource(false);
  },
  { immediate: true }
);

async function loadSource(forceRefresh: boolean) {
  const requestGeneration = ++generation;
  source.value = "";

  try {
    const url = await getAssetDownloadUrl(props.assetId, { forceRefresh });

    if (requestGeneration === generation) {
      source.value = url;
    }
  } catch {
    // Keep the attachment metadata visible when a temporary URL cannot be issued.
  }
}

function handleLoadError() {
  if (hasRetried) {
    source.value = "";
    return;
  }

  hasRetried = true;
  void loadSource(true);
}
</script>

<template>
  <img v-if="source" :alt="alt" :src="source" referrerpolicy="no-referrer" @error="handleLoadError" />
</template>
