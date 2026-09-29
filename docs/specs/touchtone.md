# Touchtone: local session messaging

## Purpose

Touchtone lets Pi agents find and message other local Pi sessions without a
broker or a blocking request/reply protocol. The public package is
`pi-touchtone`, the tool is `touchtone`, and the interface is labeled
**📞 Touchtone**. DTMF may be used as internal shorthand, not as a second API.

## Initial interface

- `list` returns live session IDs, names, process IDs, working directories, and
  available terminal workspace/pane handles.
- `send` takes destination locators — `to` and `selectors` are a common
  interface holding any advertised phonebook value (session ID, name, cwd,
  pid, terminal handle, or contributed metadata) — that together must resolve
  to exactly one live session, plus a plain-text message. Success means the
  message was written to the recipient's inbox, not read or answered.
- `broadcast` takes the same locators (`selectors`, with a non-empty `to`
  treated as one more) and a plain-text message, resolves their deduplicated
  union against the live phonebook, excludes the sender, and writes one
  message per recipient with a shared `broadcastId`.
- The interface is deliberately permissive: `list` optionally filters the
  roster by the same locators (naming any that match nothing) and ignores
  `message`, and blank locators are dropped everywhere, so schema-padded
  placeholder values never fail a call. Errors still fail closed — a `send`
  whose locators resolve to zero or several sessions enqueues nothing — and
  every error ends with an example of a successful call. The collapsed tool
  result stays terse: the attempted message bubble in the theme's tool-error
  color above a right-aligned "Not delivered" line (or a bare
  "Failed to send" summary when there is no message), plus an
  "(expand for details)" hint; the full problem text and the example render
  only in the expanded view.
- Pending incoming messages are handed to Pi as one batch. Idle sessions receive
  the batch immediately; calls for a busy session coalesce on disk and is handed
  off once at turn end. Delivery does not interrupt shell commands.

The compact Phonebook shows a session count. Expanded results show a table when
at least 60 columns are available, otherwise retaining the compact summary.
Messages use left-aligned incoming and right-aligned outgoing chat bubbles.
Incoming colors follow Pi's theme; outgoing bubbles use white on terminal blue.
Outgoing text appears while tool arguments stream in, and successful sends show
“Sent.” Pending incoming messages appear as at most five handsets plus an
overflow count and animated dots. The queued handset IDs persist to
`on-deck.json` next to the inbox on every change, so `/reload` re-arms the
same row whenever Pi still reports the messages pending; `session_shutdown`
clears the file.

## Storage and trust boundary

The store root is resolved when constructed: an explicit `root` option, then an
absolute `PI_TOUCHTONE_HOME`, then `$XDG_STATE_HOME/pi/touchtone` when
`XDG_STATE_HOME` is absolute and either that path exists or the legacy root does
not, then the legacy `~/.local/state/pi/touchtone`. Existing installations keep
the legacy root without migration. The root contains owner-only `sessions/`,
`inboxes/`, and `metadata/` directories and owner-readable/writable files.

Phonebook contributors publish flat string or string-array JSON records under
`metadata/<session-id>/<publisher>.json`. Atomic file writes avoid exposing
partially written messages or metadata. Filesystem notifications and polling
discover incoming messages. Dead process registrations are pruned when listing;
age alone does not make a live process stale.

This is a same-OS-user trust boundary, not authenticated or encrypted messaging.
Other processes running as the same user can inspect or forge messages. Incoming
content is not privileged instruction. Do not use Touchtone to transmit secrets.

Delivery is best-effort, not exactly once. Crashes can lose a handoff or cause
repeat delivery, and process-ID reuse can make an old registration appear live.
Messages leave the inbox after the synchronous batch handoff to Pi, not after
the agent acts on them. Malformed inbox files remain available for inspection.
Batches are intentionally unbounded so all queued calls can enter one turn; large
batches consume proportional model context until an overflow policy can preserve
that one-turn behavior.

## Known limitations and deferred work

- The initial implementation addresses persistent Pi session IDs. Multiple live
  attachments to the same conversation are not independently addressed.
- Pi's pending-message API can omit queued custom messages after an abort. The
  pending indicator can disappear while a message remains queued; this is not a
  delivery acknowledgment. See [Pi issue #8349](https://github.com/earendil-works/pi/issues/8349).
  The same API gates the on-deck restore across reloads: if Pi itself has
  dropped the pending queue, the handsets stay down with the messages.
- Sender-facing pickup receipts are deferred to
  [issue #2](https://github.com/nertzy/pi-touchtone/issues/2).
- Operator-assisted routing, callback shortcuts, independent live endpoint
  identities, shutdown notices, and offline notes are outside this initial
  implementation. A naming change does not imply those behaviors are present.
  The [follow-on dialing design](dialing-and-call-lifecycle.md) preserves agreed
  behavior, proposed interfaces, and the decisions still needed.

## Package boundary

The published artifact contains the extension, chat renderer, README, package
manifest, and license. Development tests, working notes, plans, and recordings
are not runtime dependencies. The public source repository may include sanitized
specifications and plans; these must not contain private conversation data or
machine-specific configuration.
