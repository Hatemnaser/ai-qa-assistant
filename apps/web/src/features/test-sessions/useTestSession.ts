import { computed, onActivated, onDeactivated, onScopeDispose, ref, watch } from "vue";
import type { AuthUser } from "../auth/types";
import type { Project } from "../projects/types";
import type { QaExecutionRecipe, QaRequestDetail, QaRunnerProfile } from "../qa/types";
import type { TestScope, TestSessionDetail, TestTurnInput } from "./types";
import { useI18n } from "../../i18n/useI18n";
import { DEFAULT_MODEL, type QuickAction } from "../chat/constants";
import { useChatDrafts, type ChatDraftTicket } from "../chat/composables/useChatDrafts";
import { accountDraftPersistence } from '../chat/draftPersistence';
import { useChatAttachments } from "../chat/composables/useChatAttachments";
import type { SelectedAttachment } from "../chat/types";
import { prepareChatAttachmentsForSubmit } from "../chat/chatAttachmentSubmission";
import { getAssetDownloadUrl } from "../assets/assetsApi";
import { createProject } from "../projects/projectsApi";
import { qaRunnerProfileManifest, qaRecipeCanRunOnProfile, qaRecipeReviewState } from "../qa/harnessPresentation";
import { qaChecklistEvidence, qaWorkspaceNextAction } from "../qa/workspacePresentation";
import * as qa from "../qa/qaApi";
import * as api from "../sessions/sessionApi";
import { testSessionCanPrepare, testSessionNeedsPolling, sessionQaNeedsPolling } from "./sessionPresentation";

export interface TestSessionPageProps {
  currentUser: AuthUser | null;
  projects: Project[];
  preferredProjectId?: string;
  sessionId?: string;
  requestId?: string;
  isLoadingProjects?: boolean;
  projectLoadError?: string;
  active?: boolean;
  preferredModel?: string;
  beforeAdopt?: (id: string) => Promise<void>;
  refreshRevision?: number;
}

export function useTestSession(props: TestSessionPageProps, events: {
  scopeChanged: (scope: TestScope) => void;
  updated: () => void;
  reloadProjects: () => void;
}) {
  const { t } = useI18n();
  const projectId = ref("");
  const session = ref<TestSessionDetail | null>(null);
  const request = ref<QaRequestDetail | null>(null);
  const selectedRequestId = ref("");
  const profiles = ref<QaRunnerProfile[]>([]);
  const profileId = ref("");
  const profileError = ref("");
  const profilesLoading = ref(false);
  const loading = ref(false);
  const busy = ref(false);
  const qaActionBusy = ref(false);
  const readError = ref("");
  const error = ref("");
  const message = ref("");
  const mode = ref("general");
  const model = ref(DEFAULT_MODEL);
  const quickAction = ref<string | null>(null);
  const selectedAttachments = ref<SelectedAttachment[]>([]);
  const drafts = useChatDrafts({ messageInput: message, selectedMode: mode, selectedModel: model, quickActionMode: quickAction, selectedAttachments }, accountDraftPersistence(() => props.currentUser?.id), () => { error.value = t('sessions.draftStorage'); });
  watch(() => props.preferredModel, value => { if (value) drafts.setDefaultModel(value); }, { immediate: true });
  let activeDraftKey = "new:";
  const draftKeys = new Set([activeDraftKey]);
  let epoch = 0;
  let readRevision = 0;
  let profilesRevision = 0;
  let projectChoiceRevision = 0;
  const lifecycleActive = ref(true);
  const active = computed(() => lifecycleActive.value && props.active !== false);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let viewedSessionId = "";
  let inferredScopePending = false;
  let scopeInitialized = false;
  let ownerId = props.currentUser?.id || "";
  let ownerRevision = 0;
  type SendAttempt = {
    creationKey: string; session: TestSessionDetail | null; inFlight: boolean;
    pending: { draftRevision: number; input: TestTurnInput; sessionId: string } | null;
  };
  // Retry identities belong to the draft, so visiting another project or
  // history record cannot turn an uncertain POST into a duplicate upload/turn.
  let sendAttempts = new WeakMap<ChatDraftTicket["entry"], SendAttempt>();
  const attachments = useChatAttachments({ selectedAttachments, drafts, getIdentity: () => `${props.currentUser?.id}:${epoch}` });
  const project = computed(() => props.projects.find(item => item.id === projectId.value) || null);
  const artifact = computed(() => request.value?.artifacts.find(item => item.id === request.value?.selectedArtifactId) || request.value?.artifacts[0] || null);
  const run = computed(() => request.value?.runs[0] || null);
  const rows = computed(() => qaChecklistEvidence(artifact.value, run.value));
  const missingCount = computed(() => rows.value.reduce((sum, row) => sum + row.missingRequirements.length, 0));
  const turnBusy = computed(() => Boolean(session.value?.turnStatus && ["PENDING", "PROCESSING"].includes(session.value.turnStatus.status)));
  const isCurrentRequest = computed(() => !session.value || session.value.currentRequestId === request.value?.id);
  const readBlocked = computed(() => loading.value || Boolean(readError.value) || Boolean(session.value?.archivedAt) || !props.currentUser || !active.value);
  const blocked = computed(() => busy.value || readBlocked.value);
  // A conversational POST temporarily blocks a click, not the identity or
  // existence of the pending QA decision. Keep that distinction explicit.
  const approvalAvailable = computed(() => !readBlocked.value && isCurrentRequest.value && !sessionQaNeedsPolling(session.value, request.value) && Boolean(request.value?.selectedArtifactId && ["READY_TO_RUN", "CHANGES_REQUESTED"].includes(request.value.phase)));
  const canStart = computed(() => !busy.value && approvalAvailable.value);
  const canSelect = computed(() => !blocked.value && isCurrentRequest.value && !sessionQaNeedsPolling(session.value, request.value) && Boolean(request.value && artifact.value && !request.value.selectedArtifactId && artifact.value.assessments[0]?.status !== "PENDING"));
  const canReview = computed(() => !blocked.value && request.value?.phase === "READY_FOR_REVIEW" && run.value?.status === "RESULTS_SUBMITTED");
  const selectedProfile = computed(() => profiles.value.find(item => item.id === profileId.value) || null);
  const canPrepare = computed(() => !blocked.value && !profileError.value && !profilesLoading.value && testSessionCanPrepare(session.value, request.value));
  const viewingPast = computed(() => Boolean(session.value?.currentRequestId && selectedRequestId.value !== session.value.currentRequestId));
  const nextAction = computed(() => qaWorkspaceNextAction({
    request: request.value, artifact: artifact.value, run: run.value, isLoading: loading.value,
    loadError: Boolean(readError.value), isSample: false, canSelectArtifact: canSelect.value,
    canStartRun: canStart.value, canReview: canReview.value, missingEvidenceCount: missingCount.value, isBusy: busy.value,
  }));

  function capture() {
    const revision = epoch;
    const identity = props.currentUser?.id;
    return () => !disposed && revision === epoch && identity === props.currentUser?.id;
  }
  function notifyScope(requestId = selectedRequestId.value) {
    if (!active.value || disposed) return;
    events.scopeChanged({ projectId: projectId.value, sessionId: session.value?.id, requestId: requestId || undefined });
  }
  function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
  function transferDraft(nextKey: string) {
    drafts.transferTo(nextKey);
    draftKeys.delete(activeDraftKey);
    draftKeys.add(nextKey);
    activeDraftKey = nextKey;
  }
  function selectDraft(nextKey: string, preserveUnscoped: boolean) {
    // Choosing a project restores its existing draft. Keep an independent
    // unscoped draft where it is instead of overwriting either private draft.
    if (preserveUnscoped && !draftKeys.has(nextKey)) transferDraft(nextKey);
    else { drafts.select(nextKey); draftKeys.add(nextKey); activeDraftKey = nextKey; }
  }
  function schedule() {
    clearTimer();
    if (active.value && !disposed && testSessionNeedsPolling(session.value, request.value)) {
      timer = setTimeout(() => { void refresh(false); }, 2000);
    }
  }
  function adopt(next: TestSessionDetail) {
    if (session.value && next.id === session.value.id && next.version < session.value.version) return;
    const oldCurrent = session.value?.currentRequestId;
    const wasCurrent = !selectedRequestId.value || selectedRequestId.value === oldCurrent;
    session.value = next;
    viewedSessionId = next.id;
    if (wasCurrent) selectedRequestId.value = next.currentRequestId || "";
  }
  async function refresh(showLoading = true) {
    if (!props.currentUser || !active.value || busy.value) return;
    const current = capture();
    const revision = ++readRevision;
    const projectKey = projectId.value;
    const sessionKey = viewedSessionId;
    let inferredProject = false;
    if (showLoading) loading.value = true;
    try {
      if (sessionKey) {
        const previousVersion = session.value?.version;
        const previousUpdatedAt = session.value?.updatedAt;
        const value = await api.fetchTestSession(projectKey, sessionKey);
        if (!current() || revision !== readRevision) return;
        if (value.id !== sessionKey || (projectKey && value.projectId !== projectKey)
          || (selectedRequestId.value && !value.requests.some(item => item.id === selectedRequestId.value))) {
          throw new Error(t("testSessions.errors.scope"));
        }
        inferredProject = !projectKey && Boolean(value.projectId);
        projectId.value = value.projectId;
        if (inferredProject) {
          inferredScopePending = true;
          // Restore the existing account-scoped draft at its canonical key.
          // Transferring the temporary empty draft would overwrite it on disk.
          selectDraft(`${value.projectId}:${value.id}`, false);
          // The initial parallel profile read had no project. Load only after
          // the owned session supplied it; normal late-response guards apply.
          void loadProfiles();
        }
        adopt(value);
        if (previousVersion !== undefined && (value.version !== previousVersion || value.updatedAt !== previousUpdatedAt)) events.updated();
      }
      const requestKey = selectedRequestId.value;
      const detail = requestKey && projectId.value ? await qa.fetchQaRequest(projectId.value, requestKey) : null;
      if (!current() || revision !== readRevision || requestKey !== selectedRequestId.value) return;
      request.value = detail;
      readError.value = "";
      // Preserve an explicit historical request, or the URL's current-request
      // default, rather than changing the user's selected record on restore.
      if (inferredScopePending && active.value) {
        inferredScopePending = false;
        notifyScope(props.requestId || "");
      }
    } catch (failure) {
      if (current() && revision === readRevision) readError.value = failure instanceof Error ? failure.message : t("testSessions.errors.request");
    } finally {
      if (current() && revision === readRevision) { loading.value = false; schedule(); }
    }
  }
  async function loadProfiles() {
    if (!props.currentUser || !projectId.value || !active.value) return;
    const current = capture();
    const revision = ++profilesRevision;
    profilesLoading.value = true;
    try {
      const values = await qa.fetchQaRunnerProfiles(projectId.value);
      if (!current() || revision !== profilesRevision) return;
      profiles.value = values;
      profileError.value = "";
      if (!values.some(item => item.id === profileId.value)) profileId.value = "";
      // A single non-production candidate is only a visible suggestion, never consent.
      const candidates = values.filter(item => item.status === "ONLINE" && item.environmentKind !== "PRODUCTION");
      if (!profileId.value && candidates.length === 1) profileId.value = candidates[0]!.id;
    } catch {
      if (current() && revision === profilesRevision) profileError.value = t("testSessions.errors.profiles");
    } finally { if (current() && revision === profilesRevision) profilesLoading.value = false; }
  }
  async function selectScope(scope: TestScope, preserveUnscopedDraft = false) {
    const nextOwner = props.currentUser?.id || "";
    const nextRequestId = scope.requestId || (scope.sessionId === viewedSessionId ? session.value?.currentRequestId || "" : "");
    if (scopeInitialized && nextOwner === ownerId && scope.projectId === projectId.value && (scope.sessionId || "") === viewedSessionId && nextRequestId === selectedRequestId.value) return true;
    scopeInitialized = true;
    inferredScopePending = false;
    epoch += 1; readRevision += 1; profilesRevision += 1; clearTimer();
    const sameOwner = ownerId === nextOwner;
    if (!sameOwner) {
      ownerRevision += 1;
      drafts.reset(); draftKeys.clear(); activeDraftKey = "new:"; draftKeys.add(activeDraftKey);
      sendAttempts = new WeakMap(); ownerId = nextOwner;
    }
    const sameSession = sameOwner && projectId.value === scope.projectId && viewedSessionId === (scope.sessionId || "");
    projectId.value = scope.projectId;
    viewedSessionId = scope.sessionId || "";
    selectedRequestId.value = scope.requestId || "";
    request.value = null;
    if (!sameSession) session.value = null;
    profiles.value = []; profileId.value = ""; profileError.value = "";
    readError.value = ""; error.value = ""; loading.value = false; busy.value = false; qaActionBusy.value = false; profilesLoading.value = false;
    const draftKey = `${scope.projectId}:${scope.sessionId || scope.requestId || "new"}`;
    selectDraft(draftKey, preserveUnscopedDraft);
    const current = capture();
    await Promise.all([refresh(), loadProfiles()]);
    return current();
  }
  watch(() => [props.currentUser?.id, props.preferredProjectId, props.sessionId, props.requestId] as const, () => {
    void selectScope({ projectId: props.preferredProjectId || "", sessionId: props.sessionId, requestId: props.requestId });
  }, { immediate: true, flush: "sync" });
  watch(() => props.refreshRevision, () => { void refresh(); });
  async function checkProjectMove(id: string, from: string, to: string) {
    const owner = ownerId, revision = ownerRevision;
    if (!owner || disposed || !await drafts.canRelocate(`${from}:${id}`, `${to}:${id}`) || owner !== ownerId || revision !== ownerRevision)
      throw new Error(t('sessions.draftMoveConflict'));
  }
  async function applyProjectMove(value: TestSessionDetail, from: string) {
    const owner = ownerId, revision = ownerRevision;
    const inScope = capture();
    const previousKey = `${from}:${value.id}`;
    const nextKey = `${value.projectId}:${value.id}`;
    if (!owner || disposed || !await drafts.relocate(previousKey, nextKey) || owner !== ownerId || revision !== ownerRevision)
      throw new Error(t('sessions.draftMoveConflict'));
    draftKeys.delete(previousKey); draftKeys.add(nextKey);
    if (activeDraftKey === previousKey) activeDraftKey = nextKey;
    if (!inScope() || !active.value || viewedSessionId !== value.id || projectId.value !== from) return;
    // Only an acknowledged move may update an explicitly scoped open link.
    // Arbitrary wrong-project links still fail the normal detail-read guard.
    epoch += 1; readRevision += 1; profilesRevision += 1; clearTimer();
    projectId.value = value.projectId; adopt(value);
    profiles.value = []; profileId.value = ''; profileError.value = '';
    readError.value = ''; loading.value = false; busy.value = false; qaActionBusy.value = false;
    events.updated();
    notifyScope();
    await Promise.all([refresh(false), loadProfiles()]);
  }
  async function chooseProject(id: string) {
    const choice = ++projectChoiceRevision;
    // Wait for the current draft before deciding it is safe to transfer it.
    if (drafts.hydrating.value) return;
    if (session.value) {
      const value = session.value;
      if (value.requests.length || turnBusy.value || blocked.value) return;
      const current = capture();
      await mutate(async () => {
        const settled = await settleLegacy(value);
        if (!current()) return;
        const from = projectId.value;
        await checkProjectMove(value.id, from, id);
        if (!current()) return;
        const updated = await api.updateTestSession(from, value.id, { expectedSessionVersion: settled.version, expectedUpdatedAt: settled.updatedAt, projectId: id || null });
        if (current()) await applyProjectMove(updated, from);
      });
      await loadProfiles();
      return;
    }
    const preserve = !projectId.value && !session.value;
    const draftKey = `${id}:new`;
    if (preserve && !draftKeys.has(draftKey)) {
      const inScope = capture();
      const current = () => inScope() && choice === projectChoiceRevision;
      busy.value = true;
      error.value = "";
      try {
        const existing = await drafts.restoreStoredDraft(draftKey);
        if (!current() || !active.value) return;
        if (existing) draftKeys.add(draftKey);
      } catch {
        // A failed local read is not an empty destination. Keep the source
        // scope and draft intact instead of replacing an unknown saved draft.
        if (current()) error.value = t('sessions.draftStorage');
        return;
      } finally { if (current()) busy.value = false; }
    }
    if (await selectScope({ projectId: id }, preserve)) notifyScope();
  }
  async function newProject(name: string) {
    if (!name.trim() || busy.value || !props.currentUser || !active.value) return;
    const current = capture();
    busy.value = true;
    try {
      const created = await createProject({ name: name.trim(), description: "" });
      if (!current()) return;
      events.reloadProjects();
      if (!active.value) return;
      busy.value = false;
      await chooseProject(created.id);
    } catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : t("testSessions.errors.request"); }
    finally { if (current()) busy.value = false; }
  }
  async function ensureSession(attempt: SendAttempt) {
    if (session.value) return session.value;
    if (attempt.session) return attempt.session;
    const created = await api.createTestSession(projectId.value, { clientSessionId: attempt.creationKey, ...(selectedRequestId.value ? { requestId: selectedRequestId.value } : {}) });
    attempt.session = created;
    return created;
  }
  async function settleLegacy(value: TestSessionDetail) {
    if (value.managed !== false) return value;
    await props.beforeAdopt?.(value.id);
    return api.fetchTestSession(value.projectId, value.id);
  }
  async function send() {
    if (blocked.value || turnBusy.value || drafts.hydrating.value) return;
    const content = message.value.trim() || attachments.getAttachmentOnlyMessage(selectedAttachments.value);
    if (!content) return;
    const current = capture();
    const ticket = drafts.capture();
    let attempt = sendAttempts.get(ticket.entry);
    if (!attempt) {
      attempt = { creationKey: crypto.randomUUID(), session: null, inFlight: false, pending: null };
      sendAttempts.set(ticket.entry, attempt);
    }
    if (attempt.inFlight) return;
    attempt.inFlight = true;
    const files = [...selectedAttachments.value];
    const projectKey = projectId.value;
    const selectedModel = model.value;
    busy.value = true; error.value = ""; clearTimer(); ++readRevision;
    try {
      const value = await settleLegacy(await ensureSession(attempt));
      if (!current()) return;
      adopt(value);
      transferDraft(`${projectKey}:${value.id}`);
      if (!active.value) return;
      if (!attempt.pending || attempt.pending.draftRevision !== ticket.revision || attempt.pending.sessionId !== value.id) {
        const prepared = await prepareChatAttachmentsForSubmit(files, { isAuthenticated: true, projectId: projectKey || null });
        attempt.pending = { draftRevision: ticket.revision, sessionId: value.id, input: {
          clientTurnId: crypto.randomUUID(), expectedSessionVersion: value.version, expectedUpdatedAt: value.updatedAt, content,
          model: selectedModel, mode: mode.value as TestTurnInput["mode"], attachments: prepared.requestAttachments || undefined,
        } };
      }
      if (!current() || !active.value) return;
      // Version is not part of the turn's idempotency content hash. Preserve the
      // turn identity on retry while allowing an explicitly refreshed version.
      attempt.pending.input.expectedSessionVersion = value.version;
      const updated = await api.sendTestTurn(projectKey, value.id, attempt.pending.input);
      attempt.session = updated;
      attempt.pending = null;
      if (ownerId === props.currentUser?.id && ticket.entry.valid) drafts.consume(ticket, false);
      if (!current()) return;
      adopt(updated);
      events.updated();
    } catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : t("testSessions.errors.request"); }
    finally { attempt.inFlight = false; if (current()) { busy.value = false; notifyScope(); schedule(); } }
  }
  async function mutate(operation: () => Promise<void>, reload = true, qaAction = true) {
    if (blocked.value) return false;
    const current = capture();
    let succeeded = false;
    busy.value = true; qaActionBusy.value = qaAction; error.value = ""; clearTimer(); ++readRevision;
    try { await operation(); if (current()) { succeeded = true; events.updated(); } }
    catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : t("testSessions.errors.request"); }
    finally { if (current()) { busy.value = false; qaActionBusy.value = false; if (reload) await refresh(false); if (current() && reload) notifyScope(); } }
    return succeeded && current();
  }
  async function prepare(resume: "resume" | "retry" | null = null) {
    const value = session.value;
    if (!value || !projectId.value || (!resume && !canPrepare.value) || profilesLoading.value || profileError.value) return;
    if (resume && (!value.preparation || !["WAITING_PROFILE", "FAILED", "READY"].includes(value.preparation.status)
      || (resume === "retry" && value.preparation.status !== "FAILED") || testSessionNeedsPolling(value, request.value))) return;
    const current = capture();
    const profile = selectedProfile.value;
    const input = { expectedSessionVersion: value.version, ...(profile ? { runnerRegistrationId: profile.runnerRegistrationId, profileKey: profile.key } : {}) };
    await mutate(async () => {
      const updated = resume
        ? await api.resumeTestPreparation(projectId.value, value.id, { ...input, action: resume })
        : await api.prepareTestSession(projectId.value, value.id, { ...input, proposalId: value.pendingProposal!.id });
      if (current()) adopt(updated);
    });
  }
  async function qaMutation(operation: (project: string, detail: QaRequestDetail) => Promise<QaRequestDetail>) {
    const detail = request.value;
    if (!detail) return;
    const current = capture(); const projectKey = projectId.value;
    await mutate(async () => { const result = await operation(projectKey, detail); if (current()) request.value = result; });
  }
  async function start(input: { confirmProduction: boolean; profile: QaRunnerProfile; recipe: QaExecutionRecipe }) {
    if (!canStart.value || profilesLoading.value || profileError.value) return;
    const profile = profiles.value.find(item => item.id === input.profile.id);
    const recipe = request.value?.executionRecipes?.find(item => item.id === input.recipe.id);
    if (!profile || !recipe || !qaRecipeCanRunOnProfile(recipe, profile) || !qaRecipeReviewState(recipe, request.value?.operations || [], false).isReviewed) return;
    if (profile.environmentKind === "PRODUCTION" && !input.confirmProduction) return;
    await qaMutation(async (projectKey, detail) => (await qa.startQaRun(projectKey, detail.id, {
      executionMode: "PLAYWRIGHT", expectedRequestVersion: detail.version, recipeId: recipe.id,
      recipeHash: recipe.recipeHash, runnerRegistrationId: profile.runnerRegistrationId, profileKey: profile.key,
      confirmProduction: input.confirmProduction,
    })).request);
  }
  async function generate(profile: QaRunnerProfile) {
    const detail = request.value; const selected = artifact.value;
    if (!detail || !selected || !canStart.value || profilesLoading.value || profileError.value) return;
    const known = profiles.value.find(item => item.id === profile.id && item.manifestHash === profile.manifestHash && item.status === "ONLINE");
    if (!known) return;
    await mutate(async () => { await qa.generateQaExecutionRecipe(projectId.value, detail.id, { artifactId: selected.id, profileManifest: qaRunnerProfileManifest(known) }); });
  }
  async function retryReview(input: { recipeId: string; assessmentId: string }) {
    const detail = request.value;
    const recipe = detail?.executionRecipes?.find(item => item.id === input.recipeId);
    const reviewState = qaRecipeReviewState(recipe || null, detail?.operations || []);
    if (!detail || !isCurrentRequest.value || !reviewState.canRetry || reviewState.assessment?.id !== input.assessmentId) return;
    const current = capture();
    await mutate(async () => {
      const receipt = await qa.retryQaExecutionRecipeReview(projectId.value, detail.id, input.recipeId, { assessmentId: input.assessmentId });
      if (current()) request.value = { ...detail, operations: [receipt, ...(detail.operations || []).filter(item => item.operationId !== receipt.operationId)] };
    });
  }
  async function selectArtifact() {
    const id = artifact.value?.id;
    if (!canSelect.value || !id) return;
    await qaMutation((projectKey, detail) => qa.selectQaArtifact(projectKey, detail.id, id, detail.version));
  }
  async function review(decision: "APPROVED" | "CHANGES_REQUESTED", comment: string) {
    const latest = run.value;
    if (!canReview.value || !latest) return;
    await qaMutation((projectKey, detail) => qa.reviewQaRun(projectKey, detail.id, latest.id, { decision, comment, expectedRunVersion: latest.version }));
  }
  async function cancel() {
    const latest = run.value;
    if (!latest || !latest.executionJob || !["QUEUED", "CLAIMED", "RUNNING"].includes(latest.executionJob.status)) return;
    await qaMutation((projectKey, detail) => qa.cancelQaExecution(projectKey, detail.id, latest.id));
  }
  async function startExternal(confirmProduction: boolean) {
    if (!canStart.value) return;
    await qaMutation(async (projectKey, detail) => (await qa.startQaRun(projectKey, detail.id, { executionMode: "CONNECTED_AGENT", expectedRequestVersion: detail.version, confirmProduction })).request);
  }
  async function selectRequest(id: string) {
    if (!session.value?.requests.some(item => item.id === id)) return;
    if (await selectScope({ projectId: projectId.value, sessionId: session.value.id, requestId: id })) notifyScope();
  }
  async function update(input: { title?: string; archived?: boolean }) {
    const value = session.value;
    if (!value || busy.value || loading.value || readError.value || !props.currentUser || !active.value) return;
    const current = capture();
    // Restoring archived sessions is allowed; other mutation gates remain closed.
    busy.value = true; error.value = ""; clearTimer(); ++readRevision;
    try {
      const settled = await settleLegacy(value);
      if (!current()) return;
      const updated = await api.updateTestSession(projectId.value, value.id, { ...input, expectedSessionVersion: settled.version, expectedUpdatedAt: settled.updatedAt });
      if (current()) { adopt(updated); events.updated(); }
    }
    catch (failure) { if (current()) error.value = failure instanceof Error ? failure.message : t("testSessions.errors.request"); }
    finally { if (current()) { busy.value = false; schedule(); } }
  }
  async function removeDraft() {
    const value = session.value;
    if (!value || value.requests.length || turnBusy.value || blocked.value) return;
    const current = capture();
    const removed = await mutate(async () => {
      const settled = await settleLegacy(value);
      if (current()) await api.deleteTestSession(projectId.value, value.id, settled.version, settled.updatedAt);
    }, false);
    if (removed && session.value?.id === value.id) {
      drafts.remove(`${projectId.value}:${value.id}`);
      draftKeys.delete(`${projectId.value}:${value.id}`);
      if (await selectScope({ projectId: projectId.value })) notifyScope();
    }
  }
  async function openAsset(assetId: string) {
    const current = capture();
    try { const url = await getAssetDownloadUrl(assetId); if (current() && active.value) window.open(url, "_blank", "noopener,noreferrer"); }
    catch { if (current()) error.value = t("testSessions.errors.asset"); }
  }
  let retryKey = "";
  async function retryTurn() {
    const value = session.value;
    if (!value || value.turnStatus?.status !== "FAILED" || blocked.value) return;
    retryKey ||= crypto.randomUUID();
    const current = capture();
    await mutate(async () => {
      const updated = await api.retrySessionTurn(value.id, value.turnStatus!.id, { clientRetryId: retryKey, expectedSessionVersion: value.version });
      if (current()) { adopt(updated); retryKey = ""; }
    }, true, false);
  }
  watch(active, value => {
    if (!value) { clearTimer(); readRevision += 1; profilesRevision += 1; loading.value = false; profilesLoading.value = false; }
    else { void refresh(); void loadProfiles(); }
  }, { flush: "sync" });
  onDeactivated(() => { lifecycleActive.value = false; });
  onActivated(() => { lifecycleActive.value = true; });
  onScopeDispose(() => { disposed = true; epoch += 1; clearTimer(); });
  return { projectId, project, session, request, selectedRequestId, artifact, run, profiles, profileId, selectedProfile,
    profileError, profilesLoading, loading, busy, qaActionBusy, readError, error, message, mode, model,
    turnBusy, blocked, readBlocked, draftLoading: drafts.hydrating, approvalAvailable, canStart, canSelect, canReview, canPrepare, viewingPast, missingCount, nextAction,
    ...attachments, send, refresh, loadProfiles, chooseProject, newProject, prepare, start, generate, retryReview, retryTurn,
    selectArtifact, review, cancel, startExternal, selectRequest, update, removeDraft, openAsset, checkProjectMove, applyProjectMove };
}
