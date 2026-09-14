# Changelog

Notable changes to `pi-touchtone` are documented here.

## [0.1.0]

### Added

- Added a `touchtone` tool with a `list` action for nearby sessions and a
  nonblocking `send` action for delivering a message to one session.
- Added shared-file mailboxes with atomic writes and a polling fallback to
  filesystem notifications, with no broker or blocking request/reply protocol.
- Added roster entries that prune sessions whose PIDs are no longer alive while
  leaving quiet but live sessions in place.
- Added delivery that steers busy interactive sessions at the next supported
  processing point and triggers a turn in idle sessions.
- Added chat-bubble rendering for incoming and outgoing messages and an on-deck
  handset indicator for messages waiting in the local queue.
- Added owner-only permissions on the message and roster files for the local,
  same-OS-user trust boundary.
