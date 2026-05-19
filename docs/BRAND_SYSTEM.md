# Brand And Design System

This document is the source of truth for the AI QA Assistant visual identity and frontend design system. The goal is not to install a full template. The goal is to define a small token-based system that can grow with auth, settings, projects, memory, and future billing pages without making the app feel random.

## Brand Goal

AI QA Assistant should feel:

- Calm, because QA work often starts from uncertainty.
- Precise, because users are looking for defects, edge cases, and risk.
- Modern, because the product is AI-assisted.
- Trustworthy, because test output and reports need to feel reliable.
- Focused, because this is a work tool, not a marketing page.

## Template Strategy

Ready-made templates are useful for inspiration, but not as the final source of truth.

Use templates for:

- Layout references.
- Sidebar and dashboard density.
- Button, dropdown, modal, and table states.
- Light/dark palette inspiration.
- Spacing rhythm.

Do not copy a full template into the repo unless we intentionally decide to adopt its design system. Full templates often bring extra CSS, JS, page structures, and visual assumptions that make a focused app harder to maintain.

Recommended reference sources:

- Bootstrap official docs for color modes and CSS variables.
- Bootswatch for quick Bootstrap palette inspiration.
- Bootstrap Themes marketplace for polished dashboard references.
- AdminLTE or AdminKit for admin/workspace layout patterns only.
- Coolors or Adobe Color for palette exploration.
- WebAIM Contrast Checker before finalizing text and button colors.

## Color Rules

- Use semantic token names, not raw color names in components.
- Keep one primary action color.
- Use one accent color sparingly for highlights, not for every interactive element.
- Keep success, warning, and danger semantic colors separate from brand colors.
- Light mode and dark mode should be sibling palettes, not simple inverted versions.
- Body text should pass WCAG AA contrast.
- Primary buttons should pass contrast against their text color.
- Beige can work, but it should be a warm neutral base, not the whole personality.

## Core Tokens

The design system is split into three layers:

1. Primitive tokens: raw scales such as neutral colors, status colors, spacing, font sizes, and radii.
2. Semantic tokens: product meaning such as app surface, output surface, primary action, secondary action, danger action, dropdown surface, and input surface.
3. Component patterns: Bootstrap-compatible classes and small app primitives that consume semantic tokens.

Components should use semantic tokens. Raw hex values belong only in `apps/web/src/styles/abstracts/_variables.scss` and `apps/web/src/styles/themes/_dark.scss`.

These are the token families the app standardizes around:

```scss
--color-neutral-0
--color-neutral-50
--color-neutral-100
--color-neutral-200
--color-neutral-300
--color-neutral-400
--color-neutral-500
--color-neutral-600
--color-neutral-700
--color-neutral-800
--color-neutral-900

--color-brand-50
--color-brand-100
--color-brand-200
--color-brand-300
--color-brand-400
--color-brand-500
--color-brand-600
--color-brand-700
--color-brand-contrast

--color-success-50
--color-success-500
--color-success-700
--color-warning-50
--color-warning-500
--color-warning-700
--color-danger-50
--color-danger-500
--color-danger-600
--color-danger-contrast

--space-1
--space-2
--space-3
--space-4
--space-5
--space-6
--space-7
--space-8

--radius-sm
--radius-md
--radius-lg
--radius-xl
--radius-2xl
--radius-bubble
--radius-pill

--control-height-sm
--control-height-md
--control-height-lg
--control-height-xl
--row-height-sm
--layout-sidebar-width
--layout-chat-width
--layout-message-width
--layout-composer-width
--layout-auth-card-width
--layout-auth-aside-min
--layout-auth-content-min
--motion-fast

--font-family-base
--font-size-xs
--font-size-sm
--font-size-md
--font-size-lg
--font-size-xl
--font-size-title-xs
--font-size-title-sm
--font-size-title-md
--font-size-title-lg
--font-size-display-sm
--font-size-display-md
--font-size-display-lg
--font-size-body
--font-size-control
--font-size-label
--font-size-output
--font-weight-regular
--font-weight-medium
--font-weight-semibold
--font-weight-bold
--font-weight-extrabold
--line-height-tight
--line-height-base
--line-height-compact
--line-height-readable
--line-height-output
--icon-size-sm
--icon-size-md
--icon-size-lg
--icon-size-xl

--brand-primary
--brand-primary-hover
--brand-primary-contrast

--surface-app
--surface-panel
--surface-raised
--surface-floating
--surface-floating-hover
--surface-dropdown
--surface-dropdown-hover
--surface-output
--surface-user-message
--surface-assistant-message
--surface-input
--surface-interactive
--surface-interactive-hover
--surface-attachment
--surface-attachment-hover
--surface-code
--surface-table-header

--text-main
--text-muted
--text-subtle
--text-inverse
--text-on-primary
--text-on-user-message
--text-on-assistant-message
--text-on-dropdown
--text-on-interactive
--text-on-interactive-hover
--text-on-attachment
--text-code
--border
--border-subtle
--border-strong
--border-interactive
--border-interactive-hover
--border-active
--interactive-border-active
--border-attachment
--border-floating

--status-success-bg
--status-success-text
--status-warning-bg
--status-warning-text
--status-danger-bg
--status-danger-text
--status-danger
--status-danger-hover
--status-danger-contrast

--action-primary-bg
--action-primary-bg-hover
--action-primary-text
--action-primary-border
--action-primary-border-hover
--action-secondary-bg
--action-secondary-bg-hover
--action-secondary-text
--action-secondary-text-hover
--action-secondary-border
--action-secondary-border-hover
--action-danger-bg
--action-danger-bg-hover
--action-danger-text
--action-danger-border
--action-danger-border-hover

--shadow-soft
--shadow-hover
--focus-ring
--focus-ring-soft
```

New code should prefer `--color-*` for primitives and `--surface-*`, `--text-*`, `--border-*`, `--action-*`, or `--status-*` for actual component styling.

## Current Pattern Contract

The active UI foundation is intentionally small:

- Spacing uses `--space-*` tokens for repeated gaps and padding.
- Radius uses `--radius-*` tokens; pills use `--radius-pill`.
- Repeated icon buttons use `.ui-icon-btn`; smaller message actions add `.ui-icon-btn--sm`, and send buttons add `.ui-icon-btn--send`.
- Primary actions use Bootstrap `.btn-primary`, backed by `--action-primary-*` tokens.
- Secondary actions use Bootstrap outline variants or `.ui-row`, backed by `--action-secondary-*` and interactive surface tokens.
- Destructive actions use Bootstrap `.btn-danger`, backed by `--action-danger-*` tokens.
- Repeated full-width action buttons use `.btn-control` with Bootstrap button variants.
- Text-only links use Bootstrap `.btn-link`, backed by muted/text tokens.
- Bootstrap outline buttons are allowed, but `.btn-outline-primary` and `.btn-outline-secondary` share the same secondary interactive pattern.
- Forms use Bootstrap-compatible `.form-control`, `.form-label`, and `.form-check` classes backed by shared input, control-height, font, and focus tokens.
- Reusable UI primitives such as `TextField`, `CheckboxField`, and `Icon` live in `apps/web/src/ui` and should stay thin wrappers over Bootstrap-compatible shared classes.
- Sidebar navigation rows and recent-chat rows use compact row heights, shared hover surfaces, and no permanent card border.
- Row behavior is centralized in `SidebarNavItem`, `SidebarChatItem`, and the `.ui-row*` styles instead of being embedded directly in the sidebar layout.
- Dropdowns all route through `_dropdowns.scss` and Bootstrap dropdown CSS variables.
- Layout SCSS stays structural. Topbar, auth presentation, messages, composer, rows, buttons, and forms live in `styles/components`.
- Component-specific SCSS should only add sizing, layout, or component-only details on top of these patterns.

## Interaction Rules

Components should use the same state pattern unless there is a strong product reason not to:

```text
Default surface:       --surface-interactive
Hover surface:         --surface-interactive-hover
Floating surface:      --surface-floating
Floating hover:        --surface-floating-hover
Dropdown surface:      --surface-dropdown
Dropdown hover:        --surface-dropdown-hover
Input surface:         --surface-input
Output surface:        --surface-output
Default border:        --border-interactive
Hover border:          --border-interactive-hover
Active border:         --interactive-border-active
Primary action:        --action-primary-bg
Primary hover:         --action-primary-bg-hover
Secondary action:      --action-secondary-bg
Secondary hover:       --action-secondary-bg-hover
Destructive action:    --action-danger-bg
Destructive hover:     --action-danger-bg-hover
```

Rules:

- Hover should usually change surface color, not the active border.
- Active state should own the stronger border.
- Sidebar workspace navigation and chat history rows share one hover surface per theme.
- `New Chat` behaves like the active workspace nav row when it represents the current empty/new chat state.
- Chat history rows stay lightweight: no persistent card border, only hover/active surface changes.
- Dropdown, sidebar list, and secondary workspace actions should share one hover surface per theme.
- Dropdowns and upload/attachment cards share floating surface tokens so they do not look like unrelated components.
- Inline code uses code tokens, not danger tokens.
- User-message attachments use attachment tokens, not ad hoc transparent colors.
- Buttons can still use Bootstrap classes, but their colors should come from semantic tokens.

## Dropdown Rules

All dropdown-like menus should use the shared styles in `apps/web/src/styles/components/_dropdowns.scss`.

Covered menus:

- Topbar actions menu.
- Topbar model selector.
- Topbar mode selector.
- Composer attachment menu.
- Assistant answer export menu.
- Sidebar chat context menu.
- Sidebar export submenu.

Rules:

- Menu surface uses `--surface-dropdown`.
- Menu hover/focus/active state uses `--surface-dropdown-hover`.
- Menu text uses `--text-on-dropdown`.
- Menu border uses `--border-floating`.
- Menu shadow uses `--shadow-soft`.
- Topbar menus, composer upload menu, sidebar context menu, and sidebar export submenu must all inherit the same local dropdown tokens from `_dropdowns.scss`.
- Bootstrap dropdown CSS variables must be overridden to the same tokens; do not rely on Bootstrap defaults for menu backgrounds.
- Menu items use `--font-size-md`, `--font-weight-regular`, and `--line-height-compact`.
- Disabled items use `--text-muted` with reduced opacity.
- Destructive dropdown items use `--status-danger-text`; hover/focus/active uses `--status-danger-bg`.
- Context submenus can adjust width, but should not redefine colors, font, hover, or danger states.
- Model and mode controls use custom Bootstrap dropdowns, not native selects, so the open menu is fully themeable.

## Direction A: Warm Precision

Recommended if we want beige, calmness, and trust without making the product feel old.

Psychology:

- Warm off-white lowers friction.
- Graphite actions feel precise and mature without leaning into generic SaaS blue.
- Muted taupe adds warmth without turning into a loud yellow accent.

Light mode:

```text
surface-app:          #F7F3EA
surface-panel:        #FFFCF7
surface-floating:     #F7F3EA
surface-dropdown-hover: #E4DAC9
surface-interactive:  #EFE8DA
surface-interactive-hover: #E4DAC9
surface-user-message: #EFE8DA
surface-input:        #FFFCF7
surface-attachment:   #F7F3EA
surface-code:         #EFE8DA
text-main:            #1F2933
text-muted:           #667085
text-code:            #5F5145
border:               #D8CEC0
border-interactive-hover: #B9AC9A
brand-primary:        #2F3542
brand-primary-hover:  #1F252E
success:              #15803D
danger:               #B42318
danger-hover:         #912018
```

Dark mode:

```text
surface-app:          #0B0B0A
surface-panel:        #151514
surface-floating:     #202020
surface-dropdown:     #202020
surface-dropdown-hover: #2B2B2B
surface-interactive:  #1F1F1D
surface-interactive-hover: #2B2B2B
surface-user-message: #2B2B2B
surface-input:        #151514
surface-attachment:   #202020
surface-code:         #1F1F1D
text-main:            #F3F0EA
text-muted:           #A7A29A
text-code:            #D8B76A
border:               #2E2E2B
border-interactive-hover: #46443F
brand-primary:        #A3A3A3
brand-primary-hover:  #C7C7C7
success:              #8FD0A7
danger-text:          #E7A2A6
danger:               #DC3F45
danger-hover:         #B92F35
```

Best fit:

- Current product.
- QA/chat workspace.
- Future settings/projects pages.

Risk:

- If beige is overused, the app can feel too soft. Keep panels clean and actions crisp.
- If graphite is overused, actions can feel flat. Use hierarchy, hover states, and spacing to keep controls clear.

## Direction B: Clinical Tech

Recommended if we want a sharper enterprise SaaS feel.

Psychology:

- Clean gray surfaces feel operational and efficient.
- Blue/teal feels accurate and systematic.
- Less warmth, more productivity.

Light mode:

```text
surface-app:          #F4F7FA
surface-panel:        #FFFFFF
surface-muted:        #EAF0F6
surface-elevated:     #FFFFFF
text-main:            #111827
text-muted:           #667085
border:               #D7DEE8
brand-primary:        #0F5BCE
brand-primary-hover:  #0B49A6
brand-accent:         #0F766E
brand-accent-soft:    #CCFBF1
success:              #15803D
warning:              #B45309
danger:               #B42318
```

Dark mode:

```text
surface-app:          #0D1117
surface-panel:        #111827
surface-muted:        #1F2937
surface-elevated:     #172033
text-main:            #F9FAFB
text-muted:           #AAB4C3
border:               #303B4D
brand-primary:        #4C8DFF
brand-primary-hover:  #3274EA
brand-accent:         #2DD4BF
brand-accent-soft:    #123B3A
success:              #86EFAC
warning:              #FCD34D
danger:               #FDA4AF
```

Best fit:

- More corporate SaaS.
- Dense dashboards.
- Future analytics or billing sections.

Risk:

- It can look generic if the logo and accent language are not distinctive.

## Direction C: Signal Lab

Recommended if we want something more distinctive and AI/tool-like.

Psychology:

- Deep violet suggests intelligence and synthesis.
- Teal suggests verification and signal.
- Works well for AI tools, but must be restrained.

Light mode:

```text
surface-app:          #F7F6FB
surface-panel:        #FFFFFF
surface-muted:        #EEEAF8
surface-elevated:     #FFFFFF
text-main:            #171423
text-muted:           #6B6478
border:               #DDD7EA
brand-primary:        #6D28D9
brand-primary-hover:  #5B21B6
brand-accent:         #0F766E
brand-accent-soft:    #CCFBF1
success:              #15803D
warning:              #B45309
danger:               #B42318
```

Dark mode:

```text
surface-app:          #12101A
surface-panel:        #191525
surface-muted:        #241F33
surface-elevated:     #211A31
text-main:            #FAF7FF
text-muted:           #C4BBD5
border:               #3B314F
brand-primary:        #8B5CF6
brand-primary-hover:  #7C3AED
brand-accent:         #2DD4BF
brand-accent-soft:    #123B3A
success:              #86EFAC
warning:              #FCD34D
danger:               #FDA4AF
```

Best fit:

- AI-first positioning.
- More memorable visual identity.
- Brand pages later.

Risk:

- Purple AI products are common, so the rest of the identity needs discipline.

## Logo Direction

The first logo should be a simple SVG mark, not a complex illustration.

Promising concepts:

- Checkmark inside a chat bubble.
- QA initials with a small target ring.
- A scan/target symbol with a check dot.
- A bracketed checkmark to suggest test assertions.

Recommended first mark:

```text
Rounded square + target ring + check dot
```

Why:

- It matches QA, precision, and AI scanning.
- It works as favicon, sidebar badge, and app icon.
- It avoids looking like a generic chat app.

## Implementation Plan

1. Pick one direction, or combine A and B.
2. Update `apps/web/src/styles/abstracts/_variables.scss` with semantic tokens.
3. Update `apps/web/src/styles/themes/_dark.scss` with the selected dark mode tokens.
4. Add Bootstrap CSS variable overrides for primary, body, border, and focus colors.
5. Replace hard-coded danger and focus colors with semantic variables.
6. Add a first SVG brand mark under `apps/web/src/assets/brand/`.
7. Add a small sidebar logo mark only after the final mark is chosen.
8. Run `npm run build:web` and a manual visual pass in light/dark mode.

## Current Recommendation

Start with Direction A: Warm Precision.

It supports the warm neutral idea, but keeps actions and dark-mode controls in graphite/gray instead of blue or beige. It also gives us a stronger emotional baseline than the current default Bootstrap blue on gray.

## Initial Implementation

The first implementation uses Direction A as the active palette. Component styles now use semantic tokens directly instead of legacy aliases like `--bg-app`, `--primary`, or `--success-bg`.

Implemented now:

- Light and dark primitive color scales using `--color-neutral-*`, `--color-brand-*`, and status scales.
- Semantic surface, text, border, action, status, spacing, sizing, typography, icon, and layout tokens.
- Bootstrap primary and body variable overrides.
- Shared spacing, radius, control-height, row-height, layout width, font, line-height, icon-size, and motion tokens.
- Shared focus ring and soft shadow tokens.
- Neutral graphite primary actions instead of default blue.
- Matte black dark mode with warm neutral surfaces.
- Separate neutral surfaces for user messages, dropdowns, and secondary interactive rows.
- Primary, secondary, and danger buttons now consume `--action-*` tokens.
- Secondary interactive controls now share `--surface-interactive`, `--surface-interactive-hover`, and border interaction tokens.
- Dark-mode interactive controls avoid beige surfaces; dropdowns, action buttons, and list items use gray surfaces with explicit hover states.
- Sidebar now uses a compact workspace nav for `New Chat`, `Search`, and `Projects`, inspired by Claude/ChatGPT sidebar density.
- Recent chats are a lightweight scrolling history list, not card-like buttons.
- Sidebar nav and chat history rows share the same hover surface; active state is shown by background, not a permanent border.
- Long chat titles use an inner text span for reliable ellipsis.
- Auth pages use the same semantic surfaces, borders, input styles, and primary/secondary button rules as the chat workspace.
- Layout partials were trimmed so `_chat-layout.scss` and `_auth.scss` only own page structure; component presentation moved into component partials.
- Composer attach/send controls and assistant message action controls share `.ui-icon-btn`.
- Quick action buttons use the same interactive surface rules as other secondary actions.
- Danger buttons use Bootstrap `.btn-danger`, backed by semantic danger tokens instead of one-off modal styling.
- Inline code and attachment cards no longer borrow danger colors or raw rgba values.
- Sidebar uses one clear wordmark, `AI QA Assistant`, while the final logo mark is still undecided.

Still intentionally open:

- Final logo shape.
- Product font choice.
- Full component inventory.
- Search and Projects nav behavior.
- Future page layout patterns for settings, projects, and memory.
