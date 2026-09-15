# Dialing and call lifecycle

> **Superseded by:** [docs/specs/2026-09-15-party-line-and-batch-delivery.md](./2026-09-15-party-line-and-batch-delivery.md) - "not a multicast request" constraint only; deterministic one-endpoint resolution otherwise stands

**Status: follow-on design, not implemented by the initial release.**

This document preserves agreed product behavior and separates it from proposals
that still need decisions. The [initial specification](touchtone.md) describes
what exists today: the `touchtone` tool with `list` and `send`, a Phonebook
presentation, chat bubbles, and a pending-message indicator. The full dialing
interface below does not ship merely because the package has been renamed.

## Agreed product behavior

### Operator and Phonebook

- **📒 Phonebook** supports lookup by terminal pane and Pi session ID.
- **🧑‍💼 Operator** is the current agent using deterministic lookup, not a
  separate model or service.
- **Dial 0** invokes: **“Operator. Who would you like to reach?”**
- The operator greeting can ship independently of the complete routing schema.

### Independently addressable live endpoints

A persistent Pi conversation ID is not a unique live address: multiple running
agents may attach to the same conversation. Give each live endpoint a separate
address and retain the persistent conversation ID as metadata. Do not solve
this by refusing the second attachment and leaving that agent unreachable.

Each new conversation binding, including `/new` and `/resume`, gets a fresh
endpoint. Mail for an old address must not silently enter a different
conversation. A uniquely resumed instance of the **same conversation** may be
rediscovered even after renaming or moving panes. Display-name similarity alone
is not evidence of conversation continuity.

### Deterministic resolution and return to sender

Alternate recipient addresses are ways to identify **one endpoint**, not a
multicast request. Conflicting unique matches must be rejected rather than
resolved by argument order or a first-match rule. The sender may inspect the
candidates, choose one, or explicitly send separate messages to several.

Use **↩️ Return to sender**, with a domain failure named `ReturnToSender`, for
rejected resolution. Return actionable candidate addresses and match information.
A rejection must enqueue nothing. Keep that distinct from an accepted message
whose pickup status is unknown; do not automatically resend the latter.

### Calling vocabulary

| Presentation | Meaning |
| --- | --- |
| 📞 Connected | The receiver is off hook. |
| 🎵 On hold | Pending calls, with animated dots and at most five 📞 handsets plus `+N`. |
| ☎️ Call Waiting | An incoming message has not been picked up, whether the agent is busy or idle. |
| ☎️ Hung Up | The endpoint has stopped; its recent conversation peers should be notified. |
| “This number is no longer in service” | A confirmed past endpoint is gone. |

An unknown destination must remain distinct from a confirmed past endpoint.
Telephone-announcement wording is desired; **“☎️ Your call cannot be completed
as dialed.”** is proposed wording, not a settled string.

### Callback

**“*️⃣6️⃣9️⃣ Call back”** replies to the sender of the most recently **picked-up**
incoming message, not the most recent arrival. Preserve that sender's identity.
If the endpoint has gone, allow unambiguous rediscovery of the same conversation;
if resolution is ambiguous, send nothing and return choices.

### Recent peers and shutdown

Recent peers are endpoints this live endpoint exchanges messages with during its
lifetime. The peer set is runtime-only: preserve it across extension reload, but
not process restart. Do not reconstruct it from conversation history, persisted
memories, or prior-run peer records. Quiet clean-shutdown notices and peer-side
dead-process detection are proposed mechanics, not a finalized protocol.

### Take a message

Use **📝 Take a message**, with the operator asking:
**“They’re unavailable. Shall I take a message?”**

Offer this only for a **confirmed past session**. Unknown destinations are not
eligible; multiple historical conversation matches require disambiguation.
Name similarity is insufficient historical evidence. This settles eligibility
and presentation, not storage, retention, collection, or delivery guarantees.

## Proposed machine interface — not yet approved

Human dialing codes can map to named actions rather than overloading recipient
addresses. The proposed action names are `operator`, `phonebook`, `dial`, and
`callback`. Typed alternate addresses would distinguish a live endpoint, a
persistent conversation, and a scoped terminal pane. These are **not** arguments
accepted by the currently implemented tool.

A proposed phonebook entry has a live endpoint ID, persistent session ID,
display name, PID, working directory, and scoped workspace/pane/surface handles.
Short pane references need a scope, and a pane may contain multiple endpoints.
Do not introduce two competing names for the same persistent identity.

Proposed resolution uses one discovery snapshot, returns per-address matches,
and enqueues once only after successful selection. A unique endpoint narrowing
an ambiguous conversation match is a proposal. Suggested rejection reasons are
`not-found`, `ambiguous`, and `conflicting`; the exact schema and decision
procedure remain open.

## Decisions still required

1. **Machine interface:** settle the named actions and typed address structure.
2. **Endpoint reload continuity:** should `/reload` retain an endpoint when the
   conversation binding is unchanged? Keeping it is recommended; it is not yet
   an approved endpoint-lifetime rule.
3. **Pickup boundary:** mailbox handoff, queue admission, and admission to a model
   turn are different events. Choose and verify the boundary before callback or
   receipt logic depends on it. No local event proves model understanding.
4. **Callback lifetime:** decide whether the last picked-up caller survives
   reload and when conversation replacement resets it. Reconstructing it from
   historical conversation files is a separate decision.
5. **Offline collection:** decide whether a unique resumed instance may collect
   a stored note automatically, and who owns collection when several instances
   attach to the same conversation.
6. **Offline storage and retention:** a phonebook history record or tombstone is
   a proposed mechanism, not an approved storage design. Set retention, cleanup,
   and exclusive-claim rules explicitly.
7. **Shutdown protocol:** settle notice transport and failure detection without
   adding model-turn acknowledgment loops or false certainty about delivery.

Keep three outcomes distinct throughout the design: rejected with no enqueue,
explicitly accepted offline storage, and accepted live mail without pickup
acknowledgment. None implies exactly-once delivery or permission to retry blindly.

## Separate follow-on work

- [Pickup receipts, issue #2](https://github.com/nertzy/pi-touchtone/issues/2):
  correlated best-effort control records, quiet sender UI updates, no model turn
  solely for acknowledgment, and “picked up” rather than proof of understanding.
- Watcher resilience: polling should start independently of optional filesystem
  notifications, and runtime watcher errors need handling.
- Roster validation: validate optional fields at the file boundary so a malformed
  record cannot prevent otherwise valid peers from being listed.
- Ownership/lifecycle tests: force interleavings for simultaneous conversation
  attachments, registration replacement, and failure-safe watcher teardown.

Pi lifecycle admission during compaction is an upstream concern. A routing
mismatch was observed in a synthetic probe, but transcript corruption or message
loss was **not** reproduced. Do not describe that hypothesis as a proven data-loss
bug or build a transport workaround without confirming the owning boundary.
