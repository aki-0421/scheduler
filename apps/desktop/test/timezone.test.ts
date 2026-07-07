import { describe, expect, it } from "vitest";

import { localDateTimeToUtcIso } from "@/lib/timezone";

describe("timezone conversion", () => {
  it("converts selected IANA timezone local time to UTC", () => {
    expect(localDateTimeToUtcIso("2026-07-08", "09:30", "Asia/Tokyo")).toBe(
      "2026-07-08T00:30:00.000Z",
    );
  });

  it("handles a spring DST boundary after the skipped hour", () => {
    expect(
      localDateTimeToUtcIso("2026-03-08", "03:30", "America/New_York"),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("handles a fall DST boundary after the repeated hour", () => {
    expect(
      localDateTimeToUtcIso("2026-11-01", "02:30", "America/New_York"),
    ).toBe("2026-11-01T07:30:00.000Z");
  });
});
