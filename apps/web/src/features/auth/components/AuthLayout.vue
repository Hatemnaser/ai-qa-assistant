<script setup lang="ts">
defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  "toggle-theme": [];
}>();
</script>

<template>
  <main class="auth-page">
    <section class="auth-brand-panel d-flex flex-column justify-content-between">
      <div>
        <button class="btn btn-link mb-5" type="button" @click="emit('back-to-chat')">Back to chat</button>

        <div class="auth-brand">
          <div class="auth-brand-mark d-flex align-items-center justify-content-center" aria-hidden="true">QA</div>
          <p class="auth-kicker">AI QA Assistant</p>
          <h1>Quality work, organized from the first prompt.</h1>
          <p>
            A focused workspace for test cases, bug reports, edge cases, project context, and team QA memory.
          </p>
        </div>
      </div>

      <button class="btn btn-link align-self-start" type="button" @click="emit('toggle-theme')">
        {{ themeToggleLabel }} mode
      </button>
    </section>

    <section class="auth-content d-flex align-items-center justify-content-center" aria-label="Authentication">
      <div class="auth-card">
        <slot />
      </div>
    </section>
  </main>
</template>
