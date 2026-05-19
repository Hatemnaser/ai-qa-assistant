<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    id: string;
    label: string;
    modelValue?: boolean;
    required?: boolean;
  }>(),
  {
    disabled: false,
    modelValue: false,
    required: false,
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

function updateValue(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="form-check d-flex align-items-center gap-2">
    <input
      :id="id"
      class="form-check-input"
      type="checkbox"
      :checked="props.modelValue"
      :disabled="props.disabled"
      :required="required"
      @change="updateValue"
    />
    <label class="form-check-label" :for="id">{{ label }}</label>
  </div>
</template>
