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
