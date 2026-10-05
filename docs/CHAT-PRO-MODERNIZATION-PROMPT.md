# Customs OS — Master Prompt for a Professional Modern Messenger

## Role
Act as a Principal Product Designer + Senior React/TypeScript Engineer + UX Architect. Upgrade the existing Customs OS chat into a modern, production-grade business messenger inspired by the clarity and information architecture of Telegram, WhatsApp Business, and Slack, while preserving the existing Customs OS visual language and backend.

## Non-negotiable architecture
- Keep one integrated chat system. Do not create parallel chat, call, owner, group, or notification subsystems.
- Reuse the existing Supabase schema, RPCs, Realtime channels, storage, PWA service worker, authentication, organization_id isolation, and existing chat hierarchy.
- Do not weaken RLS, auth, storage security, or multi-tenant boundaries.
- Do not move or duplicate chat data to another database.
- UI is Persian RTL, using the existing design tokens and Jalali display conventions.
- Mobile is a first-class web-app/PWA target, especially iPhone Safari.

## Information architecture
The chat landing view must be intentionally calm and sparse.

The top utility navigation must never create a new group/channel merely because the user clicked "گروه". Every utility item opens its own information surface:
- گروه‌ها: list all groups, channels, and shared-company conversations. Provide a secondary action for creating a new group/channel.
- صاحب کالا: list cargo owners. Each owner behaves like a Telegram-style folder and can expand/collapse its shipment subgroups.
- تماس: show call history with caller/callee, status, date/time, and a tap that opens the related conversation.
- اعضا: show active internal organization members with role/phone and allow starting a direct conversation with the selected member.
- پیام جدید: open the direct-message people picker.
- هوش مصنوعی: open the existing Customs OS AI operator.
- تنظیمات: open the full messenger settings panel.

## Mobile header
- The utility navigation must be visually integrated into the active chat header on mobile.
- Never create a second floating or detached header that visually merges into the chat area.
- The conversation header stays compact: back, avatar, title/status, essential actions.
- Utility buttons scroll horizontally and remain touch-friendly.
- Respect safe-area insets.
- Never let the utility row consume the majority of the message viewport.

## Telegram-style chat organization
- Make the chat list feel like folders/sections instead of a dense admin table.
- Keep "صاحب کالا" folders collapsed/expandable.
- Keep direct messages, groups/channels, cargo-owner folders, and shipment subgroups visually distinct.
- Use unread badges sparingly and consistently.
- Avoid redundant buttons that perform the same action in multiple places.

## Messenger settings
Settings must include:
- Light/dark theme
- Accent color
- Wallpaper
- Font size
- Message/notification enablement
- Notification sound
- Call vibration
- Enter-to-send behavior
- Compact vs comfortable density
- Show/hide sender names in groups
- Message-preview preference
- Persist preferences locally and, where available, in the existing user_settings.chat.preferences structure

## Interaction quality
- Every top control has an obvious purpose and correct destination.
- List entries must open the correct conversation or information surface.
- Clicking a member must target that member, not merely reopen an empty people picker.
- Clicking call history must open the related conversation.
- Clicking an owner must open its owner conversation; expanding the owner reveals shipment subgroups.
- Creating a group/channel is a secondary action inside the group directory, not the default result of opening "گروه‌ها".

## Visual system
- Minimal, calm, premium business-messenger UI.
- Avoid excessive borders, giant cards, heavy gradients, or oversized headers.
- Preserve current Customs OS colors and tokens.
- Use consistent 40–48px touch targets.
- Keep desktop efficient and mobile ergonomic.
- Accessibility: keyboard navigation, semantic buttons, aria-labels, visible focus states, readable contrast.

## Reliability
Before considering the feature complete:
1. Run npm install.
2. Run npm run typecheck.
3. Run npm run build.
4. Verify there are no stale dynamic imports or undefined component identifiers.
5. Run a browser-level smoke test for the chat route and mobile header.
6. Check that the four directories (groups, owners, calls, members) open and display the correct data.
7. Ensure the existing voice call, file upload, OCR, push, AI, message actions, and chat hierarchy remain intact.

## Definition of done
The result should feel like a real modern business messenger, not a customs admin panel with chat appended to it. The message viewport is the primary surface; navigation and utilities stay compact and purposeful.
