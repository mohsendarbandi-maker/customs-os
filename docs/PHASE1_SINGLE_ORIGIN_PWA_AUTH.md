# Phase 1 — Single-origin PWA and session durability

## Decision

Customs OS is one installed web app on `https://darbandicommercial.ir`. Chat, reminders and all other workspaces are internal React Router paths. Only `public/manifest.webmanifest` is the install identity.

## What changed

- `index.html` declares one root-scoped manifest, a single PNG Apple touch icon, `viewport-fit=cover`, and the Apple standalone/status-bar metadata.
- `public/manifest.webmanifest` uses `id`, `start_url`, and `scope` equal to `/`, `display: standalone`, the shared ocean-blue theme, and PNG icons at 180, 192 and 512 pixels, including maskable variants.
- Area-specific chat, reminders and mobile manifests were removed. The Worker no longer varies manifest or Apple icon headers using hostname or Referer.
- The old chat/reminders/mobile hostnames are permanent URL aliases. GET/HEAD requests to these origins return a 301 to the primary host; root URLs map to `/chat`, `/reminders`, or `/` respectively. Legacy `.webmanifest` URLs redirect to the one canonical manifest. Query parameters and paths are retained.
- To avoid breaking current integrations during migration, legacy API/auth/realtime/storage/functions/webhook paths are deliberately excluded from the browser-alias redirect. Those endpoints still reach the Worker; third-party clients can be migrated independently.
- Old `?source=pwa` launch URLs return to the canonical home instead of opening a separate chat application.
- Supabase Auth retains `persistSession: true`, `autoRefreshToken: true`, PKCE and the existing storage key. A custom asynchronous storage adapter mirrors the session between localStorage and IndexedDB; explicit removals clear both stores. Safari `visibilitychange`, `pageshow`, and `focus` recovery is throttled and coalesced. Transient network errors do not clear the session.
- Form drafts now persist to localStorage plus IndexedDB and restore before the initial empty form can overwrite them. Existing v1 form drafts are migrated to organization-scoped v2 keys only after a durable copy is written.
- Reminder drafts persist the text, date and selected shipment. A legacy sessionStorage draft is migrated once and removed only after the new copy is accepted.
- Chat composer drafts are scoped by user, organization and conversation, and are flushed on `pagehide` or when the document becomes hidden. They do not replace the existing offline outbox for messages already sent/queued.
- A waiting service worker no longer activates unconditionally. The app displays “نسخهٔ جدید آماده است” and activates only when the user chooses to update, reducing the chance of an open form/chat being replaced mid-entry.
- Offline navigation remains network-only with a precached app-shell/offline fallback; user-specific API responses are not newly cached.

## Security and compatibility notes

- Sessions are not copied between origins. On the first launch after the canonical-origin change, sign in at `darbandicommercial.ir` again if necessary. No session token is put in the URL.
- The Worker redirects only GET/HEAD requests on the three legacy app domains; integration endpoints are intentionally left alone. Smoke checks validate the known root aliases and the old reminders manifest URL.
- The storage fallback only improves persistence when browser storage is available; it cannot guarantee persistence if iOS evicts both localStorage and IndexedDB or the device is force-terminated before any browser storage write completes.
- The Supabase JWT expiry and refresh-token rotation/reuse settings are server-side dashboard settings and are not represented in this repository. They must be verified in the Supabase Auth dashboard; no server-side setting was changed by this PR. Do not rotate signing keys or shorten token lifetime blindly as part of a frontend change.
- This change does not alter RLS, database schemas, customs workflow rules, role checks or finance logic.

## Required post-deploy iPhone steps

1. Delete the old separately installed Chat, Reminders and Mobile icons from the Home Screen. Open `https://darbandicommercial.ir` in Safari, sign in, then use Share → Add to Home Screen to install the single Customs OS app.
2. Verify the canonical page is HTTPS, has one `/manifest.webmanifest` reference, and uses the branded `/pwa/mobile-icon-180.png` Apple touch icon.
3. In Safari and Home Screen mode, test widths 375/390/430 CSS pixels if a responsive inspector is available; also test portrait/landscape, background/resume, keyboard, chat draft restore, reminder date/shipment restore, and a half-complete customs form.
4. Go offline, confirm the offline indicator appears and that already queued operations/messages remain queued rather than falsely marked delivered/saved; reconnect and verify the existing queue recovers.
5. Confirm the “new version” notice appears when a worker waits and that update activation occurs only after tapping the update action.
6. In Supabase Dashboard → Authentication → settings/configuration, review JWT expiry and refresh-token rotation/reuse settings; capture the values before changing anything. The live server-side values could not be verified from frontend source alone.

## Validation status

Automated checks cover the canonical manifest, icon fetches, legacy 301 redirects, Auth storage invariants, durable draft usage, service-worker update opt-in, and the existing Worker/API smoke checks. Physical iPhone/Safari/Home Screen testing is a manual acceptance step and is not claimed as completed by CI.
