import {
  type Component,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const ESC = "\x1b";
const RESET = `${ESC}[0m`;

export type ChatDirection = "incoming" | "outgoing";

export interface ChatIdentity {
  sessionId: string;
  sessionName?: string;
  pid: number;
}

export function renderDialLabel(
  identity: ChatIdentity,
  expanded: boolean,
  marker = "📞",
): string {
  const icon = marker;
  const name = identity.sessionName?.trim() || "unnamed session";
  return expanded
    ? `${icon} ${name} (${identity.sessionId}, pid ${identity.pid})`
    : `${icon} ${name}`;
}

interface ChatBubbleTheme {
  getFgAnsi(color: "text"): string;
  getBgAnsi(color: "customMessageBg"): string;
}

function backgroundToForeground(background: string): string {
  return background === `${ESC}[49m`
    ? `${ESC}[39m`
    : background.replace(new RegExp(`^${ESC}\\[48;`), `${ESC}[38;`);
}

function bubbleColors(options: ChatBubbleOptions) {
  if (options.direction === "incoming") {
    const background = options.theme.getBgAnsi("customMessageBg");
    return {
      foreground: options.theme.getFgAnsi("text"),
      background,
      fill: backgroundToForeground(background),
    };
  }
  return {
    foreground: "\x1b[38;2;255;255;255m",
    background: "\x1b[44m",
    fill: "\x1b[34m",
  };
}

function align(line: string, width: number, direction: ChatDirection): string {
  if (direction === "incoming") return line;
  return `${" ".repeat(Math.max(0, width - visibleWidth(line)))}${line}`;
}

type ChatBubbleOptions = {
  label: string;
  body: string;
  styleLabel?: (text: string) => string;
} & (
  | { direction: "incoming"; theme: ChatBubbleTheme }
  | { direction: "outgoing"; theme?: ChatBubbleTheme }
);

export class ChatBubble implements Component {
  private readonly options: ChatBubbleOptions;

  constructor(options: ChatBubbleOptions) {
    this.options = options;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const { foreground, background, fill } = bubbleColors(this.options);
    const paint = (line: string): string =>
      `${foreground}${background}${line}${RESET}`;
    const paintFill = (line: string): string => `${fill}${line}${RESET}`;
    if (safeWidth < 5) {
      return wrapTextWithAnsi(
        stripTerminalSequences(this.options.body),
        safeWidth,
      )
        .map((line) =>
          stripTerminalSequences(truncateToWidth(line, safeWidth, "")),
        )
        .map((line) => align(paint(line), safeWidth, this.options.direction));
    }
    const bubbleWidth = Math.max(
      4,
      Math.min(safeWidth, Math.floor(safeWidth * 0.72)),
    );
    const contentWidth = Math.max(1, bubbleWidth - 4);
    const body = stripTerminalSequences(this.options.body);
    const bodyLines = body
      .split("\n")
      .flatMap((line) => wrapTextWithAnsi(line || " ", contentWidth));
    const actualContentWidth = Math.max(1, ...bodyLines.map(visibleWidth));
    const actualBubbleWidth = Math.min(safeWidth, actualContentWidth + 4);
    const labelLines = wrapTextWithAnsi(
      stripTerminalSequences(this.options.label),
      safeWidth,
    ).map((line) => this.options.styleLabel?.(line) ?? line);
    const top = paintFill(`▗${"▄".repeat(actualBubbleWidth - 2)}▖`);
    const bottom = paintFill(`▝${"▀".repeat(actualBubbleWidth - 2)}▘`);
    const middle = bodyLines.map((line) => {
      const clipped = stripTerminalSequences(
        truncateToWidth(line, actualBubbleWidth - 4, ""),
      );
      return paint(
        `  ${clipped}${" ".repeat(actualBubbleWidth - 4 - visibleWidth(clipped))}  `,
      );
    });

    return [...labelLines, top, ...middle, bottom].map((line) =>
      align(line, safeWidth, this.options.direction),
    );
  }

  invalidate(): void {}
}

const DOTS = [".", "..", "..."];

export class OnDeckIndicator implements Component {
  private count = 0;
  private frame = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  private readonly requestRender: () => void;
  private readonly styleText: (text: string) => string;

  constructor(
    requestRender: () => void,
    intervalMs = 350,
    styleText: (text: string) => string = (text) => text,
  ) {
    this.requestRender = requestRender;
    this.styleText = styleText;
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % DOTS.length;
      this.requestRender();
    }, intervalMs);
    this.timer.unref?.();
  }

  setCount(count: number): void {
    this.count = Math.max(0, count);
  }

  render(width: number): string[] {
    if (this.count === 0) return [];
    const handsets = Array.from(
      { length: Math.min(this.count, 5) },
      () => "📞",
    ).join(" ");
    const overflow = this.count > 5 ? ` +${this.count - 5}` : "";
    const line = `${handsets}${overflow} ${DOTS[this.frame]}`;
    return [this.styleText(truncateToWidth(line, Math.max(1, width), ""))];
  }

  invalidate(): void {}

  dispose(): void {
    clearInterval(this.timer);
  }
}
