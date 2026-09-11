<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { CreateQaRequestInput } from "../types";

const props = defineProps<{
  errorMessage?: string;
  isOpen: boolean;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [input: CreateQaRequestInput];
}>();

const form = reactive<CreateQaRequestInput>({
  acceptanceNotes: "",
  checklistMode: "ODDPATH_GENERATED",
  environment: "",
  objective: "",
  target: "",
  title: "",
});

const canSubmit = computed(() => Boolean(form.title.trim() && form.objective.trim() && !props.isSaving));

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;
    form.acceptanceNotes = "";
    form.checklistMode = "ODDPATH_GENERATED";
    form.environment = "";
    form.objective = "";
    form.target = "";
    form.title = "";
  }
);

function requestCancel() {
  if (!props.isSaving) emit("cancel");
}

function submit() {
  if (!canSubmit.value) return;
  emit("save", {
    acceptanceNotes: form.acceptanceNotes?.trim() || undefined,
    checklistMode: form.checklistMode,
    environment: form.environment?.trim() || undefined,
    objective: form.objective.trim(),
    target: form.target?.trim() || undefined,
    title: form.title.trim(),
  });
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !props.isSaving,
  isOpen: () => props.isOpen,
  onClose: requestCancel,
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
      aria-labelledby="qa-request-form-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable qa-request-dialog">
        <form class="modal-content app-modal" @submit.prevent="submit">
          <div class="modal-header">
            <div>
              <span class="qa-modal-eyebrow">New operational record</span>
              <h2 id="qa-request-form-title" class="modal-title">Create QA Request</h2>
            </div>
            <button class="btn-close" type="button" aria-label="Close" :disabled="isSaving" @click="requestCancel"></button>
          </div>

          <div class="modal-body qa-request-form">
            <label class="qa-form-field">
              <span class="form-label">Request title</span>
              <input v-model="form.title" class="form-control" maxlength="180" placeholder="Checkout regression" autofocus />
            </label>

            <label class="qa-form-field">
              <span class="form-label">Objective</span>
              <textarea
                v-model="form.objective"
                class="form-control"
                maxlength="20000"
                placeholder="Verify the critical checkout path and preserve reviewable proof."
              ></textarea>
            </label>

            <div class="qa-form-grid">
              <label class="qa-form-field">
                <span class="form-label">Target <small>optional</small></span>
                <input v-model="form.target" class="form-control" maxlength="500" placeholder="Checkout" />
              </label>
              <label class="qa-form-field">
                <span class="form-label">Environment <small>optional</small></span>
                <input v-model="form.environment" class="form-control" maxlength="500" placeholder="Staging" />
              </label>
            </div>

            <label class="qa-form-field">
              <span class="form-label">Acceptance notes <small>optional</small></span>
              <textarea
                v-model="form.acceptanceNotes"
                class="form-control"
                maxlength="5000"
                placeholder="What must be true before a human can accept this QA record?"
              ></textarea>
            </label>

            <fieldset class="qa-form-field">
              <legend class="form-label">Checklist source</legend>
              <div class="qa-mode-options">
                <label class="qa-mode-option" :class="{ 'qa-mode-option--active': form.checklistMode === 'ODDPATH_GENERATED' }">
                  <input v-model="form.checklistMode" type="radio" value="ODDPATH_GENERATED" />
                  <span>
                    <strong>Generate with Oddpath</strong>
                    <small>Build from Project Instructions, Project Memory, and indexed documents.</small>
                  </span>
                </label>
                <label class="qa-mode-option" :class="{ 'qa-mode-option--active': form.checklistMode === 'AGENT_PROVIDED' }">
                  <input v-model="form.checklistMode" type="radio" value="AGENT_PROVIDED" />
                  <span>
                    <strong>Agent will provide it</strong>
                    <small>Codex, Claude, or another agent submits a candidate for Oddpath review.</small>
                  </span>
                </label>
              </div>
            </fieldset>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
              {{ errorMessage }}
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="requestCancel">Cancel</button>
            <button class="btn btn-primary" type="submit" :disabled="!canSubmit">
              {{ isSaving ? "Creating QA Request…" : "Create QA Request" }}
            </button>
          </div>
        </form>
      </div>
    </div>
    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
