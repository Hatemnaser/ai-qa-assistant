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
import {
  renderChatList,
  renderMessages,
  addMessage,
  setInputValue,
  getInputValue,
  clearInput,
} from "./ui.js";
import { STORAGE_KEYS } from "./constants.js";

const form = document.querySelector("#chat-form");
const newChatBtn = document.querySelector("#new-chat-btn");
const modeSelect = document.querySelector("#qa-mode");
const themeToggle = document.querySelector("#theme-toggle");

const deleteChatModalElement = document.querySelector("#deleteChatModal");
const confirmDeleteChatBtn = document.querySelector("#confirm-delete-chat");

const deleteChatModal = new bootstrap.Modal(deleteChatModalElement);

let chatIdToDelete = null;

const screenshotInput = document.querySelector("#screenshot-input");
const attachedFileName = document.querySelector("#attached-file-name");
const clearScreenshotBtn = document.querySelector("#clear-screenshot");

let selectedImage = null;

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

  renderMessages(activeChat);
}

async function handleSubmit(event) {
  event.preventDefault();

  const userMessage = getInputValue();

  const messageForAI =
    userMessage || (selectedImage ? "Analyze this screenshot as a QA engineer." : "");

  if (!messageForAI) return;

  let activeChat = getActiveChat();

  if (!activeChat) {
    activeChat = createChat();
  }

  const mode = selectedImage ? "screenshot_review" : modeSelect.value;

  const imageForRequest = selectedImage
    ? {
        mimeType: selectedImage.mimeType,
        data: selectedImage.data,
      }
    : null;

  const displayMessage = selectedImage
    ? `${messageForAI}\n[Attached screenshot: ${selectedImage.name}]`
    : messageForAI;

  addMessage("msg", displayMessage);

  addMessageToChat(activeChat.id, {
    role: "user",
    content: displayMessage,
    mode,
    createdAt: new Date().toISOString(),
  });

  clearInput();
  clearSelectedImage();

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

screenshotInput.addEventListener("change", async () => {
  const file = screenshotInput.files[0];

  if (!file) return;

  const maxSizeInMB = 4;
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

  if (file.size > maxSizeInBytes) {
    alert(`Image is too large. Please upload an image smaller than ${maxSizeInMB}MB.`);
    clearSelectedImage();
    return;
  }

  selectedImage = await fileToBase64(file);
  attachedFileName.textContent = file.name;
  clearScreenshotBtn.classList.remove("d-none");
  modeSelect.value = "screenshot_review";
});

clearScreenshotBtn.addEventListener("click", clearSelectedImage);

confirmDeleteChatBtn.addEventListener("click", () => {
  if (!chatIdToDelete) return;

  deleteChat(chatIdToDelete);
  chatIdToDelete = null;

  deleteChatModal.hide();
  renderApp();
});

document.querySelectorAll(".quick-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;
    const mode = button.dataset.mode;

    setInputValue(prompt);
    modeSelect.value = mode;
    document.querySelector("#message").focus();
  });
});

function updateThemeButton(theme) {
  themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
}

themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme;
  const nextTheme = currentTheme === "dark" ? "light" : "dark";

  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(STORAGE_KEYS.THEME, nextTheme);
  updateThemeButton(nextTheme);
});

const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "light";
document.documentElement.dataset.theme = savedTheme;
updateThemeButton(savedTheme);

renderApp();


function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      const base64Data = result.split(",")[1];

      resolve({
        name: file.name,
        mimeType: file.type,
        data: base64Data,
      });
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function clearSelectedImage() {
  selectedImage = null;
  screenshotInput.value = "";
  attachedFileName.textContent = "No file attached";
  clearScreenshotBtn.classList.add("d-none");
}

