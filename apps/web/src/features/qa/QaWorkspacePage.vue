<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { useI18n } from "../../i18n/useI18n";
import { getAssetDownloadUrl } from "../assets/assetsApi";
import type { AuthUser } from "../auth/types";
import type { Project } from "../projects/types";
import QaConnectionModal from "./components/QaConnectionModal.vue";
import QaPlaywrightRunModal from "./components/QaPlaywrightRunModal.vue";
import QaRequestFormModal from "./components/QaRequestFormModal.vue";
import {
  isQaHarnessPollingActive,
  qaExecutionStatusPresentation,
  qaOperationGroups,
  qaOperationPresentation,
  qaRecipeCoverage,
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
  QaEvidence,
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
  "sign-in": [];
}>();

const selectedProjectId = ref("");
const requests = ref<QaRequestSummary[]>([]);
const selectedRequest = ref<QaRequestDetail | null>(null);
const isLoading = ref(false);
const isLoadingRequest = ref(false);
const errorMessage = ref("");
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
const { t } = useI18n();
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
const latestRecipe = computed<QaExecutionRecipe | null>(() => selectedArtifactRecipes.value[0] || null);
const latestRecipeAssessment = computed(() => latestRecipe.value?.assessments[0] || null);
const activeOperations = computed(() => (selectedRequest.value?.operations || []).filter(
  ({ status }) => status === "PENDING" || status === "PROCESSING"
));
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
    !isSample.value
  );
});
const canStartRun = computed(() => Boolean(
  selectedRequest.value &&
  ["READY_TO_RUN", "CHANGES_REQUESTED"].includes(selectedRequest.value.phase) &&
  selectedRequest.value.selectedArtifactId &&
  !isSample.value
));
const canCancelExecution = computed(() => Boolean(
  latestRun.value?.executionMode === "PLAYWRIGHT"
  && latestExecutionJob.value
  && ["QUEUED", "CLAIMED", "RUNNING"].includes(latestExecutionJob.value.status)
  && !isSample.value
));
const canReview = computed(() => Boolean(
  selectedRequest.value?.phase === "READY_FOR_REVIEW" &&
  latestRun.value?.status === "RESULTS_SUBMITTED" &&
  !isSample.value
));

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
  successMessage.value = "";
  reviewComment.value = "";
  selectedRequest.value = null;
  requests.value = [];
  runnerProfiles.value = [];
  connectionCount.value = 0;
  isLoading.value = Boolean(projectId && props.currentUser);
  if (!isLoading.value) return;
  try {
    const [loadedRequests, connections, profiles] = await Promise.all([
      fetchQaRequests(projectId),
      fetchProjectConnections(projectId).catch(() => []),
      fetchQaRunnerProfiles(projectId).catch(() => []),
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
      errorMessage.value = error instanceof Error ? error.message : "Could not load the QA Workspace.";
    }
  } finally {
    if (revision === loadRevision) isLoading.value = false;
  }
}

async function openRequest(request: QaRequestSummary) {
  if (request.id.startsWith("sample-")) return;
  if (request.id === selectedRequest.value?.id) {
    // The displayed row can be selected again while another detail is still
    // loading. That click cancels the pending selection, not the current record.
    if (isLoadingRequest.value) {
      loadRevision += 1;
      isLoadingRequest.value = false;
      scheduleHarnessPoll();
    }
    return;
  }
  const projectId = selectedProjectId.value;
  const revision = ++loadRevision;
  const isCurrent = captureContext();
  isLoading.value = false;
  isLoadingRequest.value = true;
  errorMessage.value = "";
  try {
    const detail = await fetchQaRequest(projectId, request.id);
    if (isCurrent()) selectedRequest.value = detail;
  } catch (error) {
    if (isCurrent()) errorMessage.value = error instanceof Error ? error.message : "Could not load this QA Request.";
  } finally {
    if (revision === loadRevision) isLoadingRequest.value = false;
  }
}

function openCreateRequest() {
  if (!selectedProject.value) return;
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
    isCurrent = captureContext(created.request.id);
    const summaries = await fetchQaRequests(projectId);
    if (!isCurrent()) return;
    requests.value = summaries;
    successMessage.value = created.request.phase === "PROCESSING_FAILED"
      ? "QA Request saved. Checklist generation needs attention."
      : created.operation
        ? "QA Request created. Oddpath is generating its checklist in the background."
        : "QA Request created.";
  } catch (error) {
    if (isCurrent()) requestModalError.value = error instanceof Error ? error.message : "Could not create this QA Request.";
  } finally {
    isCreatingRequest.value = false;
    scheduleHarnessPoll();
  }
}

async function chooseArtifact() {
  const request = selectedRequest.value;
  const artifact = selectedArtifact.value;
  if (!request || !artifact || isMutating.value) return;
  await mutate(async () => selectQaArtifact(
    selectedProjectId.value,
    request.id,
    artifact.id,
    request.version
  ), "QA Checklist selected and ready for an agent run.");
}

async function beginAgentRun() {
  const request = selectedRequest.value;
  if (!request || isMutating.value) return;
  await mutate(async () => (await startQaRun(selectedProjectId.value, request.id)).request,
    "QA Run started. Connect an agent to record results and evidence.");
}

async function openRunModal() {
  if (!canStartRun.value) return;
  isRunModalOpen.value = true;
  await loadRunnerProfiles();
}

async function loadRunnerProfiles() {
  const projectId = selectedProjectId.value;
  if (!projectId || isLoadingProfiles.value) return;
  const isCurrent = captureContext();
  const revision = ++profileLoadRevision;
  isLoadingProfiles.value = true;
  try {
    const profiles = await fetchQaRunnerProfiles(projectId);
    if (isCurrent() && revision === profileLoadRevision) runnerProfiles.value = profiles;
  } catch (error) {
    if (isCurrent() && revision === profileLoadRevision) {
      errorMessage.value = error instanceof Error ? error.message : "Could not discover Playwright Runner profiles.";
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
  void loadRunnerProfiles();
}

async function generateRecipe(profile: QaRunnerProfile) {
  const request = selectedRequest.value;
  const artifact = selectedArtifact.value;
  const projectId = selectedProjectId.value;
  if (!request || !artifact || isGeneratingRecipe.value || isRetryingRecipeReview.value) return;
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
    successMessage.value = "Execution Recipe generation started. You can keep this screen open while Oddpath reviews it.";
  } catch (error) {
    if (isCurrent()) errorMessage.value = error instanceof Error ? error.message : "Could not generate this Execution Recipe.";
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
  if (!request || !projectId || isSample.value || isRetryingRecipeReview.value || isMutating.value
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
  if (!request || isMutating.value || isRetryingRecipeReview.value
    || !qaRecipeReviewState(recipe, request.operations).isReviewed) return;
  const applied = await mutate(async () => (await startQaRun(selectedProjectId.value, request.id, {
    confirmProduction: input.confirmProduction,
    executionMode: "PLAYWRIGHT",
    expectedRequestVersion: request.version,
    profileKey: input.profile.key,
    recipeHash: input.recipe.recipeHash,
    recipeId: input.recipe.id,
    runnerRegistrationId: input.profile.runnerRegistrationId,
  })).request, "Playwright execution queued. The selected Runner can now claim this exact Recipe.");
  if (applied) isRunModalOpen.value = false;
}

async function cancelExecution() {
  const request = selectedRequest.value;
  const run = latestRun.value;
  if (!request || !run || !canCancelExecution.value || isMutating.value) return;
  await mutate(
    () => cancelQaExecution(selectedProjectId.value, request.id, run.id),
    "Playwright execution cancelled. Its partial history is preserved."
  );
}

async function submitReview(decision: "APPROVED" | "CHANGES_REQUESTED") {
  const request = selectedRequest.value;
  const run = latestRun.value;
  if (!request || !run || isMutating.value) return;
  await mutate(
    () => reviewQaRun(selectedProjectId.value, request.id, run.id, {
      comment: reviewComment.value.trim() || undefined,
      decision,
      expectedRunVersion: run.version,
    }),
    decision === "APPROVED" ? "QA record approved." : "Changes requested. A new run can now be started."
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
    if (isCurrent()) errorMessage.value = error instanceof Error ? error.message : "Oddpath could not complete this action.";
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
  if (isUnmounted || isMutating.value || isCreatingRequest.value || isGeneratingRecipe.value || isRetryingRecipeReview.value
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

async function openStoredEvidence(evidence: QaEvidence) {
  const assetId = evidence.assets[0]?.asset.id;
  if (!assetId) return;
  errorMessage.value = "";
  try {
    const url = await getAssetDownloadUrl(assetId);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) errorMessage.value = "Your browser blocked the evidence tab.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not open this evidence.";
  }
}

function safeExternalEvidenceUrl(value: string | null) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch {
    return "";
  }
}

function phaseLabel(phase: QaRequestPhase) {
  const labels: Record<QaRequestPhase, string> = {
    APPROVED: "Approved",
    CANCELLED: "Cancelled",
    CHANGES_REQUESTED: "Changes requested",
    CHECKLIST_REVIEW: "Checklist review",
    DRAFT: "Draft",
    EVIDENCE_NEEDED: "Evidence needed",
    GENERATING: "Generating",
    PROCESSING_FAILED: "Needs attention",
    READY_FOR_REVIEW: "Human review",
    READY_TO_RUN: "Ready to run",
    RUNNING: "Running",
  };
  return labels[phase];
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
  return resultByItemId.value.get(item.id)?.status || "NOT RUN";
}

function formatRelative(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMinutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (Math.abs(deltaMinutes) < 1) return "now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}
</script>

<template>
  <section class="qa-workspace-page">
    <header class="qa-workspace-header">
      <div>
        <span class="qa-eyebrow">QA control plane</span>
        <h1>Workspace</h1>
        <p>Operational QA records for humans and agents.</p>
      </div>

      <div v-if="currentUser && projects.length > 0" class="qa-workspace-actions">
        <label class="qa-project-select">
          <span>Project</span>
          <select v-model="selectedProjectId" class="form-select">
            <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
          </select>
        </label>
        <button class="btn btn-outline-secondary" type="button" :disabled="!selectedProject" @click="isConnectionModalOpen = true">
          <span class="qa-connection-dot" :class="{ 'qa-connection-dot--active': connectionCount > 0 }"></span>
          {{ connectionCount > 0 ? `${connectionCount} agent connection${connectionCount === 1 ? '' : 's'}` : "Connect agent" }}
        </button>
        <button class="btn btn-primary" type="button" :disabled="!selectedProject" @click="openCreateRequest">+ Create QA Request</button>
      </div>
    </header>

    <section v-if="!currentUser" class="workspace-panel qa-auth-state">
      <span class="qa-eyebrow">Persistent QA, not another chat</span>
      <h2>Turn agent work into reviewable QA records.</h2>
      <p>Sign in to coordinate Codex, Claude, or any other agent through checklists, evidence, status, history, and Human Review.</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">Sign in to Oddpath</button>
    </section>

    <section v-else-if="!isLoadingProjects && projects.length === 0" class="workspace-panel qa-auth-state">
      <span class="qa-eyebrow">Start with project context</span>
      <h2>Create a Project before your first QA Request.</h2>
      <p>Project Instructions, Project Memory, and indexed documents become a locked context snapshot for every checklist.</p>
      <button class="btn btn-primary" type="button" @click="emit('new-project')">Create Project</button>
    </section>

    <template v-else-if="currentUser">
      <section class="qa-value-strip">
        <div>
          <span class="qa-eyebrow">Why Oddpath</span>
          <h2>Agents execute. Oddpath keeps the record.</h2>
        </div>
        <div class="qa-value-points">
          <span><b>01</b> Immutable checklist</span>
          <span><b>02</b> Required evidence</span>
          <span><b>03</b> Human decision + history</span>
        </div>
        <button class="btn btn-link" type="button" @click="emit('open-chat')">Open QA Chat →</button>
      </section>

      <p v-if="projectLoadError || errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
        {{ projectLoadError || errorMessage }}
      </p>
      <p v-if="successMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">{{ successMessage }}</p>

      <section v-if="operationGroups.current.length" class="qa-operation-stack" aria-labelledby="qa-current-operations-title" aria-live="polite">
        <h2 id="qa-current-operations-title" class="qa-operation-heading">{{ t('projects.qa.operations.currentTitle') }}</h2>
        <article
          v-for="operation in operationGroups.current"
          :key="operation.operationId"
          class="qa-operation-banner"
          :class="`qa-operation-banner--${qaOperationPresentation(operation).tone}`"
        >
          <span class="qa-operation-indicator" :class="{ 'qa-operation-indicator--spinning': ['PENDING', 'PROCESSING'].includes(operation.status) }">↻</span>
          <div><strong>{{ operationLabel(operation) }}</strong><small>{{ qaOperationPresentation(operation).message }}</small></div>
          <span class="qa-status" :class="`qa-status--${qaOperationPresentation(operation).tone}`">{{ operation.status }}</span>
        </article>
      </section>
      <details v-if="operationGroups.earlier.length" :key="selectedRequest?.id" class="qa-operation-history">
        <summary>{{ t('projects.qa.operations.earlierTitle', { count: operationGroups.earlier.length }) }}</summary>
        <p>{{ t('projects.qa.operations.historyNote') }}</p>
        <div class="qa-operation-stack">
          <article v-for="operation in operationGroups.earlier" :key="operation.operationId" class="qa-operation-banner">
            <span class="qa-operation-indicator" aria-hidden="true">↻</span>
            <div><strong>{{ operationLabel(operation) }}</strong><small>{{ qaOperationPresentation(operation, true).message }}</small></div>
            <span class="qa-status qa-status--neutral">{{ operation.status }}</span>
          </article>
        </div>
      </details>

      <div class="qa-status-grid" aria-label="QA Request status summary">
        <article class="qa-status-card"><span class="qa-status-icon qa-status-icon--success">✓</span><div><strong>{{ phaseCounts.approved }}</strong><small>Approved</small></div></article>
        <article class="qa-status-card"><span class="qa-status-icon qa-status-icon--active">→</span><div><strong>{{ phaseCounts.running }}</strong><small>Running</small></div></article>
        <article class="qa-status-card"><span class="qa-status-icon qa-status-icon--warning">!</span><div><strong>{{ phaseCounts.evidence }}</strong><small>Evidence needed</small></div></article>
        <article class="qa-status-card"><span class="qa-status-icon">□</span><div><strong>{{ phaseCounts.ready }}</strong><small>Ready</small></div></article>
      </div>

      <div v-if="isLoading" class="workspace-panel qa-loading">Loading QA Workspace…</div>

      <div v-else class="qa-control-grid">
        <section class="workspace-panel qa-request-list-panel">
          <div class="qa-section-heading">
            <div><span class="qa-eyebrow">Primary object</span><h2>QA Requests</h2></div>
            <button class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost" type="button" aria-label="Refresh QA Requests" @click="loadWorkspace">↻</button>
          </div>
          <p v-if="isSample" class="qa-sample-note"><strong>Interactive sample</strong> · Nothing was written to your project.</p>
          <div class="qa-request-list">
            <button
              v-for="request in displayedRequests"
              :key="request.id"
              class="qa-request-row"
              :class="{ 'qa-request-row--active': selectedRequest?.id === request.id }"
              type="button"
              @click="openRequest(request)"
            >
              <span class="qa-request-row__top">
                <strong>{{ request.title }}</strong>
                <span class="qa-status" :class="`qa-status--${phaseTone(request.phase)}`">{{ phaseLabel(request.phase) }}</span>
              </span>
              <span class="qa-request-row__objective">{{ request.objective }}</span>
              <span class="qa-request-row__meta">Updated {{ formatRelative(request.updatedAt) }}</span>
            </button>
          </div>
          <button v-if="isSample" class="btn btn-primary w-100" type="button" @click="openCreateRequest">Create your first QA Request</button>
        </section>

        <section class="workspace-panel qa-record-panel" :aria-busy="isLoadingRequest">
          <template v-if="selectedRequest">
            <header class="qa-record-header">
              <div>
                <div class="qa-record-title-line">
                  <h2>{{ selectedRequest.title }}</h2>
                  <span v-if="isSample" class="qa-status qa-status--active">Sample</span>
                  <span class="qa-status" :class="`qa-status--${phaseTone(selectedRequest.phase)}`">{{ phaseLabel(selectedRequest.phase) }}</span>
                </div>
                <p>{{ selectedRequest.objective }}</p>
              </div>
              <div class="qa-record-actions">
                <button v-if="canSelectArtifact" class="btn btn-primary" type="button" :disabled="isMutating" @click="chooseArtifact">Select checklist</button>
                <template v-if="canStartRun">
                  <button class="btn btn-primary" type="button" :disabled="isMutating" @click="openRunModal">
                    {{ latestExecutionJob?.status === "FAILED" || latestExecutionJob?.status === "CANCELLED" ? "Retry with Playwright" : "Run with Playwright" }}
                  </button>
                  <button class="btn btn-outline-secondary" type="button" :disabled="isMutating" @click="beginAgentRun">Start agent run</button>
                </template>
                <button v-if="canCancelExecution" class="btn btn-outline-danger" type="button" :disabled="isMutating" @click="cancelExecution">Cancel execution</button>
                <button v-if="isSample" class="btn btn-primary" type="button" @click="openCreateRequest">Create real request</button>
              </div>
            </header>

            <div class="qa-record-metadata">
              <span><small>Target</small>{{ selectedRequest.target || "Not specified" }}</span>
              <span><small>Environment</small>{{ selectedRequest.environment || "Not specified" }}</span>
              <span><small>Context</small>{{ selectedRequest.contextSnapshots[0]?.retrievalMode || "None" }}</span>
              <span><small>Latest run</small>{{ latestRun?.sourceLabel || "Not started" }}</span>
            </div>

            <section class="qa-harness-panel">
              <div class="qa-harness-panel__intro">
                <span class="qa-eyebrow">Execution Harness</span>
                <h3>Approve the Recipe. Your Runner executes it.</h3>
                <p>Oddpath binds the immutable checklist, exact Recipe hash, public Runner profile, results, and evidence into one reviewable record.</p>
              </div>
              <div class="qa-harness-facts">
                <span><small>Runner profiles</small><strong>{{ onlineRunnerProfiles.length }} online</strong></span>
                <span><small>Execution Recipe</small><strong>{{ latestRecipe ? `Revision ${latestRecipe.revision}` : "Not created" }}</strong></span>
                <span><small>Recipe review</small><strong>{{ latestRecipeAssessment?.status || "Not started" }}</strong></span>
              </div>
              <div class="qa-harness-panel__action">
                <template v-if="latestRecipe">
                  <small>{{ qaRecipeCoverage(latestRecipe) }} · <code>{{ latestRecipe.recipeHash.slice(0, 10) }}…</code></small>
                  <button v-if="canStartRun" class="btn btn-outline-secondary" type="button" @click="openRunModal">Review exact run</button>
                </template>
                <button v-else-if="canStartRun" class="btn btn-outline-secondary" type="button" @click="openRunModal">Create Execution Recipe</button>
                <small v-else>Select and lock a checklist before creating an Execution Recipe.</small>
              </div>
            </section>

            <section v-if="executionStatus && latestExecutionJob" class="qa-execution-progress" :class="`qa-execution-progress--${executionStatus.tone}`">
              <div>
                <span class="qa-eyebrow">Playwright execution</span>
                <strong>{{ executionStatus.label }}</strong>
                <p>{{ executionStatus.message }}</p>
              </div>
              <div class="qa-execution-progress__meter" :aria-label="`${latestExecutionJob.completedItems} of ${latestExecutionJob.totalItems} checklist items complete`">
                <span :style="{ width: latestExecutionJob.totalItems ? `${Math.round((latestExecutionJob.completedItems / latestExecutionJob.totalItems) * 100)}%` : '8%' }"></span>
              </div>
              <small>Profile {{ latestExecutionJob.profileKey }} · Execution {{ latestExecutionJob.id.slice(0, 10) }}…</small>
              <div v-if="latestExecutionJob.status === 'FAILED'" class="qa-execution-progress__actions">
                <span>{{ latestExecutionJob.failureCode || "RUNNER_EXECUTION_FAILED" }}</span>
                <button v-if="canStartRun" class="btn btn-sm btn-outline-secondary" type="button" @click="openRunModal">Review & retry</button>
              </div>
            </section>

            <section v-if="latestAssessment && latestAssessment.status !== 'PASSED'" class="qa-assessment" :class="`qa-assessment--${latestAssessment.status.toLowerCase()}`">
              <div>
                <strong>Oddpath checklist assessment · {{ latestAssessment.status }}</strong>
                <p>{{ latestAssessment.summary || (latestAssessment.status === 'FAILED' ? 'Automated assessment was unavailable. The owner may still inspect and select this candidate.' : 'Review these suggestions before selecting a revision.') }}</p>
              </div>
              <ul v-if="latestAssessment.suggestions.length > 0">
                <li v-for="suggestion in latestAssessment.suggestions" :key="suggestion.code || suggestion.message">
                  <b>{{ suggestion.severity || "INFO" }}</b> {{ suggestion.message }}
                </li>
              </ul>
            </section>

            <section class="qa-checklist-section">
              <div class="qa-section-heading">
                <div>
                  <span class="qa-eyebrow">Artifact · Revision {{ selectedArtifact?.revision || 0 }}</span>
                  <h3>{{ selectedArtifact?.title || "Waiting for a QA Checklist" }}</h3>
                </div>
                <span v-if="selectedArtifact" class="qa-artifact-origin">{{ selectedArtifact.origin === 'ODDPATH_GENERATED' ? 'Oddpath generated' : 'Agent provided' }}</span>
              </div>

              <div v-if="!selectedArtifact" class="qa-empty-artifact">
                <strong>Waiting for an agent candidate</strong>
                <p>Connect Codex, Claude, or another agent. It can submit a checklist through MCP or REST; Oddpath will assess it before owner selection.</p>
                <button class="btn btn-outline-secondary" type="button" @click="isConnectionModalOpen = true">Connect agent</button>
              </div>

              <div v-else class="qa-checklist-list">
                <article v-for="item in selectedArtifact.items" :key="item.id" class="qa-checklist-item">
                  <div class="qa-checklist-item__main">
                    <span class="qa-checklist-index">{{ String(item.ordinal + 1).padStart(2, '0') }}</span>
                    <div>
                      <div class="qa-checklist-title">
                        <strong>{{ item.title }}</strong>
                        <span v-if="item.priority" class="qa-priority">{{ item.priority }}</span>
                      </div>
                      <p>{{ item.expectedResult }}</p>
                      <div class="qa-evidence-requirements">
                        <span v-for="requirement in item.evidenceRequirements" :key="requirement.id">
                          {{ requirement.kind }} · {{ requirement.description }}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span class="qa-status" :class="`qa-status--${resultTone(item)}`">{{ resultLabel(item) }}</span>
                </article>
              </div>
            </section>

            <section v-if="canReview" class="qa-human-review">
              <div>
                <span class="qa-eyebrow">Human Review</span>
                <h3>Approve the QA record, not the release.</h3>
                <p>A FAIL outcome can still be approved when the results and required evidence accurately represent what happened.</p>
              </div>
              <textarea v-model="reviewComment" class="form-control" maxlength="10000" placeholder="Optional review note"></textarea>
              <div class="qa-human-review__actions">
                <button class="btn btn-outline-secondary" type="button" :disabled="isMutating" @click="submitReview('CHANGES_REQUESTED')">Request changes</button>
                <button class="btn btn-primary" type="button" :disabled="isMutating || missingEvidenceCount > 0" @click="submitReview('APPROVED')">Approve QA record</button>
              </div>
            </section>
          </template>
        </section>

        <aside class="qa-side-column">
          <section class="workspace-panel qa-evidence-panel">
            <div class="qa-section-heading"><div><span class="qa-eyebrow">Proof gate</span><h2>Evidence</h2></div><span class="qa-status" :class="missingEvidenceCount ? 'qa-status--warning' : 'qa-status--success'">{{ missingEvidenceCount ? `${missingEvidenceCount} missing` : "Complete" }}</span></div>
            <p v-if="!latestRun" class="workspace-note">Evidence appears here after an agent starts a run.</p>
            <div v-else-if="latestRun.evidence.length === 0" class="qa-empty-side">
              <strong>No evidence yet</strong>
              <p>Results alone are not enough when a checklist requirement asks for proof.</p>
            </div>
            <article v-for="evidence in latestRun?.evidence || []" :key="evidence.id" class="qa-evidence-item">
              <div><span class="qa-evidence-kind">{{ evidence.kind }}</span><small>{{ evidence.transport }} · {{ evidence.actorKind }}</small></div>
              <p v-if="evidence.textContent">{{ evidence.textContent }}</p>
              <a
                v-if="safeExternalEvidenceUrl(evidence.externalReference)"
                class="qa-evidence-link"
                :href="safeExternalEvidenceUrl(evidence.externalReference)"
                rel="noopener noreferrer"
                target="_blank"
              >Open external evidence <small>External · not stored by Oddpath</small></a>
              <button
                v-if="evidence.assets[0]"
                class="qa-evidence-link"
                type="button"
                @click="openStoredEvidence(evidence)"
              >Open {{ evidence.assets[0].asset.originalName }} <small>Stored evidence</small></button>
            </article>
          </section>

          <section class="workspace-panel qa-history-panel">
            <div class="qa-section-heading"><div><span class="qa-eyebrow">Append-only</span><h2>History</h2></div><span>{{ selectedRequest?.events.length || 0 }}</span></div>
            <ol class="qa-timeline">
              <li v-for="event in (selectedRequest?.events || []).slice().reverse().slice(0, 8)" :key="event.id">
                <span></span>
                <div><strong>{{ event.type.replaceAll('_', ' ') }}</strong><small>{{ event.transport }} · {{ formatRelative(event.createdAt) }}</small></div>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </template>

    <QaRequestFormModal
      :error-message="requestModalError"
      :is-open="isRequestModalOpen"
      :is-saving="isCreatingRequest"
      @cancel="isRequestModalOpen = false"
      @save="saveRequest"
    />
    <QaConnectionModal
      v-if="isConnectionModalOpen && selectedProject"
      :project-id="selectedProject.id"
      :project-name="selectedProject.name"
      @changed="handleConnectionsChanged"
      @close="isConnectionModalOpen = false"
    />
    <QaPlaywrightRunModal
      v-if="selectedArtifact"
      :artifact="selectedArtifact"
      :is-generating="isGeneratingRecipe"
      :is-loading-profiles="isLoadingProfiles"
      :is-open="isRunModalOpen"
      :is-retrying-review="isRetryingRecipeReview"
      :is-saving="isMutating"
      :operations="selectedRequest?.operations || []"
      :profiles="runnerProfiles"
      :recipes="selectedRequest?.executionRecipes || []"
      @close="isRunModalOpen = false"
      @connect="openRunnerConnection"
      @generate="generateRecipe"
      @refresh="loadRunnerProfiles"
      @retry-review="retryRecipeReview"
      @start="startPlaywrightRun"
    />
  </section>
</template>
