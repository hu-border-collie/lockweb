import { describe, it, expect } from "vitest";
import {
  intervals,
  totalWear,
  dailyWear,
  summary,
  streaks,
  dayKey,
  shiftDay,
  validateSession,
} from "../src/lib/time";
import type { Entry, WearSession } from "../src/lib/models";
const time = (s: string) => new Date(s).getTime();
const session = (start: string, end: string | null, id = "s"): WearSession => ({
  id,
  start: time(start),
  end: end ? time(end) : null,
  note: "",
});
const entry = (day: string, id = day): Entry => ({
  id,
  timestamp: time(day + "T12:00:00+08:00"),
  note: "",
  tags: [],
  wearing: "on",
  comfort: null,
  photoIds: ["p" + id],
  createdAt: 0,
  updatedAt: 0,
});
describe("wear time and calendar statistics", () => {
  it("merges overlaps and adjacent intervals, regardless of order", () => {
    const now = time("2026-10-12T12:00:00+08:00");
    const sessions = [
      session("2026-10-12T02:00:00+08:00", "2026-10-12T05:00:00+08:00"),
      session("2026-10-12T01:00:00+08:00", "2026-10-12T03:00:00+08:00"),
      session("2026-10-12T05:00:00+08:00", "2026-10-12T06:00:00+08:00"),
    ];
    expect(intervals(sessions, now)).toHaveLength(1);
    expect(totalWear(sessions, now)).toBe(5 * 3600000);
  });
  it("splits crossing midnight correctly, including overlapping ongoing wear", () => {
    const now = time("2026-10-12T03:00:00+08:00");
    const sessions = [
      session("2026-10-11T22:00:00+08:00", null),
      session("2026-10-12T01:00:00+08:00", "2026-10-12T02:00:00+08:00"),
    ];
    expect(dailyWear(sessions, now)).toEqual({
      "2026-10-11": 2 * 3600000,
      "2026-10-12": 3 * 3600000,
    });
    expect(totalWear(sessions, now)).toBe(5 * 3600000);
  });
  it("uses local midnight rather than fixed 24h buckets across DST", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const sessions = [
        session("2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00"),
      ];
      expect(
        dailyWear(sessions, time("2026-03-10T00:00:00-04:00"))["2026-03-08"],
      ).toBe(23 * 3600000);
    } finally {
      process.env.TZ = previous;
    }
  });
  it("ignores invalid, zero, reversed and future-only ranges", () => {
    const now = time("2026-10-12T12:00:00+08:00");
    expect(
      totalWear(
        [
          { id: "a", start: NaN, end: null, note: "" },
          session("2026-10-13T00:00:00+08:00", null),
          session("2026-10-12T02:00:00+08:00", "2026-10-12T01:00:00+08:00"),
        ],
        now,
      ),
    ).toBe(0);
  });
  it("computes streak from today or yesterday and counts days once", () => {
    const now = time("2026-10-12T18:00:00+08:00");
    const entries = [
      entry("2026-10-09"),
      entry("2026-10-10"),
      entry("2026-10-11"),
      entry("2026-10-11", "extra"),
    ];
    expect(streaks(entries, now)).toEqual({ current: 3, longest: 3 });
    expect(streaks(entries, time("2026-10-13T18:00:00+08:00"))).toEqual({
      current: 0,
      longest: 3,
    });
  });
  it("keeps longest single wear separate from longest checkin streak", () => {
    const now = time("2026-10-12T18:00:00+08:00");
    const s = summary(
      [entry("2026-10-11"), entry("2026-10-12")],
      [session("2026-10-12T01:00:00+08:00", "2026-10-12T06:00:00+08:00")],
      now,
    );
    expect(s.longestWear).toBe(5 * 3600000);
    expect(s.longest).toBe(2);
    expect(s.today).toBe(1);
    expect(s.week).toBe(1);
    expect(s.month).toBe(2);
    expect(s.photos).toBe(2);
  });
  it("handles month/year boundaries and leap days", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2024-02-28", 1)).toBe("2024-02-29");
    expect(dayKey(time("2026-10-11T17:00:00Z"))).toBe("2026-10-12");
  });
  it("rejects invalid manual wear dates", () => {
    expect(() =>
      validateSession({ id: "a", start: 0, end: -1, note: "" }),
    ).toThrow();
    expect(() =>
      validateSession({
        id: "a",
        start: Date.now() + 10000,
        end: null,
        note: "",
      }),
    ).toThrow();
  });
});
