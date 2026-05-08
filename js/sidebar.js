export function renderChatList({
  chats,
  activeChatId,
  onSelectChat,
  onRenameChat,
  onExportChat = () => {},
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
    titleButton.title = formatChatTooltip(chat);
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
      closeChatMenus();

      titleButton.classList.add("d-none");
      renameInput.classList.remove("d-none");
      renameInput.focus();
      renameInput.select();
    });

    renameItem.appendChild(renameButton);

    const exportItem = document.createElement("li");
    exportItem.className = "chat-export-item";

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "dropdown-item";
    exportButton.innerHTML = `<span>Export</span><span aria-hidden="true">›</span>`;

    const exportMenu = document.createElement("ul");
    exportMenu.className = "chat-dropdown-menu chat-export-submenu";

    ["MD", "TXT", "CSV", "JSON"].forEach((formatLabel) => {
      const exportFormatItem = document.createElement("li");
      const exportFormatButton = document.createElement("button");
      const format = formatLabel.toLowerCase();

      exportFormatButton.type = "button";
      exportFormatButton.className = "dropdown-item";
      exportFormatButton.textContent = formatLabel;

      exportFormatButton.addEventListener("click", (event) => {
        event.stopPropagation();
        closeChatMenus();
        onExportChat(chat, format);
      });

      exportFormatItem.appendChild(exportFormatButton);
      exportMenu.appendChild(exportFormatItem);
    });

    function openExportMenu() {
      const buttonRect = exportButton.getBoundingClientRect();

      exportMenu.style.left = `${buttonRect.right + 8}px`;
      exportMenu.style.top = `${buttonRect.top}px`;
      exportMenu.classList.add("show");
    }

    function closeExportMenu() {
      exportMenu.classList.remove("show");
    }

    exportItem.addEventListener("mouseenter", openExportMenu);
    exportButton.addEventListener("focus", openExportMenu);

    exportItem.appendChild(exportButton);

    const deleteItem = document.createElement("li");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "dropdown-item text-danger";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", () => {
      closeChatMenus();
      onDeleteChatRequest(chat.id);
    });

    deleteItem.appendChild(deleteButton);

    renameItem.addEventListener("mouseenter", closeExportMenu);
    deleteItem.addEventListener("mouseenter", closeExportMenu);
    renameButton.addEventListener("focus", closeExportMenu);
    deleteButton.addEventListener("focus", closeExportMenu);

    menu.appendChild(renameItem);
    menu.appendChild(exportItem);
    menu.appendChild(deleteItem);

    menu.addEventListener("mouseleave", (event) => {
      if (!exportMenu.contains(event.relatedTarget)) {
        closeExportMenu();
      }
    });

    exportMenu.addEventListener("mouseleave", (event) => {
      if (!menu.contains(event.relatedTarget)) {
        closeExportMenu();
      }
    });

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
    document.body.appendChild(exportMenu);
    chatList.appendChild(item);
  });
}

function closeChatMenus() {
  document.querySelectorAll(".chat-dropdown-menu.show").forEach((menu) => {
    menu.classList.remove("show");
  });
}

function formatChatTooltip(chat) {
  const modeLabel = String(chat.mode || "general")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const updatedAt = chat.updatedAt ? new Date(chat.updatedAt) : null;
  const timeLabel =
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? updatedAt.toLocaleDateString([], { month: "short", day: "numeric" })
      : "";

  return [chat.title, modeLabel, timeLabel].filter(Boolean).join(" · ");
}

document.addEventListener("click", closeChatMenus);

document.addEventListener(
  "scroll",
  () => {
    closeChatMenus();
  },
  true
);
