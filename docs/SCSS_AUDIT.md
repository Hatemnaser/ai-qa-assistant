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

## Keep

| Area | Selectors | Usage |
| --- | --- | --- |
| App shell | `.app` | Small mobile layout override around the Vue shell. |
| Sidebar shell | `.sidebar`, `.brand`, `#new-chat-btn`, `.sidebar-section`, `.sidebar-title` | Product-specific sidebar sizing and scrolling. |
| Chat list | `.chat-list`, `.chat-list-item`, `.chat-title-btn`, `.chat-rename-input`, `.chat-menu`, `.chat-menu-btn` | Custom interaction surface. |
| Context menus | `.chat-dropdown-menu`, `.chat-export-item`, `.chat-export-submenu` | Custom fixed-position menu behavior. |
| Chat layout | `.chat-layout`, `.chat-topbar`, `.topbar-controls`, `.topbar-field`, `.topbar-field-label`, `.topbar-select`, `#qa-mode`, `.topbar-icon-btn`, `.topbar-actions-menu`, `.status` | Keeps topbar parity. |
| Chat body | `.chat-area`, `.welcome-message`, `.welcome-actions`, `.welcome-action`, `.msg`, `.answer`, `.chat-form`, `.quick-actions`, `.empty-chat` | Product-specific chat layout. |
| Composer | `.composer`, `.drag-over`, `.composer-row`, `.composer-icon-btn`, `.composer-send-btn`, `.composer-textarea`, `.composer-menu` | Custom chat input behavior and dropup styling. |
| Message actions | `.message-actions`, `.message-action-btn`, `.message-action-icon-btn`, `.answer-export-menu`, `.message-text` | Custom answer action controls. |
| Attachments | `.attachment-preview`, `.attachment-preview-card`, `.attachment-preview-info`, `.attachment-preview-name`, `.attachment-preview-type`, `.attachment-remove-btn`, `.chat-attachment-card`, `.chat-attachment-thumb`, `.chat-attachment-meta`, `.chat-attachment-name`, `.chat-attachment-type` | Product-specific image preview and bubble styling. |
| Markdown output | `.answer h1`, `.answer h2`, `.answer h3`, `.answer p`, `.answer li`, `.answer table`, `.answer th`, `.answer td`, `.answer code`, `.answer ul`, `.answer ol` | Required for AI markdown readability. |
| Modals | `.app-modal` plus Bootstrap modal descendants | Keeps modal colors aligned with theme variables. |
| Theme | `:root`, `html[data-theme="dark"]` | CSS variable theme system. |
| Bootstrap theme overrides | `.form-select`, `.btn-outline-primary`, `.text-secondary` | Needed for theme-variable colors. |

## Later Cleanup

Rerun the selector audit against `apps/web/src` when chat UI changes. If Bootstrap can replace a custom selector without hurting parity or clarity, prefer Bootstrap.
