<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, ref, watch } from "vue";
import { useI18n } from "../../i18n/useI18n";
import ChatMessages from "../chat/components/ChatMessages.vue";
import ChatTopbar from "../chat/components/ChatTopbar.vue";
import { sessionTimeline } from "./sessionTimeline";
import ChatComposer from "../chat/components/ChatComposer.vue";
import SessionComposerDock from "../chat/components/SessionComposerDock.vue";
import { sessionDecision, type SessionDecision } from "../test-sessions/decisionPresentation";
import SessionToolsPanel from "./SessionToolsPanel.vue";
import SessionActivityPanel from "./SessionActivityPanel.vue";
import { buildSessionSources, type SessionSource } from "./sessionSources";
import { isPrimarySessionEvent, qaEventLabelKey } from "./sessionActivityPresentation";
import Icon from "../../ui/Icon.vue";
import QaConnectionModal from "../qa/components/QaConnectionModal.vue";
import QaRunApprovalPanel from "../qa/components/QaRunApprovalPanel.vue";
import { exportChatByFormat, exportAnswerByFormat } from "../chat/chatExport";
import { useTestSession, type TestSessionPageProps } from "../test-sessions/useTestSession";
import { testSessionTranscript } from "../test-sessions/sessionPresentation";
import type { TestScope, TestSessionMessage } from "../test-sessions/types";
import type { ChatMessage, ChatAttachment, ChatUsageSummary, AiModelOption, ExportFormat } from "../chat/types";
import TestRequestRecord from "../test-sessions/TestRequestRecord.vue";

const props = defineProps<TestSessionPageProps & { composerTarget?: HTMLElement | null; usageSummary?: ChatUsageSummary | null; modelOptions?: AiModelOption[] }>();
const emit = defineEmits<{
  "scope-change": [scope: TestScope]; "reload-projects": []; "session-updated": []; "open-conversations": [];
  "open-project": [projectId: string];
  "open-projects": [];
}>();
const { t, formatDate } = useI18n();
const state = useTestSession(props, {
  scopeChanged: scope => emit("scope-change", scope), reloadProjects: () => emit("reload-projects"), updated: () => emit("session-updated"),
});
const {
  projectId, project, session, request, selectedRequestId, artifact, run, profiles, profileId, profileError,
  profilesLoading, loading, busy, readError, error, message, model, selectedAttachments, turnBusy, blocked,
  canStart, canSelect, canReview, canPrepare, viewingPast, nextAction,
} = state;
const record = ref<InstanceType<typeof TestRequestRecord> | null>(null);
const currentTool = ref<'sources' | 'activity' | 'results' | null>(null);
const selectedSourceId = ref<string | null>(null);
const toolOpener = ref<HTMLElement | null>(null);
let toolRevision = 0;
const toolsScopeKey = computed(() => `${props.currentUser?.id || 'guest'}:${projectId.value}:${session.value?.id || props.sessionId || 'new'}`);
const sources = computed(() => buildSessionSources(session.value?.messages || [], selectedAttachments.value));
watch(toolsScopeKey, closeTransientTools);
watch(request, value => { if (!value && currentTool.value === 'results') currentTool.value = null; });
function openTool(tool: 'sources' | 'activity' | 'results', toggle = false) {
  toolRevision += 1;
  if (toggle && currentTool.value === tool) { currentTool.value = null; return; }
  if (document.activeElement instanceof HTMLElement) toolOpener.value = document.activeElement;
  currentTool.value = tool;
}
function closeTool() { toolRevision += 1; currentTool.value = null; }
function openSource(source: SessionSource | undefined) {
  if (!source) return;
  selectedSourceId.value = source.id;
  openTool('sources');
}
function openMessageAttachment(attachment: ChatAttachment, messageId: string) {
  openSource(sources.value.find(source => source.messageId === messageId
    && (attachment.assetId ? source.assetId === attachment.assetId : source.name === attachment.name))
    || (attachment.assetId ? sources.value.find(source => source.assetId === attachment.assetId) : undefined));
}
function openDraftAttachment(index: number) {
  const attachment = selectedAttachments.value[index];
  openSource(sources.value.find(source => source.file === attachment?.file));
}
async function locateMessage(id: string) {
  const scope = toolsScopeKey.value;
  closeTool();
  await nextTick();
  // A modal's post-flush close watcher restores its opener first. Explicit
  // source navigation then takes focus, but never into a different session.
  await nextTick();
  if (!viewActive.value || props.active === false || toolsScopeKey.value !== scope) return;
  const element = [...(transcript.value?.querySelectorAll<HTMLElement>('[data-message-id]') || [])].find(item => item.dataset.messageId === id);
  element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'center' });
}
const connectionOpen = ref(false);
const viewActive = ref(true);
let transientRevision = 0;
function closeTransientTools() {
  transientRevision += 1;
  closeTool();
  selectedSourceId.value = null;
  toolOpener.value = null;
  connectionOpen.value = false;
}
// KeepAlive retains drafts/controllers, not body-teleported dialogs or locks.
onDeactivated(() => { viewActive.value = false; closeTransientTools(); });
onActivated(() => { viewActive.value = true; });
watch(() => props.active, active => { if (!active) closeTransientTools(); }, { flush: 'sync' });
async function openConnections() {
  const revision = ++transientRevision;
  const scope = toolsScopeKey.value;
  closeTool();
  await nextTick();
  if (viewActive.value && props.active !== false && revision === transientRevision && scope === toolsScopeKey.value) connectionOpen.value = true;
}
const projectName = ref("");
const renameTitle = ref("");
const reviewComment = ref("");
const renameOpen = ref(false);
const deleteOpen = ref(false);
const noteOpen = ref(false);
const proposalOpen = ref(false);
const reviewNoteInput = ref<HTMLTextAreaElement | null>(null);
const transcript = ref<HTMLElement | null>(null);
const approvalDetailsHost = ref<HTMLElement | null>(null);
const decisionHost = ref<HTMLElement | null>(null);
const reviewRequestId = ref('');
const menu = ref<HTMLDetailsElement | null>(null);
const renameInput = ref<HTMLInputElement | null>(null);
const proposalDetails = ref<HTMLElement | null>(null);
const preparationActive = computed(() => Boolean(session.value?.preparation && ["CHECKLIST", "RECIPE", "REVIEW"].includes(session.value.preparation.status)));
const isGenerating = computed(() => Boolean(request.value?.operations?.some(op => op.kind === "EXECUTION_RECIPE_GENERATION" && ["PENDING", "PROCESSING"].includes(op.status))));
const hasCancelableRun = computed(() => Boolean(run.value?.executionJob && ["QUEUED", "CLAIMED", "RUNNING"].includes(run.value.executionJob.status)));
const approvalIdentity = computed(() => `${props.currentUser?.id}:${projectId.value}:${session.value?.id}:${request.value?.id}`);
const activeWork = computed(() => preparationActive.value || hasCancelableRun.value || Boolean(
  session.value?.requests.some(item => ['GENERATING', 'CHECKLIST_REVIEW', 'RUNNING'].includes(item.phase))
  || request.value?.operations?.some(op => ['PENDING', 'PROCESSING'].includes(op.status))
  || run.value && ['CREATED', 'ACTIVE'].includes(run.value.status)));
const availableDecision = computed(() => sessionDecision({
  loading: loading.value || props.isLoadingProjects,
  readError: Boolean(readError.value || props.projectLoadError), hasProject: Boolean(projectId.value) || !session.value?.pendingProposal,
  archived: Boolean(session.value?.archivedAt), working: activeWork.value,
  proposal: Boolean(session.value?.pendingProposal && !(reviewRequestId.value === request.value?.id && request.value?.phase === 'READY_FOR_REVIEW')),
  recovery: Boolean(session.value?.preparation && ['WAITING_PROFILE', 'FAILED', 'STOPPED'].includes(session.value.preparation.status) && !(reviewRequestId.value === request.value?.id && request.value?.phase === 'READY_FOR_REVIEW')),
  canSelect: canSelect.value, approvalAvailable: state.approvalAvailable.value,
  evidence: nextAction.value.action === 'evidence', reviewAvailable: canReview.value,
}));
const lastDecision = ref<SessionDecision>('none');
watch(availableDecision, value => { if (!busy.value && !loading.value && !readError.value) lastDecision.value = value; }, { immediate: true, flush: 'sync' });
watch(approvalIdentity, () => { lastDecision.value = availableDecision.value; });
const decision = computed(() => loading.value || props.isLoadingProjects || readError.value || props.projectLoadError ? availableDecision.value : busy.value ? lastDecision.value : availableDecision.value);
const decisionTitle = computed(() => {
  if (decision.value === 'none') return '';
  const keys = {
    loading: 'testSessions.loading', 'read-error': 'testSessions.retry', project: 'testSessions.chooseProject',
    archived: 'testSessions.archived', working: 'workspaces.workingCurrent', proposal: 'testSessions.proposal',
    recovery: 'testSessions.prepFailed', checklist: 'testSessions.selectChecklist', approval: 'projects.qa.approval.title',
    evidence: 'testSessions.missing', review: 'testSessions.approve', none: '',
  } as const;
  return t(keys[decision.value as Exclude<SessionDecision, 'none'>]);
});
const pendingReviews = computed(() => session.value?.requests.filter(item => item.phase === 'READY_FOR_REVIEW' && (item.id !== request.value?.id || decision.value === 'proposal')) || []);
const decisionSummary = computed(() => {
  if (['none', 'loading', 'read-error'].includes(decision.value)) return '';
  if (decision.value === 'proposal') return session.value?.pendingProposal?.title || '';
  if (decision.value === 'working') return session.value?.requests.find(item => item.id === session.value?.currentRequestId)?.title || request.value?.title || '';
  return request.value?.title || project.value?.name || '';
});
// Polling replaces the session DTO, but must not replace the owner's explicit
// choice to review an earlier record. Reset only when its scope/proposal changes.
watch([
  () => props.currentUser?.id,
  () => projectId.value,
  () => session.value?.id,
  () => session.value?.pendingProposal?.id,
], () => { reviewRequestId.value = ''; });
watch(approvalIdentity, () => { reviewComment.value = ""; connectionOpen.value = false; renameOpen.value = false; deleteOpen.value = false; noteOpen.value = false; proposalOpen.value = false; });

function exportTranscript(format: ExportFormat) {
  if (session.value) exportChatByFormat(testSessionTranscript(session.value, t("testSessions.exportNote")), format);
}
defineExpose({ exportTranscript, checkProjectMove: state.checkProjectMove, applyProjectMove: state.applyProjectMove });
function closeMenu() { if (menu.value) { menu.value.open = false; menu.value.querySelector('summary')?.focus(); } }
async function rename() { closeMenu(); renameTitle.value = session.value?.title || ""; renameOpen.value = true; await nextTick(); renameInput.value?.focus(); }
function closeRename() { renameOpen.value = false; menu.value?.querySelector('summary')?.focus(); }
async function saveName() { await state.update({ title: renameTitle.value.trim() }); if (!error.value) renameOpen.value = false; }
async function copyAnswer(content: string) { try { await navigator.clipboard.writeText(content); return true; } catch { return false; } }
const timeline = computed(() => sessionTimeline(session.value).filter(entry => entry.kind !== 'event' || isPrimarySessionEvent(entry.event.type)));
function chatMessage(entry: TestSessionMessage): ChatMessage { return { ...entry, role: entry.role === 'user' ? 'user' : 'assistant', mode: entry.mode || 'general', model: entry.model || '' }; }
async function openResults(id: string) {
  const scope = toolsScopeKey.value;
  const revision = ++toolRevision;
  await state.selectRequest(id);
  if (!viewActive.value || props.active === false || scope !== toolsScopeKey.value || revision !== toolRevision
    || selectedRequestId.value !== id || request.value?.id !== id || loading.value || readError.value || props.projectLoadError) return;
  await focusRecord();
}
async function focusRecord() {
  const scope = toolsScopeKey.value;
  const id = request.value?.id;
  if (!id || !viewActive.value || props.active === false || loading.value || readError.value || props.projectLoadError) return false;
  openTool('results');
  const revision = toolRevision;
  await nextTick();
  if (scope !== toolsScopeKey.value || request.value?.id !== id || revision !== toolRevision || !viewActive.value) return false;
  record.value?.$el?.focus({ preventScroll: true });
  return true;
}
async function focusMissing() { if (await focusRecord()) record.value?.openMissing(); }
async function showReviewNote() { noteOpen.value = true; await nextTick(); reviewNoteInput.value?.focus(); reviewNoteInput.value?.scrollIntoView({ block: 'center' }); }
async function showProposal() { proposalOpen.value = !proposalOpen.value; await nextTick(); if (proposalOpen.value) { proposalDetails.value?.focus(); proposalDetails.value?.scrollIntoView({ block: 'start' }); } }
</script>

<template>
  <section class="workspace-surface qa-focused-workspace test-session session-tools-workspace" :class="{ 'session-tools-workspace--open': currentTool }">
    <section class="test-session__main" :aria-label="t('chat.title.default')">
      <ChatTopbar :chat-title="session?.title || request?.title || t('sessionTools.start.title')" :project-id="projectId" :projects="projects" :is-loading-projects="isLoadingProjects" :project-error="projectLoadError" :locked-project="Boolean(session?.requests.length || requestId)" @update:project-id="state.chooseProject($event || '')" @open-project="emit('open-project', $event)" @open-projects="emit('open-projects')">
        <template #actions><div class="test-session__header-actions">
          <div class="session-tools-buttons" role="group" :aria-label="t('sessionTools.activity.title')">
            <button v-for="tool in (['sources', 'activity'] as const)" :key="tool" type="button" class="ui-icon-btn" :title="t(`sessionTools.${tool}`)" :aria-label="t(`sessionTools.${tool}`)" :aria-expanded="currentTool === tool" aria-controls="session-tools-panel" @click="openTool(tool, true)"><Icon :name="tool" /></button>
            <button v-if="request" type="button" class="ui-icon-btn" :title="t('sessionTools.results')" :aria-label="t('sessionTools.results')" :aria-expanded="currentTool === 'results'" aria-controls="session-tools-panel" @click="openTool('results', true)"><Icon name="results" /></button>
          </div>
          <details v-if="session" ref="menu" class="test-session__menu" @keydown.esc.stop.prevent="closeMenu"><summary :aria-label="t('testSessions.details')">⋯</summary><div>
            <button type="button" @click="rename">{{ t('testSessions.rename') }}</button>
            <button type="button" :disabled="busy || loading || Boolean(readError)" @click="state.update({ archived: !session.archivedAt })">{{ t(session.archivedAt ? 'testSessions.restore' : 'testSessions.archive') }}</button>
            <button type="button" @click="exportTranscript('md')">{{ t('testSessions.export') }} · MD</button>
            <button type="button" @click="exportTranscript('json')">{{ t('testSessions.export') }} · JSON</button>
            <button type="button" @click="exportTranscript('txt')">{{ t('testSessions.export') }} · TXT</button>
            <button type="button" @click="exportTranscript('csv')">{{ t('testSessions.export') }} · CSV</button>
            <small v-if="session.requests.length">{{ t('testSessions.exportNote') }}</small>
            <button v-if="!session.requests.length" type="button" :disabled="blocked" @click="deleteOpen = true; closeMenu()">{{ t('testSessions.deleteDraft') }}</button>
          </div></details>
        </div></template>
      </ChatTopbar>
      <div ref="transcript" class="test-session__scroll" tabindex="-1">
      <section v-if="deleteOpen" class="test-session__action" role="alert">
        <p>{{ t('testSessions.deleteConfirm') }}</p>
        <button type="button" class="btn btn-secondary" :disabled="busy" @click="deleteOpen = false; closeMenu()">{{ t('testSessions.close') }}</button>
        <button type="button" class="btn btn-danger" :disabled="blocked" @click="state.removeDraft()">{{ t('testSessions.deleteDraft') }}</button>
      </section>
      <form v-if="renameOpen" class="test-session__rename" @submit.prevent="saveName" @keydown.esc="closeRename">
        <label>{{ t('testSessions.rename') }}<input ref="renameInput" v-model="renameTitle" class="form-control" maxlength="180" /></label>
        <button class="btn btn-primary" :disabled="busy || !renameTitle.trim()">{{ t('testSessions.save') }}</button><button type="button" class="btn btn-secondary" @click="closeRename">{{ t('testSessions.close') }}</button>
      </form>
      <div v-if="projectLoadError" class="workspace-feedback workspace-feedback--error" role="alert">{{ projectLoadError }}<button type="button" class="btn btn-secondary" @click="emit('reload-projects')">{{ t('testSessions.retry') }}</button></div>
      <div v-if="loading" class="test-session__notice" role="status">{{ t('testSessions.loading') }}</div>
      <div v-if="readError" class="workspace-feedback workspace-feedback--error" role="alert">{{ readError }}<button class="btn btn-secondary" type="button" :disabled="busy" @click="state.refresh()">{{ t('testSessions.retry') }}</button></div>
      <div v-if="error" class="workspace-feedback workspace-feedback--error" role="alert">{{ error }}</div>
      <div v-if="viewingPast" class="test-session__request-switch">
        <p>{{ t('testSessions.viewingPast') }} · {{ request?.title }} <button type="button" class="btn btn-link" @click="state.selectRequest(session!.currentRequestId!)">{{ t('testSessions.backCurrent') }}</button></p>
      </div>

      <div class="test-session__conversation">
        <div v-if="!session?.messages.length && !request && !loading" class="test-session__welcome"><h2>{{ t('sessionTools.start.heading') }}</h2><p>{{ t('sessionTools.start.body') }}</p></div>
        <template v-for="entry in timeline" :key="entry.id">
          <div v-if="entry.kind === 'message' && entry.message.role !== 'system'" :data-message-id="entry.message.id" tabindex="-1"><ChatMessages inline :messages="[chatMessage(entry.message)]" :copy-answer="copyAnswer" :is-sending="false" @export-answer="exportAnswerByFormat" @open-attachment="attachment => openMessageAttachment(attachment, entry.message.id)" /></div>
          <section v-else class="test-session__saved-status" :data-message-id="entry.kind === 'message' ? entry.message.id : undefined" tabindex="-1">
            <small>{{ t('testSessions.system') }} · <time :datetime="entry.createdAt">{{ formatDate(entry.createdAt, { timeStyle: 'short' }) }}</time></small>
            <template v-if="entry.kind === 'event'"><strong>{{ t(qaEventLabelKey(entry.event.type)) }}</strong><span>{{ entry.event.title }}</span><button class="btn btn-link" type="button" @click="openResults(entry.event.requestId)">{{ t('testSessions.checks') }}</button></template>
            <p v-else>{{ entry.message.content }}</p>
          </section>
        </template>
        <p v-if="turnBusy" class="test-session__notice" role="status">{{ t('testSessions.thinking') }}</p>
        <div v-if="session?.turnStatus?.status === 'FAILED'" class="workspace-feedback workspace-feedback--error" role="alert"><p>{{ t('testSessions.turnFailed') }}</p><code>{{ session.turnStatus.errorCode }}</code><button class="btn btn-secondary" type="button" :disabled="blocked" @click="state.retryTurn()">{{ t('testSessions.retry') }}</button></div>
        <div ref="approvalDetailsHost" class="test-session__approval-details" />
        <div ref="decisionHost" class="test-session__decision-details" />
        <section v-if="session?.pendingProposal && proposalOpen" ref="proposalDetails" class="test-session__action" tabindex="-1">
          <strong>{{ session.pendingProposal.title }}</strong><p>{{ session.pendingProposal.objective }}</p>
          <dl><dt>{{ t('testSessions.target') }}</dt><dd>{{ session.pendingProposal.target || '—' }}</dd><dt>{{ t('testSessions.environment') }}</dt><dd>{{ session.pendingProposal.environment || '—' }}</dd></dl>
          <p v-if="session.pendingProposal.acceptanceNotes">{{ session.pendingProposal.acceptanceNotes }}</p><small>{{ t('testSessions.sourceNote') }}</small>
        </section>
        <section v-if="canReview && noteOpen" class="test-session__action">
          <label>{{ t('testSessions.reviewComment') }}<textarea ref="reviewNoteInput" v-model="reviewComment" class="form-control" maxlength="10000" rows="3" /></label>
        </section>
        <button v-if="request" class="btn btn-link test-session__results-link" type="button" @click="focusRecord">{{ t('workspaces.panelResults') }} · {{ request.title }}</button>
        <section v-if="request && !session?.events?.length && !loading && !readError && ['APPROVED', 'CANCELLED', 'PROCESSING_FAILED', 'CHANGES_REQUESTED'].includes(request.phase)" class="test-session__saved-status">
          <small>{{ t('testSessions.system') }}</small>
          <strong>{{ request.title }} · {{ t(`projects.qa.focus.phase.${request.phase}`) }}</strong>
          <p v-if="request.phase === 'APPROVED'">{{ t('testSessions.reviewNote') }}</p>
          <p v-if="run?.executionJob?.failureMessage" role="alert">{{ run.executionJob.failureMessage }}</p>
          <button class="btn btn-link" type="button" @click="focusRecord">{{ t('testSessions.checks') }}</button>
          <p v-for="review in request.reviews" :key="review.id"><time :datetime="review.createdAt">{{ formatDate(review.createdAt) }}</time> · {{ t(review.decision === 'APPROVED' ? 'testSessions.approve' : 'testSessions.changes') }}<span v-if="review.comment"> · {{ review.comment }}</span></p>
        </section>
        <section v-if="session?.preparation?.errorCode && decision !== 'recovery'" class="test-session__saved-status" role="note"><strong>{{ t('testSessions.prepFailed') }}</strong><code>{{ session.preparation.errorCode }}</code></section>
        <button v-for="pending in pendingReviews" :key="pending.id" class="btn btn-link test-session__pending-review" type="button" :disabled="busy || loading" @click="reviewRequestId = pending.id; state.selectRequest(pending.id)">{{ t('workspaces.pendingReview') }} · {{ pending.title }} · {{ t(`projects.qa.focus.phase.${pending.phase}`) }}</button>
      </div>
      </div>

      <SessionComposerDock scroll-selector=".test-session__scroll" :reader-key="toolsScopeKey" :decision-title="decisionTitle" :decision-summary="decisionSummary" :decision-key="`${approvalIdentity}:${decision}`" :details-target="decisionHost">
        <template #decision>
        <section v-if="decision === 'loading'" class="test-session__action" role="status">{{ t('testSessions.loading') }}</section>
        <section v-else-if="decision === 'read-error'" class="test-session__action" role="alert">{{ readError || projectLoadError }}<button type="button" class="btn btn-secondary" :disabled="busy" @click="projectLoadError ? emit('reload-projects') : state.refresh()">{{ t('testSessions.retry') }}</button></section>
        <section v-else-if="decision === 'project'" class="test-session__action">
          <strong>{{ t('testSessions.chooseProject') }}</strong>
          <select class="form-select" :aria-label="t('testSessions.project')" :disabled="busy || isLoadingProjects" @change="state.chooseProject(($event.target as HTMLSelectElement).value)"><option value="">{{ t('testSessions.chooseProject') }}</option><option v-for="item in projects" :key="item.id" :value="item.id">{{ item.name }}</option></select>
          <form class="test-session__create-project" @submit.prevent="state.newProject(projectName)"><label><span class="visually-hidden">{{ t('testSessions.projectName') }}</span><input v-model="projectName" class="form-control" :placeholder="t('testSessions.projectName')" maxlength="160" /></label><button class="btn btn-secondary" :disabled="busy || !projectName.trim()">{{ t('testSessions.createProject') }}</button></form>
        </section>
        <section v-if="decision === 'archived'" class="test-session__action"><p>{{ t('testSessions.archived') }}</p><button type="button" class="btn btn-secondary" :disabled="busy" @click="state.update({ archived: false })">{{ t('testSessions.restore') }}</button></section>
          <section v-if="decision === 'proposal' && session?.pendingProposal" class="test-session__action test-session__proposal">
            <div><span class="test-session__eyebrow">{{ t('testSessions.proposal') }}</span><strong>{{ session.pendingProposal.title }}</strong></div>
            <p>{{ session.pendingProposal.target || '—' }} · {{ session.pendingProposal.environment || '—' }}</p>
            <button type="button" class="btn btn-sm btn-link" :aria-expanded="proposalOpen" @click="showProposal">{{ t('testSessions.details') }}</button>
            <p>{{ t('testSessions.prepareNote') }}</p>
            <div class="test-session__runner-choice"><label>{{ t('testSessions.runner') }}<select v-model="profileId" class="form-select" :disabled="profilesLoading || busy || Boolean(profileError)"><option value="">{{ t('testSessions.chooseRunner') }}</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.label }} · {{ t(`projects.qa.approval.environment.${profile.environmentKind}`) }} · {{ t(`projects.qa.approval.profileState.${profile.status}`) }}</option></select></label><button class="btn btn-primary" type="button" :disabled="!canPrepare" @click="state.prepare()">{{ t('testSessions.prepare') }}</button></div>
          </section>
          <section v-if="decision === 'working'" class="test-session__action" role="status"><strong>{{ t('workspaces.workingCurrent') }}</strong>
            <progress :aria-label="t('projects.qa.focus.progress')" :max="!viewingPast && hasCancelableRun ? run?.executionJob?.totalItems || undefined : undefined" :value="!viewingPast && hasCancelableRun && run?.executionJob?.totalItems ? run.executionJob.completedItems : undefined" />
            <button v-if="viewingPast && session?.currentRequestId" class="btn btn-secondary" type="button" @click="state.selectRequest(session.currentRequestId)">{{ t('testSessions.backCurrent') }}</button>
            <button v-else-if="hasCancelableRun" class="btn btn-secondary" type="button" :disabled="blocked" @click="state.cancel()">{{ t('testSessions.cancelRun') }}</button>
          </section>
          <section v-if="decision === 'recovery' && session?.preparation" class="test-session__action">
            <p>{{ t(session.preparation.status === 'WAITING_PROFILE' ? 'testSessions.noRunner' : 'testSessions.prepFailed') }}</p><code v-if="session.preparation.errorCode">{{ session.preparation.errorCode }}</code>
            <label>{{ t('testSessions.runner') }}<select v-model="profileId" class="form-select" :disabled="profilesLoading || busy || Boolean(profileError)"><option value="">{{ t('testSessions.chooseRunner') }}</option><option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.label }} · {{ t(`projects.qa.approval.environment.${profile.environmentKind}`) }} · {{ t(`projects.qa.approval.profileState.${profile.status}`) }}</option></select></label>
            <button v-if="session.preparation.status !== 'STOPPED'" type="button" class="btn btn-secondary" :disabled="blocked || profilesLoading || Boolean(profileError)" @click="state.prepare(session.preparation.status === 'FAILED' ? 'retry' : 'resume')">{{ t('testSessions.resume') }}</button>
          </section>
          <div v-if="profileError && ['proposal', 'recovery'].includes(decision)" class="workspace-feedback workspace-feedback--error" role="alert">{{ profileError }}<button type="button" class="btn btn-secondary" :disabled="profilesLoading" @click="state.loadProfiles()">{{ t('testSessions.retry') }}</button></div>
          <QaRunApprovalPanel v-if="artifact && request" v-show="decision === 'approval'" :artifact="artifact" :profiles="profiles" :recipes="request.executionRecipes || []" :operations="request.operations || []"
            :target="request.target" :environment="request.environment"
            :is-open="decision === 'approval'" :is-generating="isGenerating" :is-loading-profiles="profilesLoading" :is-retrying-review="false" :is-saving="state.qaActionBusy.value" :is-discussing="busy && !state.qaActionBusy.value" :profile-load-error="profileError" :read-error="readError" :disabled="state.readBlocked.value || decision !== 'approval'"
            :identity-key="approvalIdentity" :request-version="request.version" :details-target="approvalDetailsHost" @start="state.start" @generate="state.generate" @retry-review="state.retryReview" @connect="openConnections" @refresh="state.loadProfiles" />
          <section v-if="request && ['checklist', 'evidence', 'review'].includes(decision)" class="test-session__action" :data-tone="nextAction.tone">
            <strong>{{ decisionTitle }}</strong><p v-if="decision !== 'review'">{{ t(nextAction.messageKey) }}</p>
            <template v-if="hasCancelableRun && run?.executionJob">
              <progress :aria-label="t('projects.qa.focus.progress')" :max="run.executionJob.totalItems || undefined" :value="run.executionJob.totalItems ? run.executionJob.completedItems : undefined" />
              <small v-if="run.executionJob.totalItems">{{ t('projects.qa.focus.progressCount', { completed: run.executionJob.completedItems, total: run.executionJob.totalItems }) }}</small>
            </template>
            <p v-if="run?.executionJob?.failureMessage" role="alert">{{ run.executionJob.failureMessage }}</p>
            <button v-if="decision === 'checklist'" class="btn btn-primary" type="button" :disabled="!canSelect" @click="state.selectArtifact()">{{ t('testSessions.selectChecklist') }}</button>
            <button v-if="nextAction.action === 'evidence'" class="btn btn-secondary" type="button" @click="focusMissing">{{ t('testSessions.missing') }}</button>
            <button v-if="hasCancelableRun" class="btn btn-secondary" type="button" :disabled="blocked" @click="state.cancel()">{{ t('testSessions.cancelRun') }}</button>
            <button v-if="nextAction.action === 'results'" class="btn btn-secondary" type="button" @click="focusRecord">{{ t('testSessions.checks') }}</button>
            <form v-if="decision === 'review'" class="test-session__review" @submit.prevent="state.review('APPROVED', reviewComment)"><p>{{ t('testSessions.reviewNote') }}</p><button type="button" class="btn btn-sm btn-link" @click="showReviewNote">{{ t('testSessions.reviewComment') }}</button><div><button type="button" class="btn btn-secondary" :disabled="!canReview" @click="state.review('CHANGES_REQUESTED', reviewComment)">{{ t('testSessions.changes') }}</button><button class="btn btn-primary" :disabled="!canReview">{{ t('testSessions.approve') }}</button></div></form>
          </section>
          <Teleport :to="approvalDetailsHost || 'body'" :disabled="!approvalDetailsHost"><details v-if="decision === 'approval'" class="test-session__external"><summary>{{ t('testSessions.externalRun') }}</summary><p>{{ t('testSessions.externalConfirm') }}</p><button type="button" class="btn btn-secondary" :disabled="!canStart" @click="state.startExternal(false)">{{ t('testSessions.externalRun') }}</button></details></Teleport>
          <p v-if="error && decision !== 'none'" class="workspace-feedback workspace-feedback--error" role="alert">{{ error }}</p>
        </template>
        <Teleport :to="composerTarget || 'body'" :disabled="!composerTarget"><ChatComposer :message="message" :mode="state.mode.value" :model="model" :model-options="modelOptions" :show-starters="!session?.messages.length" :selected-attachments="selectedAttachments" :is-sending="busy || turnBusy" :disabled="blocked || turnBusy || state.draftLoading.value || Boolean(projectLoadError)"
          @update:message="message = $event" @update:mode="state.mode.value = $event" @update:model="model = $event" @quick-action="action => { state.mode.value = action.mode; if (!message.trim()) message = t(action.promptKey) || action.prompt; }" @submit="state.send" @attachments-selected="state.handleAttachmentsSelected" @remove-selected-attachment="state.removeSelectedAttachment" @open-selected-attachment="openDraftAttachment" /></Teleport>
        <small v-if="session?.pendingProposal || session?.requests.length" class="test-session__model-note">{{ t('testSessions.modelNote') }}</small>
      </SessionComposerDock>
    </section>
    <SessionToolsPanel :scope-key="toolsScopeKey" :current-tool="currentTool" :force-drawer="Boolean(composerTarget)" :sources="sources" :selected-source-id="selectedSourceId" :opener-element="toolOpener" @close="closeTool" @select-source="selectedSourceId = $event" @focus-message="locateMessage">
      <template #activity><SessionActivityPanel :session="session" :request="request" :loading="loading" :read-error="readError || projectLoadError" :disabled="blocked" :retry-disabled="busy || loading || isLoadingProjects" @select-request="state.selectRequest" @retry="projectLoadError ? emit('reload-projects') : state.refresh()" /><div class="session-tools-actions"><button v-if="projectId" class="btn btn-secondary" type="button" @click="openConnections">{{ t('testSessions.connect') }}</button><button v-if="session || request" class="btn btn-secondary" type="button" :disabled="busy || loading" @click="state.refresh()">{{ t('testSessions.refresh') }}</button></div></template>
      <template #results>
        <p v-if="loading" role="status">{{ t('sessionTools.activity.loading') }}</p>
        <div v-if="readError || projectLoadError" class="workspace-feedback workspace-feedback--error" role="alert"><p>{{ readError || projectLoadError }}</p><button type="button" class="btn btn-secondary" :disabled="busy || loading || isLoadingProjects" @click="projectLoadError ? emit('reload-projects') : state.refresh()">{{ t('sessionTools.activity.retry') }}</button></div>
        <TestRequestRecord v-if="request" ref="record" :key="`${currentUser?.id}:${request.id}`" :request="request" :disabled="blocked" @open-asset="state.openAsset" />
      </template>
    </SessionToolsPanel>
    <QaConnectionModal v-if="viewActive && connectionOpen && project" :key="`${currentUser?.id}:${project.id}`" :project-id="project.id" :project-name="project.name" :known-runner-profile="profiles.length > 0" initial-preset="RUNNER" appearance="tests" @close="connectionOpen = false; state.loadProfiles()" @changed="state.loadProfiles()" />
  </section>
</template>
