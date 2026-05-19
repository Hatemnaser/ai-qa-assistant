<script setup lang="ts">
withDefaults(
  defineProps<{
    id: string;
    label: string;
    required?: boolean;
  }>(),
  {
    required: false,
  }
);
</script>

<template>
  <div class="form-check d-flex align-items-center gap-2">
    <input :id="id" class="form-check-input" type="checkbox" :required="required" />
    <label class="form-check-label" :for="id">{{ label }}</label>
  </div>
</template>
