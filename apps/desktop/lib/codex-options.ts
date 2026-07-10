export const reasoningEffortOptions = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "最高" },
] as const;

export type ReasoningEffort = (typeof reasoningEffortOptions)[number]["value"];

export const reasoningEffortValues = reasoningEffortOptions.map(
  (option) => option.value,
) as [ReasoningEffort, ...ReasoningEffort[]];

const reasoningEffortLabelByValue = new Map(
  reasoningEffortOptions.map((option) => [option.value, option.label]),
);

const allFrontierReasoningEfforts = reasoningEffortValues;

// Keep task-facing options aligned with `codex debug models`; internal-only models stay hidden.
export const codexModelOptions = [
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    detail: "複雑なコーディングと長い調査向け",
    efforts: allFrontierReasoningEfforts,
    defaultEffort: "medium",
  },
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    detail: "品質とコストのバランス",
    efforts: allFrontierReasoningEfforts,
    defaultEffort: "medium",
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    detail: "軽いタスクとサブエージェント向け",
    efforts: allFrontierReasoningEfforts,
    defaultEffort: "medium",
  },
  {
    value: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    detail: "低レイテンシの対話的なコーディング向け",
    efforts: allFrontierReasoningEfforts,
    defaultEffort: "high",
  },
] as const;

export type CodexModel = (typeof codexModelOptions)[number]["value"];

export const defaultCodexModel: CodexModel = "gpt-5.5";
export const defaultReasoningEffort: ReasoningEffort = "medium";

export const codexModelValues = codexModelOptions.map(
  (option) => option.value,
) as [CodexModel, ...CodexModel[]];

export function normalizeCodexModel(
  value: string | undefined | null,
): CodexModel {
  return codexModelValues.includes(value as CodexModel)
    ? (value as CodexModel)
    : defaultCodexModel;
}

export function normalizeReasoningEffort(
  value: string | undefined | null,
  model: CodexModel = defaultCodexModel,
): ReasoningEffort {
  const efforts = codexModelOptions.find(
    (option) => option.value === model,
  )?.efforts;
  return efforts?.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : defaultReasoningEffortForModel(model);
}

export function defaultReasoningEffortForModel(
  model: CodexModel,
): ReasoningEffort {
  return (
    codexModelOptions.find((option) => option.value === model)?.defaultEffort ??
    defaultReasoningEffort
  );
}

export function reasoningEffortOptionsForModel(model: CodexModel) {
  const profile = codexModelOptions.find((option) => option.value === model);
  return (profile?.efforts ?? reasoningEffortValues).map((value) => ({
    value,
    label: reasoningEffortLabelByValue.get(value) ?? value,
  }));
}
