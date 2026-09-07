import { highlightCode, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";

const WIDGET_ID = "pi-copy-snippet";

type Snippet = { language: string; code: string };

type AssistantContent = string | Array<{ type?: string; text?: string }>;

function getTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return (content as Array<{ type?: string; text?: string }>)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function extractCodeBlocks(markdown: string): Snippet[] {
  const snippets: Snippet[] = [];
  const blockPattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(markdown)) !== null) {
    snippets.push({
      language: (match[1] ?? "").trim(),
      code: match[2] ?? "",
    });
  }

  return snippets;
}

function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform;
  let command: string;
  let args: string[];

  if (platform === "darwin") {
    command = "pbcopy";
    args = [];
  } else if (platform === "win32") {
    command = "powershell.exe";
    args = ["-NoProfile", "-Command", "$input | Set-Clipboard"];
  } else if (process.env.WAYLAND_DISPLAY) {
    command = "wl-copy";
    args = [];
  } else {
    command = "xclip";
    args = ["-selection", "clipboard"];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => reject(new Error(`No se pudo acceder al portapapeles: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} terminó con código ${code ?? "desconocido"}`));
    });
    child.stdin.end(text);
  });
}

class SnippetWidget implements Component {
  private clickRanges: Array<{ start: number; end: number; snippet: Snippet }> = [];

  constructor(
    private snippets: Snippet[],
    private readonly theme: Theme,
    private readonly tui: { requestRender(): void },
    private readonly onCopy: (snippet: Snippet) => void,
  ) {}

  setSnippets(snippets: Snippet[]): void {
    this.snippets = snippets;
    this.tui.requestRender();
  }

  private framedLine(content: string, width: number): string {
    if (width < 2) return truncateToWidth(content, width);
    const innerWidth = width - 2;
    const clipped = truncateToWidth(content, innerWidth, "");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
    return this.theme.fg("border", "│") + clipped + padding + this.theme.fg("border", "│");
  }

  private border(label: string, width: number, top: boolean): string {
    if (width < 4) return this.theme.fg("borderAccent", "─".repeat(Math.max(0, width)));
    const left = top ? "╭─ " : "╰─ ";
    const right = top ? "╮" : "╯";
    const available = width - visibleWidth(left) - visibleWidth(right);
    const title = truncateToWidth(label, Math.max(0, available), "");
    const fill = "─".repeat(Math.max(0, available - visibleWidth(title)));
    return this.theme.fg("borderAccent", left + title + fill + right);
  }

  private renderSnippet(snippet: Snippet, index: number, width: number): string[] {
    const language = snippet.language || "texto";
    const sourceLines = snippet.code.endsWith("\n") ? snippet.code.slice(0, -1).split("\n") : snippet.code.split("\n");
    const previewLimit = 5;
    const preview = sourceLines.slice(0, previewLimit).join("\n");
    const highlighted = highlightCode(preview, snippet.language || undefined);
    const numberWidth = String(Math.min(sourceLines.length, previewLimit)).length;
    const lines = [this.border(`Snippet ${index + 1} · ${language} `, width, true)];

    for (let lineIndex = 0; lineIndex < highlighted.length; lineIndex++) {
      const number = String(lineIndex + 1).padStart(numberWidth, " ");
      const content = this.theme.fg("dim", ` ${number} │ `) + (highlighted[lineIndex] ?? "");
      lines.push(this.framedLine(content, width));
    }

    if (sourceLines.length > previewLimit) {
      const omitted = sourceLines.length - previewLimit;
      lines.push(this.framedLine(this.theme.fg("dim", `     … ${omitted} línea(s) más`), width));
    }

    lines.push(this.border(`${sourceLines.length} línea(s) · [ Copiar ] `, width, false));
    return lines;
  }

  render(width: number): string[] {
    if (this.snippets.length === 0) return [];

    const lines: string[] = [];
    this.clickRanges = [];

    for (let index = 0; index < this.snippets.length; index++) {
      const snippet = this.snippets[index]!;
      const start = lines.length;
      lines.push(...this.renderSnippet(snippet, index, width));
      this.clickRanges.push({ start, end: lines.length, snippet });
      if (index < this.snippets.length - 1) lines.push("");
    }

    lines.push(truncateToWidth(this.theme.fg("dim", "Ctrl+S: elegir · clic: copiar (fullscreen)"), width));
    return lines;
  }

  handleMouse(event: TuiMouseEvent): { handled: boolean; focus?: boolean; render?: boolean } | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    const target = this.clickRanges.find((range) => event.y >= range.start && event.y < range.end);
    if (!target) return undefined;

    this.onCopy(target.snippet);
    return { handled: true, render: true };
  }

  invalidate(): void {
    this.clickRanges = [];
  }
}

export default function (pi: ExtensionAPI) {
  let latestSnippets: Snippet[] = [];
  let widget: SnippetWidget | undefined;
  let currentContext: ExtensionContext | undefined;

  const copySnippet = async (snippet: Snippet, ctx: ExtensionContext) => {
    try {
      await copyToClipboard(snippet.code);
      ctx.ui.notify(`Snippet ${snippet.language || "de texto"} copiado`, "info");
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : "Error al copiar", "error");
    }
  };

  const chooseAndCopy = async (requestedIndex: number | undefined, ctx: ExtensionContext) => {
    if (latestSnippets.length === 0) {
      ctx.ui.notify("No hay snippets disponibles", "warning");
      return;
    }

    if (requestedIndex !== undefined) {
      const snippet = latestSnippets[requestedIndex];
      if (!snippet) {
        ctx.ui.notify(`No existe el snippet ${requestedIndex + 1}`, "warning");
        return;
      }
      await copySnippet(snippet, ctx);
      return;
    }

    if (latestSnippets.length === 1) {
      await copySnippet(latestSnippets[0]!, ctx);
      return;
    }

    const choices = latestSnippets.map((snippet, index) => {
      const language = snippet.language || "texto";
      const preview = snippet.code.split("\n").find((line) => line.trim())?.trim() ?? "(vacío)";
      return `${index + 1}. ${language} — ${preview.slice(0, 60)}`;
    });
    const selected = await ctx.ui.select("Selecciona el snippet que quieres copiar", choices);
    if (!selected) return;

    await copySnippet(latestSnippets[choices.indexOf(selected)]!, ctx);
  };

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    ctx.ui.setWidget(WIDGET_ID, (tui, theme) => {
      widget = new SnippetWidget(latestSnippets, theme, tui, (snippet) => {
        if (currentContext) void copySnippet(snippet, currentContext);
      });
      return widget;
    });
  });

  pi.on("session_shutdown", () => {
    widget = undefined;
    currentContext = undefined;
    latestSnippets = [];
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    latestSnippets = extractCodeBlocks(getTextContent(event.message.content as AssistantContent));
    widget?.setSnippets(latestSnippets);
    if (latestSnippets.length > 0) {
      ctx.ui.notify(`${latestSnippets.length} snippet(s) disponible(s) para copiar`, "info");
    }
  });

  pi.registerCommand("copy-snippet", {
    description: "Elige y copia un snippet de la última respuesta (ej. /copy-snippet 2)",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const parsed = trimmed === "" ? undefined : Number.parseInt(trimmed, 10) - 1;
      if (trimmed !== "" && (!Number.isInteger(parsed) || parsed! < 0)) {
        ctx.ui.notify("Uso: /copy-snippet [número]", "warning");
        return;
      }
      await chooseAndCopy(parsed, ctx);
    },
  });

  pi.registerShortcut("ctrl+s", {
    description: "Elegir y copiar un snippet de la última respuesta",
    handler: async (ctx) => {
      await chooseAndCopy(undefined, ctx);
    },
  });
}
