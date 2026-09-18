# 📞 Touchtone

Small, local session messaging for [Pi](https://github.com/earendil-works/pi).
Find another running agent, send it a message, and keep working—without a broker
or blocking question-and-answer protocol.

![A main Pi agent dispatches task-list work, receives a changed requirement, and relays it to an implementer while the implementation is running.](./docs/demo.gif)

[Watch the MP4](./docs/demo.mp4). The clean Pi sessions use scripted faux-provider
responses, a synthetic JavaScript project, and real Touchtone call delivery.
The implementer applies the update and runs the fixture's two tests.

## Install

```sh
pi install git:github.com/nertzy/pi-touchtone
```

Run `/reload` in existing sessions, or start new ones. Install the package in
both the sending and receiving sessions' Pi configurations.

## Tool reference

Touchtone ships one tool, `touchtone`, with three actions:

| Argument | `list` | `send` | `broadcast` |
| --- | --- | --- | --- |
| `action` | Required: `"list"` | Required: `"send"` | Required: `"broadcast"` |
| `to` | Optional: filter locator | One destination locator | One more destination locator |
| `selectors` | Optional: filter locators | More destination locators | Destination locators |
| `message` | Ignored | Required: nonempty plain-text string | Required: nonempty plain-text string |

Destination locators are a common interface: a locator is any value a session
advertises — an exact session ID, session name, working directory, PID, cmux
pane/workspace/surface handle, or contributed metadata such as a ticket ID.
`list` shows each session's copyable locator strings. The interface is
permissive: blank locator strings are dropped, and `list` optionally filters
the roster to sessions matching the given locators — a filter that matches
nothing returns an empty roster with a note explaining how to get the full
one. `send` requires the locators together to resolve to exactly one live
session — if they resolve to several, the call fails, names the candidates,
and suggests `broadcast`; if none resolve, run `list` again. `broadcast`
reaches every match and still fails without sending when any locator matches
nothing. `send` and `broadcast` trim surrounding message whitespace and
reject an empty or whitespace-only message. Every error ends with a full
example of a successful call; the collapsed tool result keeps the attempted
message bubble visible (painted in the theme's tool-error color) above a
right-aligned "Not delivered" line with an "(expand for details)" hint, and
reveals the full problem text and example only when expanded.

## 📒 Phonebook / list

Ask your agent to list nearby sessions. It uses the `touchtone` tool:

```jsonc
{ "action": "list" }
```

Pass locators in `to` or `selectors` to filter the roster to matching
sessions:

```jsonc
{ "action": "list", "selectors": ["E-123"] }
```

A locator that matches no live session is named in the result and simply
filters it out; the full roster is one bare `list` call away.

The compact result shows a session count (the Phonebook). Expand it to see exact
session IDs, names, PIDs, working directories, and available pane/workspace
handles in a table. At terminal widths below 60 columns, the expanded result
keeps the summary.

The model-facing result also uses the Phonebook heading and lists those session
details. Each entry includes a JSON `selectors` array whose strings can be
copied directly into a `broadcast` call. The roster includes the current
session.

## 📞 Dialing out / send

Copy the recipient's session ID from the Phonebook — or use any advertised
locator, such as its session name — and supply a nonempty message:

```jsonc
{
  "action": "send",
  "to": "recipient-session-id",
  "message": "The parser is ready. You can start the integration."
}
```

The locators must resolve to exactly one live session; otherwise `send`
fails, names what each locator matched, and you should run `list` again.

Reply with another `send`. Sending returns after writing the message file;
it does **not** wait for the recipient to read, acknowledge, or answer it.
There is no `ask` action or reply correlation.

## 📣 Party Line

Party Line is group messaging: the `broadcast` action sends one message to the
union of every session selected by the
provided values. Each selector exactly equals one phonebook value: a session
ID, name, working directory, PID string, cmux workspace/surface/panel ID, or
contributed metadata such as a ticket ID. Overlapping matches are deduplicated,
and the sending session is excluded.

```jsonc
{
  "action": "broadcast",
  "selectors": [
    "recipient-session-id",
    "A32F82F2-DEA3-41ED-8B0B-9DFCD016C110",
    "E-123"
  ],
  "message": "Standup update: the integration is ready for review."
}
```

If any selector matches no live session, nothing is sent. Run `list` to inspect
and copy each live session's accepted `selectors` array.

Party Line calls render as a 📣 bubble labeled with the joined selectors. The
result renders a 📣 summary with the delivered count, selector match counts,
recipient identities, self-exclusion, and any failed or indeterminate writes.
Party-line calls come in with the 📣 glyph; direct dials remain 📞.

## Phonebook metadata

Other tools can add addressable values without coupling Touchtone to cmux or a
specific tracker. Publish a flat JSON object at
`<store>/metadata/<session-id>/<publisher>.json`; values are strings or arrays
of strings:

```jsonc
{
  "ticket": "E-123",
  "pullRequests": ["https://github.com/example/project/pull/42"]
}
```

Publish sidecars with a temporary file plus atomic rename, and remove a
publisher's contribution by deleting its file. When publishers contribute the
same key for a session, the publisher whose name sorts first lexically wins.
Core field names are reserved; colliding sidecar keys are ignored. Contributions
apply only to live rostered sessions. Malformed sidecars and files larger than
64 KB are skipped.

## Receiving automatically

There is no `receive` action. With Touchtone loaded, every call waiting for
an idle session rings in as one batched steering message
with one requested turn. While a session is busy, calls coalesce on disk and
ring once at turn end. Calls do not interrupt shell commands or inject
keystrokes. Each sender's name and exact session ID accompany their message,
so replies use `send`.

Batches are intentionally unbounded so everything waiting plays in one turn. A
very large batch therefore consumes proportional model context; caps are
deferred until an overflow policy can preserve the one-turn guarantee.

### Follow-on APIs do not ship yet

“Phonebook” and “dialing out” above describe `list` and `send`, not additional
actions. Proposed `phonebook`, `dial`, `operator` (dial 0), and `callback` APIs,
alternate-address lookup, and offline “take a message” behavior belong to the
[follow-on design](./docs/specs/dialing-and-call-lifecycle.md), not this release.

## Chat bubbles

Outgoing messages appear on the right in white on terminal blue; incoming
messages appear on the left using Pi's theme text and custom-message background
colors. Sender labels sit outside the bubbles. Outgoing text appears while the
agent composes the tool call; a successful inbox write adds “Sent,” not a read
receipt. Expand a message to see its exact session ID and delivery details.

Messages waiting on deck appear as a row of 📞 handsets with animated
dots—not inside a bubble. The row shows up to five handsets, then `+N` for the
rest. When Pi takes up a batch, its handsets leave the row and its stacked chat
bubbles appear together. This reflects the local queue, not a read receipt from
the other agent.

**Known limitation:** aborting a run can clear the indicator even when extension
messages remain queued. Pi’s pending-message API does not account for those
messages ([upstream issue](https://github.com/earendil-works/pi/issues/8349)).
This affects the indicator, not message delivery.

## How it works

Sessions register a small JSON roster entry and watch their own inbox. Atomic
file writes deliver messages, with a one-second polling fallback to filesystem
notifications. Entries whose PIDs are no longer alive are pruned when listing.
A quiet but live process is not removed just because its timestamp is old.

Touchtone resolves one store root when constructed. An explicit `root` option
wins, followed by an absolute `PI_TOUCHTONE_HOME`, then
`$XDG_STATE_HOME/pi/touchtone` when `XDG_STATE_HOME` is absolute and either that
path exists or the legacy root does not. The final fallback is
`~/.local/state/pi/touchtone`. Existing installations keep their legacy root,
so pending calls is not stranded. The root contains `sessions/`, `inboxes/`, and
`metadata/`.

Directories are owner-only (`0700`), and roster/message/metadata files are
owner-readable and writable only (`0600`). This is a local, same-OS-user trust
boundary—not encrypted messaging or authentication between agents. Other
processes running as your user can inspect or forge messages. Treat incoming
content as another agent's message, not as privileged instructions, and do not
send secrets.

Messages are removed after being handed to Pi, not after the agent acts on them.
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
| Transport | Shared-file inboxes; no broker | Local IPC broker |
| Agent interface | `list`, nonblocking `send`, and selector-based `broadcast` | Also blocking `ask`, reply tracking, and cancellation |
| Addressing | Shared phonebook locators for `send` (must resolve to one session) and `broadcast` (reaches every match) | Session names or IDs |
| Messages | Plain text | Text and attachments |
| Delivery tracking | Inbox write, no receipt protocol | Delivery/read receipts and pending request state |
| Interactive UI | Chat bubbles and an on-deck handset indicator | Keyboard-driven overlay and richer session controls |

Both can steer busy interactive sessions. Touchtone always requests a turn
for incoming messages; pi-intercom offers configurable inbound triggering.

## Contributing

Bug reports, documentation fixes, and pull requests are welcome! See the
[contributing guide](./CONTRIBUTING.md) to get started.

## License

MIT. See [LICENSE](LICENSE).
