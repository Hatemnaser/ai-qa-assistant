<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import { useI18n } from "../../i18n/useI18n";
import { getAssetDownloadUrl } from "../assets/assetsApi";
import type { AuthUser } from "../auth/types";
import type { Project } from "../projects/types";
import QaConnectionModal from "./components/QaConnectionModal.vue";
import QaPlaywrightRunModal from "./components/QaPlaywrightRunModal.vue";
import QaRequestFormModal from "./components/QaRequestFormModal.vue";
import QaEvidenceCard from "./components/QaEvidenceCard.vue";
import { qaChecklistEvidence, qaGeneralEvidence, qaWorkspaceNextAction } from "./workspacePresentation";
import {
  isQaHarnessPollingActive,
  qaExecutionStatusPresentation,
  qaOperationGroups,
  qaOperationPresentation,
  qaRecipeReviewState,
  qaRunnerProfileManifest,
} from "./harnessPresentation";
import {
  cancelQaExecution,
  createQaRequest,
  fetchProjectConnections,
  fetchQaOperation,
  fetchQaRequest,
  fetchQaRequests,
  fetchQaRunnerProfiles,
  fetchQaSample,
  generateQaExecutionRecipe,
  retryQaExecutionRecipeReview,
  reviewQaRun,
  selectQaArtifact,
  startQaRun,
} from "./qaApi";
import type {
  CreateQaRequestInput,
  QaArtifact,
  QaChecklistItem,
  QaExecutionRecipe,
  QaOperationReceipt,
  QaRequestDetail,
  QaRequestPhase,
  QaRequestSummary,
  QaRunnerProfile,
} from "./types";

const props = defineProps<{
  currentUser: AuthUser | null;
  isLoadingProjects: boolean;
  projectLoadError: string;
  projectToOpenId?: string | null;
  projects: Project[];
}>();

const emit = defineEmits<{
  "new-project": [];
  "open-chat": [];
  "reload-projects": [];
  "sign-in": [];
}>();

const selectedProjectId = ref("");
const requests = ref<QaRequestSummary[]>([]);
const selectedRequest = ref<QaRequestDetail | null>(null);
const isLoading = ref(false);
const isLoadingRequest = ref(false);
const errorMessage = ref("");
const recordLoadError = ref(false);
const failedRequestId = ref<string | null>(null);
const successMessage = ref("");
const isRequestModalOpen = ref(false);
const isCreatingRequest = ref(false);
const requestModalError = ref("");
const isConnectionModalOpen = ref(false);
const connectionCount = ref(0);
const isMutating = ref(false);
const isGeneratingRecipe = ref(false);
const isRetryingRecipeReview = ref(false);
const isRunModalOpen = ref(false);
const isLoadingProfiles = ref(false);
const runnerProfiles = ref<QaRunnerProfile[]>([]);
const reviewComment = ref("");
const profileLoadError = ref("");
const connectionLoadError = ref(false);
const isRequestListOpen = ref(false);
const recordRef = ref<HTMLElement | null>(null);
const listToggleRef = ref<HTMLButtonElement | null>(null);
const itemDetailOverrides = ref<Record<string, boolean>>({});
const { t, locale } = useI18n();
let loadRevision = 0;
let profileLoadRevision = 0;
let isUnmounted = false;
let harnessPollTimer: number | null = null;
let harnessPollRevision = 0;

const selectedProject = computed(() =>
  props.projects.find((project) => project.id === selectedProjectId.value) || null
);
const isSample = computed(() => selectedRequest.value?.sample === true);
const displayedRequests = computed<QaRequestSummary[]>(() => {
  if (requests.value.length > 0) return requests.value;
  if (!selectedRequest.value) return [];
  const request = selectedRequest.value;
  return [{
    createdAt: request.createdAt,
    id: request.id,
    objective: request.objective,
    phase: request.phase,
    projectId: request.projectId,
    title: request.title,
    updatedAt: request.updatedAt,
    version: request.version,
  }];
});
const selectedArtifact = computed<QaArtifact | null>(() => {
  const request = selectedRequest.value;
  if (!request) return null;
  return request.artifacts.find((artifact) => artifact.id === request.selectedArtifactId)
    || request.artifacts[0]
    || null;
});
const latestRun = computed(() => selectedRequest.value?.runs[0] || null);
const latestExecutionJob = computed(() => latestRun.value?.executionJob || null);
const executionStatus = computed(() => qaExecutionStatusPresentation(latestExecutionJob.value));
const latestAssessment = computed(() => selectedArtifact.value?.assessments[0] || null);
const selectedArtifactRecipes = computed(() => {
  const artifactId = selectedArtifact.value?.id;
  return (selectedRequest.value?.executionRecipes || []).filter((recipe) => recipe.artifactId === artifactId);
});
const operationGroups = computed(() => qaOperationGroups(selectedRequest.value?.operations || []));
const onlineRunnerProfiles = computed(() => runnerProfiles.value.filter(({ status }) => status === "ONLINE"));
const resultByItemId = computed(() => new Map(
  (latestRun.value?.results || []).map((result) => [result.checklistItemId, result])
));
const phaseCounts = computed(() => {
  const source = requests.value;
  return {
    approved: source.filter((request) => request.phase === "APPROVED").length,
    evidence: source.filter((request) => request.phase === "EVIDENCE_NEEDED").length,
    ready: source.filter((request) => ["READY_TO_RUN", "READY_FOR_REVIEW"].includes(request.phase)).length,
    running: source.filter((request) => request.phase === "RUNNING").length,
  };
});
const missingEvidenceCount = computed(() => {
  if (!selectedArtifact.value || !latestRun.value) return 0;
  const fulfilled = new Set(latestRun.value.evidence.map((evidence) => evidence.requirementId).filter(Boolean));
  return selectedArtifact.value.items.flatMap((item) => item.evidenceRequirements)
    .filter((requirement) => requirement.required && !fulfilled.has(requirement.id)).length;
});
const canSelectArtifact = computed(() => {
  const request = selectedRequest.value;
  const artifact = selectedArtifact.value;
  const assessment = latestAssessment.value;
  return Boolean(
    request && artifact &&
    !request.selectedArtifactId &&
    assessment && assessment.status !== "PENDING" &&
    !isSample.value && !recordLoadError.value
  );
});
const canStartRun = computed(() => Boolean(
  selectedRequest.value &&
  ["READY_TO_RUN", "CHANGES_REQUESTED"].includes(selectedRequest.value.phase) &&
  selectedRequest.value.selectedArtifactId &&
  !isSample.value && !recordLoadError.value
));
const canCancelExecution = computed(() => Boolean(
  latestRun.value?.executionMode === "PLAYWRIGHT"
  && latestExecutionJob.value
  && ["QUEUED", "CLAIMED", "RUNNING"].includes(latestExecutionJob.value.status)
  && !isSample.value && !recordLoadError.value
));
const canReview = computed(() => Boolean(
  selectedRequest.value?.phase === "READY_FOR_REVIEW" &&
  latestRun.value?.status === "RESULTS_SUBMITTED" &&
  !isSample.value && !recordLoadError.value
));
const isRecordBusy = computed(() => props.isLoadingProjects || isLoading.value || isLoadingRequest.value || isMutating.value
  || isCreatingRequest.value || isGeneratingRecipe.value || isRetryingRecipeReview.value);
const checklistRows = computed(() => qaChecklistEvidence(selectedArtifact.value, latestRun.value));
const generalEvidence = computed(() => qaGeneralEvidence(selectedArtifact.value, latestRun.value));
const nextAction = computed(() => qaWorkspaceNextAction({
  request: selectedRequest.value, artifact: selectedArtifact.value, run: latestRun.value,
  isLoading: isLoading.value || isLoadingRequest.value, isSample: isSample.value,
  canSelectArtifact: canSelectArtifact.value, canStartRun: canStartRun.value,
  canReview: canReview.value, missingEvidenceCount: missingEvidenceCount.value,
  isBusy: isRecordBusy.value,
  loadError: recordLoadError.value,
}));
const currentOperations = computed(() => operationGroups.value.current.filter(({ status }) => status !== "SUCCEEDED"));
const completedOperations = computed(() => operationGroups.value.current.filter(({ status }) => status === "SUCCEEDED"));
const evidenceLabel = computed(() => !latestRun.value
  ? t("projects.qa.focus.evidenceNotStarted")
  : missingEvidenceCount.value
    ? t("projects.qa.focus.evidenceMissing", { count: missingEvidenceCount.value })
    : t("projects.qa.focus.evidenceComplete"));

watch(() => `${props.currentUser?.id}:${selectedProjectId.value}:${selectedRequest.value?.id}:${latestRun.value?.id}`, () => {
  itemDetailOverrides.value = {};
  reviewComment.value = "";
  isRunModalOpen.value = false;
});

// Observe project changes before the immediate props watcher selects the initial
// project. Navigation here may mount with account projects already loaded.
watch(selectedProjectId, () => {
  void loadWorkspace();
});

watch(
  () => [props.currentUser?.id || null, props.projectToOpenId || null, props.projects.map(({ id }) => id).join("|")] as const,
  () => {
    if (!props.currentUser || props.projects.length === 0) {
      selectedProjectId.value = "";
      requests.value = [];
      selectedRequest.value = null;
      return;
    }
    const preferred = props.projectToOpenId && props.projects.some(({ id }) => id === props.projectToOpenId)
      ? props.projectToOpenId
      : selectedProjectId.value && props.projects.some(({ id }) => id === selectedProjectId.value)
        ? selectedProjectId.value
        : props.projects[0]!.id;
    if (selectedProjectId.value !== preferred) {
      selectedProjectId.value = preferred;
    } else {
      void loadWorkspace();
    }
  },
  { immediate: true }
);

watch(
  () => {
    const request = selectedRequest.value;
    const job = request?.runs[0]?.executionJob;
    return request
      ? `${request.id}:${(request.operations || []).map(({ operationId, status }) => `${operationId}:${status}`).join("|")}:${job?.id || ""}:${job?.status || ""}`
      : "";
  },
  () => scheduleHarnessPoll(),
  { immediate: true }
);

onBeforeUnmount(() => {
  isUnmounted = true;
  harnessPollRevision += 1;
  if (harnessPollTimer) window.clearTimeout(harnessPollTimer);
});

// A response may only update the selection which initiated it. The revision
// also rejects an A -> B -> A navigation while an older A request is pending.
function captureContext(requestId?: string | null) {
  const projectId = selectedProjectId.value;
  const ownerId = props.currentUser?.id;
  const revision = loadRevision;
  return () => !isUnmounted
    && ownerId === props.currentUser?.id
    && projectId === selectedProjectId.value
    && revision === loadRevision
    && (requestId === undefined || requestId === (selectedRequest.value?.id || null));
}

async function loadWorkspace() {
  const projectId = selectedProjectId.value;
  const revision = ++loadRevision;
  const isCurrent = captureContext();
  profileLoadRevision += 1;
  isLoadingProfiles.value = false;
  isLoadingRequest.value = false;
  errorMessage.value = "";
  recordLoadError.value = false;
  failedRequestId.value = null;
  successMessage.value = "";
  reviewComment.value = "";
  selectedRequest.value = null;
  requests.value = [];
  runnerProfiles.value = [];
  connectionCount.value = 0;
  profileLoadError.value = "";
  connectionLoadError.value = false;
  isRunModalOpen.value = false;
  isConnectionModalOpen.value = false;
  isRequestModalOpen.value = false;
  isLoading.value = Boolean(projectId && props.currentUser);
  if (!isLoading.value) return;
  try {
    const [loadedRequests, connections, profiles] = await Promise.all([
      fetchQaRequests(projectId),
      fetchProjectConnections(projectId).catch(() => {
        if (isCurrent()) connectionLoadError.value = true;
        return [];
      }),
      fetchQaRunnerProfiles(projectId).catch(() => {
        if (isCurrent()) profileLoadError.value = t("projects.qa.focus.profilesError");
        return [];
      }),
    ]);
    if (!isCurrent()) return;
    requests.value = loadedRequests;
    connectionCount.value = connections.filter((connection) => !connection.revokedAt).length;
    runnerProfiles.value = profiles;
    const detail = loadedRequests[0]
      ? await fetchQaRequest(projectId, loadedRequests[0].id)
      : await fetchQaSample(projectId);
    if (isCurrent()) selectedRequest.value = detail;
  } catch (error) {
    if (isCurrent()) {
      recordLoadError.value = true;
      errorMessage.value = error instanceof Error ? error.message : t("projects.qa.focus.loadError");
    }
  } finally {
    if (revision === loadRevision) isLoading.value = false;
  }
}

async function openRequest(request: QaRequestSummary) {
  isRequestListOpen.value = false;
  if (request.id.startsWith("sample-")) {
    await focusRecord();
    return;
  }
  if (request.id === selectedRequest.value?.id) {
    recordLoadError.value = false;
    failedRequestId.value = null;
    errorMessage.value = "";
    // The displayed row can be selected again while another detail is still
    // loading. That click cancels the pending selection, not the current record.
    if (isLoadingRequest.value) {
      loadRevision += 1;
      isLoadingRequest.value = false;
      scheduleHarnessPoll();
    }
    await focusRecord();
    return;
  }
  const projectId = selectedProjectId.value;
  const revision = ++loadRevision;
  const isCurrent = captureContext();
  isLoading.value = false;
  isLoadingRequest.value = true;
  errorMessage.value = "";
  recordLoadError.value = false;
  failedRequestId.value = null;
  successMessage.value = "";
  try {
    const detail = await fetchQaRequest(projectId, request.id);
    if (isCurrent()) {
      selectedRequest.value = detail;
      await focusRecord();
    }
  } catch (error) {
    if (isCurrent()) {
      recordLoadError.value = true;
      failedRequestId.value = request.id;
      errorMessage.value = error instanceof Error ? error.message : t("projects.qa.focus.loadError");
    }
  } finally {
    if (revision === loadRevision) isLoadingRequest.value = false;
  }
}

function openCreateRequest() {
  if (!selectedProject.value || isRecordBusy.value) return;
  requestModalError.value = "";
  isRequestModalOpen.value = true;
}

async function saveRequest(input: CreateQaRequestInput) {
  const projectId = selectedProjectId.value;
  if (!projectId || isCreatingRequest.value) return;
  let isCurrent = captureContext(selectedRequest.value?.id || null);
  isCreatingRequest.value = true;
  harnessPollRevision += 1;
  requestModalError.value = "";
  try {
    const created = await createQaRequest(projectId, input);
    if (!isCurrent()) return;
    isRequestModalOpen.value = false;
    selectedRequest.value = withOperation(created.request, created.operation);
    recordLoadError.value = false;
    failedRequestId.value = null;
    errorMessage.value = "";
    isCurrent = captureContext(created.request.id);
    const summaries = await fetchQaRequests(projectId);
    if (!isCurrent()) return;
    requests.value = summaries;
    successMessage.value = created.request.phase === "PROCESSING_FAILED"
      ? t("projects.qa.focus.savedNeedsAttention")
      : created.operation
        ? t("projects.qa.focus.createdGenerating")
        : t("projects.qa.focus.created");
  } catch (error) {
    if (isCurrent()) requestModalError.value = error instanceof Error ? error.message : t("projects.qa.focus.createError");
  } finally {
    isCreatingRequest.value = false;
    scheduleHarnessPoll();
  }
}

async function chooseArtifact() {
  const request = selectedRequest.value;
  const artifact = selectedArtifact.value;
  if (!request || !artifact || isRecordBusy.value || !canSelectArtifact.value) return;
  await mutate(async () => selectQaArtifact(
    selectedProjectId.value,
    request.id,
    artifact.id,
    request.version
  ), t("projects.qa.focus.selected"));
}

async function beginAgentRun() {
  const request = selectedRequest.value;
  if (!request || isRecordBusy.value || !canStartRun.value) return;
  await mutate(async () => (await startQaRun(selectedProjectId.value, request.id)).request,
    t("projects.qa.focus.agentStarted"));
}

async function openRunModal() {
  if (!canStartRun.value || isRecordBusy.value) return;
  isRunModalOpen.value = true;
  await loadRunnerProfiles();
}

async function loadRunnerProfiles() {
  const projectId = selectedProjectId.value;
  if (!projectId || isLoadingProfiles.value) return;
  const isCurrent = captureContext();
  const revision = ++profileLoadRevision;
  isLoadingProfiles.value = true;
  profileLoadError.value = "";
  try {
    const profiles = await fetchQaRunnerProfiles(projectId);
    if (isCurrent() && revision === profileLoadRevision) runnerProfiles.value = profiles;
  } catch (error) {
    if (isCurrent() && revision === profileLoadRevision) {
      profileLoadError.value = t("projects.qa.focus.profilesError");
    }
  } finally {
    if (revision === profileLoadRevision) isLoadingProfiles.value = false;
  }
}

function openRunnerConnection() {
  isRunModalOpen.value = false;
  isConnectionModalOpen.value = true;
}

function handleConnectionsChanged(count: number) {
  connectionCount.value = count;
  connectionLoadError.value = false;
  void loadRunnerProfiles();
}

async function generateRecipe(profile: QaRunnerProfile) {
  const request = selectedRequest.value;
  const artifact = selectedArtifact.value;
  const projectId = selectedProjectId.value;
  if (!request || !artifact || isRecordBusy.value || !canStartRun.value || isLoadingProfiles.value || profileLoadError.value) return;
  const isCurrent = captureContext(request.id);
  isGeneratingRecipe.value = true;
  harnessPollRevision += 1;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const operation = await generateQaExecutionRecipe(projectId, request.id, {
      artifactId: artifact.id,
      profileManifest: qaRunnerProfileManifest(profile),
    });
    if (!isCurrent() || !selectedRequest.value) return;
    selectedRequest.value = withOperation(selectedRequest.value, operation);
    successMessage.value = t("projects.qa.focus.recipeStarted");
  } catch (error) {
    if (isCurrent()) errorMessage.value = error instanceof Error ? error.message : t("projects.qa.focus.recipeError");
  } finally {
    isGeneratingRecipe.value = false;
    scheduleHarnessPoll();
  }
}

async function retryRecipeReview(input: { recipeId: string; assessmentId: string }) {
  const request = selectedRequest.value;
  const projectId = selectedProjectId.value;
  const recipe = selectedArtifactRecipes.value.find(({ id }) => id === input.recipeId) || null;
  const review = qaRecipeReviewState(recipe, request?.operations);
  if (!request || !projectId || isLoadingRequest.value || isSample.value || isRetryingRecipeReview.value || isMutating.value
    || isGeneratingRecipe.value || !review.canRetry || review.assessment?.id !== input.assessmentId) return;
  const isCurrent = captureContext(request.id);
  isRetryingRecipeReview.value = true;
  harnessPollRevision += 1;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const operation = await retryQaExecutionRecipeReview(projectId, request.id, input.recipeId, {
      assessmentId: input.assessmentId,
    });
    if (!isCurrent() || !selectedRequest.value) return;
    selectedRequest.value = withOperation(selectedRequest.value, operation);
    successMessage.value = t("projects.qa.reviewRetry.started");
    // Reload the new assessment; retain the receipt if this read fails so polling can recover.
    const detail = await fetchQaRequest(projectId, request.id).catch(() => null);
    if (detail && isCurrent()) {
      selectedRequest.value = detail;
    }
  } catch (error) {
    if (isCurrent()) {
      errorMessage.value = error instanceof Error ? error.message : t("projects.qa.reviewRetry.error");
    }
  } finally {
    isRetryingRecipeReview.value = false;
    scheduleHarnessPoll();
  }
}

async function startPlaywrightRun(input: {
  confirmProduction: boolean;
  profile: QaRunnerProfile;
  recipe: QaExecutionRecipe;
}) {
  const request = selectedRequest.value;
  const recipe = selectedArtifactRecipes.value.find(({ id }) => id === input.recipe.id) || null;
  if (!request || isRecordBusy.value || !canStartRun.value || isLoadingProfiles.value || profileLoadError.value
    || !qaRecipeReviewState(recipe, request.operations).isReviewed) return;
  const applied = await mutate(async () => (await startQaRun(selectedProjectId.value, request.id, {
    confirmProduction: input.confirmProduction,
    executionMode: "PLAYWRIGHT",
    expectedRequestVersion: request.version,
    profileKey: input.profile.key,
    recipeHash: input.recipe.recipeHash,
    recipeId: input.recipe.id,
    runnerRegistrationId: input.profile.runnerRegistrationId,
  })).request, t("projects.qa.focus.executionQueued"));
  if (applied) isRunModalOpen.value = false;
}

async function cancelExecution() {
  const request = selectedRequest.value;
  const run = latestRun.value;
  if (!request || !run || !canCancelExecution.value || isRecordBusy.value) return;
  await mutate(
    () => cancelQaExecution(selectedProjectId.value, request.id, run.id),
    t("projects.qa.focus.executionCancelled")
  );
}

async function submitReview(decision: "APPROVED" | "CHANGES_REQUESTED") {
  const request = selectedRequest.value;
  const run = latestRun.value;
  if (!request || !run || isRecordBusy.value || !canReview.value
    || (decision === "APPROVED" && missingEvidenceCount.value > 0)) return;
  await mutate(
    () => reviewQaRun(selectedProjectId.value, request.id, run.id, {
      comment: reviewComment.value.trim() || undefined,
      decision,
      expectedRunVersion: run.version,
    }),
    decision === "APPROVED" ? t("projects.qa.focus.recordApproved") : t("projects.qa.focus.changesRequested")
  );
}

async function mutate(action: () => Promise<QaRequestDetail>, success: string) {
  if (isMutating.value) return false;
  const projectId = selectedProjectId.value;
  const isCurrent = captureContext(selectedRequest.value?.id || null);
  isMutating.value = true;
  harnessPollRevision += 1;
  errorMessage.value = "";
  successMessage.value = "";
  try {
    const detail = await action();
    if (!isCurrent()) return false;
    selectedRequest.value = detail;
    const summaries = await fetchQaRequests(projectId);
    if (!isCurrent()) return false;
    requests.value = summaries;
    successMessage.value = success;
    return true;
  } catch (error) {
    if (isCurrent()) errorMessage.value = error instanceof Error ? error.message : t("projects.qa.focus.actionError");
    return false;
  } finally {
    isMutating.value = false;
    scheduleHarnessPoll();
  }
}

function withOperation(request: QaRequestDetail, operation: QaOperationReceipt | null) {
  if (!operation) return request;
  const operations = [operation, ...(request.operations || []).filter(({ operationId }) => operationId !== operation.operationId)];
  return { ...request, operations };
}

function scheduleHarnessPoll() {
  const revision = ++harnessPollRevision;
  if (harnessPollTimer) {
    window.clearTimeout(harnessPollTimer);
    harnessPollTimer = null;
  }
  const request = selectedRequest.value;
  if (isUnmounted || isLoadingRequest.value || isMutating.value || isCreatingRequest.value || isGeneratingRecipe.value || isRetryingRecipeReview.value
    || !request || isSample.value || !isQaHarnessPollingActive(request.operations || [], request.runs[0]?.executionJob)) return;
  harnessPollTimer = window.setTimeout(() => void pollHarness(revision), 1_500);
}

async function pollHarness(revision: number) {
  const request = selectedRequest.value;
  const projectId = selectedProjectId.value;
  if (!request || !projectId || revision !== harnessPollRevision) return;
  const isCurrent = captureContext(request.id);
  try {
    const refreshedOperations = await Promise.all((request.operations || []).map((operation) =>
      ["PENDING", "PROCESSING"].includes(operation.status)
        ? fetchQaOperation(projectId, operation.operationId).catch(() => operation)
        : operation
    ));
    if (revision !== harnessPollRevision || !isCurrent()) return;
    const hasTerminalChange = refreshedOperations.some((operation, index) => operation.status !== request.operations?.[index]?.status);
    const hasExecution = Boolean(request.runs[0]?.executionJob);
    if (hasTerminalChange || hasExecution || refreshedOperations.some(({ status }) => status === "SUCCEEDED")) {
      const [detail, summaries] = await Promise.all([
        fetchQaRequest(projectId, request.id),
        fetchQaRequests(projectId),
      ]);
      if (revision !== harnessPollRevision || !isCurrent()) return;
      if (detail.phase !== request.phase || detail.runs[0]?.executionJob?.status !== request.runs[0]?.executionJob?.status || hasTerminalChange) {
        successMessage.value = "";
      }
      selectedRequest.value = detail;
      requests.value = summaries;
    } else {
      selectedRequest.value = { ...request, operations: refreshedOperations };
    }
  } catch {
    // A transient poll failure does not replace the user's current record or action errors.
  } finally {
    if (revision === harnessPollRevision) scheduleHarnessPoll();
  }
}

function operationLabel(operation: QaOperationReceipt) {
  const labels: Record<QaOperationReceipt["kind"], string> = {
    CHECKLIST_GENERATION: t("projects.qa.operations.checklistGeneration"),
    CHECKLIST_REVIEW: t("projects.qa.operations.checklistReview"),
    EXECUTION_RECIPE_GENERATION: t("projects.qa.operations.recipeGeneration"),
    EXECUTION_RECIPE_REVIEW: t("projects.qa.operations.recipeReview"),
  };
  return labels[operation.kind];
}

async function openStoredEvidence(assetId: string) {
  if (!assetId || isRecordBusy.value || recordLoadError.value) return;
  const isCurrent = captureContext(selectedRequest.value?.id);
  const runId = latestRun.value?.id;
  errorMessage.value = "";
  try {
    const url = await getAssetDownloadUrl(assetId);
    if (!isCurrent() || latestRun.value?.id !== runId) return;
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    if (isCurrent() && latestRun.value?.id === runId) errorMessage.value = error instanceof Error ? error.message : t("projects.qa.focus.evidenceOpenError");
  }
}

async function refreshSelectedRequest() {
  const request = selectedRequest.value;
  if (isRecordBusy.value) return;
  if ((!request || isSample.value) && !failedRequestId.value) return loadWorkspace();
  const requestId = failedRequestId.value || request!.id;
  const projectId = selectedProjectId.value;
  const revision = ++loadRevision;
  const isCurrent = captureContext(request?.id);
  harnessPollRevision += 1;
  isLoadingRequest.value = true;
  errorMessage.value = "";
  try {
    const [detail, summaries] = await Promise.all([
      fetchQaRequest(projectId, requestId), fetchQaRequests(projectId),
    ]);
    if (!isCurrent()) return;
    selectedRequest.value = detail;
    requests.value = summaries;
    recordLoadError.value = false;
    failedRequestId.value = null;
  } catch (error) {
    if (isCurrent()) {
      recordLoadError.value = true;
      failedRequestId.value = requestId;
      errorMessage.value = error instanceof Error ? error.message : t("projects.qa.focus.loadError");
    }
  } finally {
    if (revision === loadRevision) {
      isLoadingRequest.value = false;
      scheduleHarnessPoll();
    }
  }
}

async function focusRecord() {
  await nextTick();
  recordRef.value?.focus({ preventScroll: true });
}

async function focusSection(id: string) {
  await nextTick();
  const target = document.getElementById(id);
  target?.scrollIntoView({ block: "nearest" });
  target?.focus({ preventScroll: true });
}

async function handleNextAction() {
  if (nextAction.value.disabled || isRecordBusy.value) return;
  switch (nextAction.value.action) {
    case "create": return openCreateRequest();
    case "select": return chooseArtifact();
    case "prepare": return openRunModal();
    case "refresh": return refreshSelectedRequest();
    case "connect": isConnectionModalOpen.value = true; return;
    case "review": return focusSection("qa-human-review");
    case "results": return focusSection("qa-results");
    case "evidence": {
      const row = checklistRows.value.find(({ missingRequirements }) => missingRequirements.length);
      if (row) {
        itemDetailOverrides.value[row.item.id] = true;
        await focusSection(`qa-item-${row.item.id}`);
      }
    }
  }
}

function itemDetailsOpen(row: (typeof checklistRows.value)[number]) {
  return itemDetailOverrides.value[row.item.id]
    ?? (row.result?.status === "FAIL" || row.result?.status === "BLOCKED"
      || Boolean(latestRun.value && row.missingRequirements.length));
}

function closeRequestList(event: KeyboardEvent) {
  if (event.key !== "Escape" || !isRequestListOpen.value) return;
  event.preventDefault();
  isRequestListOpen.value = false;
  listToggleRef.value?.focus();
}

function phaseLabel(phase: QaRequestPhase) {
  return t(`projects.qa.focus.phase.${phase}`);
}

function phaseTone(phase: QaRequestPhase) {
  if (phase === "APPROVED" || phase === "READY_TO_RUN") return "success";
  if (phase === "PROCESSING_FAILED") return "danger";
  if (["EVIDENCE_NEEDED", "CHANGES_REQUESTED", "CHECKLIST_REVIEW"].includes(phase)) return "warning";
  if (["RUNNING", "READY_FOR_REVIEW", "GENERATING"].includes(phase)) return "active";
  return "neutral";
}

function resultTone(item: QaChecklistItem) {
  const status = resultByItemId.value.get(item.id)?.status;
  if (status === "PASS") return "success";
  if (status === "FAIL") return "danger";
  if (status === "BLOCKED" || status === "SKIPPED") return "warning";
  return "neutral";
}

function resultLabel(item: QaChecklistItem) {
  return t(`projects.qa.focus.result.${resultByItemId.value.get(item.id)?.status || "NOT_RUN"}`);
}

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(locale.value, { numeric: "auto" });
  if (Math.abs(deltaMinutes) < 60) return formatter.format(-deltaMinutes, "minute");
  const hours = Math.round(deltaMinutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(-hours, "hour");
  return date.toLocaleDateString(locale.value);
}
</script>

<template>
  <section class="qa-workspace-page workspace-surface qa-focused-workspace">
    <header class="qa-workspace-header">
      <div><h1>{{ t('projects.qa.focus.title') }}</h1><p>{{ t('projects.qa.focus.subtitle') }}</p></div>
      <div v-if="currentUser && projects.length" class="qa-workspace-actions">
        <label class="qa-project-select">
          <span>{{ t('projects.qa.focus.project') }}</span>
          <select v-model="selectedProjectId" class="form-select">
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          </select>
        </label>
        <button class="btn btn-outline-secondary" type="button" :disabled="!selectedProject || isRecordBusy" @click="isConnectionModalOpen = true">
          {{ connectionLoadError ? t('projects.qa.focus.connections') : t('projects.qa.focus.connectionsCount', { count: connectionCount }) }}
        </button>
        <button class="btn btn-primary" type="button" :disabled="!selectedProject || isRecordBusy" @click="openCreateRequest">{{ t('projects.qa.focus.actions.create') }}</button>
      </div>
    </header>

    <section v-if="!currentUser" class="workspace-panel qa-auth-state">
      <h2>{{ t('projects.qa.focus.signInTitle') }}</h2>
      <p>{{ t('projects.qa.focus.signInBody') }}</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">{{ t('projects.qa.focus.signIn') }}</button>
    </section>
    <div v-else-if="isLoadingProjects" class="workspace-panel qa-loading" role="status">{{ t('projects.qa.focus.loadingProjects') }}</div>
    <div v-else-if="projectLoadError" class="workspace-feedback workspace-feedback--error" role="alert">
      <p>{{ projectLoadError }}</p>
      <button class="btn btn-outline-secondary" type="button" @click="emit('reload-projects')">{{ t('projects.qa.focus.actions.refresh') }}</button>
    </div>
    <section v-else-if="projects.length === 0" class="workspace-panel qa-auth-state">
      <h2>{{ t('projects.qa.focus.newProjectTitle') }}</h2>
      <p>{{ t('projects.qa.focus.newProjectBody') }}</p>
      <button class="btn btn-primary" type="button" @click="emit('new-project')">{{ t('projects.qa.focus.newProject') }}</button>
    </section>
    <template v-else>
      <details class="qa-workspace-help">
        <summary>{{ t('projects.qa.focus.help') }}</summary>
        <p>{{ t('projects.qa.focus.helpBody') }}</p>
        <p>{{ t('projects.qa.focus.connectionsNote') }}</p>
        <button class="btn btn-link" type="button" @click="emit('open-chat')">{{ t('projects.qa.focus.openChat') }}</button>
      </details>
      <details class="qa-project-overview">
        <summary>{{ t('projects.qa.focus.projectSummary') }}</summary>
        <div class="qa-status-grid">
          <article class="qa-status-card"><div><strong>{{ phaseCounts.approved }}</strong><small>{{ t('projects.qa.focus.phase.APPROVED') }}</small></div></article>
          <article class="qa-status-card"><div><strong>{{ phaseCounts.running }}</strong><small>{{ t('projects.qa.focus.phase.RUNNING') }}</small></div></article>
          <article class="qa-status-card"><div><strong>{{ phaseCounts.evidence }}</strong><small>{{ t('projects.qa.focus.phase.EVIDENCE_NEEDED') }}</small></div></article>
          <article class="qa-status-card"><div><strong>{{ phaseCounts.ready }}</strong><small>{{ t('projects.qa.focus.ready') }}</small></div></article>
        </div>
      </details>
      <div v-if="errorMessage" class="workspace-feedback workspace-feedback--error" role="alert">
        <p>{{ errorMessage }}</p>
        <button class="btn btn-outline-secondary" type="button" :disabled="isRecordBusy" @click="refreshSelectedRequest">{{ t('projects.qa.focus.actions.refresh') }}</button>
      </div>
      <p v-if="successMessage" class="workspace-feedback workspace-feedback--success" role="status">{{ successMessage }}</p>
      <div v-if="isLoading" class="workspace-panel qa-loading" role="status">{{ t('projects.qa.focus.next.loadingTitle') }}</div>
      <div v-else class="qa-control-grid">
        <section class="workspace-panel qa-request-list-panel" @keydown="closeRequestList">
          <div class="qa-section-heading">
            <h2>{{ t('projects.qa.focus.testList') }}</h2>
            <button ref="listToggleRef" class="btn btn-outline-secondary qa-list-toggle" type="button" :aria-expanded="isRequestListOpen" aria-controls="qa-request-list" @click="isRequestListOpen = !isRequestListOpen">{{ t('projects.qa.focus.chooseTest') }}</button>
            <button class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost" type="button" :disabled="isRecordBusy" :aria-label="t('projects.qa.focus.refreshTests')" @click="loadWorkspace">↻</button>
          </div>
          <p v-if="isSample" class="qa-sample-note">{{ t('projects.qa.focus.sampleNote') }}</p>
          <div id="qa-request-list" class="qa-request-list" :class="{ 'qa-request-list--open': isRequestListOpen }">
            <button v-for="request in displayedRequests" :key="request.id" class="qa-request-row"
              :class="{ 'qa-request-row--active': selectedRequest?.id === request.id }"
              :aria-current="selectedRequest?.id === request.id ? 'true' : undefined"
              :disabled="isMutating || isCreatingRequest || isGeneratingRecipe || isRetryingRecipeReview"
              type="button" @click="openRequest(request)">
              <span class="qa-request-row__top"><strong>{{ request.title }}</strong><span class="qa-status" :class="`qa-status--${phaseTone(request.phase)}`">{{ phaseLabel(request.phase) }}</span></span>
              <span class="qa-request-row__objective">{{ request.objective }}</span>
              <span class="qa-request-row__meta">{{ t('projects.qa.focus.updated', { time: formatRelative(request.updatedAt) }) }}</span>
            </button>
          </div>
        </section>
        <section ref="recordRef" class="workspace-panel qa-record-panel" tabindex="-1" :aria-busy="isLoadingRequest">
          <header v-if="selectedRequest" class="qa-record-header">
            <div>
              <div class="qa-record-title-line">
                <h2>{{ selectedRequest.title }}</h2>
                <span v-if="isSample" class="qa-status qa-status--active">{{ t('projects.qa.focus.sample') }}</span>
                <span class="qa-status" :class="`qa-status--${phaseTone(selectedRequest.phase)}`">{{ phaseLabel(selectedRequest.phase) }}</span>
              </div>
              <p>{{ selectedRequest.objective }}</p>
            </div>
          </header>
          <div v-if="selectedRequest" class="qa-record-metadata">
            <span><small>{{ t('projects.qa.focus.target') }}</small><bdi>{{ selectedRequest.target || t('projects.qa.focus.unspecified') }}</bdi></span>
            <span><small>{{ t('projects.qa.focus.environment') }}</small>{{ selectedRequest.environment || t('projects.qa.focus.unspecified') }}</span>
          </div>
          <section class="qa-next-action" :class="`qa-next-action--${nextAction.tone}`" aria-live="polite">
            <div class="qa-next-action__copy">
              <h3>{{ t(nextAction.titleKey) }}</h3><p>{{ t(nextAction.messageKey) }}</p>
            </div>
            <div v-if="nextAction.actionKey" class="qa-next-action__actions">
              <button class="btn btn-primary" type="button" :disabled="nextAction.disabled || isRecordBusy" @click="handleNextAction">{{ t(nextAction.actionKey) }}</button>
            </div>
          </section>
          <div v-if="selectedRequest && !isSample" class="qa-record-tools">
            <button v-if="canStartRun" class="btn btn-outline-secondary" type="button" :disabled="isRecordBusy" @click="beginAgentRun">{{ t('projects.qa.focus.agentRun') }}</button>
            <button v-if="canCancelExecution" class="btn btn-outline-danger" type="button" :disabled="isRecordBusy" @click="cancelExecution">{{ t('projects.qa.focus.cancelRun') }}</button>
            <button v-if="nextAction.action !== 'refresh'" class="btn btn-link" type="button" :disabled="isRecordBusy" @click="refreshSelectedRequest">{{ t('projects.qa.focus.actions.refresh') }}</button>
          </div>
          <section v-if="currentOperations.length" class="qa-operation-stack" aria-labelledby="qa-current-operations-title" aria-live="polite">
            <h2 id="qa-current-operations-title" class="qa-operation-heading">{{ t('projects.qa.operations.currentTitle') }}</h2>
            <article v-for="operation in currentOperations" :key="operation.operationId" class="qa-operation-banner" :class="`qa-operation-banner--${qaOperationPresentation(operation).tone}`">
              <span class="qa-operation-indicator" :class="{ 'qa-operation-indicator--spinning': ['PENDING', 'PROCESSING'].includes(operation.status) }" aria-hidden="true">↻</span>
              <div><strong>{{ operationLabel(operation) }}</strong><small>{{ qaOperationPresentation(operation).message }}</small></div>
              <span class="qa-status" :class="`qa-status--${qaOperationPresentation(operation).tone}`">{{ operation.status }}</span>
            </article>
          </section>
          <section v-if="executionStatus && latestExecutionJob" class="qa-execution-progress" :class="`qa-execution-progress--${executionStatus.tone}`">
            <div><strong>{{ t(`projects.qa.focus.execution.${latestExecutionJob.status}`) }}</strong>
              <p>{{ latestExecutionJob.failureMessage || t(`projects.qa.focus.execution.${latestExecutionJob.status}Body`) }}</p></div>
            <div v-if="['QUEUED', 'CLAIMED', 'RUNNING'].includes(latestExecutionJob.status) || latestExecutionJob.totalItems > 0"
              class="qa-execution-progress__meter" :class="{ 'qa-execution-progress__meter--indeterminate': !latestExecutionJob.totalItems }"
              role="progressbar" :aria-label="t('projects.qa.focus.progress')" :aria-valuemin="0"
              :aria-valuemax="latestExecutionJob.totalItems || undefined"
              :aria-valuenow="latestExecutionJob.totalItems ? latestExecutionJob.completedItems : undefined">
              <span :style="latestExecutionJob.totalItems ? { width: `${Math.min(100, Math.max(0, (latestExecutionJob.completedItems / latestExecutionJob.totalItems) * 100))}%` } : undefined"></span>
            </div>
            <small v-if="latestExecutionJob.totalItems">{{ t('projects.qa.focus.progressCount', { completed: latestExecutionJob.completedItems, total: latestExecutionJob.totalItems }) }}</small>
            <code v-if="latestExecutionJob.failureCode">{{ latestExecutionJob.failureCode }}</code>
          </section>
          <section v-if="latestAssessment && latestAssessment.status !== 'PASSED'" class="qa-assessment" :class="`qa-assessment--${latestAssessment.status.toLowerCase()}`">
            <div><strong>{{ t('projects.qa.focus.checklistAssessment') }} · {{ latestAssessment.status }}</strong>
              <p>{{ latestAssessment.summary || t('projects.qa.focus.advisoryAssessment') }}</p></div>
            <ul v-if="latestAssessment.suggestions.length">
              <li v-for="(suggestion, index) in latestAssessment.suggestions" :key="index"><b>{{ suggestion.severity || 'INFO' }}</b> {{ suggestion.message }}</li>
            </ul>
          </section>

          <section v-if="selectedRequest" id="qa-results" class="qa-checklist-section" tabindex="-1">
            <div class="qa-section-heading">
              <div><span class="qa-eyebrow">{{ t('projects.qa.focus.revision', { number: selectedArtifact?.revision || 0 }) }}</span>
                <h3>{{ selectedArtifact?.title || t('projects.qa.focus.waitingChecklist') }}</h3></div>
              <span v-if="selectedArtifact" class="qa-artifact-origin">{{ t(selectedArtifact.origin === 'ODDPATH_GENERATED' ? 'projects.qa.focus.generated' : 'projects.qa.focus.agentProvided') }}</span>
            </div>
            <div class="qa-proof-summary">
              <span class="qa-status" :class="!latestRun ? 'qa-status--neutral' : missingEvidenceCount ? 'qa-status--warning' : 'qa-status--success'">{{ evidenceLabel }}</span>
              <p>{{ t('projects.qa.focus.proofNote') }}</p>
            </div>
            <div v-if="selectedArtifact" class="qa-checklist-list">
              <article v-for="row in checklistRows" :id="`qa-item-${row.item.id}`" :key="row.item.id" class="qa-focused-checklist-item" tabindex="-1">
                <div class="qa-check-result-heading">
                  <span class="qa-checklist-index">{{ String(row.item.ordinal + 1).padStart(2, '0') }}</span>
                  <h4>{{ row.item.title }}</h4><span v-if="row.item.priority" class="qa-priority">{{ row.item.priority }}</span>
                  <span class="qa-status" :class="`qa-status--${resultTone(row.item)}`">{{ resultLabel(row.item) }}</span>
                </div>
                <p class="qa-check-expected">{{ row.item.expectedResult }}</p>
                <details class="qa-check-details" :open="itemDetailsOpen(row)">
                  <summary @click.prevent="itemDetailOverrides[row.item.id] = !itemDetailsOpen(row)">{{ t('projects.qa.focus.checkDetails', { count: row.evidence.length }) }}</summary>
                  <div v-if="row.result?.observedResult" class="qa-observed-result"><strong>{{ t('projects.qa.focus.observed') }}</strong><p>{{ row.result.observedResult }}</p></div>
                  <div v-if="row.result?.notes" class="qa-observed-result"><strong>{{ t('projects.qa.focus.notes') }}</strong><p>{{ row.result.notes }}</p></div>
                  <div v-if="row.missingRequirements.length" class="qa-missing-evidence">
                    <strong>{{ t('projects.qa.focus.missingTitle') }}</strong><p>{{ t('projects.qa.focus.missingBody') }}</p>
                    <ul><li v-for="requirement in row.missingRequirements" :key="requirement.id">{{ requirement.kind }} · {{ requirement.description }}</li></ul>
                  </div>
                  <template v-if="row.item.preconditions.length"><h5>{{ t('projects.qa.focus.preconditions') }}</h5><ul><li v-for="(condition, index) in row.item.preconditions" :key="index">{{ condition }}</li></ul></template>
                  <template v-if="row.item.steps.length"><h5>{{ t('projects.qa.focus.steps') }}</h5><ol><li v-for="(step, index) in row.item.steps" :key="index">{{ step }}</li></ol></template>
                  <div v-if="row.item.evidenceRequirements.length" class="qa-evidence-requirements">
                    <span v-for="requirement in row.item.evidenceRequirements" :key="requirement.id">{{ requirement.kind }} · {{ requirement.description }} · {{ t(requirement.required ? 'projects.qa.focus.required' : 'projects.qa.focus.optional') }}</span>
                  </div>
                  <QaEvidenceCard v-for="evidence in row.evidence" :key="evidence.id" :evidence="evidence" :disabled="isRecordBusy" @open="openStoredEvidence" />
                </details>
              </article>
            </div>
            <section v-if="generalEvidence.length" class="qa-general-evidence">
              <h3>{{ t('projects.qa.focus.runEvidence') }}</h3><p>{{ t('projects.qa.focus.runEvidenceBody') }}</p>
              <QaEvidenceCard v-for="evidence in generalEvidence" :key="evidence.id" :evidence="evidence" :disabled="isRecordBusy" @open="openStoredEvidence" />
            </section>
          </section>

          <section v-if="canReview" id="qa-human-review" class="qa-human-review" tabindex="-1">
            <div><span class="qa-eyebrow">{{ t('projects.qa.focus.humanReview') }}</span><h3>{{ t('projects.qa.focus.reviewTitle') }}</h3><p>{{ t('projects.qa.focus.reviewBody') }}</p></div>
            <label for="qa-review-comment">{{ t('projects.qa.focus.reviewNote') }}</label>
            <textarea id="qa-review-comment" v-model="reviewComment" class="form-control" :disabled="isRecordBusy" maxlength="10000"></textarea>
            <div class="qa-human-review__actions">
              <button class="btn btn-outline-secondary" type="button" :disabled="isRecordBusy" @click="submitReview('CHANGES_REQUESTED')">{{ t('projects.qa.focus.requestChanges') }}</button>
              <button class="btn btn-primary" type="button" :disabled="isRecordBusy || missingEvidenceCount > 0" @click="submitReview('APPROVED')">{{ t('projects.qa.focus.approveRecord') }}</button>
            </div>
          </section>
          <details v-if="selectedRequest" :key="`details-${selectedRequest.id}`" class="qa-record-details">
            <summary>{{ t('projects.qa.focus.technicalDetails') }}</summary>
            <p>{{ t('projects.qa.focus.selectionNote') }}</p>
            <p v-if="profileLoadError" role="alert">{{ profileLoadError }}</p>
            <div class="qa-harness-facts">
              <span><small>{{ t('projects.qa.focus.runnerProfiles') }}</small><strong>{{ profileLoadError ? t('projects.qa.focus.unavailable') : t('projects.qa.focus.onlineCount', { count: onlineRunnerProfiles.length }) }}</strong></span>
              <span><small>{{ t('projects.qa.focus.context') }}</small><strong>{{ selectedRequest.contextSnapshots[0]?.retrievalMode || 'NONE' }}</strong></span>
              <span><small>{{ t('projects.qa.focus.latestRun') }}</small><strong>{{ latestRun?.sourceLabel || t('projects.qa.focus.notStarted') }}</strong></span>
            </div>
            <p v-if="latestExecutionJob"><bdi>{{ latestExecutionJob.id }}</bdi> · {{ latestExecutionJob.profileKey }}</p>
            <div v-for="recipe in selectedArtifactRecipes" :key="recipe.id" class="qa-evidence-item">
              <strong>{{ t('projects.qa.focus.revision', { number: recipe.revision }) }} · {{ recipe.title }}</strong>
              <p>{{ recipe.assessments[0]?.status || t('projects.qa.focus.notStarted') }}</p><code>{{ recipe.recipeHash }}</code>
            </div>
          </details>
          <details v-if="selectedRequest" :key="`history-${selectedRequest.id}`" class="qa-record-history">
            <summary>{{ t('projects.qa.focus.history') }} · {{ selectedRequest.events.length }}</summary>
            <article v-for="review in selectedRequest.reviews" :key="review.id" class="qa-evidence-item">
              <strong>{{ t('projects.qa.focus.humanReview') }} · {{ review.decision }}</strong>
              <p v-if="review.comment">{{ review.comment }}</p>
              <small>{{ formatRelative(review.createdAt) }} · {{ review.runId }}</small>
            </article>
            <article v-for="operation in completedOperations" :key="operation.operationId" class="qa-operation-banner">
              <div><strong>{{ operationLabel(operation) }}</strong><small>{{ qaOperationPresentation(operation).message }}</small><small>{{ operation.operationId }}</small></div>
              <span class="qa-status qa-status--success">{{ operation.status }}</span>
            </article>
            <section v-if="operationGroups.earlier.length" class="qa-operation-history">
              <h3>{{ t('projects.qa.operations.earlierTitle', { count: operationGroups.earlier.length }) }}</h3>
              <p>{{ t('projects.qa.operations.historyNote') }}</p>
              <article v-for="operation in operationGroups.earlier" :key="operation.operationId" class="qa-operation-banner">
                <div><strong>{{ operationLabel(operation) }}</strong><small>{{ qaOperationPresentation(operation, true).message }}</small><small>{{ operation.operationId }}</small></div>
                <span class="qa-status qa-status--neutral">{{ operation.status }}</span>
              </article>
            </section>
            <ol class="qa-timeline"><li v-for="event in selectedRequest.events.slice().reverse()" :key="event.id"><span></span><div><strong>{{ event.type.replaceAll('_', ' ') }}</strong><small>{{ event.transport }} · {{ formatRelative(event.createdAt) }}</small></div></li></ol>
          </details>
        </section>
      </div>
    </template>
    <QaRequestFormModal :error-message="requestModalError" :is-open="isRequestModalOpen" :is-saving="isCreatingRequest" @cancel="isRequestModalOpen = false" @save="saveRequest" />
    <QaConnectionModal v-if="isConnectionModalOpen && selectedProject" appearance="tests" :project-id="selectedProject.id" :project-name="selectedProject.name" @changed="handleConnectionsChanged" @close="isConnectionModalOpen = false" />
    <QaPlaywrightRunModal v-if="selectedArtifact" :artifact="selectedArtifact" :is-generating="isGeneratingRecipe" :is-loading-profiles="isLoadingProfiles"
      :profile-load-error="profileLoadError" :is-open="isRunModalOpen" :is-retrying-review="isRetryingRecipeReview" :is-saving="isMutating"
      :operations="selectedRequest?.operations || []" :profiles="runnerProfiles" :recipes="selectedRequest?.executionRecipes || []"
      @close="isRunModalOpen = false" @connect="openRunnerConnection" @generate="generateRecipe" @refresh="loadRunnerProfiles"
      @retry-review="retryRecipeReview" @start="startPlaywrightRun" />
  </section>
</template>
