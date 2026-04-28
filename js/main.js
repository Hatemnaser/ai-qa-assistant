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
  onDeleteChat: (chatId) => {
    deleteChat(chatId);
    renderApp();
  },
});

  renderMessages(activeChat);
}

async function handleSubmit(event) {
  event.preventDefault();

  const userMessage = getInputValue();
  if (!userMessage) return;

  let activeChat = getActiveChat();

  if (!activeChat) {
    activeChat = createChat();
  }

  const mode = modeSelect.value;

  addMessage("msg", userMessage);
  addMessageToChat(activeChat.id, {
    role: "user",
    content: userMessage,
    mode,
    createdAt: new Date().toISOString(),
  });

  clearInput();

  addMessage("answer", "Thinking...");

  try {
    const aiReply = await sendMessageToAI({
      message: userMessage,
      mode,
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