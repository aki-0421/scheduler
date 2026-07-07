import { CronExpressionParser } from "cron-parser";

export type CronPreviewResult =
  | { ok: true; dates: string[] }
  | { ok: false; error: string };

export function getCronPreview(
  expression: string,
  timezone: string,
  count = 5,
): CronPreviewResult {
  const normalized = expression.trim().replace(/\s+/g, " ");
  const fields = normalized ? normalized.split(" ") : [];

  if (fields.length === 6) {
    return {
      ok: false,
      error: "秒 field はサポートしていません。5-field cron を使ってください。",
    };
  }

  if (fields.length !== 5) {
    return { ok: false, error: "5-field cron 式を入力してください。" };
  }

  try {
    const interval = CronExpressionParser.parse(normalized, {
      currentDate: new Date(),
      tz: timezone,
    });

    return {
      ok: true,
      dates: interval.take(count).map((date) => date.toDate().toISOString()),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "cron 式が不正です。",
    };
  }
}
