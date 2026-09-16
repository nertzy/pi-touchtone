# Changelog

Notable changes to `pi-touchtone` are documented here.

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
