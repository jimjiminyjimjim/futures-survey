import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  buildSlides,
  buildDeckSteps,
  buildSectionHeadings,
} from "@/lib/presentation/build-slides";
import { toRoundCsv } from "@/lib/admin/csv";
import { pivotResponses } from "@/lib/admin/responses";
import {
  SESSION_1_INPUT,
  SESSION_1_CSV_COLUMNS,
  syntheticSession1Rows,
} from "./fixtures/session-1-v3";

/**
 * Session 1 regression (quick task 261117-eak). Session 2 adds a ranking
 * kind, an importance_change scale and per-session consent, and none of it
 * may change what Session 1 produces. This spec computes Session 1's
 * presentation slides, deck steps, section headings and CSV output from a
 * Session-1-v3-shaped fixture and deep-equals them against a baseline that
 * was RECORDED FROM THE UNTOUCHED CODE before any src change.
 *
 * Re-recording (RECORD_SESSION1_BASELINE=1) is refused once src has changes,
 * so the baseline can only ever describe untouched Session 1 behaviour.
 */

const BASELINE_PATH = path.join(
  process.cwd(),
  "tests/api/fixtures/session-1-baseline.json"
);

function compute() {
  const { slides } = buildSlides(SESSION_1_INPUT);
  const steps = buildDeckSteps(slides);
  const headings = buildSectionHeadings(slides);
  const participants = pivotResponses(syntheticSession1Rows());
  const csvWithConsent = toRoundCsv(participants, SESSION_1_CSV_COLUMNS, {
    includeConsent: true,
  });
  const csvWithoutConsent = toRoundCsv(participants, SESSION_1_CSV_COLUMNS);
  // JSON round trip so the comparison matches exactly what is stored on disk
  // (undefined fields dropped, as JSON.stringify drops them).
  return JSON.parse(
    JSON.stringify({ slides, steps, headings, csvWithConsent, csvWithoutConsent })
  );
}

test.describe("session 1 regression — @static (no DB)", () => {
  test("slides, deck steps, headings and CSV match the recorded baseline", () => {
    const actual = compute();

    if (process.env.RECORD_SESSION1_BASELINE === "1") {
      const dirty = execSync("git status --porcelain -- src", {
        encoding: "utf8",
      }).trim();
      if (dirty !== "") {
        throw new Error("refusing to record: src has changes");
      }
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(actual, null, 2) + "\n");
      return;
    }

    const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    expect(actual).toEqual(baseline);
  });

  test("the fixture is non-trivial (guards against recording an empty baseline)", () => {
    const actual = compute();
    expect(actual.slides.length).toBeGreaterThan(30);
    expect(actual.steps.length).toBeGreaterThan(actual.slides.length);
    expect(actual.csvWithConsent.split("\r\n").length).toBe(5);
  });
});
