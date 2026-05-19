<script setup lang="ts">
withDefaults(
  defineProps<{
    autocomplete?: string;
    id: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    type?: "email" | "password" | "text";
  }>(),
  {
    placeholder: "",
    required: false,
    type: "text",
  }
);
</script>

<template>
  <div class="d-flex flex-column gap-2">
    <label class="form-label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="form-control"
      :type="type"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      :required="required"
    />
  </div>
</template>
