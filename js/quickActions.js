export function initQuickActions({
  modeSelect,
  messageInput,
  setInputValue,
  autoResizeTextarea,
}) {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-btn");

    if (!button) return;

    const prompt = button.dataset.prompt;
    const mode = button.dataset.mode;

    setInputValue(prompt);
    modeSelect.value = mode;
    modeSelect.dispatchEvent(new Event("change"));
    messageInput.focus();
    autoResizeTextarea();
  });
}
