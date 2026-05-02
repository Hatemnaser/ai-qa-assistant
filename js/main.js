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

const messageInput = document.querySelector("#message");
const composer = document.querySelector("#composer");
const screenshotInput = document.querySelector("#screenshot-input");
const attachmentPreview = document.querySelector("#attachment-preview");

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

  const attachmentForDisplay = selectedImage
    ? {
        type: "image",
        name: selectedImage.name,
        mimeType: selectedImage.mimeType,
        previewUrl: selectedImage.previewUrl,
      }
    : null;

  addMessage("msg", messageForAI, attachmentForDisplay);

  addMessageToChat(activeChat.id, {
    role: "user",
    content: messageForAI,
    attachment: attachmentForDisplay,
    mode,
    createdAt: new Date().toISOString(),
  });

  clearInput();
  clearSelectedImage();
  autoResizeTextarea();

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

messageInput.addEventListener("input", autoResizeTextarea);

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

screenshotInput.addEventListener("change", async () => {
  const file = screenshotInput.files[0];
  await handleImageFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  composer.addEventListener(eventName, (event) => {
    event.preventDefault();
    composer.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  composer.addEventListener(eventName, (event) => {
    event.preventDefault();
    composer.classList.remove("drag-over");
  });
});

composer.addEventListener("drop", async (event) => {
  const file = event.dataTransfer.files[0];
  await handleImageFile(file);
});

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
    messageInput.focus();
    autoResizeTextarea();
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
        previewUrl: result,
      });
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${messageInput.scrollHeight}px`;
}

function renderAttachmentPreview() {
  attachmentPreview.innerHTML = "";

  if (!selectedImage) {
    attachmentPreview.classList.add("d-none");
    return;
  }

  attachmentPreview.classList.remove("d-none");

  const card = document.createElement("div");
  card.className = "attachment-preview-card";

  const image = document.createElement("img");
  image.src = selectedImage.previewUrl;
  image.alt = selectedImage.name;

  const info = document.createElement("div");
  info.className = "attachment-preview-info";

  const name = document.createElement("div");
  name.className = "attachment-preview-name";
  name.textContent = selectedImage.name;

  const type = document.createElement("div");
  type.className = "attachment-preview-type";
  type.textContent = "Image";

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "attachment-remove-btn";
  removeButton.textContent = "×";
  removeButton.setAttribute("aria-label", "Remove attachment");
  removeButton.addEventListener("click", clearSelectedImage);

  info.appendChild(name);
  info.appendChild(type);

  card.appendChild(image);
  card.appendChild(info);
  card.appendChild(removeButton);

  card.addEventListener("click", (event) => {
    if (event.target === removeButton) return;
    window.open(selectedImage.previewUrl, "_blank");
  });

  attachmentPreview.appendChild(card);
}

function clearSelectedImage() {
  selectedImage = null;
  screenshotInput.value = "";
  renderAttachmentPreview();
}

async function handleImageFile(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Please upload an image file.");
    return;
  }

  const maxSizeInMB = 4;
  const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

  if (file.size > maxSizeInBytes) {
    alert(`Image is too large. Please upload an image smaller than ${maxSizeInMB}MB.`);
    return;
  }

  selectedImage = await fileToBase64(file);
  modeSelect.value = "screenshot_review";
  renderAttachmentPreview();
}

