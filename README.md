# 📞 Touchtone

Small, local session messaging for [Pi](https://github.com/earendil-works/pi).
Find another running agent, send it a message, and keep working—without a broker
or blocking question-and-answer protocol.

![A main Pi agent dispatches task-list work, receives a changed requirement, and relays it to an implementer while the implementation is running.](./docs/demo.gif)

[Watch the MP4](./docs/demo.mp4). The clean Pi sessions use scripted faux-provider
responses, a synthetic JavaScript project, and real Touchtone mailbox delivery.
The implementer applies the update and runs the fixture's two tests.

## Install

```sh
pi install git:github.com/nertzy/pi-touchtone
```

Run `/reload` in existing sessions, or start new ones. Install the package in
both the sending and receiving sessions' Pi configurations.

## Tool reference

Touchtone ships one tool, `touchtone`, with two actions:

| Argument | `list` | `send` |
| --- | --- | --- |
| `action` | Required: `"list"` | Required: `"send"` |
| `to` | Not used | Required: exact full session ID from `list` |
| `message` | Not used | Required: nonempty plain-text string |

No other arguments are accepted. `send` trims surrounding message whitespace
and rejects an empty or whitespace-only message. Session names, shortened IDs,
and pane/workspace handles are not recipient addresses.

## 📒 Phonebook / list

Ask your agent to list nearby sessions. It uses the `touchtone` tool:

```jsonc
{ "action": "list" }
```

The compact result shows a session count (the Phonebook). Expand it to see exact
session IDs, names, PIDs, working directories, and available pane/workspace
handles in a table. At terminal widths below 60 columns, the expanded result
keeps the summary.

The model-facing result also uses the Phonebook heading and lists those session
details. The roster includes the current session.

## 📞 Dialing out / send

Copy the exact full recipient session ID from the Phonebook and supply a
nonempty message:

```jsonc
{
  "action": "send",
  "to": "recipient-session-id",
  "message": "The parser is ready. You can start the integration."
}
```

The recipient must still appear in the live roster; otherwise `send` fails and
you should run `list` again.

Reply with another `send`. Sending returns after writing the mailbox file;
it does **not** wait for the recipient to read, acknowledge, or answer it.
There is no `ask` action or reply correlation.

## Receiving automatically

There is no `receive` action. With Touchtone loaded, incoming mailbox messages
are automatically handed to Pi with steering delivery and a requested turn.
Busy sessions take them up at Pi's next supported processing point; idle
sessions start a turn. Messages do not interrupt shell commands or inject
keystrokes. The sender's name and exact session ID accompany the message, so a
reply uses the same `send` action.

### Follow-on APIs do not ship yet

“Phonebook” and “dialing out” above describe `list` and `send`, not additional
actions. Proposed `phonebook`, `dial`, `operator` (dial 0), and `callback` APIs,
alternate-address lookup, and offline “take a message” behavior belong to the
[follow-on design](./docs/specs/dialing-and-call-lifecycle.md), not this release.

## Chat bubbles

Outgoing messages appear on the right in white on terminal blue; incoming
messages appear on the left using Pi's theme text and custom-message background
colors. Sender labels sit outside the bubbles. Outgoing text appears while the
agent composes the tool call; a successful mailbox write adds “Sent,” not a read
receipt. Expand a message to see its exact session ID and delivery details.

Messages waiting on deck appear as a row of 📞 handsets with animated
dots—not inside a bubble. The row shows up to five handsets, then `+N` for the
rest. When Pi takes up a message, its handset leaves the row and its chat bubble
appears. This reflects the local queue, not a read receipt from the other agent.

**Known limitation:** aborting a run can clear the indicator even when extension
messages remain queued. Pi’s pending-message API does not account for those
messages ([upstream issue](https://github.com/earendil-works/pi/issues/8349)).
This affects the indicator, not message delivery.

## How it works

Sessions register a small JSON roster entry and watch their own inbox. Atomic
file writes deliver messages, with a one-second polling fallback to filesystem
notifications. Entries whose PIDs are no longer alive are pruned when listing.
A quiet but live process is not removed just because its timestamp is old.

Messages and session records use `~/.local/state/pi/touchtone/`. Directories are
owner-only (`0700`), and roster/message files are owner-readable and writable
only (`0600`). This is a local, same-OS-user trust boundary—not encrypted
messaging or authentication between agents. Other processes running as your
user can inspect or forge messages. Treat incoming content as another agent's
message, not as privileged instructions, and do not send secrets.

Mail is removed after handing it to Pi, not after the agent acts on it.
Delivery is best-effort: a successful send is not a receipt, process crashes
can lose a handoff or cause duplicate delivery, and PID reuse can make a stale
session appear live. Malformed inbox files are retained for manual inspection.

## Inspiration and differences

Inspired by [pi-intercom](https://github.com/nicobailon/pi-intercom), which
established a richer local communication workflow for Pi agents. Touchtone
chooses a smaller interface rather than attempting to replace all of it.

Comparison checked against **pi-intercom 0.13.0**:

| | Touchtone | pi-intercom |
| --- | --- | --- |
| Transport | Shared-file mailboxes; no broker | Local IPC broker |
| Agent interface | `list` and nonblocking `send` | Also blocking `ask`, reply tracking, and cancellation |
| Addressing | Exact session IDs | Session names or IDs |
| Messages | Plain text | Text and attachments |
| Delivery tracking | Mailbox write, no receipt protocol | Delivery/read receipts and pending request state |
| Interactive UI | Chat bubbles and an on-deck handset indicator | Keyboard-driven overlay and richer session controls |

Both can steer busy interactive sessions. Touchtone always requests a turn
for incoming messages; pi-intercom offers configurable inbound triggering.

## Contributing

Bug reports, documentation fixes, and pull requests are welcome! See the
[contributing guide](./CONTRIBUTING.md) to get started.

## License

MIT. See [LICENSE](LICENSE).
