# Changelog

Notable changes to `pi-touchtone` are documented here.

## [Unreleased]

### Added

- Added terminal handles for cmux, herdr, tmux, zellij, WezTerm, and kitty as
  exact-match phonebook locators, with mixed-terminal handles shown in `list`.
- Added launcher metadata from `PI_TOUCHTONE_METADATA` and gated
  `PI_SUBAGENT_*` inputs: agent, run, and other launch values are dialable,
  while a non-dialable parent session ID provides spawned-by annotations.
  Launch state survives reloads and session switches within the process.

## [0.3.0] - 2026-10-13

### Added

- Added a `touchtone:on-deck` pi event carrying the number of received calls
  still waiting for the model, so other extensions can mirror it (for example
  as a terminal tab indicator).
- Added pi-galley support: chat bubbles run against the terminal edges and wrap
  at pi-galley's measure when it is narrower than 72% of the terminal.

### Fixed

- Fixed touchtone calls failing when the model pads unused arguments with
  placeholder values: blank locators are ignored, `to` and `selectors` accept
  any advertised phonebook value, `list` can filter the roster by locators, and
  every error ends with an example of a successful call.
- Fixed collapsed failed-call results showing the full error text; they now
  show the attempted message above a terse "Not delivered" line (or a one-line
  "Failed to …" summary when there is no message), with details on expand.
- Fixed failed outgoing bubbles looking like sent ones; they now use the error
  background with a right-aligned "Not delivered" status.
- Fixed the on-deck indicator disappearing after `/reload` while calls were
  still queued.
- Fixed the on-deck indicator staying blank while calls waited in a busy
  session's inbox; it now arms when a call arrives.

## [0.2.0] - 2026-09-16

### Added

- Added Party Line group messaging: a `broadcast` action that delivers one
  message to every session
  matching an array of selectors, where each selector matches against any
  phonebook value (session id, name, working directory, pid, cmux handles, or
  contributed metadata) and any selector with no matches fails the send
  atomically.
- Added publisher-scoped phonebook metadata: any process can extend its own
  roster entry by writing `<store>/metadata/<session-id>/<publisher>.json`,
  and those values become Party Line selectors.
- Added copyable `selectors` arrays to `list` output for addressing sessions
  by any phonebook value.
- Added batched inbox delivery: all queued calls arrive in one combined
  message, and calls for busy sessions coalesce on disk until the session
  finishes its turn.
- Added an XDG-compliant store root honoring `PI_TOUCHTONE_HOME` and
  `XDG_STATE_HOME`, defaulting to `~/.local/state/pi/touchtone` as before.

## [0.1.0] - 2026-09-14

### Added

- Added a `touchtone` tool with a `list` action for nearby sessions and a
  nonblocking `send` action for delivering a message to one session.
- Added shared-file inboxes with atomic writes and a polling fallback to
  filesystem notifications, with no broker or blocking request/reply protocol.
- Added roster entries that prune sessions whose PIDs are no longer alive while
  leaving quiet but live sessions in place.
- Added delivery that steers busy interactive sessions at the next supported
  processing point and triggers a turn in idle sessions.
- Added chat-bubble rendering for incoming and outgoing messages and an on-deck
  handset indicator for messages waiting in the local queue.
- Added owner-only permissions on the message and roster files for the local,
  same-OS-user trust boundary.
