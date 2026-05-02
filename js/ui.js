export function renderChatList({
  chats,
  activeChatId,
  onSelectChat,
  onRenameChat,
  onDeleteChatRequest,
}) {
  const chatList = document.querySelector("#chat-list");

  document.querySelectorAll(".chat-dropdown-menu").forEach((menu) => {
    menu.remove();
  });

  chatList.innerHTML = "";

  chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className =
      chat.id === activeChatId
        ? "chat-list-item active"
        : "chat-list-item";

    const titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "chat-title-btn";
    titleButton.textContent = chat.title;
    titleButton.addEventListener("click", () => onSelectChat(chat.id));

    const renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.className = "chat-rename-input d-none";
    renameInput.value = chat.title;

    function saveRename() {
      const newTitle = renameInput.value.trim();

      titleButton.classList.remove("d-none");
      renameInput.classList.add("d-none");

      if (newTitle && newTitle !== chat.title) {
        onRenameChat(chat.id, newTitle);
      }
    }

    renameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        saveRename();
      }

      if (event.key === "Escape") {
        renameInput.value = chat.title;
        titleButton.classList.remove("d-none");
        renameInput.classList.add("d-none");
      }
    });

    renameInput.addEventListener("blur", saveRename);

    const dropdown = document.createElement("div");
    dropdown.className = "chat-menu";

    const menuButton = document.createElement("button");
    menuButton.type = "button";
    menuButton.className = "chat-menu-btn";
    menuButton.innerHTML = "⋯";
    menuButton.setAttribute("aria-label", "Chat options");

    const menu = document.createElement("ul");
    menu.className = "chat-dropdown-menu";

    const renameItem = document.createElement("li");
    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "dropdown-item";
    renameButton.textContent = "Rename";

    renameButton.addEventListener("click", () => {
      menu.classList.remove("show");

      titleButton.classList.add("d-none");
      renameInput.classList.remove("d-none");
      renameInput.focus();
      renameInput.select();
    });

    renameItem.appendChild(renameButton);

    const deleteItem = document.createElement("li");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "dropdown-item text-danger";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", () => {
      menu.classList.remove("show");
      onDeleteChatRequest(chat.id);
    });

    deleteItem.appendChild(deleteButton);

    menu.appendChild(renameItem);
    menu.appendChild(deleteItem);

    menuButton.addEventListener("click", (event) => {
      event.stopPropagation();

      document.querySelectorAll(".chat-dropdown-menu.show").forEach((openMenu) => {
        if (openMenu !== menu) {
          openMenu.classList.remove("show");
        }
      });

      const buttonRect = menuButton.getBoundingClientRect();

      menu.style.left = `${buttonRect.right + 8}px`;
      menu.style.top = `${buttonRect.top}px`;

      menu.classList.toggle("show");
    });

    dropdown.appendChild(menuButton);

    item.appendChild(titleButton);
    item.appendChild(renameInput);
    item.appendChild(dropdown);

    document.body.appendChild(menu);
    chatList.appendChild(item);
  });
}

function closeChatMenus() {
  document.querySelectorAll(".chat-dropdown-menu.show").forEach((menu) => {
    menu.classList.remove("show");
  });
}

document.addEventListener("click", closeChatMenus);

document.addEventListener(
  "scroll",
  () => {
    closeChatMenus();
  },
  true
);

export function renderMessages(chat) {
  const chatArea = document.querySelector("#chat-area");
  chatArea.innerHTML = "";

  if (!chat || chat.messages.length === 0) {
    chatArea.innerHTML = `
      <div class="welcome-message">
        <h3 class="h5 fw-bold">How can I help with QA today?</h3>
        <p>Try asking for test cases, bug reports, edge cases, screenshots, or QA checklists.</p>
      </div>
    `;
    return;
  }

  chat.messages.forEach((message) => {
    addMessage(
      message.role === "user" ? "msg" : "answer",
      message.content,
      message.attachment || null
    );
  });
}

export function addMessage(className, text, attachment = null) {
  const chatArea = document.querySelector("#chat-area");

  const welcomeMessage = document.querySelector(".welcome-message");
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  const messageWrapper = document.createElement("div");
  messageWrapper.className = className;

  if (className === "answer") {
    if (text !== "Thinking...") {
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
      messageWrapper.appendChild(actions);
    }

    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = window.marked
      ? marked.parse(text)
      : text.replace(/\n/g, "<br>");

    messageWrapper.appendChild(content);
  } else {
    if (attachment) {
      messageWrapper.appendChild(createAttachmentBubble(attachment));
    }

    if (text) {
      const textElement = document.createElement("div");
      textElement.className = "message-text";
      textElement.textContent = text;
      messageWrapper.appendChild(textElement);
    }
  }

  chatArea.appendChild(messageWrapper);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function createAttachmentBubble(attachment) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "chat-attachment-card";
  card.title = "Open attachment";

  if (attachment.type === "image") {
    const image = document.createElement("img");
    image.src = attachment.previewUrl;
    image.alt = attachment.name;
    image.className = "chat-attachment-thumb";

    const meta = document.createElement("div");
    meta.className = "chat-attachment-meta";

    const name = document.createElement("div");
    name.className = "chat-attachment-name";
    name.textContent = attachment.name;

    const type = document.createElement("div");
    type.className = "chat-attachment-type";
    type.textContent = "Image";

    meta.appendChild(name);
    meta.appendChild(type);

    card.appendChild(image);
    card.appendChild(meta);

    card.addEventListener("click", () => {
      window.open(attachment.previewUrl, "_blank");
    });
  }

  return card;
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