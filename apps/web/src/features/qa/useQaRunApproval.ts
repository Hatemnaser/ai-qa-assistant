import { computed, nextTick, ref, watch } from "vue";

import { qaRecipeCanRunOnProfile, qaRecipeReviewState } from "./harnessPresentation";
import type { QaArtifact, QaExecutionRecipe, QaOperationReceipt, QaRunnerProfile } from "./types";

export interface QaRunApprovalProps {
  artifact: QaArtifact;
  isGenerating: boolean;
  isLoadingProfiles: boolean;
  isOpen?: boolean;
  isRetryingReview: boolean;
  isSaving: boolean;
  /** Temporary conversation POST; disables clicks without consuming consent. */
  isDiscussing?: boolean;
  operations: QaOperationReceipt[];
  profileLoadError?: string;
  profiles: QaRunnerProfile[];
  recipes: QaExecutionRecipe[];
  /** Owner + project + session/request identity supplied by the owning surface. */
  identityKey?: string;
  requestVersion?: number;
  readError?: string;
  disabled?: boolean;
}

export interface QaRunApprovalStart {
  confirmProduction: boolean;
  profile: QaRunnerProfile;
  recipe: QaExecutionRecipe;
}

interface ApprovalActions {
  generate(profile: QaRunnerProfile): void;
  retryReview(input: { recipeId: string; assessmentId: string }): void;
  start(input: QaRunApprovalStart): void;
}

/** Shared UI approval state; API version/hash validation remains authoritative. */
export function useQaRunApproval(props: QaRunApprovalProps, actions: ApprovalActions) {
  const selectedProfileId = ref("");
  const selectedRecipeId = ref("");
  const recipeApproved = ref(false);
  const productionConfirmed = ref(false);
  const retryRequested = ref(false);
  const startRequested = ref(false);
  const generateRequested = ref(false);
  const isUnavailable = computed(() => Boolean(props.disabled || props.readError || props.isOpen === false));

  const selectedProfile = computed(() => props.profiles.find(({ id }) => id === selectedProfileId.value) || null);
  const artifactRecipes = computed(() => props.recipes.filter(({ artifactId, requestId }) =>
    artifactId === props.artifact.id && requestId === props.artifact.requestId
  ));
  const selectedRecipe = computed(() => artifactRecipes.value.find(({ id }) => id === selectedRecipeId.value) || null);
  const recipeReview = computed(() => qaRecipeReviewState(selectedRecipe.value, props.operations, props.isRetryingReview || retryRequested.value));
  const latestRecipeAssessment = computed(() => recipeReview.value.assessment);
  const isRecipeReviewed = computed(() => recipeReview.value.isReviewed);
  const isProfileCompatible = computed(() => Boolean(selectedProfile.value && selectedRecipe.value
    && qaRecipeCanRunOnProfile(selectedRecipe.value, selectedProfile.value)));
  const isProduction = computed(() => selectedProfile.value?.environmentKind === "PRODUCTION");
  const isActionBusy = computed(() => props.isDiscussing || props.isSaving || props.isGenerating || props.isRetryingReview
    || retryRequested.value || startRequested.value || generateRequested.value);
  const canRetryReview = computed(() => !isUnavailable.value && recipeReview.value.canRetry && !isActionBusy.value);
  const canGenerate = computed(() => Boolean(!isUnavailable.value && !isActionBusy.value
    && !props.isLoadingProfiles && !props.profileLoadError && !recipeReview.value.isPending
    && selectedProfile.value?.status === "ONLINE" && selectedProfile.value.manifestHash));
  const approvalDisabled = computed(() => isUnavailable.value || !isRecipeReviewed.value || isActionBusy.value
    || props.isLoadingProfiles || Boolean(props.profileLoadError));

  const startBlockReason = computed(() => {
    if (isUnavailable.value) return "projects.qa.approval.recordUnavailable";
    if (props.isDiscussing) return "projects.qa.approval.recordUnavailable";
    if (props.isSaving || startRequested.value) return "projects.qa.approval.queueing";
    if (props.isGenerating || generateRequested.value) return "projects.qa.approval.generating";
    // Review recovery is independent of Runner discovery/availability.
    if (recipeReview.value.isPending) return "projects.qa.approval.reviewPending";
    if (selectedRecipe.value && !isRecipeReviewed.value) {
      return latestRecipeAssessment.value?.status === "FAILED"
        ? "projects.qa.approval.reviewFailed" : "projects.qa.approval.reviewMissing";
    }
    if (props.isLoadingProfiles) return "projects.qa.approval.loadingProfiles";
    if (props.profileLoadError) return "projects.integrations.errors.profiles";
    if (!selectedProfile.value) return "projects.qa.approval.profileMissing";
    if (selectedProfile.value.status === "OFFLINE") return "projects.qa.approval.profileOffline";
    if (selectedProfile.value.status === "INCOMPATIBLE") return "projects.qa.approval.profileIncompatible";
    if (!selectedRecipe.value) return "projects.qa.approval.recipeMissing";
    if (!isProfileCompatible.value) return "projects.qa.approval.profileMismatch";
    if (!recipeApproved.value) return "projects.qa.approval.reviewRequired";
    if (isProduction.value && !productionConfirmed.value) return "projects.qa.approval.productionRequired";
    return null;
  });
  const canStart = computed(() => startBlockReason.value === null);

  watch(() => [props.isOpen, props.identityKey, props.artifact.requestId,
    props.profiles.map(({ id, status }) => `${id}:${status}`).join("|")] as const, () => {
    if (props.isOpen === false) return;
    const current = props.profiles.find(({ id }) => id === selectedProfileId.value);
    selectedProfileId.value = current?.id || props.profiles.find(({ status }) => status === "ONLINE")?.id || props.profiles[0]?.id || "";
  }, { immediate: true, flush: "sync" });

  watch(() => [selectedProfileId.value, artifactRecipes.value.map(({ id, revision }) => `${id}:${revision}`).join("|")] as const, () => {
    const profile = selectedProfile.value;
    const current = artifactRecipes.value.find(({ id }) => id === selectedRecipeId.value);
    const preferred = profile ? artifactRecipes.value.find((recipe) => qaRecipeCanRunOnProfile(recipe, profile)) : null;
    selectedRecipeId.value = current && (!profile || qaRecipeCanRunOnProfile(current, profile))
      ? current.id : preferred?.id || artifactRecipes.value[0]?.id || "";
  }, { immediate: true, flush: "sync" });

  function resetApproval() {
    recipeApproved.value = false;
    productionConfirmed.value = false;
  }

  // Flush synchronously: a click in the same tick as navigation/refresh may not
  // reuse approval from the previous identity, record version or public manifest.
  watch([
    () => props.identityKey, () => props.artifact.requestId, () => props.artifact.id,
    () => props.requestVersion, () => props.isOpen, () => props.disabled, () => props.readError,
    () => props.isSaving, () => props.isGenerating,
    selectedProfileId, selectedRecipeId, () => selectedProfile.value?.manifestHash,
    () => selectedProfile.value?.status, () => selectedProfile.value?.environmentKind,
    () => selectedProfile.value?.runnerRegistrationId, () => selectedProfile.value?.key,
    () => selectedProfile.value?.supportedRecipeVersions.join(","),
    () => selectedRecipe.value?.recipeHash, () => selectedRecipe.value?.profileManifestHash,
    () => latestRecipeAssessment.value?.id, () => latestRecipeAssessment.value?.status,
    () => recipeReview.value.isPending, () => props.isLoadingProfiles, () => props.profileLoadError,
  ], resetApproval, { flush: "sync" });

  watch(() => props.isRetryingReview, value => { if (!value) retryRequested.value = false; });
  watch(() => props.isSaving, value => { if (!value) startRequested.value = false; });
  watch(() => props.isGenerating, value => { if (!value) generateRequested.value = false; });

  async function retryReview() {
    if (!canRetryReview.value || !selectedRecipe.value || !latestRecipeAssessment.value) return;
    const input = { recipeId: selectedRecipe.value.id, assessmentId: latestRecipeAssessment.value.id };
    retryRequested.value = true;
    resetApproval();
    actions.retryReview(input);
    await nextTick();
    if (!props.isRetryingReview) retryRequested.value = false;
  }

  async function start() {
    if (!canStart.value || !selectedProfile.value || !selectedRecipe.value) return;
    const input = { confirmProduction: productionConfirmed.value, profile: selectedProfile.value, recipe: selectedRecipe.value };
    startRequested.value = true;
    resetApproval();
    actions.start(input);
    await nextTick();
    if (!props.isSaving) startRequested.value = false;
  }

  async function generate() {
    if (!canGenerate.value || !selectedProfile.value) return;
    const profile = selectedProfile.value;
    generateRequested.value = true;
    resetApproval();
    actions.generate(profile);
    await nextTick();
    if (!props.isGenerating) generateRequested.value = false;
  }

  return {
    selectedProfileId, selectedRecipeId, recipeApproved, productionConfirmed, retryRequested,
    startRequested, generateRequested, selectedProfile, artifactRecipes, selectedRecipe,
    recipeReview, latestRecipeAssessment, isRecipeReviewed, isProfileCompatible, isProduction,
    canRetryReview, canGenerate, canStart, approvalDisabled, isActionBusy, startBlockReason,
    retryReview, start, generate,
  };
}
