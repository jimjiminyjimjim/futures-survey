import { test, expect } from "@playwright/test";
import {
  toAdminDateTimeInputValue,
  parseAdminDateTimeInput,
} from "../../src/lib/admin/datetime";

/**
 * RND-02: the London (Europe/London) wall-time <-> UTC instant round trip
 * used by the schedule form, including both DST transition edges — pure
 * functions, no DB involved.
 */
test.describe("admin datetime — @static (no DB)", () => {
  test("parseAdminDateTimeInput: BST, GMT, nonexistent (spring forward), ambiguous (autumn back), blank, invalid", () => {
    expect(parseAdminDateTimeInput("2026-07-01T09:00")).toEqual({
      ok: true,
      iso: "2026-07-01T08:00:00.000Z",
    });
    expect(parseAdminDateTimeInput("2026-11-01T09:00")).toEqual({
      ok: true,
      iso: "2026-11-01T09:00:00.000Z",
    });
    expect(parseAdminDateTimeInput("2027-03-28T01:30")).toEqual({
      ok: false,
      reason: "nonexistent",
    });
    expect(parseAdminDateTimeInput("2026-10-25T01:30")).toEqual({
      ok: true,
      iso: "2026-10-25T00:30:00.000Z",
    });
    expect(parseAdminDateTimeInput("")).toEqual({ ok: true, iso: null });
    expect(parseAdminDateTimeInput("2026-13-01T09:00")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseAdminDateTimeInput("tomorrow")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  test("toAdminDateTimeInputValue: both sides of the autumn ambiguous hour collapse to one wall time, a BST instant, and null", () => {
    expect(toAdminDateTimeInputValue("2026-10-25T00:30:00Z")).toBe(
      "2026-10-25T01:30"
    );
    expect(toAdminDateTimeInputValue("2026-10-25T01:30:00Z")).toBe(
      "2026-10-25T01:30"
    );
    expect(
      toAdminDateTimeInputValue("2026-07-01T08:00:00.000000+00:00")
    ).toBe("2026-07-01T09:00");
    expect(toAdminDateTimeInputValue(null)).toBe("");
  });
});
