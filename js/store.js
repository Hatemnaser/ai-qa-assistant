import { STORAGE_KEYS, DEFAULT_MODE } from "./constants.js";

export function getChats() {
  const savedChats = localStorage.getItem(STORAGE_KEYS.CHATS);
  return savedChats ? JSON.parse(savedChats) : [];
}

export function saveChats(chats) {
  localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
}

export function createChat() {
  const chat = {
    id: crypto.randomUUID(),
    title: "New QA Chat",
    mode: DEFAULT_MODE,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const chats = [chat, ...getChats()];
  saveChats(chats);
  setActiveChatId(chat.id);

  return chat;
}

export function getActiveChatId() {
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_CHAT_ID);
}

export function setActiveChatId(chatId) {
  localStorage.setItem(STORAGE_KEYS.ACTIVE_CHAT_ID, chatId);
}

export function getActiveChat() {
  const chats = getChats();
  const activeChatId = getActiveChatId();

  return chats.find((chat) => chat.id === activeChatId) || chats[0] || null;
}

export function updateChat(updatedChat) {
  const chats = getChats().map((chat) =>
    chat.id === updatedChat.id
      ? { ...updatedChat, updatedAt: new Date().toISOString() }
      : chat
  );

  saveChats(chats);
}

export function addMessageToChat(chatId, message) {
  const chats = getChats();

  const updatedChats = chats.map((chat) => {
    if (chat.id !== chatId) return chat;

    const messages = [...chat.messages, message];

    return {
      ...chat,
      title:
        chat.title === "New QA Chat" && message.role === "user"
          ? message.content.slice(0, 35)
          : chat.title,
      messages,
      updatedAt: new Date().toISOString(),
    };
  });

  saveChats(updatedChats);
}

export function renameChat(chatId, newTitle) {
  const cleanTitle = newTitle.trim();

  if (!cleanTitle) return;

  const chats = getChats().map((chat) =>
    chat.id === chatId
      ? {
          ...chat,
          title: cleanTitle.slice(0, 50),
          updatedAt: new Date().toISOString(),
        }
      : chat
  );

  saveChats(chats);
}

export function deleteChat(chatId) {
  const chats = getChats().filter((chat) => chat.id !== chatId);
  saveChats(chats);

  const activeChatId = getActiveChatId();

  if (activeChatId === chatId) {
    if (chats.length > 0) {
      setActiveChatId(chats[0].id);
    } else {
      createChat();
    }
  }
}