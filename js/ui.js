export function renderChatList({ chats, activeChatId, onSelectChat }) {
  const chatList = document.querySelector("#chat-list");
  chatList.innerHTML = "";

  chats.forEach((chat) => {
    const button = document.createElement("button");
    button.className =
      chat.id === activeChatId
        ? "chat-list-item active"
        : "chat-list-item";

    button.textContent = chat.title;
    button.addEventListener("click", () => onSelectChat(chat.id));

    chatList.appendChild(button);
  });
}

export function renderMessages(chat) {
  const chatArea = document.querySelector("#chat-area");
  chatArea.innerHTML = "";

  if (!chat || chat.messages.length === 0) {
    chatArea.innerHTML = `
      <div class="welcome-message">
        <h3 class="h5 fw-bold">How can I help with QA today?</h3>
        <p>Try asking for test cases, bug reports, edge cases, or QA checklists.</p>
      </div>
    `;
    return;
  }

  chat.messages.forEach((message) => {
    addMessage(message.role === "user" ? "msg" : "answer", message.content);
  });
}

export function addMessage(className, text) {
  const chatArea = document.querySelector("#chat-area");

  const welcomeMessage = document.querySelector(".welcome-message");
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  const message = document.createElement("div");
  message.className = className;
  message.innerHTML = text.replace(/\n/g, "<br>");

  chatArea.appendChild(message);
  chatArea.scrollTop = chatArea.scrollHeight;
}

export function setInputValue(value) {
  document.querySelector("#message").value = value;
}

export function getInputValue() {
  return document.querySelector("#message").value.trim();
}

export function clearInput() {
  document.querySelector("#message").value = "";
}