# SCSS Audit

The Vue app imports SCSS from `apps/web/src/styles/main.scss`. These styles are app-owned now; the old root `scss/` and compiled `css/` pipeline has been removed.

## Cleanup Rule

- Prefer Bootstrap utilities when they express the layout clearly.
- Keep custom SCSS for product-specific surfaces: sidebar, chat bubbles, composer, markdown output, attachments, modals, and dark theme tokens.
- Remove selectors only when they are unused by the Vue app.

## Removed In This Pass

| Selector | Replacement | Reason |
| --- | --- | --- |
| `.form-control` overrides | None | No current legacy or Vue usage. |
| `#new-chat-btn` | `.sidebar-nav-item` | Removed the legacy Bootstrap button id and width override. |
| `.sidebar-actions`, `.sidebar-action-btn` | `.sidebar-nav`, `.sidebar-nav-item` | Sidebar actions are now compact workspace navigation rows. |
| `.sidebar-item`, `.sidebar-item-btn` | `.chat-list-item`, `.chat-title-btn` | Chat history no longer uses card-style wrappers. |
| `.message-action-icon-btn` | `.ui-icon-btn.ui-icon-btn--sm` | Message action buttons now use the shared icon-button pattern. |

## Keep

| Area | Selectors | Usage |
| --- | --- | --- |
| App shell | `.app` | Small mobile layout override around the Vue shell. |
| Sidebar shell | `.sidebar`, `.brand` | Product-specific sidebar sizing and panel behavior. |
| Sidebar nav | `.sidebar-nav`, `.sidebar-nav-item`, `.sidebar-nav-icon`, `.sidebar-nav-icon-search`, `.sidebar-nav-icon-project` | Compact workspace navigation inspired by Claude/ChatGPT. |
| Chat history | `.sidebar-section`, `.sidebar-title`, `.chat-list`, `.chat-list-item`, `.chat-title-btn`, `.chat-title-text`, `.chat-rename-input`, `.chat-menu`, `.chat-menu-btn` | Scrollable recent-chat list with lightweight row states. |
| Dropdowns and context menus | `.dropdown-menu`, `.chat-dropdown-menu`, `.topbar-actions-menu`, `.topbar-select-menu`, `.composer-menu`, `.answer-export-menu`, `.chat-export-item`, `.chat-export-submenu`, `.dropdown-item-danger` | Shared menu surfaces, fixed-position chat context menu, and export submenu behavior. |
| Chat layout | `.chat-layout`, `.chat-topbar`, `.topbar-title`, `.topbar-subtitle`, `.topbar-controls`, `.topbar-field`, `.topbar-field-label`, `.topbar-select-dropdown`, `.topbar-select-btn`, `.topbar-icon-btn`, `.topbar-status` | Keeps topbar parity. |
| Chat body | `.chat-area`, `.welcome-message`, `.welcome-title`, `.welcome-actions`, `.welcome-action`, `.msg`, `.answer`, `.chat-form`, `.quick-actions`, `.empty-chat` | Product-specific chat layout. |
| Composer | `.composer`, `.drag-over`, `.composer-row`, `.composer-icon-btn`, `.composer-send-btn`, `.composer-textarea`, `.composer-menu` | Custom chat input behavior and dropup styling. |
| Icon buttons | `.ui-icon-btn`, `.ui-icon-btn--sm`, `.ui-icon-btn--send` | Shared icon-button base for composer and message actions. |
| Message actions | `.message-actions`, `.message-action-btn`, `.answer-export-menu`, `.message-text` | Custom answer action layout. |
| Attachments | `.attachment-preview`, `.attachment-preview-card`, `.attachment-preview-info`, `.attachment-preview-name`, `.attachment-preview-type`, `.attachment-remove-btn`, `.chat-attachment-card`, `.chat-attachment-thumb`, `.chat-attachment-meta`, `.chat-attachment-name`, `.chat-attachment-type` | Product-specific image preview and bubble styling. |
| Markdown output | `.answer h1`, `.answer h2`, `.answer h3`, `.answer p`, `.answer li`, `.answer table`, `.answer th`, `.answer td`, `.answer code`, `.answer ul`, `.answer ol` | Required for AI markdown readability. |
| Modals | `.app-modal` plus Bootstrap modal descendants | Keeps modal colors aligned with theme variables. |
| Theme | `:root`, `html[data-theme="dark"]` | CSS variable theme system. |
| Bootstrap theme overrides | `.btn-outline-primary`, `.btn-outline-secondary`, `.btn-danger`, Bootstrap CSS variables | Needed for theme-variable colors. |

## Later Cleanup

Rerun the selector audit against `apps/web/src` when chat UI changes. If Bootstrap can replace a custom selector without hurting parity or clarity, prefer Bootstrap.
