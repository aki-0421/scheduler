type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function parseLocalDateTime(dateValue: string, timeValue: string): DateTimeParts {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);

  if (
    !year ||
    !month ||
    !day ||
    hour == null ||
    Number.isNaN(hour) ||
    minute == null ||
    Number.isNaN(minute)
  ) {
    throw new Error("ローカルの日付と時刻が無効です。");
  }

  return { year, month, day, hour, minute, second: 0 };
}

function getPartsInTimeZone(date: Date, timeZone: string): DateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function partsToUtcMs(parts: DateTimeParts) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const zonedParts = getPartsInTimeZone(date, timeZone);
  return partsToUtcMs(zonedParts) - date.getTime();
}

function sameParts(left: DateTimeParts, right: DateTimeParts) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

export function localDateTimeToUtcIso(
  dateValue: string,
  timeValue: string,
  timeZone: string,
) {
  const localParts = parseLocalDateTime(dateValue, timeValue);
  const localAsUtcMs = partsToUtcMs(localParts);
  let utcMs = localAsUtcMs;

  for (let index = 0; index < 4; index += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = localAsUtcMs - offset;
    if (nextUtcMs === utcMs) {
      break;
    }
    utcMs = nextUtcMs;
  }

  const utcDate = new Date(utcMs);
  const resolvedParts = getPartsInTimeZone(utcDate, timeZone);
  if (!sameParts(localParts, resolvedParts)) {
    throw new Error("選択したローカル時刻はこのタイムゾーンに存在しません。");
  }

  return utcDate.toISOString();
}

export function utcIsoToLocalDateTime(isoValue: string, timeZone: string) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("UTC の日付と時刻が無効です。");
  }

  const parts = getPartsInTimeZone(date, timeZone);
  return {
    date: [
      String(parts.year).padStart(4, "0"),
      String(parts.month).padStart(2, "0"),
      String(parts.day).padStart(2, "0"),
    ].join("-"),
    time: [
      String(parts.hour).padStart(2, "0"),
      String(parts.minute).padStart(2, "0"),
    ].join(":"),
  };
}
