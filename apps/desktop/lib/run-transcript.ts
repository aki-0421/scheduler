type JsonRecord = Record<string, unknown>;

export type ToolCallStatus = "running" | "completed" | "failed";

export type ToolCallDetail = {
  label: string;
  value: string;
};

export type RunTranscriptEntry =
  | {
      kind: "assistant";
      id: string;
      text: string;
    }
  | {
      kind: "tool";
      id: string;
      itemType: string;
      label: string;
      summary: string;
      status: ToolCallStatus;
      details: ToolCallDetail[];
    }
  | {
      kind: "error";
      id: string;
      text: string;
      details: ToolCallDetail[];
    };

function asRecord(value: unknown): JsonRecord | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatValue(value: unknown): string | undefined {
  const stringValue = asString(value);
  if (stringValue) {
    return stringValue;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactText(value: string, maxLength = 160) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 1)}…`
    : compact;
}

function errorMessage(event: JsonRecord) {
  const direct = asString(event.message) ?? asString(event.msg);
  if (direct) {
    return direct;
  }
  const error = event.error;
  if (typeof error === "string") {
    return error;
  }
  return asString(asRecord(error)?.message) ?? "実行中にエラーが発生しました。";
}

function toolStatus(eventType: string, item: JsonRecord): ToolCallStatus {
  const status = asString(item.status)?.toLowerCase();
  const exitCode =
    typeof item.exit_code === "number" ? item.exit_code : undefined;
  if (
    (exitCode !== undefined && exitCode !== 0) ||
    status === "failed" ||
    status === "error" ||
    status === "cancelled" ||
    status === "canceled" ||
    item.error
  ) {
    return "failed";
  }
  if (
    eventType === "item.started" ||
    status === "in_progress" ||
    status === "running" ||
    status === "pending"
  ) {
    return "running";
  }
  return "completed";
}

function addDetail(details: ToolCallDetail[], label: string, value: unknown) {
  const formatted = formatValue(value);
  if (formatted) {
    details.push({ label, value: formatted });
  }
}

function toolPresentation(itemType: string, item: JsonRecord, raw: string) {
  const details: ToolCallDetail[] = [];

  if (itemType === "command_execution") {
    const command = asString(item.command) ?? "コマンドを実行";
    addDetail(details, "コマンド", item.command);
    addDetail(details, "出力", item.aggregated_output);
    if (typeof item.exit_code === "number") {
      addDetail(details, "終了コード", item.exit_code);
    }
    return {
      label: "コマンド",
      summary: compactText(command),
      details,
    };
  }

  if (itemType === "web_search") {
    const query = asString(item.query) ?? "ウェブを検索";
    const action = formatValue(item.action);
    if (action && action !== query) {
      addDetail(details, "検索アクション", item.action);
    }
    return {
      label: "ウェブ検索",
      summary: compactText(query),
      details,
    };
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : undefined;
    addDetail(details, "変更内容", item.changes);
    return {
      label: "ファイル変更",
      summary: changes?.length
        ? `${changes.length} 件の変更を適用`
        : "ファイルの変更を適用",
      details,
    };
  }

  if (itemType === "mcp_tool_call") {
    const server = asString(item.server);
    const tool = asString(item.tool) ?? asString(item.name);
    addDetail(details, "引数", item.arguments ?? item.input);
    addDetail(details, "結果", item.result ?? item.output);
    addDetail(details, "エラー", item.error);
    return {
      label: "MCP ツール",
      summary: compactText(
        [server, tool].filter(Boolean).join(" / ") || "MCP ツールを呼び出し",
      ),
      details,
    };
  }

  const name =
    asString(item.name) ?? asString(item.tool) ?? itemType.replaceAll("_", " ");
  addDetail(details, "イベント", raw);
  return {
    label: "ツール",
    summary: compactText(name),
    details,
  };
}

const hiddenItemTypes = new Set(["reasoning", "plan", "plan_update"]);
const knownToolItemTypes = new Set([
  "command_execution",
  "web_search",
  "file_change",
  "mcp_tool_call",
  "tool_call",
]);

export function parseRunTranscript(input: string): RunTranscriptEntry[] {
  const entries: RunTranscriptEntry[] = [];
  const toolIndexes = new Map<string, number>();

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const raw = rawLine.trim();
    if (!raw) {
      return;
    }

    let event: JsonRecord;
    try {
      const parsed = asRecord(JSON.parse(raw));
      if (!parsed) {
        return;
      }
      event = parsed;
    } catch {
      return;
    }

    const eventType =
      asString(event.type) ??
      asString(event.event_type) ??
      asString(event.eventType) ??
      "event";

    if (
      eventType === "error" ||
      eventType === "turn.failed" ||
      eventType.endsWith(".failed") ||
      eventType.endsWith(".error")
    ) {
      entries.push({
        kind: "error",
        id: `error-${index}`,
        text: errorMessage(event),
        details: [{ label: "イベント", value: raw }],
      });
      return;
    }

    if (eventType !== "item.started" && eventType !== "item.completed") {
      return;
    }

    const item = asRecord(event.item);
    const itemType = asString(item?.type);
    if (!item || !itemType || hiddenItemTypes.has(itemType)) {
      return;
    }

    const itemId = asString(item.id) ?? `${itemType}-${index}`;
    if (itemType === "agent_message") {
      if (eventType === "item.completed") {
        const message = asString(item.text);
        if (message) {
          entries.push({ kind: "assistant", id: itemId, text: message });
        }
      }
      return;
    }

    const looksLikeTool =
      knownToolItemTypes.has(itemType) ||
      itemType.endsWith("_tool_call") ||
      itemType.endsWith("_execution");
    if (!looksLikeTool) {
      return;
    }

    const presentation = toolPresentation(itemType, item, raw);
    const toolEntry: RunTranscriptEntry = {
      kind: "tool",
      id: itemId,
      itemType,
      status: toolStatus(eventType, item),
      ...presentation,
    };
    const existingIndex = toolIndexes.get(itemId);
    if (existingIndex === undefined) {
      toolIndexes.set(itemId, entries.length);
      entries.push(toolEntry);
    } else {
      entries[existingIndex] = toolEntry;
    }
  });

  return entries;
}
