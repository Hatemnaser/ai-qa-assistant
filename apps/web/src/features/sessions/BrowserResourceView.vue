<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from '../../i18n/useI18n';
import SavedBrowserLogins from './SavedBrowserLogins.vue';
import { browserLoginRequest, type BrowserLoginStatus } from './browserLoginApi';
import { safeBrowserViewerUrl } from './browserViewer';

const props = defineProps<{ projectId: string; executionId: string; scopeKey: string; active: boolean; canStop: boolean; layoutKey?: boolean }>();
const emit = defineEmits<{ stop: []; controls: [] }>();
const { t } = useI18n();
const status = ref<BrowserLoginStatus | null>(null), viewerUrl = ref<string | null>(null), frame = ref<HTMLIFrameElement | null>(null);
const connection = ref<'idle' | 'connecting' | 'connected' | 'failed'>('idle'), failed = ref(false), unavailable = ref(false), busy = ref(false);
let revision = 0, timer: ReturnType<typeof setInterval> | undefined, readinessTimer: ReturnType<typeof setTimeout> | undefined, polling = false, mode: 'VIEW' | 'LOGIN' = 'VIEW';
let viewerRevision = 0;
const canView = computed(() => status.value?.state === 'LIVE' && ['NONE', 'READY'].includes(status.value.login.phase));
function removeViewer() { if (readinessTimer) clearTimeout(readinessTimer); readinessTimer = undefined; viewerUrl.value = null; connection.value = 'idle'; }
// View intent has its own generation so disconnect rejects pending grants while
// execution-status polling continues independently.
function disconnect() { ++viewerRevision; busy.value = false; removeViewer(); }
function clear() { ++revision; if (timer) clearInterval(timer); timer = undefined; disconnect(); status.value = null; failed.value = false; unavailable.value = false; busy.value = false; polling = false; }
async function refresh() {
  if (!props.active || polling) return;
  const token = revision; polling = true;
  try {
    const value = await browserLoginRequest<BrowserLoginStatus>(props.projectId, props.executionId);
    if (token !== revision || !props.active) return;
    if (value.executionId !== props.executionId) throw new Error('Viewer scope mismatch');
    status.value = value; failed.value = false; unavailable.value = false;
    if (value.state !== 'LIVE' || (mode === 'LOGIN' ? value.login.phase !== 'LOGIN' : !['NONE', 'READY'].includes(value.login.phase))) disconnect();
  } catch (cause) { if (token === revision) { unavailable.value = ['BROWSER_RUNTIME_NOT_FOUND', 'BROWSER_RUNTIME_NOT_ACTIVE'].includes((cause as {code?:string}).code || ''); failed.value = !unavailable.value; status.value = null; disconnect(); } }
  finally { if (token === revision) polling = false; }
}
function display(url: string, nextMode: 'VIEW' | 'LOGIN') {
  removeViewer(); const safe = safeBrowserViewerUrl(url, location.origin);
  if (!props.active || !safe) { connection.value = 'failed'; return; }
  mode = nextMode; viewerUrl.value = safe; connection.value = 'connecting';
  readinessTimer = setTimeout(() => { if (connection.value === 'connecting') { disconnect(); connection.value = 'failed'; } }, 15000);
}
async function open(control = false) {
  if ((control ? status.value?.state !== 'LIVE' || status.value.login.phase !== 'LOGIN' || !props.canStop : !canView.value) || busy.value || !props.active) return;
  const token = revision, viewerToken = ++viewerRevision; busy.value = true;
  // Polling must validate the mode of a pending request, including LOGIN before
  // its first iframe is created.
  mode = control ? 'LOGIN' : 'VIEW';
  const current = () => token === revision && viewerToken === viewerRevision && props.active;
  try { const value = await browserLoginRequest<{ url: string }>(props.projectId, props.executionId, control ? '/login/viewer' : '/viewer'); if (current()) display(value.url, mode); }
  catch { if (current()) { disconnect(); connection.value = 'failed'; } }
  finally { if (current()) busy.value = false; }
}
function viewerMessage(event: MessageEvent) {
  if (!props.active || !viewerUrl.value || event.source !== frame.value?.contentWindow || event.origin !== new URL(viewerUrl.value).origin) return;
  const value = event.data;
  if (value?.type !== 'oddpath-browser' || value.runtimeId !== status.value?.runtimeId || value.mode !== mode) return;
  if (value.state === 'connected') { if (readinessTimer) clearTimeout(readinessTimer); readinessTimer = undefined; connection.value = 'connected'; }
  else if (value.state === 'disconnected') { disconnect(); connection.value = 'failed'; }
}
watch(() => [props.scopeKey, props.projectId, props.executionId, props.active, props.layoutKey], () => { clear(); if (props.active) { void refresh(); timer = setInterval(() => void refresh(), 1000); } }, { immediate: true, flush: 'sync' });
onMounted(() => window.addEventListener('message', viewerMessage));
onBeforeUnmount(() => { clear(); window.removeEventListener('message', viewerMessage); });
</script>

<template>
  <section class="session-browser-resource">
    <p>{{ t('sessionResources.browserNote') }}</p>
    <p v-if="failed" role="alert">{{ t('projects.browserLogin.error') }} <button type="button" class="btn btn-secondary" @click="refresh">{{ t('testSessions.retry') }}</button></p>
    <p v-else-if="unavailable" role="status">{{ t('sessionResources.browserUnavailable') }}</p>
    <p v-else-if="!status" role="status">{{ t('sessionTools.activity.loading') }}</p>
    <template v-else>
      <p role="status">{{ status.state === 'LIVE' ? t('sessionResources.live') : t(status.state === 'STOP_CONFIRMED' ? 'sessionResources.stopConfirmed' : status.state === 'STOP_UNCONFIRMED' ? 'sessionResources.stopUnconfirmed' : 'sessionResources.stopRequested') }}</p>
      <div class="d-flex flex-wrap gap-2">
        <button v-if="canView" class="btn btn-secondary" type="button" :disabled="busy" @click="open(false)">{{ t('sessionResources.connectBrowser') }}</button>
        <button v-if="canStop && status.login.phase === 'LOGIN' && status.state === 'LIVE'" class="btn btn-secondary" type="button" :disabled="busy" @click="open(true)">{{ t('projects.browserLogin.link') }}</button>
        <button v-if="viewerUrl" class="btn btn-secondary" type="button" @click="disconnect">{{ t('sessionResources.disconnect') }}</button>
        <button v-if="canStop && status.state === 'LIVE' && status.login.phase === 'NONE'" class="btn btn-secondary" type="button" @click="emit('stop')">{{ t('projects.browserLogin.stop') }}</button>
      </div>
      <p v-if="status.login.phase !== 'NONE'">{{ t('sessionResources.loginControlsNote') }} <button type="button" class="btn btn-link" @click="emit('controls')">{{ t('sessionResources.returnControls') }}</button></p>
      <p role="status">{{ t(`sessionResources.connection.${connection}`) }}</p>
      <iframe v-if="viewerUrl && active" ref="frame" class="session-browser-frame" :src="viewerUrl" :title="t('sessionResources.browser')" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
    </template>
    <SavedBrowserLogins v-if="active" :project-id="projectId" :scope-key="scopeKey" />
  </section>
</template>
