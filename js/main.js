import { sendMessageToAI } from "./api.js";
import {
  DEFAULT_MODE,
  DEFAULT_MODEL,
  GEMINI_MODELS,
  SCREENSHOT_REVIEW_MODEL,
  getModelConfig,
  normalizeModel,
  supportsImages,
} from "./constants.js";
import {
  getChats,
  createChat,
  getActiveChat,
  getActiveChatId,
  setActiveChatId,
  clearActiveChatId,
  addMessageToChat,
  updateChat,
  importChat,
  renameChat,
  deleteChat,
} from "./store.js";
import { renderMessages, addMessage } from "./ui.js";
import { renderChatList } from "./sidebar.js";
import { initThemeToggle } from "./theme.js";
import { initQuickActions } from "./quickActions.js";
import { initComposer } from "./composer.js";
import {
  exportChatCsv,
  exportChatJson,
  exportChatMarkdown,
  exportChatText,
  parseImportedChatJson,
} from "./export.js";

const form = document.querySelector("#chat-form");
const newChatBtn = document.querySelector("#new-chat-btn");
const modeSelect = document.querySelector("#qa-mode");
const modelSelect = document.querySelector("#model-select");
const exportChatBtn = document.querySelector("#export-chat-btn");
const importChatInput = document.querySelector("#import-chat-input");

const deleteChatModalElement = document.querySelector("#deleteChatModal");
const confirmDeleteChatBtn = document.querySelector("#confirm-delete-chat");

const deleteChatModal = new bootstrap.Modal(deleteChatModalElement);

const chatLayout = document.querySelector(".chat-layout");

let chatIdToDelete = null;
let draftChat = createDraftChat();

const composerController = initComposer({ form, modeSelect });
const placeholdersByMode = {
  general: "Ask about QA strategy, risks, or testing ideas...",
  test_cases: "Describe the feature or requirement to test...",
  bug_report: "Describe the issue, actual result, and expected result...",
  edge_cases: "Describe the feature and I will look for edge cases...",
  checklist: "Describe the product, feature, or release scope...",
  screenshot_review: "Add notes about what to inspect in the screenshot...",
};

function createDraftChat(settings = {}) {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title: "New QA Chat",
    mode: DEFAULT_MODE,
    model: DEFAULT_MODEL,
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...settings,
  };
}

function getActiveViewChat() {
  if (draftChat) return draftChat;

  const activeChat = getActiveChat();

  if (activeChat) return activeChat;

  draftChat = createDraftChat();
  return draftChat;
}

function renderModelOptions(selectedModel) {
  modelSelect.innerHTML = "";

  GEMINI_MODELS.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.value;
    option.textContent = model.label;
    option.title = model.recommendedFor;
    modelSelect.appendChild(option);
  });

  modelSelect.value = normalizeModel(selectedModel);
  updateModelHint();
}

function updateModelHint() {
  const selectedModel = normalizeModel(modelSelect.value);
  const selectedConfig = getModelConfig(selectedModel);
  const screenshotRecommendation =
    modeSelect.value === "screenshot_review"
      ? ` Screenshot review is best with ${SCREENSHOT_REVIEW_MODEL}.`
      : "";

  modelSelect.title = `${selectedConfig.label}: ${selectedConfig.recommendedFor}.${screenshotRecommendation}`;
}

function getModelForMode(mode, requestedModel) {
  const selectedModel = normalizeModel(requestedModel);

  if (mode === "screenshot_review" && !supportsImages(selectedModel)) {
    return SCREENSHOT_REVIEW_MODEL;
  }

  return selectedModel;
}

function syncModelForMode(mode) {
  const model = getModelForMode(mode, modelSelect.value);
  modelSelect.value = model;

  return model;
}

function updateComposerPlaceholder() {
  composerController.messageInput.placeholder =
    placeholdersByMode[modeSelect.value] || placeholdersByMode.general;
}

function renderApp() {
  const activeChat = getActiveViewChat();

  const model = normalizeModel(activeChat.model);

  modeSelect.value = activeChat.mode || DEFAULT_MODE;
  renderModelOptions(model);
  updateComposerPlaceholder();

  renderChatList({
    chats: getChats(),
    activeChatId: draftChat ? null : getActiveChatId(),
    onSelectChat: (chatId) => {
      draftChat = null;
      setActiveChatId(chatId);
      renderApp();
    },
    onRenameChat: (chatId, newTitle) => {
      renameChat(chatId, newTitle);
      renderApp();
    },
    onExportChat: (chat, format) => {
      exportSidebarChat(chat, format);
    },
    onDeleteChatRequest: (chatId) => {
      chatIdToDelete = chatId;
      deleteChatModal.show();
    },
  });

  chatLayout.classList.toggle(
    "empty-chat",
    !activeChat || activeChat.messages.length === 0
  );

  renderMessages(activeChat);
}

function updateActiveChatSettings(settings) {
  const activeChat = getActiveViewChat();

  if (!activeChat) return;

  if (draftChat && activeChat.id === draftChat.id) {
    draftChat = {
      ...draftChat,
      ...settings,
      updatedAt: new Date().toISOString(),
    };
    return;
  }

  updateChat({
    ...activeChat,
    ...settings,
  });
}

function exportSidebarChat(chat, format) {
  const exporters = {
    md: exportChatMarkdown,
    txt: exportChatText,
    csv: exportChatCsv,
    json: exportChatJson,
  };

  const exporter = exporters[format];

  if (exporter) {
    exporter(chat);
  }
}

async function handleSubmit(event) {
  event.preventDefault();

  const userMessage = composerController.getInputValue();

  const messageForAI =
    userMessage ||
    (composerController.hasSelectedImage()
      ? "Analyze this screenshot as a QA engineer."
      : "");

  if (!messageForAI) return;

  let activeChat = getActiveViewChat();

  const mode = composerController.hasSelectedImage()
    ? "screenshot_review"
    : modeSelect.value;
  const model = getModelForMode(mode, modelSelect.value);
  const history = buildRequestHistory(activeChat);

  const imageForRequest = composerController.getRequestImage();
  const attachmentForDisplay = composerController.getDisplayAttachment();
  const isDraftChat = draftChat && activeChat.id === draftChat.id;

  if (isDraftChat) {
    activeChat = createChat({
      ...activeChat,
      mode,
      model,
    });
    draftChat = null;
  }

  addMessage("msg", messageForAI, attachmentForDisplay);

  addMessageToChat(activeChat.id, {
    role: "user",
    content: messageForAI,
    attachment: attachmentForDisplay,
    mode,
    model,
    createdAt: new Date().toISOString(),
  });

  chatLayout.classList.remove("empty-chat");

  composerController.clearInput();
  composerController.clearSelectedImage();
  composerController.autoResizeTextarea();

  addMessage("answer", "Thinking...");

  try {
    const aiReply = await sendMessageToAI({
      message: messageForAI,
      mode,
      model,
      history,
      image: imageForRequest,
    });

    const thinkingMessage = document.querySelector("#chat-area").lastElementChild;
    thinkingMessage.remove();

    addMessage("answer", aiReply.reply, null, aiReply.mode || mode);

    addMessageToChat(activeChat.id, {
      role: "assistant",
      content: aiReply.reply,
      mode: aiReply.mode || mode,
      model: aiReply.model || model,
      createdAt: new Date().toISOString(),
    });

    renderApp();
  } catch (error) {
    const thinkingMessage = document.querySelector("#chat-area").lastElementChild;
    thinkingMessage.textContent =
      error.message ||
      "Sorry, something went wrong. Please make sure the backend server is running.";

    console.error(error);
  }
}

function buildRequestHistory(chat) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const chatModel = normalizeModel(chat?.model);

  return messages
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .slice(-8)
    .map((message) => {
      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
        mode: message.mode || chat.mode || DEFAULT_MODE,
        model: normalizeModel(message.model || chatModel),
      };
    });
}

newChatBtn.addEventListener("click", () => {
  draftChat = createDraftChat();
  clearActiveChatId();
  renderApp();
});

exportChatBtn.addEventListener("click", () => {
  const activeChat = getActiveViewChat();

  if (!activeChat || (draftChat && activeChat.id === draftChat.id)) {
    alert("There is no active chat to export.");
    return;
  }

  exportChatJson(activeChat);
});

importChatInput.addEventListener("change", async () => {
  const file = importChatInput.files[0];
  importChatInput.value = "";

  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".json")) {
    alert("Please choose a JSON chat export file.");
    return;
  }

  try {
    const rawJson = await file.text();
    const chat = parseImportedChatJson(rawJson);

    importChat(chat);
    draftChat = null;
    renderApp();
  } catch (error) {
    alert(error.message || "Could not import this chat JSON file.");
  }
});

form.addEventListener("submit", handleSubmit);

modeSelect.addEventListener("change", () => {
  const model = syncModelForMode(modeSelect.value);

  updateModelHint();
  updateComposerPlaceholder();
  updateActiveChatSettings({
    mode: modeSelect.value,
    model,
  });
});

modelSelect.addEventListener("change", () => {
  const model = syncModelForMode(modeSelect.value);

  updateActiveChatSettings({
    model,
  });
  updateModelHint();
});

confirmDeleteChatBtn.addEventListener("click", () => {
  if (!chatIdToDelete) return;

  deleteChat(chatIdToDelete);
  chatIdToDelete = null;
  draftChat = getActiveChat() ? null : createDraftChat();

  deleteChatModal.hide();
  renderApp();
});

initQuickActions({
  modeSelect,
  messageInput: composerController.messageInput,
  setInputValue: composerController.setInputValue,
  autoResizeTextarea: composerController.autoResizeTextarea,
});

initThemeToggle();

renderApp();
composerController.autoResizeTextarea();

