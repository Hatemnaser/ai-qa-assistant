<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import { useQaRunApproval } from "../useQaRunApproval";
import {
  describeQaRecipeStep,
  qaRecipeCoverage,
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
  profileLoadError?: string;
  profiles: QaRunnerProfile[];
  recipes: QaExecutionRecipe[];
  identityKey?: string;
  requestVersion?: number;
  readError?: string;
  disabled?: boolean;
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

const { t } = useI18n();
const {
  selectedProfileId, selectedRecipeId, recipeApproved, productionConfirmed,
  selectedProfile, artifactRecipes, selectedRecipe, recipeReview, latestRecipeAssessment,
  isRecipeReviewed, isProfileCompatible, isProduction, canRetryReview, canGenerate, canStart,
  approvalDisabled, isActionBusy, startBlockReason, retryReview, start, generate,
} = useQaRunApproval(props, {
  generate: profile => emit("generate", profile),
  retryReview: input => emit("retryReview", input),
  start: input => emit("start", input),
});

function close() {
  if (!isActionBusy.value) emit("close");
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !isActionBusy.value,
  isOpen: () => props.isOpen,
  onClose: close,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="dialogRef"
      class="workspace-surface qa-focused-workspace modal fade show d-block"
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
            <button class="btn-close" type="button" aria-label="Close" :disabled="isActionBusy" @click="close"></button>
          </div>

          <div class="modal-body qa-run-modal-body">
            <p v-if="readError" class="workspace-feedback workspace-feedback--error" role="alert">{{ readError }}</p>
            <p class="qa-run-intro">
              Oddpath sends one immutable Recipe to your local Runner. The Runner keeps profile values local and returns only results and required evidence.
            </p>

            <section class="qa-run-step">
              <div class="qa-run-step__heading">
                <span>01</span>
                <div><strong>Choose a Runner profile</strong><small>No secret values leave the Runner.</small></div>
                <button v-if="!profileLoadError" class="btn btn-sm btn-link" type="button" :disabled="isLoadingProfiles" @click="emit('refresh')">{{ isLoadingProfiles ? "Discovering…" : "Refresh" }}</button>
              </div>
              <p v-if="isLoadingProfiles" class="workspace-note" role="status">{{ t('projects.qa.approval.loadingProfiles') }}</p>
              <div v-else-if="profileLoadError" class="workspace-feedback workspace-feedback--error" role="alert">
                <p>{{ profileLoadError }}</p>
                <button class="btn btn-outline-secondary" type="button" @click="emit('refresh')">{{ t('projects.integrations.refresh') }}</button>
              </div>
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
                <button class="btn btn-outline-secondary" type="button" :disabled="!canGenerate" @click="generate">
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

                <button class="btn btn-link qa-generate-another" type="button" :disabled="!canGenerate" @click="generate">
                  {{ isGenerating ? "Generating new revision…" : "Generate a new revision" }}
                </button>
              </template>
            </section>

            <section v-if="selectedRecipe && selectedProfile" class="qa-run-step">
              <div class="qa-run-step__heading"><span>03</span><div><strong>Approve this exact run</strong><small>Approval is bound to the current QA Request version, Recipe hash, and profile manifest.</small></div></div>
              <label class="qa-confirmation">
                <input v-model="recipeApproved" type="checkbox" :disabled="approvalDisabled" aria-describedby="qa-run-approval-status" />
                <span>I reviewed Recipe revision {{ selectedRecipe.revision }} with hash <code>{{ selectedRecipe.recipeHash.slice(0, 12) }}…</code>.</span>
              </label>
              <label v-if="isProduction" class="qa-confirmation qa-confirmation--danger">
                <input v-model="productionConfirmed" type="checkbox" :disabled="approvalDisabled" aria-describedby="qa-run-approval-status" />
                <span>I understand this profile targets <strong>PRODUCTION</strong> and explicitly authorize this run.</span>
              </label>
            </section>
          </div>

          <div class="modal-footer qa-run-footer">
            <small id="qa-run-approval-status" role="status" aria-live="polite">{{ t(startBlockReason || 'projects.qa.approval.ready') }}</small>
            <button class="btn btn-outline-secondary" type="button" :disabled="isActionBusy" @click="close">Cancel</button>
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
