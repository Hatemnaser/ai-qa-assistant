<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../../i18n/useI18n";
import Icon from "../../ui/Icon.vue";
import { sessionSourceCanOpenExternally, type SessionSource } from "./sessionSources";
import { useSessionSourcePreview } from "./useSessionSourcePreview";

const props = defineProps<{ scopeKey: string; sources: SessionSource[]; selectedSourceId?: string | null }>();
const emit = defineEmits<{ "select-source": [id: string]; "focus-message": [messageId: string] }>();
const { t } = useI18n();
const saved = computed(() => props.sources.filter(source => source.origin === "saved"));
const drafts = computed(() => props.sources.filter(source => source.origin === "draft"));
const selected = computed(() => props.sources.find(source => source.id === props.selectedSourceId) || null);
const preview = useSessionSourcePreview({ scopeKey: () => props.scopeKey, source: selected });
const { status, text, imageUrl, downloadUrl } = preview;
</script>

<template>
  <section class="session-sources" :aria-label="t('sessionTools.sources')">
    <p class="session-sources__note">{{ t('sessionTools.sourceNote') }}</p>
    <p v-if="!sources.length">{{ t('sessionTools.noSources') }}</p>
    <section v-for="group in [{ key: 'saved', title: t('sessionTools.savedSources'), items: saved }, { key: 'draft', title: t('sessionTools.draftSources'), items: drafts }]" v-show="group.items.length" :key="group.key">
      <h3>{{ group.title }}</h3>
      <ul class="session-sources__list">
        <li v-for="source in group.items" :key="source.id">
          <button type="button" class="session-sources__item" :aria-pressed="selected?.id === source.id" @click="emit('select-source', source.id)">
            <Icon name="file-text" /><span><strong>{{ source.name }}</strong><small>{{ source.mimeType }}</small></span>
          </button>
          <button v-if="source.messageId" type="button" class="session-sources__origin" @click="emit('focus-message', source.messageId)">{{ t('sessionTools.fromMessage') }}</button>
        </li>
      </ul>
    </section>
    <section v-if="selected" class="session-sources__preview" :aria-label="t('sessionTools.preview')">
      <h3>{{ selected.name }}</h3>
      <p v-if="status === 'loading'" role="status">{{ t('sessionTools.previewLoading') }}</p>
      <pre v-else-if="status === 'text'" tabindex="0">{{ text }}</pre>
      <img v-else-if="status === 'image'" :src="imageUrl" :alt="selected.name" @error="preview.imageFailed" />
      <p v-else-if="status === 'unavailable'">{{ t('sessionTools.previewUnavailable') }}</p>
      <p v-else-if="status === 'too-large'">{{ t('sessionTools.previewTooLarge') }}</p>
      <p v-else-if="status === 'error'" role="alert">{{ t('sessionTools.previewFailed') }}</p>
      <div class="session-sources__actions">
        <button v-if="status === 'error'" type="button" @click="preview.retry">{{ t('sessionTools.retryPreview') }}</button>
        <a v-if="downloadUrl" :href="downloadUrl" target="_blank" rel="noopener noreferrer" :download="selected.name">{{ t('sessionTools.download') }}</a>
        <a v-if="downloadUrl && sessionSourceCanOpenExternally(selected) && ['error', 'unavailable', 'too-large'].includes(status)" :href="downloadUrl" target="_blank" rel="noopener noreferrer">{{ t('sessionTools.openExternal') }}</a>
      </div>
    </section>
  </section>
</template>

<style scoped>
.session-sources { min-width: 0; overflow-wrap: anywhere; }
.session-sources__note { color: var(--text-muted, #67675f); font-size: .8rem; }
.session-sources h3 { margin: 1rem 0 .5rem; font-size: .86rem; font-weight: 600; }
.session-sources__list { list-style: none; padding: 0; margin: 0; }
.session-sources__list li { margin-block: .25rem; }
.session-sources__item { display: flex; align-items: center; gap: .6rem; width: 100%; min-height: 44px; text-align: start; padding: .55rem; border: 0; border-radius: .6rem; color: inherit; background: transparent; }
.session-sources__item[aria-pressed="true"], .session-sources__item:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.session-sources__item :deep(svg) { flex: 0 0 18px; width: 18px; height: 18px; }
.session-sources__item span { min-width: 0; }
.session-sources__item strong, .session-sources__item small { display: block; overflow-wrap: anywhere; }
.session-sources__item strong { font-size: .88rem; font-weight: 500; }
.session-sources__item small { font-size: .7rem; opacity: .7; }
.session-sources__origin { min-height: 32px; margin-inline-start: 2rem; border: 0; background: transparent; color: inherit; font-size: .74rem; text-decoration: underline; }
.session-sources__preview { margin-top: 1rem; border-top: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
.session-sources__preview pre { max-height: 50dvh; overflow: auto; padding: .75rem; border-radius: .5rem; background: color-mix(in srgb, currentColor 5%, transparent); font-size: .78rem; white-space: pre-wrap; overflow-wrap: anywhere; direction: ltr; text-align: start; }
.session-sources__preview img { display: block; max-width: 100%; max-height: 55dvh; object-fit: contain; }
.session-sources__actions { display: flex; flex-wrap: wrap; gap: .5rem; }
.session-sources__actions button, .session-sources__actions a { display: inline-flex; align-items: center; min-height: 44px; padding: .4rem .6rem; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: .5rem; background: transparent; color: inherit; font-size: .8rem; text-decoration: none; }
.session-sources :is(button, a, pre):focus-visible { outline: 2px solid var(--workspace-accent, #aa9362); outline-offset: 2px; }
</style>
