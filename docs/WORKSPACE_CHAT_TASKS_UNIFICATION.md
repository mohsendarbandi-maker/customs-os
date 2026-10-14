# Customs OS Workspace: Chat + Reminders Unification

Status: proposed product and architecture baseline; not yet a database migration.

## Decision

Unify the user experience, permissions model and work-item flow. Do not simply place two independent applications next to each other, and do not create a second task/reminder database.

Keep the existing operational reminders record as the canonical work item for personal reminders, delegated tasks and operational follow-ups. Link that record to chat conversations/messages and existing customs entities. The state, due date and assignee must have one source of truth.

## What exists in the repository today

- Chat already supports direct conversations, groups, company channels, shared-company conversations, cargo-owner and shipment hierarchy, message replies/threads, reactions, pin/star, message receipts, attachments and calls.
- Chat already has a conversation membership model and server-side notification/read-receipt functions.
- Reminders already support private/team visibility, one assignee, due dates, priority, recurrence, delivery scheduling, offline queueing and links to cases, shipments, documents, clients and finance invoices.
- Important current limitation: the reminder-delivery trigger treats team visibility as a notification audience containing every active, non-client profile in the organization. That is too broad for selective collaboration. Replace this with explicit recipients; do not infer that every organization member should see or be notified about every shared item.
- Existing message and reminder data must be preserved. Do not reimplement calls, attachments, realtime messaging, offline handling or reminders as parallel systems.

## Lessons from comparable products

### Microsoft Teams + Loop + Planner

- Teams keeps direct chats and channels as work contexts; tabs provide a stable place for shared files and apps.
- Loop task lists can be embedded in chat, edited where shared, and synchronized with Planner.
- Planner brings together private tasks, tasks assigned to the user, and shared plans in one personal work view.
- Adaptation for Customs OS: task cards and task lists live in conversation context, while the authoritative item also appears in the assignee's personal work inbox.

Official references:
- https://learn.microsoft.com/en-us/microsoft-365/loop/loop-components-teams
- https://support.microsoft.com/en-us/loop/manage-your-tasks-from-loop-task-lists-and-collaborative-notes-in-planner
- https://support.microsoft.com/en-us/planner/teams/getting-started-with-planner-in-teams
- https://support.microsoft.com/en-us/teams/notifications-settings/explore-the-activity-feed-in-microsoft-teams

### Slack

- Lists combine task name, assignee, due date, status, item-level discussion, subscriptions and workflow automation.
- A user can open a focused thread for a single task rather than losing context in a whole channel.
- Due-date and field-change workflows can notify the responsible user or a selected channel.
- Adaptation for Customs OS: every shared work item needs a linked discussion, activity history, targeted notifications and task views; automate repeated customs follow-ups only after the basic ownership and permissions are reliable.

Official references:
- https://slack.com/help/articles/27452748828179-Use-lists-in-Slack
- https://slack.com/help/articles/27588021944339-Slack-lists--Track-project-tasks
- https://slack.com/help/articles/37752114318227-Set-up-automations-for-lists-in-Slack/

### Google Chat

- Group tasks live in a space; a task assigned to a person is also available in that person's personal task list.
- Task creation and updates can notify the space, while the item retains a single shared state.
- Adaptation for Customs OS: the same reminder/task should be visible from the creator's list, the assignee's inbox and the linked conversation without creating copies.

Official reference:
- https://support.google.com/chat/answer/9920628?hl=en-GB

## Product information architecture

Use one Customs OS Workspace shell, with responsive navigation:

- Home: a compact cross-workspace digest of urgent work, overdue items, today's commitments, unread messages and mentions.
- My Work: private reminders, assigned to me, shared with me, created by me, waiting for my review, completed and snoozed.
- Chat: direct messages, internal groups, company channels, cargo-owner/shipment groups and authorized shared-company conversations.
- Activity: one deduplicated feed for assignments, mentions, replies, due-date changes, overdue items, completion/review requests and security-relevant sharing changes.
- Operations: existing cases, shipments, documents and finance views; do not duplicate their business records inside chat.
- A conversation exposes contextual views for Messages, Tasks, Files and Related case/shipment details. On small screens these become tabs or focused sheets, not tiny columns.

Keep existing routes working as deep links. The reminders subdomain may remain an installable entry point/PWA, but it must use the same canonical work records and rules; it must not become an independently implemented reminder system.

## Work-item model and sharing rules

### One authoritative record

Continue using operational reminders as the canonical work item. Add a work-item kind to distinguish a personal reminder from an actionable task if the implementation needs that distinction. Keep the existing entity links so a task can belong to a case, shipment, customs document, shipment document, client or finance invoice.

Minimum fields to retain/use: organization, creator, assignee, title, description, due date and timezone, priority, state, recurrence, linked business entity, created/updated timestamps and completion data.

### Explicit sharing

Use a dedicated per-user sharing table rather than treating visibility = team as organization-wide access. Suggested records include work-item ID, user ID, access role, granted-by user, notification preference, creation time and revoked time.

Separate these concepts in the UI:
- Private: visible only to the creator/owner and permitted administrators under policy.
- Share for visibility: a named colleague can view it, but cannot silently take ownership or complete it.
- Collaborate: named colleagues can comment or contribute, subject to policy.
- Assign: one clearly named responsible person owns execution; the creator remains the requester.
- Claim from a group: eligible group members can volunteer, but only one person becomes the responsible assignee after a server-checked claim.
- Watch: interested colleagues receive selected updates without becoming responsible.

For operational accountability, default to one responsible assignee and allow multiple watchers/contributors. Multi-assignee execution can be added only if a real business process requires it.

### State and accountability

Support a deliberate state machine for shared tasks: Open, Accepted, In progress, Blocked, Waiting for review, Done and Cancelled. Private reminders can use the familiar lightweight flow. Before adding states, audit all existing checks, recurring-completion functions, statistics, delivery triggers, RPCs and filters.

Record an append-only activity history for assignment, sharing/revocation, due-date or priority changes, status changes, claims and completion/review. A task requiring verification must not be silently considered finalized when the assignee marks it complete.

## Chat integration

1. Create from a message: message menu -> Create task/reminder. Prefill the title, preserve a deep link to the source message, then choose due date, priority, responsible person, audience and whether to link it to the current conversation or customs record.
2. Task card in chat: show title, status, assignee, deadline, priority and linked case/shipment. Quick actions are permission-gated. The card reads state from the canonical work item; it must not store a second copy of task status.
3. Open discussion: task card opens the relevant reply/thread or linked conversation at the original context. Replies and files remain governed by existing chat security.
4. Shared task list: conversation's Tasks view is a filtered view of authoritative work items linked to that conversation, not a separate list table containing duplicate tasks.
5. Reverse navigation: a work item opens the linked chat, source message and customs entity. Changes to assignment/status generate a conversation event only when useful and authorized, not noisy messages for every internal field change.
6. Message-to-task AI: suggest title, date and assignee from a discussion, but require the user to confirm before creation or assignment. Never auto-complete or silently assign operational work.

## Data and service design

Recommended additive structures:
- reminder_shares: explicit per-user access grants and roles.
- reminder_conversation_links: links a canonical work item to an authorized conversation and optional source message.
- reminder_activity: append-only work-item activity/audit trail.
- A common Activity inbox/event contract with idempotency keys, while reusing and gradually consolidating existing chat notification and reminder delivery mechanisms instead of introducing another unrelated push subsystem.

Use server-side RPCs for create/share/assign/claim/complete/review transitions. Validate organization, active user, conversation membership and linked business-entity permissions server-side. Apply RLS to every new table and test direct API access, not just UI visibility.

A chat member must not automatically gain access to confidential shipment, client or finance records just because a task card was posted in a conversation. Cross-organization shared-company conversations must have separate, explicit data-sharing rules; do not inherit access to internal reminders from cross-organization chat membership.

For existing records with team visibility, use an explicit migration and audit strategy. Do not silently widen or narrow access for historical reminders. Preserve current records, deduplicate deliveries and explain any legacy items that need an owner to confirm their recipient scope.

## UX standards

- Desktop: compact primary navigation, conversation list, readable message pane and an optional contextual details panel. The details panel can show linked tasks, files and shipment/case information.
- Mobile: thumb-friendly Home, Chat, My Work and Activity navigation; focused conversation and task-detail views; iOS safe-area support and PWA installability.
- Do not force 27 tasks into a single viewport by shrinking text. Keep the workspace frame stable, allow the task panel itself to scroll, and offer Comfortable and Compact density modes with readable minimum typography.
- A task card shows only operationally useful content: title, status, assignee, deadline and priority. Put explanations and secondary metadata behind details.
- Provide global search across messages and authorized work items; search must respect the exact same permissions as normal reads.
- Central notification preferences include per-event controls, quiet hours, urgency, deduplication and a link to the exact task/message.

## Delivery phases

### Phase 0 — Security and data baseline
Inventory the live schema, RLS policies, RPCs, triggers, notification delivery and existing data. Build tests that prove private reminders are private and entity-linked reminders do not leak data. No feature release before this baseline passes.

### Phase 1 — Unified navigation and deep links
Introduce the common Workspace shell, My Work view and contextual Tasks/Files tabs in chat. Reuse existing pages and APIs; preserve routes and PWA entry points. Do not change sharing semantics yet.

### Phase 2 — Explicit sharing and delegation
Add sharing grants, recipient-specific notifications, assignment/claim/review transitions and append-only activity history. Include RLS/RPC tests for owner, assignee, viewer, collaborator, admin, client and cross-organization members.

### Phase 3 — Chat task cards
Create tasks from messages, link cards to canonical work items, enable task-level discussions and make task state updates visible in both chat and My Work in realtime without duplicate records.

### Phase 4 — Unified Activity and notifications
Unify in-app activity, push routing, quiet hours, deduplication and offline reconciliation. Never report delivered/read status unless the existing delivery/receipt protocol confirms it.

### Phase 5 — Customs-specific automation
Add templates from operational stages and documents, AI-assisted task extraction with confirmation, escalation rules, daily summaries and SLA dashboards. Every automation must have a visible source, owner, audit trail and safe retry/idempotency behavior.

## Acceptance criteria before production

- Private reminder: no other regular user can read it via UI, RPC or direct table/API queries.
- Shared-to-one-user reminder appears in that person's My Work and to no unselected colleague.
- Assignment has one accountable owner; a group claim cannot assign the same task to two people under concurrent requests.
- Revoking a share removes future access and stops future notifications to that recipient.
- Task card, My Work and linked business record show the same live status and deadline.
- Posting in a shared-company conversation does not leak internal cargo, client or finance information.
- Completing, reopening, recurring completion and review preserve the existing reminder behavior where intended.
- Tests cover duplicate message delivery, duplicate task creation, offline replay, notification retries and RLS bypass attempts.
- Build, typecheck, lint, tests and browser smoke tests pass before deployment.
