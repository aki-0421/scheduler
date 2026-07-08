export const reasoningEffortOptions = [
  { value: "none", label: "なし" },
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

export const codexModelOptions = [
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    detail: "複雑なコーディングと長い調査向け",
    efforts: allFrontierReasoningEfforts,
  },
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    detail: "品質とコストのバランス",
    efforts: allFrontierReasoningEfforts,
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    detail: "軽いタスクとサブエージェント向け",
    efforts: allFrontierReasoningEfforts,
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
): ReasoningEffort {
  return reasoningEffortValues.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : defaultReasoningEffort;
}

export function reasoningEffortOptionsForModel(model: CodexModel) {
  const profile = codexModelOptions.find((option) => option.value === model);
  return (profile?.efforts ?? reasoningEffortValues).map((value) => ({
    value,
    label: reasoningEffortLabelByValue.get(value) ?? value,
  }));
}
