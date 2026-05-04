import { sendMessageToAI } from "./api.js";
import {
  getChats,
  createChat,
  getActiveChat,
  getActiveChatId,
  setActiveChatId,
  addMessageToChat,
  renameChat,
  deleteChat,
} from "./store.js";
import { renderMessages, addMessage } from "./ui.js";
import { renderChatList } from "./sidebar.js";
import { initThemeToggle } from "./theme.js";
import { initQuickActions } from "./quickActions.js";
import { initComposer } from "./composer.js";

const form = document.querySelector("#chat-form");
const newChatBtn = document.querySelector("#new-chat-btn");
const modeSelect = document.querySelector("#qa-mode");

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

    addMessage("answer", aiReply);

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
      "Sorry, something went wrong. Please make sure the backend server is running.";

    console.error(error);
  }
}

newChatBtn.addEventListener("click", () => {
  createChat();
  renderApp();
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

