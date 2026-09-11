<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import {
  describeQaRecipeStep,
  qaRecipeCanRunOnProfile,
  qaRecipeCoverage,
  qaRecipeReviewState,
  qaRunnerProfilePresentation,
} from "../harnessPresentation";
import type {
  QaArtifact,
  QaExecutionRecipe,
  QaOperationReceipt,
  QaRunnerProfile,
} from "../types";

const props = defineProps<{
  artifact: QaArtifact;
  isGenerating: boolean;
  isLoadingProfiles: boolean;
  isOpen: boolean;
  isRetryingReview: boolean;
  isSaving: boolean;
  operations: QaOperationReceipt[];
  profiles: QaRunnerProfile[];
  recipes: QaExecutionRecipe[];
}>();

const emit = defineEmits<{
  close: [];
  connect: [];
  generate: [profile: QaRunnerProfile];
  refresh: [];
  retryReview: [input: { recipeId: string; assessmentId: string }];
  start: [input: {
    confirmProduction: boolean;
    profile: QaRunnerProfile;
    recipe: QaExecutionRecipe;
  }];
}>();

const selectedProfileId = ref("");
const selectedRecipeId = ref("");
const recipeApproved = ref(false);
const productionConfirmed = ref(false);
const retryRequested = ref(false);
const { t } = useI18n();

const selectedProfile = computed(() =>
  props.profiles.find(({ id }) => id === selectedProfileId.value) || null
);
const artifactRecipes = computed(() =>
  props.recipes.filter(({ artifactId }) => artifactId === props.artifact.id)
);
const selectedRecipe = computed(() =>
  artifactRecipes.value.find(({ id }) => id === selectedRecipeId.value) || null
);
const recipeReview = computed(() => qaRecipeReviewState(
  selectedRecipe.value,
  props.operations,
  props.isRetryingReview || retryRequested.value
));
const latestRecipeAssessment = computed(() => recipeReview.value.assessment);
const isRecipeReviewed = computed(() => recipeReview.value.isReviewed);
const canRetryReview = computed(() => recipeReview.value.canRetry && !props.isSaving && !props.isGenerating);
const isProfileCompatible = computed(() => Boolean(
  selectedProfile.value
  && selectedRecipe.value
  && qaRecipeCanRunOnProfile(selectedRecipe.value, selectedProfile.value)
));
const isProduction = computed(() => selectedProfile.value?.environmentKind === "PRODUCTION");
const canGenerate = computed(() => Boolean(
  selectedProfile.value?.status === "ONLINE" && selectedProfile.value.manifestHash
));
// One ordered set of gates drives both the action and its explanation. Keep
// review failures ahead of Runner setup: restarting a Runner cannot fix review.
const startBlockReason = computed(() => {
  if (props.isSaving) return "projects.qa.approval.queueing";
  if (props.isGenerating) return "projects.qa.approval.generating";
  if (recipeReview.value.isPending) return "projects.qa.approval.reviewPending";
  if (selectedRecipe.value && !isRecipeReviewed.value) {
    return latestRecipeAssessment.value?.status === "FAILED"
      ? "projects.qa.approval.reviewFailed"
      : "projects.qa.approval.reviewMissing";
  }
  if (!selectedProfile.value) {
    return props.isLoadingProfiles
      ? "projects.qa.approval.loadingProfiles"
      : "projects.qa.approval.profileMissing";
  }
  if (selectedProfile.value.status === "OFFLINE") return "projects.qa.approval.profileOffline";
  if (selectedProfile.value.status === "INCOMPATIBLE") return "projects.qa.approval.profileIncompatible";
  if (!selectedRecipe.value) return "projects.qa.approval.recipeMissing";
  if (!isProfileCompatible.value) return "projects.qa.approval.profileMismatch";
  if (!recipeApproved.value) return "projects.qa.approval.reviewRequired";
  if (isProduction.value && !productionConfirmed.value) return "projects.qa.approval.productionRequired";
  return null;
});
const canStart = computed(() => startBlockReason.value === null);

watch(
  () => [props.isOpen, props.profiles.map(({ id, status }) => `${id}:${status}`).join("|")] as const,
  ([isOpen]) => {
    if (!isOpen) return;
    const current = props.profiles.find(({ id }) => id === selectedProfileId.value);
    selectedProfileId.value = current?.id
      || props.profiles.find(({ status }) => status === "ONLINE")?.id
      || props.profiles[0]?.id
      || "";
  },
  { immediate: true }
);

watch(
  () => [selectedProfileId.value, artifactRecipes.value.map(({ id, revision }) => `${id}:${revision}`).join("|")] as const,
  () => {
    const profile = selectedProfile.value;
    const current = artifactRecipes.value.find(({ id }) => id === selectedRecipeId.value);
    const preferred = profile
      ? artifactRecipes.value.find((recipe) => qaRecipeCanRunOnProfile(recipe, profile))
      : null;
    selectedRecipeId.value = (current && (!profile || qaRecipeCanRunOnProfile(current, profile)))
      ? current.id
      : preferred?.id || artifactRecipes.value[0]?.id || "";
  },
  { immediate: true }
);

watch([selectedProfileId, selectedRecipeId, () => latestRecipeAssessment.value?.id, () => latestRecipeAssessment.value?.status], () => {
  recipeApproved.value = false;
  productionConfirmed.value = false;
});

watch(() => props.isRetryingReview, (isRetrying) => {
  if (!isRetrying) retryRequested.value = false;
});

async function retryReview() {
  if (!canRetryReview.value || !selectedRecipe.value || !latestRecipeAssessment.value) return;
  // Latch synchronously: a second click must not wait for the parent's prop update.
  retryRequested.value = true;
  recipeApproved.value = false;
  productionConfirmed.value = false;
  emit("retryReview", {
    recipeId: selectedRecipe.value.id,
    assessmentId: latestRecipeAssessment.value.id,
  });
  // A stale action can be declined before the parent enters its busy state.
  // Keep same-tick clicks guarded, but do not strand the dialog in that case.
  await nextTick();
  if (!props.isRetryingReview) retryRequested.value = false;
}

function close() {
  if (!props.isSaving && !props.isGenerating && !props.isRetryingReview && !retryRequested.value) emit("close");
}

function start() {
  if (!canStart.value || !selectedProfile.value || !selectedRecipe.value) return;
  emit("start", {
    confirmProduction: productionConfirmed.value,
    profile: selectedProfile.value,
    recipe: selectedRecipe.value,
  });
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !props.isSaving && !props.isGenerating && !props.isRetryingReview && !retryRequested.value,
  isOpen: () => props.isOpen,
  onClose: close,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="dialogRef"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qa-playwright-run-title"
      @click.self="close"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable qa-run-dialog">
        <section class="modal-content app-modal">
          <div class="modal-header">
            <div>
              <span class="qa-modal-eyebrow">Approved execution</span>
              <h2 id="qa-playwright-run-title" class="modal-title">Run with Playwright</h2>
            </div>
            <button class="btn-close" type="button" aria-label="Close" :disabled="isSaving || isGenerating || isRetryingReview || retryRequested" @click="close"></button>
          </div>

          <div class="modal-body qa-run-modal-body">
            <p class="qa-run-intro">
              Oddpath sends one immutable Recipe to your local Runner. The Runner keeps profile values local and returns only results and required evidence.
            </p>

            <section class="qa-run-step">
              <div class="qa-run-step__heading">
                <span>01</span>
                <div><strong>Choose a Runner profile</strong><small>No secret values leave the Runner.</small></div>
                <button class="btn btn-sm btn-link" type="button" :disabled="isLoadingProfiles" @click="emit('refresh')">{{ isLoadingProfiles ? "Discovering…" : "Refresh" }}</button>
              </div>
              <p v-if="isLoadingProfiles && profiles.length === 0" class="workspace-note">Discovering Runner profiles…</p>
              <div v-else-if="profiles.length === 0" class="qa-empty-artifact">
                <strong>No Runner profile discovered</strong>
                <p>Create a Runner connection, add a local <code>oddpath.runner.json</code>, then start the Runner. This screen updates when it registers.</p>
                <button class="btn btn-outline-secondary" type="button" @click="emit('connect')">Connect Playwright Runner</button>
              </div>
              <template v-else>
                <label class="qa-form-field">
                  <span class="form-label">Runner profile</span>
                  <select v-model="selectedProfileId" class="form-select">
                    <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
                      {{ profile.label }} · {{ profile.environmentKind }} · {{ qaRunnerProfilePresentation(profile).label }}
                    </option>
                  </select>
                </label>
                <div v-if="selectedProfile" class="qa-profile-summary">
                  <div>
                    <strong>{{ selectedProfile.runnerName }}</strong>
                    <small>{{ selectedProfile.runnerVersion }} · seen {{ selectedProfile.lastSeenAt ? new Date(selectedProfile.lastSeenAt).toLocaleTimeString() : "never" }}</small>
                  </div>
                  <span class="qa-status" :class="`qa-status--${qaRunnerProfilePresentation(selectedProfile).tone}`">
                    {{ qaRunnerProfilePresentation(selectedProfile).label }}
                  </span>
                  <p v-if="selectedProfile.status === 'OFFLINE'" id="qa-runner-offline-note">{{ t('projects.qa.runSetup.offlineNote') }}</p>
                  <p v-else-if="selectedProfile.status === 'INCOMPATIBLE'">{{ t('projects.qa.approval.profileIncompatible') }}</p>
                </div>
                <details v-if="selectedProfile?.status === 'OFFLINE'" class="qa-empty-artifact mt-3" open>
                  <summary>{{ t('projects.qa.runSetup.title') }}</summary>
                  <ol class="mt-2 mb-2">
                    <li>{{ t('projects.qa.runSetup.terminal') }}</li>
                    <li>{{ t('projects.qa.runSetup.config', { config: 'apps/runner/oddpath.runner.json' }) }}</li>
                    <li>{{ t('projects.qa.runSetup.token', { setting: 'tokenEnv', variable: 'ODDPATH_RUNNER_TOKEN' }) }}</li>
                    <li><code dir="ltr">npm run dev:runner</code></li>
                  </ol>
                  <p class="mb-0">{{ t('projects.qa.runSetup.refresh') }}</p>
                  <p v-if="isRecipeReviewed" class="mt-2 mb-0">{{ t('projects.qa.runSetup.preserveRecipe') }}</p>
                </details>
              </template>
            </section>

            <section class="qa-run-step">
              <div class="qa-run-step__heading"><span>02</span><div><strong>Review an Execution Recipe</strong><small>Generated by Oddpath or submitted by any connected agent.</small></div></div>
              <div v-if="artifactRecipes.length === 0" class="qa-empty-artifact">
                <strong>No Execution Recipe yet</strong>
                <p>Generate one from this immutable checklist and the selected public Runner profile, or let an agent submit a Recipe through MCP.</p>
                <button class="btn btn-outline-secondary" type="button" :disabled="!canGenerate || isGenerating" @click="selectedProfile && emit('generate', selectedProfile)">
                  {{ isGenerating ? "Generating Recipe…" : "Generate with Oddpath" }}
                </button>
              </div>
              <template v-else>
                <label class="qa-form-field">
                  <span class="form-label">Recipe revision</span>
                  <select v-model="selectedRecipeId" class="form-select">
                    <option v-for="recipe in artifactRecipes" :key="recipe.id" :value="recipe.id">
                      Revision {{ recipe.revision }} · {{ recipe.origin === "ODDPATH_GENERATED" ? "Oddpath generated" : "Agent provided" }}
                    </option>
                  </select>
                </label>

                <article v-if="selectedRecipe" class="qa-recipe-review">
                  <header>
                    <div><strong>{{ selectedRecipe.title }}</strong><small>{{ qaRecipeCoverage(selectedRecipe) }}</small></div>
                    <span
                      class="qa-status"
                      :class="recipeReview.isPending ? 'qa-status--active' : latestRecipeAssessment?.status === 'FAILED' ? 'qa-status--danger' : latestRecipeAssessment?.status === 'SUGGESTIONS' ? 'qa-status--warning' : 'qa-status--success'"
                    >{{ recipeReview.isPending ? t('projects.qa.reviewRetry.pending') : latestRecipeAssessment?.status || "Not reviewed" }}</span>
                  </header>
                  <p v-if="recipeReview.isPending" class="workspace-note" role="status">{{ t('projects.qa.reviewRetry.pendingNote') }}</p>
                  <div v-else-if="latestRecipeAssessment?.status === 'FAILED'">
                    <p class="workspace-note">{{ t('projects.qa.reviewRetry.note') }}</p>
                    <button class="btn btn-outline-secondary" type="button" :disabled="!canRetryReview" @click="retryReview">
                      {{ t('projects.qa.reviewRetry.action') }}
                    </button>
                  </div>
                  <p v-if="latestRecipeAssessment?.summary">{{ latestRecipeAssessment.summary }}</p>
                  <ul v-if="latestRecipeAssessment?.suggestions.length">
                    <li v-for="suggestion in latestRecipeAssessment.suggestions" :key="suggestion.code || suggestion.message">
                      <b>{{ suggestion.severity || "INFO" }}</b> {{ suggestion.message }}
                    </li>
                  </ul>
                  <details>
                    <summary>Inspect Recipe steps</summary>
                    <ol class="qa-recipe-items">
                      <li v-for="item in selectedRecipe.bundle.items" :key="item.checklistItemId">
                        <strong>{{ artifact.items.find(({ id }) => id === item.checklistItemId)?.title || item.checklistItemId }}</strong>
                        <ol><li v-for="step in item.steps" :key="step.ref">{{ describeQaRecipeStep(step) }}</li></ol>
                      </li>
                    </ol>
                  </details>
                  <div class="qa-recipe-integrity">
                    <span><small>Schema</small>Recipe v{{ selectedRecipe.schemaVersion }}</span>
                    <span><small>Immutable hash</small><code>{{ selectedRecipe.recipeHash }}</code></span>
                  </div>
                  <p v-if="selectedProfile?.status === 'ONLINE' && !isProfileCompatible" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
                    {{ t('projects.qa.approval.profileMismatch') }}
                  </p>
                </article>

                <button class="btn btn-link qa-generate-another" type="button" :disabled="!canGenerate || isGenerating || recipeReview.isPending" @click="selectedProfile && emit('generate', selectedProfile)">
                  {{ isGenerating ? "Generating new revision…" : "Generate a new revision" }}
                </button>
              </template>
            </section>

            <section v-if="selectedRecipe && selectedProfile" class="qa-run-step">
              <div class="qa-run-step__heading"><span>03</span><div><strong>Approve this exact run</strong><small>Approval is bound to the current QA Request version, Recipe hash, and profile manifest.</small></div></div>
              <label class="qa-confirmation">
                <input v-model="recipeApproved" type="checkbox" :disabled="!isRecipeReviewed || isSaving || isGenerating" aria-describedby="qa-run-approval-status" />
                <span>I reviewed Recipe revision {{ selectedRecipe.revision }} with hash <code>{{ selectedRecipe.recipeHash.slice(0, 12) }}…</code>.</span>
              </label>
              <label v-if="isProduction" class="qa-confirmation qa-confirmation--danger">
                <input v-model="productionConfirmed" type="checkbox" :disabled="!isRecipeReviewed || isSaving || isGenerating" aria-describedby="qa-run-approval-status" />
                <span>I understand this profile targets <strong>PRODUCTION</strong> and explicitly authorize this run.</span>
              </label>
            </section>
          </div>

          <div class="modal-footer qa-run-footer">
            <small id="qa-run-approval-status" role="status" aria-live="polite">{{ t(startBlockReason || 'projects.qa.approval.ready') }}</small>
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving || isGenerating || isRetryingReview || retryRequested" @click="close">Cancel</button>
            <button class="btn btn-primary" type="button" :disabled="!canStart" aria-describedby="qa-run-approval-status" @click="start">
              {{ isSaving ? "Queueing execution…" : "Approve & queue run" }}
            </button>
          </div>
        </section>
      </div>
    </div>
    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
