import { formatSidebarTimestamp } from "@/features/comments/timestamp";

describe("sidebar timestamp formatting", () => {
  const timestamp = "2026-08-11T10:30:00Z";

  it("shows full and compact timestamps", () => {
    expect(formatSidebarTimestamp(timestamp, "full", { locale: "en-US" })).toContain("2026");
    expect(formatSidebarTimestamp(timestamp, "compact", { locale: "en-US" })).toContain("Aug");
  });

  it("shows relative timestamps against the supplied time", () => {
    expect(
      formatSidebarTimestamp(timestamp, "relative", {
        now: new Date("2026-08-11T12:30:00Z"),
        locale: "en",
      })
    ).toBe("2 hours ago");
  });

  it("can hide timestamps and preserves malformed values otherwise", () => {
    expect(formatSidebarTimestamp(timestamp, "hidden")).toBeNull();
    expect(formatSidebarTimestamp("not-a-date", "compact")).toBe("not-a-date");
  });
});
