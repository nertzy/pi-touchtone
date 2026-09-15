# Party line and batched delivery

**Goal:** Let one tool call reach a group of sessions at once (a "party line", 📣), with recipients addressed by an array of identifiers matched against any session metadata — and fix queued-delivery behavior so multiple pending inbox messages are absorbed in a single model turn instead of one turn per message. Ship README documentation for both in the same commit.

**Evidence for the current pain** (observed in a live multi-session session): one sender issued 17 sequential `touchtone send` calls to reach its peers, and the recipient burned 15 separate model turns over ~90 seconds absorbing 15 replies that were all effectively a batch. Root cause (verified against pi internals): each delivered mail triggers its own `sendMessage` with `triggerTurn: true`, and pi's default `steeringMode: "one-at-a-time"` drains exactly one queued steer per assistant turn.

## Decisions

1. **New `broadcast` action** on the existing `touchtone` tool. `send` stays a deterministic one-endpoint operation; multicast is an intentional, separately-named act. 📞 remains the marker for direct mail; 📣 marks broadcast-origin mail.
2. **Selector semantics.** Each selector is a bare string that selects *every* live session where it exactly equals any addressable phonebook value (core field or contributed metadata). The recipient set is the union of all selectors' matches, deduped by `sessionId`, minus the sender's own session. Selectors are deduped before resolution; blank/whitespace-only selectors are rejected as a call error.
3. **Atomic zero-match failure.** If any selector matches zero live sessions, the whole `broadcast` call fails and nothing is enqueued; the error names the failing selectors and suggests `list`. `matchedBy` reports *pre-self-exclusion* live-match counts per selector; recipient and delivery counts are post-self-exclusion.
4. **Self-exclusion.** The sender is silently dropped from the resolved set; the result notes `excludedSelf: true` when that happened. A set that is empty *after* self-exclusion fails with a clear error.
5. **Extensible phonebook via publisher-scoped sidecar files.** The phonebook is a merged view: touchtone's own roster records plus sidecar files that any tool can publish at `metadata/<session-id>/<publisher>.json`. Core identity fields cannot be shadowed by contributed metadata.
6. **One mail file per recipient.** Broadcast fans out into N independent inbox files sharing one `broadcastId` (minted with the existing `crypto.randomUUID()` convention — no new dependency). Ownership, retry, and cleanup semantics per file are unchanged.
7. **Batched, busy-aware delivery.** When the recipient is **idle**, a mailbox sweep delivers all valid pending mails immediately as one combined message. When the recipient is **busy** (streaming) or a prior batch has been delivered but not yet opened by a turn, mail stays on disk and one all-mail sweep runs at `turn_end` — before pi's steering queue drains — so staggered arrivals during a busy period coalesce into a single steer and a single subsequent turn. This refines the earlier "per-sweep" answer: per-sweep-only batching is a no-op for the evidence scenario, because `fs.watch` fires per arriving file and one-at-a-time steering would still spend one turn per message.
8. **XDG-resolved store root with legacy continuity.** One store root for roster, inboxes, and metadata, resolved at store construction in this order (first match wins):
   1. `options.root` (constructor parameter — how tests inject a tmpdir today),
   2. `PI_TOUCHTONE_HOME` env var (**new**; must be an absolute path, else ignored),
   3. `$XDG_STATE_HOME/pi/touchtone` when `XDG_STATE_HOME` is set to an absolute path and either the XDG path already exists or the legacy default root does not,
   4. `~/.local/state/pi/touchtone` (the XDG default state location — **today's location**).
   Existing installs keep their root with zero migration and no stranded mail; fresh installs with a custom `XDG_STATE_HOME` land there. Tests stay hermetic via `options.root` or `PI_TOUCHTONE_HOME` pointed at a fresh tmpdir.

## Identifier matching

Core fields (written by touchtone itself, immutable): `sessionId`, `sessionName`, `pid` (string form), `cwd`, `cmuxWorkspace`, `cmuxSurface`, `cmuxPanel`. Contributed fields: every key in the session's merged sidecar metadata.

- Matching is **exact equality** against any addressable value — no substring matching, so resolution stays deterministic. Sidecar values may be strings or arrays of strings; a string is treated as a one-element array.
- A session matched by several selectors receives exactly one mail.
- Resolution snapshots the live roster and sidecars once per call — no cross-call caching, no persisted groups. Membership of e.g. a workspace selector is always current.
- Only enumerated core fields and contributed metadata values are addressable; a sidecar key colliding with a core field name (`sessionId`, `pid`, …) is ignored entirely, so contributed metadata can never redirect delivery or shadow routing identity.

## Phonebook contract

- Sidecar location: `<store>/metadata/<session-id>/<publisher>.json`, where `<store>` resolves per decision 8. `<publisher>` is a short slug (`ticket`, `pr`, …); one file per publisher per session, so ticket and PR integrations never overwrite each other.
- Sidecar format: a flat JSON object of `string → string | string[]`. Example: `{"ticket": "E-123", "prs": ["https://github.com/org/repo/pull/42"]}`.
- Publication is temp-file-plus-rename (same atomic-write convention as mail files); removal is deleting the file. Readers merge all valid sidecars for a session deterministically: on a key collision between publishers, the publisher whose name sorts first wins.
- Sidecars are merged only for sessions present in the live roster snapshot; sidecars for unknown session ids are ignored. A missing `metadata/` directory is a no-op, not an error.
- Malformed sidecars (bad JSON, non-object top level, non-string leaf values, oversized file — reads are bounded at 64 KB) are skipped individually: that file contributes nothing and is never an error for the caller. Directories and files are created with the same private modes the roster/inbox dirs use today.
- The merge produces a `PhonebookEntry` type: `{ session: TouchtoneSession; metadata: Record<string, string[]>; selectors: string[] }` where `selectors` is the exact list of strings `broadcast` accepts for that session (every core value plus every contributed value).
- `list` output shows each entry's `selectors` as a JSON array — the strings a model copies from `list` are exactly the strings `broadcast` accepts (fixing today's trap where `list` prints prefixed `workspace:<id>` handles that exact matching would reject). Contributed metadata appears in both the model-facing `list` content and the structured details.

## `broadcast` action contract

Schema changes on the existing tool (provider-safe — no `Type.Union`, per pi's documented Google-API limitation):

- `action` enum becomes `"list" | "send" | "broadcast"`.
- `to` stays `string` and remains the exact-session-id target for `send` only.
- New optional `selectors: string[]` (`minItems: 1`) — required for `broadcast`, forbidden for other actions; `to` is forbidden for `broadcast`. Each action accepts exactly its own fields; blank or whitespace-only selectors are rejected.
- `message` is required and non-empty for `broadcast`, as for `send`. `additionalProperties: false` is unchanged.
- Tool description, prompt snippets, prompt guidelines, and call/result renderers are updated for the new action.

Execution: snapshot merged phonebook → dedupe selectors → resolve (decisions 2–4) → on success, fan out one mail per recipient (existing atomic-write path) → return.

**Publication commit point:** all fallible preparation (directory creation, permissions/`chmod`, serialization) happens *before* the publishing rename; the rename is the commit point. A recipient whose rename succeeded is `delivered` even if a later step throws — such post-publication failures are reported as indeterminate, never as safely-failed (reporting them as failed would invite duplicate retries against already-visible mail). Only committed files count toward `delivered`; if zero recipients commit, the call returns a tool error. `failed` lists `{ sessionId, error }` for pre-publication failures.

Result details (`BroadcastDetails`, separate from inbox details): `{ broadcastId, recipients: TouchtoneSession[], matchedBy: Record<string, number>, excludedSelf?: boolean, delivered: number, failed?: { sessionId, error }[] }`. The **model-facing content** (not just details) carries the actionable summary: per-selector match counts, self-exclusion, each recipient's session id and name, and any failures — details alone never reach the model.

## Envelope change

`TouchtoneMessage` gains optional `broadcastId: string` — one UUID per `broadcast` call, shared by all fan-out copies. Validation accepts messages with or without it (plain `send` mail omits it). No other envelope fields change; no group membership is persisted anywhere.

## Batched delivery contract

- **Sweep discipline** (decision 7): idle recipient → sweep and deliver immediately on watcher/poll; busy recipient or unopened prior batch → mail stays on disk; one all-mail sweep runs at `turn_end`, awaited before the steering queue drains.
- Each delivering sweep invokes the callback **once** with the full array of valid mails, and only when at least one valid mail exists — empty and malformed-only sweeps produce zero callbacks and zero `sendMessage` calls (no spurious model turns on every poll).
- The callback makes a single `pi.sendMessage` with `deliverAs: "steer"`, `triggerTurn: true`, `display: true`, content listing each sender **with exact session id** and message, and `details` carrying a new wrapper type `TouchtoneInboxDetails { messages: TouchtoneMessage[] }`. Single-mail sweeps use the same wrapper with a 1-element array — no dual code path.
- **Handoff vs. cleanup are separate boundaries.** `sendMessage` provides only a *synchronous* handoff: on synchronous callback return, unlink exactly that sweep's valid files; on synchronous throw, unlink none and roll back that batch's on-deck additions. Malformed files are never unlinked by batch processing. Asynchronous runtime failures or crashes after handoff are best-effort, not retriable — the README already promises best-effort delivery and the docs will not overstate this as at-least-once.
- `message_start` is UI-state-only: it removes every id in the batch from the on-deck `unopened` set and never decides file deletion. Files whose ids never clear are unlinked as today.
- Renderers and `message_start` **normalize both shapes**: legacy raw `TouchtoneMessage` details (historical bubbles keep rendering) and the new `TouchtoneInboxDetails` wrapper.
- Chat UI renders a batch as one stacked group of bubbles, one per message with sender names preserved: 📞 for direct mail, 📣 per message for broadcast-origin mail (identified by shared `broadcastId`). `renderCall`/`renderResult` layouts for the `broadcast` action are specified in the README and mirror the 📣 result summary.
- Batches are intentionally **unbounded** — the requirement is "everything queued plays at once." The context-size risk of a very large batch is documented; caps are deferred until an overflow policy that preserves one-turn semantics is designed.

## Tool description and guidance

The tool description gains one line for `broadcast` ("send a message to a group of sessions at once; each selector matches every session whose phonebook values contain it — session id, name, cwd, pid, cmux handles, or contributed metadata such as a ticket id"), notes that `list` shows copyable `selectors`, and keeps the existing deliver-as-steer and untrusted-content notes. No new tools are registered.

## Test harness changes (enumerated)

- The harness `tool()` params type widens from `Record<string, string | undefined>` to admit `string[]` for `selectors`.
- The `store.consume` callback signature becomes `(messages: TouchtoneMessage[]) => void`; the fake `pi.sendMessage` records one call per sweep.
- Existing tests asserting the default storage path (`~/.local/state/pi/touchtone`) are retargeted to the resolution chain (decision 8); existing single-message details assertions move to the `TouchtoneInboxDetails` wrapper plus a legacy-shape compatibility test.

## Out of scope

- Dialing, operator, call lifecycle — still deferred per `docs/specs/dialing-and-call-lifecycle.md`; this spec does not implement its proposed machine interface.
- Receipts, acks, or read tracking for broadcasts (`broadcastId` exists to enable these later).
- Substring/fuzzy selector matching; an `includeSelf` opt-in; persisted named groups.
- Store split across XDG dirs or migration of existing state (decision 8 preserves current roots instead).
- Debounced batching beyond the busy-period `turn_end` coalescing in decision 7; batch size caps (deferred above).
- Filing deferred ideas as GitHub Issues — optional follow-up, not a delivery requirement.

## Documentation impact

- Feature / user-facing docs introduced: none (README amended instead of creating a new doc)
- Materially amended existing docs: `README.md` — new 📣 broadcast section (selector semantics with copyable `selectors`, examples: session id, cmux workspace, ticket id), phonebook sidecar contract, store-root resolution chain, batched-delivery behavior note, correction of today's handle-presentation guidance; `docs/specs/touchtone.md` — storage path section updated to the resolution chain
- Derived / memory docs invalidated: none

## Tests (node:test + the existing harness)

- **Selector resolution:** match per core field; match against sidecar string and string-array values; union dedupe across overlapping selectors; zero-match selector fails the whole call with nothing enqueued; blank selector rejected; self excluded (`excludedSelf` reported); selector matching only self fails; `matchedBy` counts are pre-self-exclusion.
- **Phonebook:** publisher-scoped sidecars merge (ticket + PR contributions coexist); core-field-collision key ignored and cannot redirect delivery; sidecar for unknown session id ignored; missing `metadata/` dir is a no-op; malformed and oversized sidecars skipped; `list` shows `selectors` whose strings are accepted verbatim by `broadcast`.
- **Store-root resolution:** `options.root` wins; then `PI_TOUCHTONE_HOME` (fresh tmpdir per test); then valid absolute `XDG_STATE_HOME/pi/touchtone`; then legacy `~/.local/state/pi/touchtone`; legacy-present/legacy-absent interplay with `XDG_STATE_HOME`; non-absolute env values ignored. Tests never touch the developer's real store.
- **Broadcast execution:** one mail file per recipient sharing one `broadcastId`; all fallible prep precedes rename (simulated post-rename throw counts as delivered); zero-commit fan-out returns a tool error; pre-publication failures appear in `failed` without rollback; result content contains counts and recipient ids.
- **Batching:** two pending mails → exactly one `sendMessage`, one `triggerTurn`, both messages in `TouchtoneInboxDetails`, content names both senders with exact ids; staggered arrivals during a busy turn deliver as one steer at `turn_end` and cost one subsequent model turn; idle arrivals deliver immediately; empty and malformed-only sweeps make zero calls; callback throw leaves all files and rolls back on-deck additions; `message_start` clears both ids; renderer stacks both bubbles and renders a legacy-shape historical message; mixed direct/broadcast batch shows 📞 and 📣 per message.

## Open questions

- None blocking. Possible later work: receipts/ack surfaced through `broadcastId`; an `includeSelf` opt-in if a real use appears; substring matching if exact proves too strict in practice; batch overflow policy.
