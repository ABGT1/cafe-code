# Desk: compact tab groups around existing chats

Decision status: Accepted. Implementation status: Implemented. Verification:
repository checks and synthetic browser coverage passed on native macOS.

Created: 2026-09-29 11:53:43 JST (UTC+0900).

Last updated: 2026-09-29 12:35:49 JST (UTC+0900).

## Context and scope

The project tree is a catalog, not a good working set for people using a few
chats across many projects. The accepted design adds a Desk/Projects sidebar
switch and compact tab groups without replacing ChatView, its composer,
provider controls, Settings, Atrium, project actions or the sidebar footer.
There is one Desk per client environment, not another workspace hierarchy.
Projectless chats require a separate backend capability and are not invented
by this presentation change. Private design artifacts stay in `.explorations/`;
production source does not import them.

## Decision

`deskModel.ts` is a pure navigation reducer; `deskStore.ts` persists a bounded,
versioned, environment-scoped local preference. Tabs reference existing server
threads or explicit draft identities. A chat has one group membership. The
split tree has at most four panes and the working set at most 256 tabs; reopen
history retains 20 references. Only selected panes mount existing ChatViews.
Flat, identity-keyed pane placement preserves a selected view when moving it
between groups. Switching selected chats retains their existing composer store
and a bounded in-memory timeline position/follow-tail cache.

The parent chat route owns Desk rendering. Child routes retain validation and
deep-link behavior without mounting a second ChatView. Draft promotion changes
the tab identity before retiring the corresponding draft. Route writes are
serialized so a delayed route echo cannot reopen a closed tab or override a
newer selection. Reconciliation runs against a completed authoritative catalog,
not an empty reconnect placeholder. Admission still follows the existing
primary-environment route boundary.

The sidebar retains its original header/footer, project controls and search.
Desk rows and compact tab strips use shell summaries for names/status, never
eager history subscriptions. Direct pencil/F2 rename uses the existing metadata
command. Group titles can be renamed directly. Drag-and-drop reorders tabs,
moves them between groups, splits at pane edges, and swaps groups. Menus offer
split/move/merge/focus alternatives and familiar close/close others/close right/
close group/close all/reopen actions. Closing is always a view-only operation;
it must not stop, archive or delete the chat, or clear its composer/queue.

Pointer drop previews update on both movement and target changes: dnd-kit only
emits `onDragOver` when the target ID changes, so it cannot alone track movement
between the center and edges of one pane. Preview and drop calculations share
the collision detector's viewport pointer coordinates, not scroll-adjusted drag
deltas. Tab hits must be inside their own visible strip and pane; releasing
outside a pane cannot fall back to the dragged tab's overlapping rectangle.
Keyboard gestures retain rectangle-based targeting. Chat content is a local
stacking context so its own overlays cannot cover the sibling drop preview.
These interactions only change local navigation state, never provider state.

Desk sidebar group headings show their chat count at rest and an inline-rename
pencil on hover/keyboard focus. Enter or blur commits, Escape cancels, and IME
composition is not submission. Edits are scoped to the original environment and
group; switching environments cannot apply a stale name to another layout.

Each group has an independently persisted session-rail preference. An unset
group preference inherits the existing global preference; pin/unpin creates
an explicit group override. Splits inherit the source setting and merges keep
the target setting. Existing composer task/context/quota popovers remain the
entry point when undocked or too narrow; group menus can also set the pin. Pane
width, not full-window width, controls whether the rail fits. Focusing a group
temporarily expands it without discarding the saved layout.

## Runtime and safety boundaries

Mounting multiple views must not multiply input dispatch. A shared chat-layout
runtime holds queue persistence, queue snapshots, pending steer/recovery state,
Stop barriers and dispatch gates. Exactly one mounted owner handles each
thread's queue; an active/fallback owner handles queues whose tab is closed.
An empty Desk keeps one hidden, noninteractive queue host. This is UI ownership,
not provider lifecycle authority: no focus/close action creates a provider turn.
The hidden host follows an exact pending draft/server alias during promotion,
including on reload, rather than selecting a server view intentionally suppressed
until that draft is retired. Environment and authoritative deletion checks still
apply before a host is admitted.
Provider receipts, existing command identity and durable queue admission remain
authoritative. Unknown orphan queues are no longer guessed to belong to the
next opened chat in Desk mode. They retain their exact original identity.

Only the active visible pane publishes the global composer handle and debug
snapshot or handles global chat shortcuts. Local composers remain separate.
Focus changes must not pull the cursor away from a deliberately selected tab,
transcript or control. Existing shared detail retention/reconnect mechanisms
are reused rather than creating new sockets. Copy handling is confined to its
actual transcript pane.

Submission gates outlive individual pane mounts. Late acknowledgements only
clear the composer snapshot they sent, not text edited after reopening a tab.
Stop advances a shared generation; asynchronous queued preparation checks that
generation again before its immutable I/O claim. Cancellation before that claim
preserves the saved message as blocked pending input. An ambiguous post-I/O
acknowledgement does not make the message eligible for blind resending.

Persistence treats local storage as untrusted: reject oversized/corrupt graphs,
unknown versions, duplicate ownership, invalid identities, cross-environment
references and prototype-sensitive keys. It stores navigation IDs, short group
names, split ratios and pin flags, never prompts, transcript content, files,
credentials or provider configuration. Failed writes leave navigation usable in
memory. Resize writes coalesce and flush on release/page hide; normal tab actions
persist immediately. No new endpoint, privilege, dependency or provider setting
is introduced.

## Verification and consequences

Model/store tests cover hostile hydration, operation invariants, environment
isolation, promotion, close/reopen and independent rail preferences. Synthetic
browser tests cover sidebar preservation, rename, compact tab interactions,
route echoes, groups, responsive presentation and shared runtime ownership.
Full formatting, lint, typecheck, tests and a final forced desktop build are
completion gates. At 2026-09-29 12:35:49 JST (UTC+0900), those checks passed with
Node 24.13.1 and Corepack Yarn 4.17.1: 4,924 unit/integration tests passed (three
existing skips), 144 combined chat/Desk browser checks plus two original sidebar
footer checks passed, and `yarn build:desktop --force` exited successfully after
tests. Browser tests do not imply native Windows/Linux qualification or live
provider verification. Reproduce with the repository checks in `AGENTS.md` and
`yarn workspace @cafecode/web test:browser` targeting the ChatView navigation,
layout, composer and desk suites, `components/desk`, ChatPaneRuntime, SessionRail,
ComposerTaskProgress and SidebarFooterNavigation.

The tradeoff is bounded multi-pane rendering cost and a larger UI ownership
surface. Keep unselected tabs as references, not hidden ChatViews. The only
hidden view exception is the empty-Desk queue host. Future changes should move
queue orchestration out of ChatView entirely, but must not duplicate the current
durable delivery/Stop/recovery behavior in a second implementation.
