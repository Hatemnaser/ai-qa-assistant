<script setup lang="ts">
import Icon from "../../../ui/Icon.vue";

type SidebarNavIcon = "folder" | "plus" | "search";

defineProps<{
  active?: boolean;
  icon: SidebarNavIcon;
  label: string;
}>();

const emit = defineEmits<{
  click: [];
}>();
</script>

<template>
  <button class="ui-row ui-row--button ui-row--interactive" :class="{ active }" type="button" @click="emit('click')">
    <span class="ui-row__icon" :class="{ 'ui-row__icon--filled': icon === 'plus' }" aria-hidden="true">
      <Icon :name="icon" />
    </span>
    <span class="ui-row__title">{{ label }}</span>
  </button>
</template>
