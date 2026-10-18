# Customs OS — Phase 0 iPhone/PWA audit
Date: 2026-10-18
Branch: `fix/ios-single-mobile-navigation`

## Scope and route inventory

The router in `src/App.tsx` has the following major route families. Most use lazy imports; Chat and Reminders have their own substantial feature trees.

| Section | Representative route(s) | Main UI/style owner | Audit finding before this change |
|---|---|---|---|
| Home / operations dashboard | `/`, `/control` | `DesktopHomePage.tsx`, `index.css` | Header has a decorative English tagline; the four statistic tiles use a dense horizontal row and labels can wrap at narrow widths. |
| Shipment entry and customs stages | `/operations`, its `tab` variants, `/cases`, `/stage` | shipment/customs pages + utility CSS | Responsive styling depends on shared Tailwind utilities plus late global overrides; some stage tables intentionally scroll horizontally and must not expand the viewport. |
| Documents, permits, declarations | `/documents`, `/permit-rules`, `/print-declaration`, `/documents/extract` | route-specific React components | Different page-level headers and table patterns; preserve horizontally scrollable tables rather than clipping their content. |
| Chat / calls / internal users | `/chat`, ChatPage internal views | `features/chat/ChatPage.tsx` and chat-specific classes | Chat has its own full-viewport header/composer; it previously bypassed AppShell, so app-wide tabs would not appear consistently. |
| Reminders / calendar / settings | `/reminders/*` | `features/reminders/RemindersPage.tsx`, `responsive.css`, `index.css` | Reminders maintained a second fixed five-item nav and legacy rules set the page/root to hidden `100dvh`; its old mobile width also included `calc(100% + 20px)`. |
| Finance / accounting | `/finance`, `/finance/accounting-vouchers`, `/erp` | finance-specific pages + `customs-accounting-voucher.css` | Print/accounting styles coexist with global styles; print layouts need separate validation and should not inherit the fixed mobile tab bar. |
| Maritime / weather / anchorage | `/maritime`, `/marine-conditions`, `/vessel-search` | maritime pages | Dense status data and maps require their own internal scroll areas; global page width must remain at the viewport width. |
| CRM / knowledge / organization settings | `/crm`, `/knowledge`, `/settings/*` | feature/page components | Uses shared shell in normal routes but varies in cards and page-level actions. Role filtering in the central nav must remain the source of visibility. |
| Authentication / onboarding | `/login`, `/onboarding` | dedicated auth pages | Intentionally bypass AppShell and should remain so. |

## Root causes found in code

1. **Sidebar/rail and clipping:** `AppShell.tsx` mounted the sidebar on all routes and relied on Tailwind's `hidden md:flex` to hide it. The CSS had conflicting rules: at `min-width:768px`, `index.css` forced `.app-sidebar{display:none!important}`, while also promoting the old scrim/drawer to a visible fixed overlay. Several later rules changed `.app-content` back to `overflow:visible`; the reminders page also had an explicit width greater than its parent. These overlapping rules made breakpoints and horizontal clipping hard to reason about.
2. **Duplicate mobile navigation:** Chat and Reminders were both included in AppShell's `bare` condition, so neither used the global dock. Reminders then rendered its own fixed five-item nav. The main shell had a top hamburger that reopened the long side drawer, so the mobile app had multiple navigation systems.
3. **Search and Safari dock:** the shipment search is **not** coded as fixed; it sits in the shipment status card toolbar. On long pages the fixed dock can overlap the last part of the scrollable content because the shell's reserved bottom space was inconsistent with safe-area handling. In the old CSS the dock was positioned only `8px + safe-area` from the bottom and the body also added safe-area padding, which could double-count some layouts.
4. **Header and theme:** the shell mobile header included a hamburger and a theme-cycle button. The page-level dashboard header also included a verbose English tagline and two buttons. Theme therefore occupied scarce mobile header space instead of being placed under Settings/More.
5. **Stats and text:** the stats row used a divider-based horizontal layout with tiny labels. Persian headings have some wrapping rules, but not all grid/flex children were protected from min-content sizing and overlong labels. The tagline used wide letter spacing on a narrow screen.
6. **Persian dates:** dashboard date and time were locale formatted with Persian locale digits, but separated by a slash instead of the requested Persian comma.

## Visual consistency comparison

| Area | Before | Main inconsistency | Target |
|---|---|---|---|
| Main shell | Glass header + role-aware sidebar + bottom dock | Drawer/hamburger/sidbar rules overlapped; sidebar hidden at tablet widths | One compact header, one five-tab dock below 1024px; sidebar only on desktop >=1024px |
| Chat | Chat-owned header, folders, conversation composer | Did not inherit AppShell navigation because route was marked bare | Keep Chat's composer/header, use shell dock in inbox and hide dock while inside a conversation |
| Reminders | Independent dense screen, extra fixed tab nav | Different nav system and fixed-height root; content width could exceed viewport | Keep reminder workflows and quick-add; remove duplicate nav and reserve room for the shared dock |
| Dashboard | Statistic row, shipping status board, decorative subtitle | Labels may wrap and English tagline consumes room | Two-column compact stats; one-line labels; hide decorative tagline on mobile |
| Tables/status boards | Wide operational tables/cards | Some intentionally wide rows can drive overflow if not confined | Keep inner horizontal scroll, prevent outer page from becoming wider than the viewport |
| Finance/documents/settings | Page-owned cards and forms | Mixed local style layers | Preserve behavior; apply shell-level viewport/touch rules without changing domain logic |

## Changes in this first remediation slice

- Mount the desktop sidebar only when `matchMedia('(min-width: 1024px)')` matches. It is absent from the React tree on narrower viewports.
- Use a compact, hamburger-free mobile/tablet header and a single five-item bottom navigation: Home, Operations, Reminders, Chat, More.
- Replace the old side drawer with a keyboard-dismissible, scrollable More bottom sheet containing role-visible routes in a 3-column icon grid, plus Appearance, Profile, and Sign out.
- Include Chat and Reminders in the global shell. Keep the dock while browsing the chat inbox and hide it in an open conversation, when the composer needs the viewport.
- Remove the reminders-only fixed nav in JSX; its page-header quick-add remains available.
- Unify mobile viewport dimensions around `100dvh`, safe-area padding, and a matching bottom content reserve. Keep shipment search in normal document flow above the list.
- On the dashboard, use a two-column stats grid at touch widths, hide the decorative English tagline, and use the Persian comma.

## CSS mental-check matrix (not physical-device certification)

| Viewport | Safari tabbed browser | Home Screen standalone | Expected checks |
|---|---|---|---|
| 375 × viewport | Header content stays in one row; five dock cells fit; More grid remains 3 columns; content can scroll to its end above dock | Same dimensions plus non-zero bottom safe area handled by `env()` | No DOM sidebar/hamburger; no page-level horizontal overflow; 16px inputs |
| 390 × viewport | Slightly more room for long Persian titles; dock labels remain single-line | Dock sits above Home Indicator and content reserve increases with safe-area inset | Search stays in shipment toolbar, not fixed; More sheet scrolls independently |
| 430 × viewport | All dock items keep consistent widths; stats stay two columns | Full-width sheet aligns to viewport and bottom inset | Chat composer has a full viewport when a conversation is selected; reminders quick-add still reachable |

This matrix is a CSS/code-level reasoned check, not a real iPhone Safari/Home Screen run. The repository build and tests are the automated evidence; final physical device checks remain part of the release checklist.
