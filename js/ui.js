import {
  exportAnswerJson,
  exportCsvFromMarkdownTable,
  exportMarkdown,
  exportText,
} from "./export.js";

export function renderMessages(chat) {
  const chatArea = document.querySelector("#chat-area");
  chatArea.innerHTML = "";

  if (!chat || chat.messages.length === 0) {
    chatArea.innerHTML = `
      <div class="welcome-message">
        <h3 class="h4 fw-bold">How can I help with QA today?</h3>
        <p>Choose a starting point or write your own QA request.</p>
        <div class="welcome-actions">
          <button type="button" class="quick-btn welcome-action"
            data-mode="test_cases"
            data-prompt="Generate test cases for a login page">
            Test Cases
          </button>
          <button type="button" class="quick-btn welcome-action"
            data-mode="bug_report"
            data-prompt="Create a structured bug report for: login button does not work">
            Bug Report
          </button>
          <button type="button" class="quick-btn welcome-action"
            data-mode="edge_cases"
            data-prompt="Suggest edge cases for a checkout page">
            Edge Cases
          </button>
          <button type="button" class="quick-btn welcome-action"
            data-mode="checklist"
            data-prompt="Create a QA checklist for a web application">
            Checklist
          </button>
        </div>
      </div>
    `;
    return;
  }

  chat.messages.forEach((message) => {
    addMessage(
      message.role === "user" ? "msg" : "answer",
      message.content,
      message.attachment || null,
      message.mode || chat.mode
    );
  });
}

export function addMessage(className, text, attachment = null, mode = "general") {
  const chatArea = document.querySelector("#chat-area");

  const welcomeMessage = document.querySelector(".welcome-message");
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  const messageWrapper = document.createElement("div");
  messageWrapper.className = className;

  if (className === "answer") {
    const content = document.createElement("div");
    content.className = "message-content";
    content.innerHTML = window.marked
      ? marked.parse(text)
      : text.replace(/\n/g, "<br>");

    messageWrapper.appendChild(content);

    if (text !== "Thinking...") {
      messageWrapper.appendChild(createAnswerActions(text, mode));
    }
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
    if (attachment.previewUrl) {
      const image = document.createElement("img");
      image.src = attachment.previewUrl;
      image.alt = attachment.name;
      image.className = "chat-attachment-thumb";
      card.appendChild(image);
    }

    const meta = document.createElement("div");
    meta.className = "chat-attachment-meta";

    const name = document.createElement("div");
    name.className = "chat-attachment-name";
    name.textContent = attachment.name;

    const type = document.createElement("div");
    type.className = "chat-attachment-type";
    type.textContent = attachment.previewUrl ? "Image" : "Image attachment";

    meta.appendChild(name);
    meta.appendChild(type);

    card.appendChild(meta);

    if (attachment.previewUrl) {
      card.addEventListener("click", () => {
        window.open(attachment.previewUrl, "_blank");
      });
    }
  }

  return card;
}

function createAnswerActions(text, mode) {
  const actions = document.createElement("div");
  actions.className = "message-actions d-flex justify-content-end gap-2";

  const copyButton = createMessageActionButton("Copy", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyButton.title = "Copied";
      setTimeout(() => {
        copyButton.title = "Copy";
      }, 1500);
    } catch (error) {
      copyButton.title = "Copy failed";
      setTimeout(() => {
        copyButton.title = "Copy";
      }, 1500);
    }
  });

  copyButton.classList.add("message-action-icon-btn");
  copyButton.setAttribute("aria-label", "Copy answer");
  copyButton.title = "Copy";
  copyButton.innerHTML = copyIconSvg();

  actions.appendChild(copyButton);

  actions.appendChild(createExportDropdown(text, mode));

  return actions;
}

function createExportDropdown(text, mode) {
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown";

  const exportButton = createMessageActionButton("Export", () => {});
  exportButton.classList.add("message-action-icon-btn");
  exportButton.setAttribute("aria-label", "Export answer");
  exportButton.setAttribute("aria-expanded", "false");
  exportButton.setAttribute("data-bs-toggle", "dropdown");
  exportButton.title = "Export";
  exportButton.innerHTML = exportIconSvg();

  const menu = document.createElement("ul");
  menu.className = "dropdown-menu dropdown-menu-end answer-export-menu";

  menu.appendChild(createExportMenuItem("MD", () => exportMarkdown(text)));
  menu.appendChild(createExportMenuItem("TXT", () => exportText(text)));
  menu.appendChild(createExportMenuItem("CSV", () => exportCsvFromMarkdownTable(text)));
  menu.appendChild(
    createExportMenuItem("JSON", () => exportAnswerJson({ content: text, mode }))
  );

  dropdown.appendChild(exportButton);
  dropdown.appendChild(menu);

  return dropdown;
}

function createExportMenuItem(label, onClick) {
  const item = document.createElement("li");
  const button = document.createElement("button");

  button.type = "button";
  button.className = "dropdown-item";
  button.textContent = label;
  button.addEventListener("click", onClick);

  item.appendChild(button);

  return item;
}

function createMessageActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);

  return button;
}

function copyIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
}

function exportIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <path d="M7 10l5 5 5-5"></path>
      <path d="M12 15V3"></path>
    </svg>
  `;
}

