# SCSS Audit

The Vue app imports SCSS from `apps/web/src/styles/main.scss`. These styles are app-owned now; the old root `scss/` and compiled `css/` pipeline has been removed.

## Cleanup Rule

- Prefer Bootstrap utilities when they express the layout clearly.
- Put raw color values only in the token files: `abstracts/_variables.scss` and `themes/_dark.scss`.
- Component SCSS should consume semantic tokens such as `--surface-*`, `--text-*`, `--border-*`, `--action-*`, and `--status-*`.
- Layout partials should stay structural. Move topbar, auth card, composer, message, row, and form styling to `components/`.
- Keep custom SCSS for product-specific surfaces: sidebar, auth pages, chat bubbles, composer, markdown output, attachments, modals, and dark theme tokens.
- Remove selectors only when they are unused by the Vue app.

## Removed In This Pass

| Selector | Replacement | Reason |
| --- | --- | --- |
| `.auth-field`, `.auth-input`, `.auth-check` | Bootstrap utilities, `.form-control`, `.form-check` | Form controls are now reusable across features. |
| `.auth-control`, `.auth-link` | `.btn-control`, `.btn-link` | Button sizing and link styling now live in the shared button layer. |
| `#new-chat-btn` | `SidebarNavItem` and `.ui-row--button` | Removed the legacy Bootstrap button id and width override. |
| `.sidebar-actions`, `.sidebar-action-btn` | `.sidebar-nav` plus `SidebarNavItem` | Sidebar actions are now compact workspace navigation rows. |
| `.sidebar-item`, `.sidebar-item-btn` | `SidebarChatItem` plus `.ui-row--compact` | Chat history no longer uses card-style wrappers. |
| `.sidebar-nav-item`, `.chat-list-item`, `.chat-title-btn`, `.chat-menu-btn` | `.ui-row`, `.ui-row__button`, `.ui-icon-btn--xs`, `.ui-icon-btn--ghost` | Sidebar rows now share one row system and reusable icon-button sizing. |
| `.sidebar-icon-*` pseudo icons | `src/ui/Icon.vue` | Icons now use one small SVG primitive instead of component-specific SCSS drawings. |
| `.message-action-icon-btn` | `.ui-icon-btn.ui-icon-btn--sm` | Message action buttons now use the shared icon-button pattern. |

## Keep

| Area | Selectors | Usage |
| --- | --- | --- |
| App shell | `.app` | Small mobile layout override around the Vue shell. |
| Sidebar shell | `.sidebar`, `.brand`, `.sidebar-nav`, `.sidebar-section`, `.sidebar-title`, `.chat-list` | Product-specific sidebar sizing, spacing, scroll, and panel behavior. |
| Rows | `.ui-row`, `.ui-row--button`, `.ui-row--compact`, `.ui-row__button`, `.ui-row__title`, `.ui-row__action`, `.ui-row__input`, `.ui-row__icon` | Shared row system used by `SidebarNavItem` and `SidebarChatItem`, ready for settings/projects lists later. |
| Forms | `.form-label`, `.form-control`, `.form-check`, `.form-check-input`, `.form-check-label` | Shared form styling on top of Bootstrap controls and `src/ui` field components. |
| Auth layout | `.auth-page`, `.auth-brand-panel`, `.auth-content` | Auth page shell and responsive grid only. |
| Auth UI | `.auth-card`, `.auth-brand`, `.auth-kicker`, `.auth-divider`, `.auth-switch`, `.auth-google-mark` | Reusable auth page presentation on top of shared button/form patterns. |
| Dropdowns and context menus | `.dropdown-menu`, `.chat-dropdown-menu`, `.topbar-actions-menu`, `.topbar-select-menu`, `.composer-menu`, `.answer-export-menu`, `.chat-export-submenu`, `.dropdown-item-danger` | Shared menu surfaces, fixed-position chat context menu, and export submenu behavior. |
| Chat layout | `.app`, `.chat-layout`, `.chat-area`, `.empty-chat` | Structural chat shell and empty-state layout only. |
| Topbar | `.chat-topbar`, `.topbar-title`, `.topbar-subtitle`, `.topbar-controls`, `.topbar-field`, `.topbar-field-label`, `.topbar-select-dropdown`, `.topbar-select-btn`, `.topbar-icon-btn`, `.topbar-status` | Chat topbar presentation and responsive controls. |
| Chat body | `.welcome-message`, `.welcome-title`, `.welcome-actions`, `.welcome-action`, `.msg`, `.answer` | Message and welcome surfaces backed by semantic tokens. |
| Composer | `.chat-form`, `.composer`, `.drag-over`, `.composer-row`, `.composer-icon-btn`, `.composer-send-btn`, `.composer-textarea`, `.composer-menu`, `.quick-actions` | Custom chat input behavior, sticky form shell, quick actions, and dropup styling. |
| Icon buttons | `.ui-icon-btn`, `.ui-icon-btn--xs`, `.ui-icon-btn--sm`, `.ui-icon-btn--ghost`, `.ui-icon-btn--send` | Shared icon-button base for composer, message actions, and compact row menus. |
| Message actions | `.message-actions`, `.message-action-btn`, `.answer-export-menu`, `.message-text` | Custom answer action layout. |
| Attachments | `.attachment-preview`, `.attachment-preview-card`, `.attachment-preview-info`, `.attachment-preview-name`, `.attachment-preview-type`, `.attachment-remove-btn`, `.chat-attachment-card`, `.chat-attachment-thumb`, `.chat-attachment-meta`, `.chat-attachment-name`, `.chat-attachment-type` | Product-specific image preview and bubble styling. |
| Markdown output | `.answer h1`, `.answer h2`, `.answer h3`, `.answer p`, `.answer li`, `.answer table`, `.answer th`, `.answer td`, `.answer code`, `.answer ul`, `.answer ol` | Required for AI markdown readability. |
| Modals | `.app-modal` plus Bootstrap modal descendants | Keeps modal colors aligned with theme variables. |
| Theme | `:root`, `html[data-theme="dark"]` | Primitive color scales, semantic surfaces, text, borders, actions, status, typography, spacing, layout widths, and Bootstrap variable bridge. |
| Bootstrap theme overrides | `.btn-primary`, `.btn-outline-primary`, `.btn-outline-secondary`, `.btn-danger`, `.btn-link`, `.btn-control`, Bootstrap CSS variables | Needed for token-backed primary, secondary, danger, link, and reusable control sizing. |

## Later Cleanup

Rerun the selector audit against `apps/web/src` when chat UI changes. If Bootstrap can replace a custom selector without hurting parity or clarity, prefer Bootstrap.
