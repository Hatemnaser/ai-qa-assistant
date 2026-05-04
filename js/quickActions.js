export function initQuickActions({
  modeSelect,
  messageInput,
  setInputValue,
  autoResizeTextarea,
}) {
  document.querySelectorAll(".quick-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt;
      const mode = button.dataset.mode;

      setInputValue(prompt);
      modeSelect.value = mode;
      messageInput.focus();
      autoResizeTextarea();
    });
  });
}
