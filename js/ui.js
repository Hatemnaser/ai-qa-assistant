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

  const messageWrapper = document.createElement("div");
  messageWrapper.className = className;

  if (className === "answer") {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "message-action-btn";
    copyButton.textContent = "Copy";

    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.className = "message-action-btn";
    downloadButton.textContent = "Download .md";

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyButton.textContent = "Copied!";
        setTimeout(() => {
          copyButton.textContent = "Copy";
        }, 1500);
      } catch (error) {
        copyButton.textContent = "Failed";
        setTimeout(() => {
          copyButton.textContent = "Copy";
        }, 1500);
      }
    });

    downloadButton.addEventListener("click", () => {
      downloadMarkdown(text);
    });

    actions.appendChild(copyButton);
    actions.appendChild(downloadButton);

    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = window.marked
      ? marked.parse(text)
      : text.replace(/\n/g, "<br>");

    messageWrapper.appendChild(actions);
    messageWrapper.appendChild(content);
  } else {
    messageWrapper.textContent = text;
  }

  chatArea.appendChild(messageWrapper);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function downloadMarkdown(content) {
  const blob = new Blob([content], {
    type: "text/markdown;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  link.href = url;
  link.download = `qa-report-${timestamp}.md`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
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