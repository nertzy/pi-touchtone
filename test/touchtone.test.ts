import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsDefault, * as fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

import {
  ChatBubble,
  OnDeckIndicator,
  renderMailLabel,
} from "../chat-bubble.ts";
import { createTouchtoneExtension, TouchtoneStore } from "../extension.ts";

const roots: string[] = [];

// Terminal escape sequences require the ESC control character, which Biome's
// noControlCharactersInRegex flags inside regex literals. Building the pattern
// from a named constant keeps the intent explicit and the rule satisfied.
const ESC = "\x1b";
const ansi = (pattern: string): RegExp => new RegExp(`${ESC}${pattern}`);

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-touchtone-"));
  roots.push(root);
  return root;
}

type HarnessComponent = { render(width: number): string[]; dispose?(): void };
type HarnessTool = {
  name: string;
  label: string;
  renderShell?: string;
  renderCall?: (...args: unknown[]) => HarnessComponent;
  renderResult?: (...args: unknown[]) => HarnessComponent;
  execute: (
    callId: string,
    params: Record<string, string | undefined>,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
  }>;
};

function harness(id: string, name: string, root: string, pid = process.pid) {
  const handlers = new Map<
    string,
    Array<(event: unknown, context: unknown) => Promise<void>>
  >();
  const tools = new Map<string, HarnessTool>();
  const delivered: Array<{
    message: { customType: string; content: string; details?: unknown };
    options: unknown;
  }> = [];
  const steered: Array<{
    message: { customType: string; content: string; details?: unknown };
    options: unknown;
  }> = [];
  const renderers = new Map<
    string,
    (...args: unknown[]) => HarnessComponent | undefined
  >();
  let widget: HarnessComponent | undefined;
  let busy = false;
  const pi = {
    getSessionName: () => name,
    on(
      event: string,
      handler: (event: unknown, context: unknown) => Promise<void>,
    ) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool(tool: HarnessTool) {
      tools.set(tool.name, tool);
    },
    registerMessageRenderer(
      type: string,
      renderer: (...args: unknown[]) => HarnessComponent | undefined,
    ) {
      renderers.set(type, renderer);
    },
    sendMessage(
      message: { customType: string; content: string; details?: unknown },
      options: unknown,
    ) {
      if (busy) steered.push({ message, options });
      else delivered.push({ message, options });
    },
  };
  createTouchtoneExtension({ root, pid, pollMs: 20 })(pi as never);
  const context = {
    cwd: path.join(os.tmpdir(), name),
    mode: "tui",
    sessionManager: { getSessionId: () => id },
    hasPendingMessages: () => steered.length > 0,
    ui: {
      setWidget(
        _key: string,
        factory:
          | undefined
          | ((tui: unknown, theme: unknown) => HarnessComponent),
      ) {
        widget?.dispose?.();
        widget = factory?.(
          { requestRender() {} },
          {
            fg(_color: string, text: string) {
              return text;
            },
          },
        );
      },
    },
  };
  return {
    delivered,
    steered,
    toolLabel() {
      const tool = tools.get("touchtone");
      assert.ok(tool);
      return tool.label;
    },
    setBusy(value: boolean) {
      busy = value;
    },
    finishTurn() {
      delivered.push(...steered.splice(0));
    },
    discardPending() {
      steered.splice(0);
    },
    async event(event: string, payload: unknown = {}) {
      for (const handler of handlers.get(event) ?? [])
        await handler(payload, context);
    },
    widgetLines(width = 80) {
      return widget?.render(width) ?? [];
    },
    renderIncoming(message: unknown, expanded = false) {
      const renderer = renderers.get("touchtone");
      assert.ok(renderer);
      return renderer(
        message,
        { expanded, outputPad: 0 },
        {
          fg(_color: string, text: string) {
            return text;
          },
          getFgAnsi() {
            return "\x1b[39m";
          },
          getBgAnsi() {
            return "\x1b[49m";
          },
        },
      );
    },
    async renderIncomingWithPiTheme(message: unknown, expanded = false) {
      const renderer = renderers.get("touchtone");
      assert.ok(renderer);
      const themeModulePath = pathToFileURL(
        path.resolve(
          "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js",
        ),
      ).href;
      const { initTheme, theme } = await import(themeModulePath);
      initTheme("dark");
      return renderer(message, { expanded, outputPad: 0 }, theme);
    },
    renderToolCall(params: Record<string, string | undefined>) {
      const tool = tools.get("touchtone");
      assert.ok(tool?.renderCall);
      return tool.renderCall(
        params,
        {
          fg(_color: string, text: string) {
            return text;
          },
        },
        { isPartial: true },
      );
    },
    async toolExecution(params: unknown = {}) {
      const tool = tools.get("touchtone");
      assert.ok(tool);
      const modulePath = pathToFileURL(
        path.resolve(
          "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js",
        ),
      ).href;
      const themeModulePath = pathToFileURL(
        path.resolve(
          "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js",
        ),
      ).href;
      const [{ ToolExecutionComponent }, { initTheme }] = await Promise.all([
        import(modulePath),
        import(themeModulePath),
      ]);
      initTheme("dark");
      return new ToolExecutionComponent(
        tool.name,
        "call",
        params,
        {},
        tool,
        { requestRender() {} },
        process.cwd(),
      );
    },
    async renderToolExecution(
      result: unknown,
      params: Record<string, string | undefined>,
      expanded = false,
    ) {
      const component = await this.toolExecution(params);
      component.markExecutionStarted();
      component.setArgsComplete();
      component.updateResult(result);
      component.setExpanded(expanded);
      return (component.render(160) as string[]).map(stripTerminalSequences);
    },
    renderToolResult(
      result: unknown,
      params: Record<string, string | undefined>,
      expanded = false,
      isError = false,
    ) {
      const tool = tools.get("touchtone");
      assert.ok(tool?.renderResult);
      return tool.renderResult(
        result,
        { expanded, isPartial: false },
        {
          fg(_color: string, text: string) {
            return text;
          },
        },
        { args: params, isError },
      );
    },
    async tool(params: Record<string, string | undefined>) {
      const tool = tools.get("touchtone");
      assert.ok(tool);
      return tool.execute("call", params);
    },
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("registers the tool, lists live sessions, and wakes an idle recipient", async (t) => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", root);
  const bob = harness("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", root);
  t.after(async () => {
    await alice.event("session_shutdown");
    await bob.event("session_shutdown");
  });

  assert.equal(alice.toolLabel(), "📞 Touchtone");
  const emptyList = await alice.tool({ action: "list" });
  assert.equal(emptyList.content[0].text, "📒 Phonebook · 0 sessions");

  await alice.event("session_start");
  await bob.event("session_start");

  const list = await alice.tool({ action: "list" });
  const handles = [
    process.env.CMUX_WORKSPACE_ID &&
      `workspace:${process.env.CMUX_WORKSPACE_ID}`,
    process.env.CMUX_SURFACE_ID && `surface:${process.env.CMUX_SURFACE_ID}`,
    process.env.CMUX_PANEL_ID && `panel:${process.env.CMUX_PANEL_ID}`,
  ]
    .filter(Boolean)
    .join(" ");
  const handleSuffix = handles ? ` - ${handles}` : "";
  assert.equal(
    list.content[0].text,
    [
      "📒 Phonebook · 2 sessions:",
      `- aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa - Alice - pid ${process.pid} - ${path.join(os.tmpdir(), "Alice")}${handleSuffix}`,
      `- bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb - Bob - pid ${process.pid} - ${path.join(os.tmpdir(), "Bob")}${handleSuffix}`,
    ].join("\n"),
  );

  const sent = await alice.tool({
    action: "send",
    to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message: "Please inspect the failure.",
  });
  assert.equal(
    sent.content[0].text,
    "📞 Message sent to Bob (bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb).",
  );
  await waitFor(() => bob.delivered.length === 1);

  assert.deepEqual(bob.delivered[0].options, {
    deliverAs: "steer",
    triggerTurn: true,
  });
  assert.equal(bob.delivered[0].message.customType, "touchtone");
  assert.equal(
    bob.delivered[0].message.content,
    `📞 Incoming from Alice (aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, pid ${process.pid}):\nPlease inspect the failure.`,
  );
});

test("renders a compact roster summary and an expanded width-aware table", async () => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", root);
  const sessions = [
    {
      sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      sessionName: "Bob",
      pid: 12345,
      cwd: "/界/path",
      cmuxWorkspace: "workspace-1",
      cmuxSurface: "surface-2",
      cmuxPanel: "panel-3",
      updatedAt: new Date().toISOString(),
    },
  ];
  const result = {
    content: [{ type: "text", text: "model-facing roster remains unchanged" }],
    details: { sessions },
  };

  assert.deepEqual(alice.renderToolCall({ action: "list" }).render(80), []);
  assert.deepEqual(alice.renderToolCall({ action: "send" }).render(80), []);
  assert.match(
    alice
      .renderToolCall({ action: "send", message: "Hello" })
      .render(80)
      .map(stripTerminalSequences)
      .join("\n"),
    /Hello/,
  );
  assert.deepEqual(
    alice.renderToolResult(result, { action: "list" }).render(80),
    ["📒 Phonebook · 1 session"],
  );
  assert.deepEqual(
    (await alice.renderToolExecution(result, { action: "list" })).filter(
      (line) => line.length > 0,
    ),
    ["📒 Phonebook · 1 session"],
  );
  assert.deepEqual(
    alice
      .renderToolResult(
        {
          content: [{ type: "text", text: "no sessions" }],
          details: { sessions: [] },
        },
        { action: "list" },
      )
      .render(80),
    ["📒 Phonebook · 0 sessions"],
  );

  const expanded = alice
    .renderToolResult(result, { action: "list" }, true)
    .render(160);
  const plainExpanded = expanded.map(stripTerminalSequences);
  assert.match(
    plainExpanded.join("\n"),
    /SESSION ID\s+NAME\s+PID\s+CWD\s+HANDLES/,
  );
  assert.match(
    plainExpanded.join("\n"),
    /bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/,
  );
  assert.match(plainExpanded.join("\n"), /Bob/);
  assert.match(plainExpanded.join("\n"), /12345/);
  assert.match(plainExpanded.join("\n"), /\/界\/path/);
  assert.match(
    plainExpanded.join("\n"),
    /workspace:workspace-1 surface:surface-2/,
  );
  assert.match(plainExpanded.join("\n"), /panel:panel-3/);
  assert.ok(expanded.every((line) => visibleWidth(line) <= 160));

  const compact = alice.renderToolResult(result, { action: "list" });
  for (const width of [1, 5, 10]) {
    assert.ok(
      compact.render(width).every((line) => visibleWidth(line) <= width),
    );
  }
  assert.deepEqual(compact.render(1).map(stripTerminalSequences), [""]);

  const expandedRoster = alice.renderToolResult(
    result,
    { action: "list" },
    true,
  );
  assert.deepEqual(expandedRoster.render(59).map(stripTerminalSequences), [
    "📒 Phonebook · 1 session",
  ]);
  assert.doesNotMatch(
    expandedRoster.render(59).join("\n"),
    /SESSION ID|Bob|12345|界/,
  );
  assert.match(expandedRoster.render(60).join("\n"), /SESSION ID/);
  assert.match(
    expandedRoster.render(60).join("\n"),
    /bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/,
  );
  for (let width = 1; width <= 80; width += 1) {
    const lines = expandedRoster.render(width);
    assert.ok(
      lines.every((line) => visibleWidth(line) <= width),
      `expanded roster exceeded width ${width}`,
    );
    if (width < 60) {
      assert.deepEqual(
        lines.map(stripTerminalSequences),
        [
          stripTerminalSequences(
            truncateToWidth("📒 Phonebook · 1 session", width, ""),
          ),
        ],
        `expanded roster showed details at width ${width}`,
      );
    }
  }
  assert.equal(result.content[0].text, "model-facing roster remains unchanged");
});

test("steers a busy recipient nonblockingly at its next turn boundary", async () => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", root);
  const bob = harness("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", root);
  await alice.event("session_start");
  await bob.event("session_start");
  bob.setBusy(true);

  await alice.tool({
    action: "send",
    to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message: "Change direction after this tool call.",
  });
  await waitFor(() => bob.steered.length === 1);
  assert.equal(bob.delivered.length, 0);

  bob.finishTurn();
  assert.equal(bob.delivered.length, 1);
  assert.deepEqual(bob.delivered[0].options, {
    deliverAs: "steer",
    triggerTurn: true,
  });
  await alice.event("session_shutdown");
  await bob.event("session_shutdown");
});

test("only changes private directory permissions when they need tightening", () => {
  const root = temporaryRoot();
  const store = new TouchtoneStore({ root });
  const chmodSync = fsDefault.chmodSync;
  const changed: Array<{ path: fs.PathLike; mode: fs.Mode }> = [];
  fsDefault.chmodSync = (path, mode) => {
    changed.push({ path, mode });
    chmodSync(path, mode);
  };
  syncBuiltinESMExports();

  try {
    store.initialize();
    store.initialize();
    store.consume("recipient", () => {});
    store.consume("recipient", () => {});
    assert.deepEqual(changed, []);

    chmodSync(store.paths.inboxes, 0o755);
    store.initialize();
    assert.deepEqual(changed, [{ path: store.paths.inboxes, mode: 0o700 }]);
    assert.equal(fs.statSync(store.paths.inboxes).mode & 0o777, 0o700);
  } finally {
    fsDefault.chmodSync = chmodSync;
    syncBuiltinESMExports();
  }
});

test("uses private atomic storage and rejects path traversal and dead recipients", async () => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", root);
  await alice.event("session_start");

  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  const rosterFile = path.join(
    root,
    "sessions",
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json",
  );
  assert.equal(fs.statSync(rosterFile).mode & 0o777, 0o600);

  await assert.rejects(
    alice.tool({ action: "send", to: "../../escape", message: "nope" }),
    /valid session id/,
  );

  fs.writeFileSync(
    path.join(root, "sessions", "dead.json"),
    JSON.stringify({
      sessionId: "dead",
      sessionName: "Dead",
      pid: 99999999,
      cwd: path.join(os.tmpdir(), "dead"),
    }),
    { mode: 0o600 },
  );
  const list = await alice.tool({ action: "list" });
  assert.doesNotMatch(list.content[0].text, /Dead/);
  assert.equal(fs.existsSync(path.join(root, "sessions", "dead.json")), false);
  await alice.event("session_shutdown");
});

test("importing the package does not touch the mailbox", () => {
  const home = temporaryRoot();
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(path.resolve("extension.ts")).href)})`,
    ],
    { env: { ...process.env, HOME: home }, timeout: 10_000 },
  );

  assert.equal(fs.existsSync(path.join(home, ".local", "state", "pi")), false);
});

test("renders incoming bubbles with theme colors and preserves outgoing colors", () => {
  let textColor = "\x1b[38;5;252m";
  let backgroundColor = "\x1b[48;2;12;34;56m";
  const incoming = new ChatBubble({
    direction: "incoming",
    label: "📞 Alice",
    body: "Hello 👋\nThis wraps onto another line\ncafé",
    theme: {
      getFgAnsi: () => textColor,
      getBgAnsi: () => backgroundColor,
    },
  });
  const outgoing = new ChatBubble({
    direction: "outgoing",
    label: "📞 Bob",
    body: "Message sent",
  });

  const incomingLines = incoming.render(30);
  const outgoingLines = outgoing.render(30);
  assert.match(incomingLines.join("\n"), ansi("\\[38;5;252m"));
  assert.match(incomingLines.join("\n"), ansi("\\[48;2;12;34;56m"));
  assert.match(incomingLines[1], ansi("\\[38;2;12;34;56m"));
  assert.match(outgoingLines.join("\n"), ansi("\\[38;2;255;255;255m"));
  assert.match(outgoingLines.join("\n"), ansi("\\[44m"));
  assert.match(outgoingLines[1], ansi("\\[34m"));
  textColor = "\x1b[38;2;210;211;212m";
  backgroundColor = "\x1b[48;5;237m";
  const updatedIncomingLines = incoming.render(30);
  assert.match(updatedIncomingLines.join("\n"), ansi("\\[38;2;210;211;212m"));
  assert.match(updatedIncomingLines.join("\n"), ansi("\\[48;5;237m"));
  assert.match(updatedIncomingLines[1], ansi("\\[38;5;237m"));
  assert.equal(stripTerminalSequences(incomingLines[0]), "📞 Alice");
  assert.match(stripTerminalSequences(incomingLines[1]), /^▗▄+▖$/);
  assert.match(
    stripTerminalSequences(incomingLines[incomingLines.length - 1]),
    /^▝▀+▘$/,
  );
  assert.doesNotMatch(incomingLines.join("\n"), /[▲◖◗╭╮╰╯│]/);
  assert.deepEqual(
    incomingLines
      .slice(2, -1)
      .map((line) => stripTerminalSequences(line).slice(2, -2).trimEnd()),
    ["Hello 👋", "This wraps onto", "another line", "café"],
  );
  const unicodeLine = incomingLines.find((line) => line.includes("café"));
  assert.ok(unicodeLine);
  assert.doesNotMatch(unicodeLine, ansi("\\[0m.*café"));
  assert.ok(
    outgoingLines.every((line) => stripTerminalSequences(line).startsWith(" ")),
  );
  assert.match(stripTerminalSequences(outgoingLines[1]).trimStart(), /^▗▄+▖$/);
  assert.ok(
    [...incomingLines, ...outgoingLines].every(
      (line) => visibleWidth(line) <= 30,
    ),
  );

  const narrowLines = new ChatBubble({
    direction: "incoming",
    label: "📞 Extremely long sender label",
    body: "wide 👋 and averylongunbrokenword",
    theme: {
      getFgAnsi: () => "\x1b[38;5;252m",
      getBgAnsi: () => "\x1b[48;5;237m",
    },
  }).render(8);
  assert.ok(narrowLines.length > 3);
  assert.ok(narrowLines.every((line) => visibleWidth(line) <= 8));
  for (const width of [1, 2, 3]) {
    assert.ok(
      incoming.render(width).every((line) => visibleWidth(line) <= width),
    );
  }
  const wideGlyph = new ChatBubble({
    direction: "incoming",
    label: "wide glyph",
    body: "👋",
    theme: {
      getFgAnsi: () => "\x1b[39m",
      getBgAnsi: () => "\x1b[49m",
    },
  });
  assert.ok(wideGlyph.render(1).every((line) => visibleWidth(line) <= 1));
  assert.equal(stripTerminalSequences(wideGlyph.render(4)[0]), "👋");
});

test("shows exact identities only when bubble details are expanded", () => {
  const sender = {
    sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sessionName: "Alice",
    pid: process.pid,
    cwd: "/tmp/alice",
    updatedAt: new Date().toISOString(),
  };
  assert.equal(renderMailLabel(sender, false), "📞 Alice");
  assert.equal(
    renderMailLabel(sender, true),
    `📞 Alice (aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, pid ${process.pid})`,
  );
});

test("renders at most five queued handsets with overflow and disposes animation", () => {
  let renders = 0;
  const indicator = new OnDeckIndicator(() => {
    renders += 1;
  }, 10);
  indicator.setCount(7);
  const line = stripTerminalSequences(indicator.render(40)[0]);
  assert.match(line, /^📞 📞 📞 📞 📞 \+2 /);
  assert.match(line, /\.{1,3}$/);
  assert.equal(
    indicator.render(5).every((rendered) => visibleWidth(rendered) <= 5),
    true,
  );
  indicator.dispose();
  const before = renders;
  return new Promise<void>((resolve) =>
    setTimeout(() => {
      assert.equal(renders, before);
      resolve();
    }, 30),
  );
});

test("keeps unopened mail on deck until its matching custom message starts", async (t) => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "alice", root);
  const bob = harness("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "bob", root);
  t.after(async () => {
    await alice.event("session_shutdown");
    await bob.event("session_shutdown");
  });
  await alice.event("session_start");
  await bob.event("session_start");
  bob.setBusy(true);

  const result = await alice.tool({
    action: "send",
    to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message: "Queued while you work",
  });
  await waitFor(() => bob.steered.length === 1);
  assert.match(stripTerminalSequences(bob.widgetLines()[0]), /^📞 /);

  await bob.event("message_start", {
    message: { role: "user", content: "unrelated" },
  });
  assert.equal(bob.widgetLines().length, 1);

  const queued = bob.steered[0].message;
  await bob.event("message_start", {
    message: { role: "custom", ...queued },
  });
  assert.deepEqual(bob.widgetLines(), []);
  assert.match(result.content[0].text, /Message sent/);
});

test("clears on-deck mail when SDK reports no pending messages at agent end", async (t) => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "alice", root);
  const bob = harness("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "bob", root);
  t.after(async () => {
    await alice.event("session_shutdown");
    await bob.event("session_shutdown");
  });
  await alice.event("session_start");
  await bob.event("session_start");
  bob.setBusy(true);

  await alice.tool({
    action: "send",
    to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message: "Queued before agent end",
  });
  await waitFor(() => bob.steered.length === 1);
  assert.equal(bob.widgetLines().length, 1);

  bob.discardPending();
  await bob.event("agent_end");
  assert.deepEqual(bob.widgetLines(), []);
});

test("keeps on-deck mail when SDK reports pending messages at agent end", async (t) => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "alice", root);
  const bob = harness("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "bob", root);
  t.after(async () => {
    await alice.event("session_shutdown");
    await bob.event("session_shutdown");
  });
  await alice.event("session_start");
  await bob.event("session_start");
  bob.setBusy(true);

  await alice.tool({
    action: "send",
    to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message: "Still pending at agent end",
  });
  await waitFor(() => bob.steered.length === 1);
  assert.equal(bob.widgetLines().length, 1);

  await bob.event("agent_end");
  assert.equal(bob.widgetLines().length, 1);
});

test("streams outgoing message text through Pi's tool execution lifecycle", async () => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "alice", root);
  const recipient = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const component = await alice.toolExecution({});
  const renderAll = () =>
    (component.render(100) as string[]).map(stripTerminalSequences);
  const render = () => renderAll().filter((line) => line.trim());

  assert.deepEqual(render(), []);
  component.updateArgs({ action: "send", to: recipient });
  assert.deepEqual(render(), []);
  component.updateArgs({
    action: "send",
    to: recipient,
    message: { malformed: true },
  });
  assert.deepEqual(render(), []);

  component.updateArgs({ action: "send", to: recipient, message: "M" });
  assert.match(render().join("\n"), /M/);
  assert.equal(render().filter((line) => line.includes("▗")).length, 1);
  assert.doesNotMatch(render().join("\n"), /Sending message/);

  component.updateArgs({ action: "send", to: recipient, message: "Meet on" });
  assert.match(render().join("\n"), /Meet on/);
  assert.doesNotMatch(render().join("\n"), /Sending message/);
  const composing = renderAll();

  component.setArgsComplete();
  assert.match(render().join("\n"), /Meet on/);
  component.markExecutionStarted();
  assert.match(render().join("\n"), /Meet on/);

  component.updateResult({
    content: [{ type: "text", text: "Message sent" }],
    details: {
      recipient: {
        sessionId: recipient,
        sessionName: "bob",
        pid: 123,
      },
      messageId: "message-1",
    },
  });
  const succeededAll = renderAll();
  const succeeded = render();
  assert.match(succeeded.join("\n"), /Meet on/);
  assert.equal(succeeded.filter((line) => line.includes("▗")).length, 1);
  assert.equal(succeeded.filter((line) => line.trim() === "Sent").length, 1);
  assert.equal(
    succeededAll.findIndex((line) => line.includes("▗")),
    composing.findIndex((line) => line.includes("▗")) - 1,
  );
  assert.equal(succeededAll.length, composing.length);
  assert.equal(succeeded.at(-1)?.trim(), "Sent");
  assert.doesNotMatch(
    succeeded.join("\n"),
    /Sending message|Message sent|Delivered|Read/,
  );

  const failed = await alice.toolExecution({
    action: "send",
    to: recipient,
    message: "Never sent",
  });
  failed.markExecutionStarted();
  failed.setArgsComplete();
  failed.updateResult({
    content: [{ type: "text", text: "Recipient disappeared" }],
    isError: true,
  });
  const failureLines = (failed.render(100) as string[]).map(
    stripTerminalSequences,
  );
  assert.match(failureLines.join("\n"), /Recipient disappeared/);
  assert.doesNotMatch(
    failureLines.join("\n"),
    /Never sent|Message sent|Sent|Delivered|Read|▗/,
  );

  const replay = await alice.toolExecution({
    action: "send",
    to: recipient,
    message: "Historical message",
  });
  replay.markExecutionStarted();
  replay.setArgsComplete();
  replay.updateResult({
    content: [{ type: "text", text: "Message sent" }],
    details: {
      recipient: {
        sessionId: recipient,
        sessionName: "bob",
        pid: 123,
      },
      messageId: "message-2",
    },
  });
  const replayLines = (replay.render(100) as string[]).map(
    stripTerminalSequences,
  );
  assert.match(replayLines.join("\n"), /Historical message/);
  assert.equal(replayLines.filter((line) => line.includes("▗")).length, 1);
});

test("incoming and successful outgoing renderers use typed details without hiding failures", async (t) => {
  const root = temporaryRoot();
  const alice = harness("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "alice", root);
  const bob = harness("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "bob", root);
  t.after(async () => {
    await alice.event("session_shutdown");
    await bob.event("session_shutdown");
  });
  await alice.event("session_start");
  await bob.event("session_start");
  const result = await alice.tool({
    action: "send",
    to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    message: "Meet on the roof",
  });
  await waitFor(() => bob.delivered.length === 1);
  const delivered = bob.delivered[0].message;

  const incoming = await bob.renderIncomingWithPiTheme(
    { role: "custom", ...delivered },
    true,
  );
  assert.ok(incoming);
  assert.match(
    stripTerminalSequences(incoming.render(100).join("\n")),
    /Meet on the roof/,
  );
  assert.match(
    stripTerminalSequences(incoming.render(100).join("\n")),
    /aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/,
  );

  const outgoing = alice.renderToolResult(
    result,
    {
      action: "send",
      to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      message: "Meet on the roof",
    },
    false,
  );
  assert.match(
    stripTerminalSequences(outgoing.render(100).join("\n")),
    /Meet on the roof/,
  );
  assert.doesNotMatch(
    stripTerminalSequences(outgoing.render(100).join("\n")),
    /"action"/,
  );

  const failed = alice.renderToolResult(
    { content: [{ type: "text", text: "Recipient disappeared" }] },
    {
      action: "send",
      to: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      message: "Never sent",
    },
    false,
    true,
  );
  assert.match(
    stripTerminalSequences(failed.render(100).join("\n")),
    /Recipient disappeared/,
  );
});

test("a fresh installation uses the default mailbox", () => {
  const home = temporaryRoot();
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const { TouchtoneStore } = await import(${JSON.stringify(pathToFileURL(path.resolve("extension.ts")).href)}); new TouchtoneStore().initialize()`,
    ],
    { env: { ...process.env, HOME: home }, timeout: 10_000 },
  );

  const root = path.join(home, ".local", "state", "pi", "touchtone");
  assert.equal(fs.statSync(root).isDirectory(), true);
  assert.equal(fs.statSync(path.join(root, "sessions")).isDirectory(), true);
  assert.equal(fs.statSync(path.join(root, "inboxes")).isDirectory(), true);
});
