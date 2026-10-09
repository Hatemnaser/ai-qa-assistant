<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
import { useI18n } from "../../../i18n/useI18n";
import { useQaRunApproval } from "../useQaRunApproval";
import type { QaArtifact, QaExecutionRecipe, QaOperationReceipt, QaRunnerProfile } from "../types";
import { describeApprovalStep } from "../runApprovalPresentation";
import { RUNNER_START_POWERSHELL } from "../runnerOnboarding";

const props = defineProps<{
  artifact: QaArtifact;
  isGenerating: boolean;
  isLoadingProfiles: boolean;
  isOpen?: boolean;
  isRetryingReview: boolean;
  isSaving: boolean;
  isDiscussing?: boolean;
  operations: QaOperationReceipt[];
  profileLoadError?: string;
  profiles: QaRunnerProfile[];
  recipes: QaExecutionRecipe[];
  identityKey?: string;
  requestVersion?: number;
  readError?: string;
  disabled?: boolean;
  detailsTarget?: HTMLElement | null;
  target?: string | null;
  environment?: string | null;
}>();
const emit = defineEmits<{
  connect: [];
  generate: [profile: QaRunnerProfile];
  refresh: [];
  retryReview: [input: { recipeId: string; assessmentId: string }];
  start: [input: { confirmProduction: boolean; profile: QaRunnerProfile; recipe: QaExecutionRecipe }];
}>();
const { t } = useI18n();
const statusId = `qa-inline-approval-${useId()}`;
const detailsOpen = ref(false);
const detailsElement = ref<HTMLDetailsElement | null>(null);
const detailsTrigger = ref<HTMLButtonElement | null>(null);
async function showDetails() {
  detailsOpen.value = true;
  await nextTick();
  detailsElement.value?.querySelector('summary')?.focus();
  detailsElement.value?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function closeDetails() { detailsOpen.value = false; detailsTrigger.value?.focus(); }
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
const reviewStatus = computed(() => recipeReview.value.isPending ? "PENDING" : latestRecipeAssessment.value?.status || "NONE");
const stepCount = computed(() => selectedRecipe.value?.bundle.items.reduce((count, item) => count + item.steps.length, 0) || 0);
</script>

<template>
  <section class="qa-run-approval" :aria-label="t('projects.qa.approval.title')">
    <button v-if="detailsTarget" ref="detailsTrigger" type="button" class="btn btn-link qa-run-approval__details-trigger" :aria-expanded="detailsOpen" :aria-controls="`${statusId}-details`" @click="detailsOpen ? closeDetails() : showDetails()">{{ t('projects.qa.approval.details') }}</button>
    <Teleport :to="detailsTarget || 'body'" :disabled="!detailsTarget">
    <details v-show="isOpen !== false && (!detailsTarget || detailsOpen)" :id="`${statusId}-details`" ref="detailsElement" class="qa-run-approval__details" :open="detailsTarget ? detailsOpen : undefined" @toggle="detailsTarget && !($event.target as HTMLDetailsElement).open && closeDetails()" @keydown.esc.stop.prevent="detailsTarget && closeDetails()">
      <summary>{{ t('projects.qa.approval.details') }}</summary>
      <div class="qa-run-approval__details-body">
        <p>{{ t('projects.qa.approval.binding') }}</p>
        <p v-if="readError" class="qa-run-approval__error" role="alert">{{ readError }}</p>
        <div class="qa-run-approval__section">
          <div class="qa-run-approval__row">
            <strong>{{ t('projects.qa.approval.profileLabel') }}</strong>
            <button class="btn btn-outline-secondary" type="button" :disabled="isLoadingProfiles || isActionBusy || disabled" @click="emit('refresh')">{{ t('projects.integrations.refresh') }}</button>
          </div>
          <p v-if="isLoadingProfiles" role="status">{{ t('projects.qa.approval.loadingProfiles') }}</p>
          <p v-else-if="profileLoadError" class="qa-run-approval__error" role="alert">{{ profileLoadError }}</p>
          <div v-else-if="profiles.length === 0">
            <p>{{ t('projects.qa.approval.profileMissing') }}</p>
            <button class="btn btn-outline-secondary" type="button" :disabled="isActionBusy || disabled || Boolean(readError)" @click="emit('connect')">{{ t('projects.qa.approval.connectRunner') }}</button>
          </div>
          <template v-else>
            <label class="qa-run-approval__field">
              <span>{{ t('projects.qa.approval.profileLabel') }}</span>
              <select v-model="selectedProfileId" class="form-select" :disabled="isActionBusy || disabled || Boolean(readError)">
                <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
                  {{ profile.label }} · {{ t(`projects.qa.approval.environment.${profile.environmentKind}`) }} · {{ t(`projects.qa.approval.profileState.${profile.status}`) }}
                </option>
              </select>
            </label>
            <p v-if="selectedProfile">{{ selectedProfile.runnerName }} · {{ selectedProfile.runnerVersion }}</p>
            <p v-if="selectedProfile?.status === 'OFFLINE'">{{ t('projects.qa.runSetup.offlineNote') }}</p>
            <p v-else-if="selectedProfile?.status === 'INCOMPATIBLE'">{{ t('projects.qa.approval.profileIncompatible') }}</p>
          </template>
        </div>
        <div class="qa-run-approval__section">
          <label v-if="artifactRecipes.length" class="qa-run-approval__field">
            <span>{{ t('projects.qa.approval.recipeLabel') }}</span>
            <select v-model="selectedRecipeId" class="form-select" :disabled="isActionBusy || disabled || Boolean(readError)">
              <option v-for="recipe in artifactRecipes" :key="recipe.id" :value="recipe.id">
                {{ t('projects.qa.focus.revision', { number: recipe.revision }) }} · {{ t(recipe.origin === 'ODDPATH_GENERATED' ? 'projects.qa.focus.generated' : 'projects.qa.focus.agentProvided') }}
              </option>
            </select>
          </label>
          <p v-else>{{ t('projects.qa.approval.recipeMissing') }}</p>
          <article v-if="selectedRecipe" class="qa-run-approval__recipe">
            <div class="qa-run-approval__row">
              <strong>{{ selectedRecipe.title }}</strong>
              <span class="qa-run-approval__review" :data-status="reviewStatus">{{ t(`projects.qa.approval.reviewState.${reviewStatus}`) }}</span>
            </div>
            <p>{{ t('projects.qa.approval.coverage', { items: selectedRecipe.bundle.items.length, steps: stepCount }) }}</p>
            <p v-if="recipeReview.isPending" role="status">{{ t('projects.qa.reviewRetry.pendingNote') }}</p>
            <template v-else-if="latestRecipeAssessment?.status === 'FAILED'">
              <p>{{ t('projects.qa.reviewRetry.note') }}</p>
              <button class="btn btn-outline-secondary" type="button" :disabled="!canRetryReview" @click="retryReview">{{ t('projects.qa.reviewRetry.action') }}</button>
            </template>
            <p v-if="latestRecipeAssessment?.summary">{{ latestRecipeAssessment.summary }}</p>
            <ul v-if="latestRecipeAssessment?.suggestions.length">
              <li v-for="(suggestion, index) in latestRecipeAssessment.suggestions" :key="index">{{ suggestion.message }}</li>
            </ul>
            <details>
              <summary>{{ t('projects.qa.approval.inspectSteps') }}</summary>
              <ol class="qa-run-approval__steps">
                <li v-for="item in selectedRecipe.bundle.items" :key="item.checklistItemId">
                  <strong>{{ artifact.items.find(({ id }) => id === item.checklistItemId)?.title || item.checklistItemId }}</strong>
                  <ol><li v-for="step in item.steps" :key="step.ref">{{ describeApprovalStep(step, t) }}</li></ol>
                </li>
              </ol>
            </details>
            <details>
              <summary>{{ t('projects.qa.approval.exactRecipe') }}</summary>
              <pre dir="ltr">{{ JSON.stringify(selectedRecipe.bundle, null, 2) }}</pre>
            </details>
            <dl class="qa-run-approval__integrity">
              <div><dt>{{ t('projects.qa.approval.recipeHash') }}</dt><dd><code dir="ltr">{{ selectedRecipe.recipeHash }}</code></dd></div>
              <div><dt>{{ t('projects.qa.approval.profileHash') }}</dt><dd><code dir="ltr">{{ selectedProfile?.manifestHash || t('projects.qa.focus.unavailable') }}</code></dd></div>
            </dl>
            <p v-if="selectedProfile?.status === 'ONLINE' && !isProfileCompatible" class="qa-run-approval__error" role="alert">{{ t('projects.qa.approval.profileMismatch') }}</p>
          </article>
          <button class="btn btn-outline-secondary" type="button" :disabled="!canGenerate" @click="generate">{{ t(isGenerating ? 'projects.qa.approval.generatingLabel' : artifactRecipes.length ? 'projects.qa.approval.generateRevision' : 'projects.qa.approval.generate') }}</button>
        </div>
      </div>
    </details>
    </Teleport>

    <div class="qa-run-approval__card">
      <div class="qa-run-approval__summary">
        <strong>{{ t('projects.qa.approval.title') }}</strong>
        <small v-if="selectedProfile">{{ selectedProfile.label }} · {{ t(`projects.qa.approval.environment.${selectedProfile.environmentKind}`) }}</small>
        <small v-if="selectedRecipe">{{ selectedRecipe.title }} · {{ t('projects.qa.focus.revision', { number: selectedRecipe.revision }) }}</small>
        <small v-if="target || environment">{{ target }} · {{ environment }}</small>
      </div>
      <div v-if="profileLoadError && !isLoadingProfiles" class="qa-run-approval__recovery" role="alert">
        <p>{{ t('projects.integrations.errors.profiles') }}</p>
        <button class="btn btn-outline-secondary" type="button" :disabled="isActionBusy || disabled" @click="emit('refresh')">{{ t('projects.integrations.refresh') }}</button>
      </div>
      <div v-else-if="!isLoadingProfiles && !selectedProfile" class="qa-run-approval__recovery">
        <p>{{ t('projects.qa.approval.profileMissing') }}</p>
        <button class="btn btn-outline-secondary" type="button" :disabled="isActionBusy || disabled || Boolean(readError)" @click="emit('connect')">{{ t('projects.qa.approval.connectRunner') }}</button>
      </div>
      <div v-else-if="selectedProfile?.status === 'OFFLINE'" class="qa-run-approval__recovery">
        <strong>{{ t('projects.qa.runSetup.reconnectTitle') }}</strong>
        <p>{{ t('projects.qa.runSetup.reconnectNote') }}</p>
        <details>
          <summary>{{ t('projects.qa.runSetup.steps') }}</summary>
          <ol>
            <li>{{ t('projects.qa.runSetup.stepTerminal') }}</li>
            <li>{{ t('projects.qa.runSetup.stepConfig') }}</li>
            <li>{{ t('projects.qa.runSetup.stepToken') }}</li>
          </ol>
          <pre><code dir="ltr">{{ RUNNER_START_POWERSHELL }}</code></pre>
          <p>{{ t('projects.qa.runSetup.refresh') }}</p>
          <p v-if="isRecipeReviewed">{{ t('projects.qa.runSetup.preserveRecipe') }}</p>
        </details>
        <button class="btn btn-outline-secondary" type="button" :disabled="isLoadingProfiles || isActionBusy || disabled" @click="emit('refresh')">{{ t('projects.integrations.refresh') }}</button>
      </div>
      <label v-if="selectedRecipe && selectedProfile" class="qa-run-approval__confirmation">
        <input v-model="recipeApproved" type="checkbox" :disabled="approvalDisabled" :aria-describedby="statusId" />
        <span>{{ t('projects.qa.approval.confirmRecipe', { revision: selectedRecipe.revision, hash: selectedRecipe.recipeHash.slice(0, 12) }) }}</span>
      </label>
      <label v-if="selectedRecipe && selectedProfile && isProduction" class="qa-run-approval__confirmation qa-run-approval__confirmation--production">
        <input v-model="productionConfirmed" type="checkbox" :disabled="approvalDisabled" :aria-describedby="statusId" />
        <span>{{ t('projects.qa.approval.confirmProduction') }}</span>
      </label>
      <div class="qa-run-approval__action">
        <small :id="statusId" role="status" aria-live="polite">{{ t(startBlockReason || 'projects.qa.approval.ready') }}</small>
        <button class="btn btn-primary" type="button" :disabled="!canStart" :aria-describedby="statusId" @click="start">{{ t(isSaving ? 'projects.qa.approval.queueingLabel' : 'projects.qa.approval.start') }}</button>
      </div>
    </div>
  </section>
</template>
