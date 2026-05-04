import { sendMessageToAI } from "./api.js";
import {
  getChats,
  createChat,
  getActiveChat,
  getActiveChatId,
  setActiveChatId,
  addMessageToChat,
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
const exportChatBtn = document.querySelector("#export-chat-btn");
const importChatInput = document.querySelector("#import-chat-input");

const deleteChatModalElement = document.querySelector("#deleteChatModal");
const confirmDeleteChatBtn = document.querySelector("#confirm-delete-chat");

const deleteChatModal = new bootstrap.Modal(deleteChatModalElement);

const chatLayout = document.querySelector(".chat-layout");

let chatIdToDelete = null;

const composerController = initComposer({ form, modeSelect });

function renderApp() {
  let activeChat = getActiveChat();

  if (!activeChat) {
    activeChat = createChat();
  }

  modeSelect.value = activeChat.mode || "general";

  renderChatList({
    chats: getChats(),
    activeChatId: getActiveChatId(),
    onSelectChat: (chatId) => {
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

  let activeChat = getActiveChat();

  if (!activeChat) {
    activeChat = createChat();
  }

  const mode = composerController.hasSelectedImage()
    ? "screenshot_review"
    : modeSelect.value;

  const imageForRequest = composerController.getRequestImage();
  const attachmentForDisplay = composerController.getDisplayAttachment();

  addMessage("msg", messageForAI, attachmentForDisplay);

  addMessageToChat(activeChat.id, {
    role: "user",
    content: messageForAI,
    attachment: attachmentForDisplay,
    mode,
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
      image: imageForRequest,
    });

    const thinkingMessage = document.querySelector("#chat-area").lastElementChild;
    thinkingMessage.remove();

    addMessage("answer", aiReply, null, mode);

    addMessageToChat(activeChat.id, {
      role: "assistant",
      content: aiReply,
      mode,
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

newChatBtn.addEventListener("click", () => {
  createChat();
  renderApp();
});

exportChatBtn.addEventListener("click", () => {
  const activeChat = getActiveChat();

  if (!activeChat) {
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
    renderApp();
  } catch (error) {
    alert(error.message || "Could not import this chat JSON file.");
  }
});

form.addEventListener("submit", handleSubmit);

confirmDeleteChatBtn.addEventListener("click", () => {
  if (!chatIdToDelete) return;

  deleteChat(chatIdToDelete);
  chatIdToDelete = null;

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

