import { ref } from "vue";

export function useAuthRequest(defaultErrorMessage: string) {
  const errorMessage = ref("");
  const isSubmitting = ref(false);

  async function submit(action: () => Promise<void>) {
    if (isSubmitting.value) {
      return;
    }

    errorMessage.value = "";
    isSubmitting.value = true;

    try {
      await action();
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : defaultErrorMessage;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    errorMessage,
    isSubmitting,
    submit,
  };
}
