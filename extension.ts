import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

import { ChatBubble, OnDeckIndicator, renderMailLabel } from "./chat-bubble.ts";

const DEFAULT_ROOT = path.join(
  os.homedir(),
  ".local",
  "state",
  "pi",
  "touchtone",
);
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

function isAbsolutePath(value: string | undefined): value is string {
  return typeof value === "string" && path.isAbsolute(value);
}

export function resolveStoreRoot(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (explicit) return explicit;
  if (isAbsolutePath(env.PI_TOUCHTONE_HOME)) return env.PI_TOUCHTONE_HOME;
  const legacy =
    home === os.homedir()
      ? DEFAULT_ROOT
      : path.join(home, ".local", "state", "pi", "touchtone");
  if (isAbsolutePath(env.XDG_STATE_HOME)) {
    const xdg = path.join(env.XDG_STATE_HOME, "pi", "touchtone");
    if (fs.existsSync(xdg) || !fs.existsSync(legacy)) return xdg;
  }
  return legacy;
}

export interface TouchtoneSession {
  sessionId: string;
  sessionName?: string;
  pid: number;
  cwd: string;
  cmuxWorkspace?: string;
  cmuxSurface?: string;
  cmuxPanel?: string;
  updatedAt: string;
}

export interface TouchtoneMessage {
  id: string;
  sender: TouchtoneSession;
  recipientSessionId: string;
  message: string;
  sentAt: string;
}

export interface TouchtonePaths {
  root: string;
  sessions: string;
  inboxes: string;
  metadata: string;
}

export interface TouchtoneOptions {
  root?: string;
  pid?: number;
  pollMs?: number;
}

export function getTouchtonePaths(root = resolveStoreRoot()): TouchtonePaths {
  return {
    root,
    sessions: path.join(root, "sessions"),
    inboxes: path.join(root, "inboxes"),
    metadata: path.join(root, "metadata"),
  };
}

function requireSessionId(value: string): string {
  if (!SESSION_ID_RE.test(value)) {
    throw new Error(
      "Recipient must be a valid session id from touchtone list.",
    );
  }
  return value;
}

function pidAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if ((fs.statSync(directory).mode & 0o7777) !== 0o700) {
    fs.chmodSync(directory, 0o700);
  }
}

function atomicWrite(file: string, value: unknown): void {
  ensurePrivateDirectory(path.dirname(file));
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isSession(value: unknown): value is TouchtoneSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<TouchtoneSession>;
  return (
    typeof record.sessionId === "string" &&
    SESSION_ID_RE.test(record.sessionId) &&
    typeof record.pid === "number" &&
    typeof record.cwd === "string"
  );
}

function isMessage(value: unknown): value is TouchtoneMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<TouchtoneMessage>;
  return (
    typeof message.id === "string" &&
    isSession(message.sender) &&
    typeof message.recipientSessionId === "string" &&
    typeof message.message === "string" &&
    typeof message.sentAt === "string"
  );
}

export class TouchtoneStore {
  readonly paths: TouchtonePaths;

  constructor(options: Pick<TouchtoneOptions, "root"> = {}) {
    this.paths = getTouchtonePaths(resolveStoreRoot(options.root));
  }

  initialize(sessionId?: string): void {
    ensurePrivateDirectory(this.paths.root);
    ensurePrivateDirectory(this.paths.sessions);
    ensurePrivateDirectory(this.paths.inboxes);
    if (sessionId) ensurePrivateDirectory(this.inboxDirectory(sessionId));
  }

  rosterFile(sessionId: string): string {
    return path.join(
      this.paths.sessions,
      `${requireSessionId(sessionId)}.json`,
    );
  }

  inboxDirectory(sessionId: string): string {
    return path.join(this.paths.inboxes, requireSessionId(sessionId));
  }

  register(record: TouchtoneSession): void {
    atomicWrite(this.rosterFile(record.sessionId), record);
  }

  unregister(sessionId: string, pid: number): void {
    try {
      const record = readJson(this.rosterFile(sessionId));
      if (isSession(record) && record.pid === pid)
        fs.unlinkSync(this.rosterFile(sessionId));
    } catch {
      // Dead-pid cleanup handles a missing or malformed best-effort roster entry.
    }
  }

  liveSessions(): TouchtoneSession[] {
    ensurePrivateDirectory(this.paths.sessions);
    const sessions: TouchtoneSession[] = [];
    for (const entry of fs.readdirSync(this.paths.sessions, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const file = path.join(this.paths.sessions, entry.name);
      try {
        const record = readJson(file);
        if (!isSession(record) || !pidAlive(record.pid)) {
          fs.unlinkSync(file);
          continue;
        }
        sessions.push(record);
      } catch {
        // A malformed file is not a session and cannot safely be addressed.
      }
    }
    return sessions.sort(
      (left, right) =>
        (left.sessionName ?? "").localeCompare(right.sessionName ?? "") ||
        left.sessionId.localeCompare(right.sessionId),
    );
  }

  send(
    sender: TouchtoneSession,
    recipient: TouchtoneSession,
    message: string,
  ): string {
    const mail: TouchtoneMessage = {
      id: crypto.randomUUID(),
      sender,
      recipientSessionId: recipient.sessionId,
      message,
      sentAt: new Date().toISOString(),
    };
    const filename = `${mail.sentAt.replaceAll(":", "-")}-${mail.id}.json`;
    atomicWrite(
      path.join(this.inboxDirectory(recipient.sessionId), filename),
      mail,
    );
    return mail.id;
  }

  consume(
    sessionId: string,
    deliver: (message: TouchtoneMessage) => void,
  ): void {
    const directory = this.inboxDirectory(sessionId);
    ensurePrivateDirectory(directory);
    for (const entry of fs.readdirSync(directory).sort()) {
      if (!entry.endsWith(".json") || entry.startsWith(".")) continue;
      const file = path.join(directory, entry);
      try {
        const value = readJson(file);
        if (!isMessage(value) || value.recipientSessionId !== sessionId)
          continue;
        deliver(value);
        fs.unlinkSync(file);
      } catch {
        // Leave unread mail in place for a later retry or manual inspection.
      }
    }
  }
}

const touchtoneParameters = Type.Object(
  {
    action: StringEnum(["list", "send"] as const),
    to: Type.Optional(
      Type.String({
        description: "Exact recipient session id from list (send only)",
      }),
    ),
    message: Type.Optional(
      Type.String({ description: "Message to deliver (send only)" }),
    ),
  },
  { additionalProperties: false },
);

type TouchtoneInput = Static<typeof touchtoneParameters>;

interface TouchtoneDetails {
  sessions?: TouchtoneSession[];
  recipient?: TouchtoneSession;
  messageId?: string;
}

function rosterHandles(session: TouchtoneSession): string {
  return (
    [
      session.cmuxWorkspace && `workspace:${session.cmuxWorkspace}`,
      session.cmuxSurface && `surface:${session.cmuxSurface}`,
      session.cmuxPanel && `panel:${session.cmuxPanel}`,
    ]
      .filter(Boolean)
      .join(" ") || "—"
  );
}

function wrapToWidth(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, width).map((line) =>
    visibleWidth(line) <= width ? line : truncateToWidth(line, width, ""),
  );
}

function phonebookSummary(count: number): string {
  return `📒 Phonebook · ${count} ${count === 1 ? "session" : "sessions"}`;
}

function rosterTable(
  sessions: TouchtoneSession[],
  styleHeader: (text: string) => string,
  styleDivider: (text: string) => string,
): Component {
  return {
    invalidate() {},
    render(width: number): string[] {
      const safeWidth = Math.max(1, width);
      const summary = phonebookSummary(sessions.length);
      if (safeWidth < 60) {
        return [truncateToWidth(summary, safeWidth, "")];
      }

      const separatorsWidth = 8;
      const available = safeWidth - separatorsWidth;
      const idWidth = 36;
      const pidWidth = Math.min(
        Math.max(3, ...sessions.map((session) => String(session.pid).length)),
        Math.max(3, Math.floor(available * 0.1)),
      );
      const remainingWidth = available - idWidth - pidWidth;
      const nameWidth = Math.min(
        16,
        Math.max(4, Math.floor(remainingWidth / 3)),
      );
      const flexibleWidth = remainingWidth - nameWidth;
      const cwdWidth = Math.max(2, Math.floor(flexibleWidth / 3));
      const handlesWidth = flexibleWidth - cwdWidth;
      const widths = [idWidth, nameWidth, pidWidth, cwdWidth, handlesWidth];
      const pad = (value: string, cellWidth: number): string =>
        value + " ".repeat(Math.max(0, cellWidth - visibleWidth(value)));
      const renderRow = (values: string[]): string[] => {
        const cells = values.map((value, index) =>
          wrapToWidth(value, widths[index]),
        );
        const height = Math.max(...cells.map((cell) => cell.length));
        return Array.from({ length: height }, (_, line) =>
          cells
            .map((cell, index) => pad(cell[line] ?? "", widths[index]))
            .join("  "),
        );
      };
      const headers = ["SESSION ID", "NAME", "PID", "CWD", "HANDLES"];
      const lines = [
        summary,
        ...renderRow(headers).map(styleHeader),
        styleDivider(
          widths.map((cellWidth) => "─".repeat(cellWidth)).join("  "),
        ),
      ];
      for (const session of sessions) {
        lines.push(
          ...renderRow([
            session.sessionId,
            session.sessionName?.trim() || "(unnamed session)",
            String(session.pid),
            session.cwd,
            rosterHandles(session),
          ]),
        );
      }
      return lines;
    },
  };
}

export function createTouchtoneExtension(options: TouchtoneOptions = {}) {
  const store = new TouchtoneStore(options);
  const pid = options.pid ?? process.pid;
  const pollMs = options.pollMs ?? 1000;

  return function touchtoneExtension(pi: ExtensionAPI): void {
    let context: ExtensionContext | undefined;
    let sessionId: string | undefined;
    let watcher: fs.FSWatcher | undefined;
    let poller: ReturnType<typeof setInterval> | undefined;
    let consuming = false;
    const unopened = new Set<string>();

    const updateOnDeck = (): void => {
      if (!context) return;
      if (context.mode !== "tui") return;
      if (unopened.size === 0) {
        context.ui.setWidget("touchtone-on-deck", undefined);
        return;
      }
      const count = unopened.size;
      context.ui.setWidget(
        "touchtone-on-deck",
        (tui, theme) => {
          const indicator = new OnDeckIndicator(
            () => tui.requestRender(),
            350,
            (text) => theme.fg("text", text),
          );
          indicator.setCount(count);
          return indicator;
        },
        { placement: "aboveEditor" },
      );
    };

    const clearOnDeck = (): void => {
      unopened.clear();
      if (context?.mode === "tui") {
        context.ui.setWidget("touchtone-on-deck", undefined);
      }
    };

    const self = (): TouchtoneSession => {
      if (!context || !sessionId)
        throw new Error("Touchtone is not initialized.");
      return {
        sessionId,
        sessionName: pi.getSessionName() ?? undefined,
        pid,
        cwd: context.cwd,
        cmuxWorkspace: process.env.CMUX_WORKSPACE_ID?.trim() || undefined,
        cmuxSurface: process.env.CMUX_SURFACE_ID?.trim() || undefined,
        cmuxPanel: process.env.CMUX_PANEL_ID?.trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
    };

    const register = (): void => store.register(self());

    const consume = (): void => {
      if (consuming || !sessionId) return;
      consuming = true;
      try {
        store.consume(sessionId, (value) => {
          const senderName =
            value.sender.sessionName?.trim() || "unnamed session";
          unopened.add(value.id);
          updateOnDeck();
          try {
            pi.sendMessage(
              {
                customType: "touchtone",
                content: `📞 Incoming from ${senderName} (${value.sender.sessionId}, pid ${value.sender.pid}):\n${value.message}`,
                display: true,
                details: value,
              },
              { deliverAs: "steer", triggerTurn: true },
            );
          } catch (error) {
            unopened.delete(value.id);
            updateOnDeck();
            throw error;
          }
        });
      } finally {
        consuming = false;
      }
    };

    const stop = (): void => {
      watcher?.close();
      watcher = undefined;
      if (poller) clearInterval(poller);
      poller = undefined;
    };

    pi.registerMessageRenderer<TouchtoneMessage>(
      "touchtone",
      (message, renderOptions, theme) => {
        if (!isMessage(message.details)) return undefined;
        return new ChatBubble({
          direction: "incoming",
          label: renderMailLabel(
            message.details.sender,
            renderOptions.expanded,
          ),
          body: message.details.message,
          theme,
          styleLabel: (text) => theme.fg("customMessageLabel", text),
        });
      },
    );

    pi.registerTool<typeof touchtoneParameters, TouchtoneDetails>({
      name: "touchtone",
      label: "📞 Touchtone",
      description:
        "List live local Pi sessions or send one a message. Sending requires the exact session id returned by list. Messages identify their sender and steer a busy recipient at the next supported processing point, or wake an idle recipient immediately.",
      promptSnippet: "List live Pi sessions and send cross-session messages",
      promptGuidelines: [
        "Use touchtone list to get a recipient's exact session id, then touchtone send to communicate with that session.",
      ],
      parameters: touchtoneParameters,
      renderShell: "self",
      renderCall(params, theme, renderContext) {
        const message =
          typeof params?.message === "string" ? params.message : "";
        if (
          params?.action !== "send" ||
          !renderContext.isPartial ||
          !message.trim()
        ) {
          return new Container();
        }
        const recipient =
          typeof params.to === "string" && params.to.trim()
            ? params.to
            : "recipient";
        const composing = new Container();
        composing.addChild(new Spacer(1));
        composing.addChild(
          new ChatBubble({
            direction: "outgoing",
            label: `📞 ${recipient}`,
            body: message,
            styleLabel: (label) => theme.fg("toolOutput", label),
          }),
        );
        return composing;
      },
      renderResult(result, renderOptions, theme, renderContext) {
        const text = result.content
          .filter(
            (item): item is { type: "text"; text: string } =>
              item.type === "text",
          )
          .map((item) => item.text)
          .join("\n");
        if (renderContext.isError) return new Text(theme.fg("error", text));
        if (renderContext.args.action === "list" && result.details?.sessions) {
          const sessions = result.details.sessions;
          if (!renderOptions.expanded) {
            const summary = theme.fg(
              "toolOutput",
              phonebookSummary(sessions.length),
            );
            return {
              invalidate() {},
              render: (width: number) => [
                truncateToWidth(summary, Math.max(1, width), ""),
              ],
            };
          }
          return rosterTable(
            sessions,
            (value) => theme.fg("muted", value),
            (value) => theme.fg("dim", value),
          );
        }
        if (
          renderContext.args.action !== "send" ||
          !result.details?.recipient
        ) {
          return new Text(theme.fg("toolOutput", text));
        }
        const sent = theme.fg("muted", "Sent");
        const delivered = new Container();
        delivered.addChild(
          new ChatBubble({
            direction: "outgoing",
            label: renderMailLabel(
              result.details.recipient,
              renderOptions.expanded,
            ),
            body: renderContext.args.message ?? "",
            styleLabel: (label) => theme.fg("toolOutput", label),
          }),
        );
        delivered.addChild({
          invalidate() {},
          render(width: number): string[] {
            const safeWidth = Math.max(1, width);
            const clipped = truncateToWidth(sent, safeWidth, "");
            return [
              `${" ".repeat(Math.max(0, safeWidth - visibleWidth(clipped)))}${clipped}`,
            ];
          },
        });
        return delivered;
      },
      async execute(
        _toolCallId,
        params: TouchtoneInput,
      ): Promise<AgentToolResult<TouchtoneDetails>> {
        if (params.action === "list") {
          const sessions = store.liveSessions();
          const lines = sessions.map((record) => {
            const name = record.sessionName?.trim() || "(unnamed session)";
            const handles = [
              record.cmuxWorkspace && `workspace:${record.cmuxWorkspace}`,
              record.cmuxSurface && `surface:${record.cmuxSurface}`,
              record.cmuxPanel && `panel:${record.cmuxPanel}`,
            ].filter(Boolean);
            return `- ${record.sessionId} - ${name} - pid ${record.pid} - ${record.cwd}${handles.length ? ` - ${handles.join(" ")}` : ""}`;
          });
          const text = lines.length
            ? `${phonebookSummary(lines.length)}:\n${lines.join("\n")}`
            : phonebookSummary(0);
          return {
            content: [{ type: "text" as const, text }],
            details: { sessions },
          };
        }

        const to = requireSessionId(params.to ?? "");
        const message = params.message?.trim();
        if (!message)
          throw new Error("message is required for touchtone send.");
        const recipient = store
          .liveSessions()
          .find((record) => record.sessionId === to);
        if (!recipient) {
          throw new Error(
            `No live session has id ${to}. Run touchtone list again.`,
          );
        }
        const messageId = store.send(self(), recipient, message);
        const recipientName =
          recipient.sessionName?.trim() || "unnamed session";
        return {
          content: [
            {
              type: "text" as const,
              text: `📞 Message sent to ${recipientName} (${recipient.sessionId}).`,
            },
          ],
          details: { recipient, messageId },
        };
      },
    });

    pi.on("message_start", async (event) => {
      const message = event.message;
      if (message.role !== "custom" || message.customType !== "touchtone")
        return;
      const details = message.details;
      if (!isMessage(details) || !unopened.delete(details.id)) return;
      updateOnDeck();
    });

    pi.on("agent_end", async (_event, ctx) => {
      if (!ctx.hasPendingMessages()) clearOnDeck();
    });

    pi.on("session_start", async (_event, ctx) => {
      stop();
      clearOnDeck();
      context = ctx;
      sessionId = requireSessionId(ctx.sessionManager.getSessionId());
      store.initialize(sessionId);
      register();
      consume();
      watcher = fs.watch(store.inboxDirectory(sessionId), consume);
      poller = setInterval(consume, pollMs);
      poller.unref?.();
    });

    pi.on("session_info_changed", async (_event, ctx) => {
      context = ctx;
      if (sessionId) register();
    });

    pi.on("session_shutdown", async () => {
      stop();
      clearOnDeck();
      if (sessionId) store.unregister(sessionId, pid);
    });
  };
}

export default function touchtone(pi: ExtensionAPI): void {
  createTouchtoneExtension()(pi);
}
