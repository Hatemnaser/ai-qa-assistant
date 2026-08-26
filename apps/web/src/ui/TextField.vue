<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    autocomplete?: string;
    disabled?: boolean;
    id: string;
    hint?: string;
    label: string;
    maxLength?: number;
    minLength?: number;
    modelValue?: string;
    placeholder?: string;
    required?: boolean;
    type?: "email" | "password" | "text";
  }>(),
  {
    disabled: false,
    modelValue: "",
    placeholder: "",
    required: false,
    type: "text",
  }
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

function updateValue(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="d-flex flex-column gap-2">
    <label class="form-label" :for="id">{{ label }}</label>
    <input
      :id="id"
      class="form-control"
      :type="type"
      :autocomplete="autocomplete"
      :disabled="props.disabled"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      :maxlength="props.maxLength"
      :minlength="props.minLength"
      :placeholder="placeholder"
      :required="required"
      :value="props.modelValue"
      @input="updateValue"
    />
    <p v-if="hint" :id="`${id}-hint`" class="form-text mb-0">{{ hint }}</p>
  </div>
</template>
