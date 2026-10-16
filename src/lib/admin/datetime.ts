/**
 * UK-time (Europe/London) display helper for every admin screen. Display
 * only — never used for a date comparison (RND-05's status derivation
 * lives entirely in Postgres, see round_status_at).
 */
export const ADMIN_TIME_ZONE = "Europe/London";

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ADMIN_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAdminDateTime(iso: string | null): string | null {
  if (iso === null) {
    return null;
  }
  return formatter.format(new Date(iso));
}

const inputPartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ADMIN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wallTimeParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
} {
  const parts = inputPartsFormatter.formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: byType.get("year")!,
    month: byType.get("month")!,
    day: byType.get("day")!,
    hour: byType.get("hour")!,
    minute: byType.get("minute")!,
  };
}

function wallTimeInputValue(date: Date): string {
  const { year, month, day, hour, minute } = wallTimeParts(date);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * The "YYYY-MM-DDTHH:mm" London wall-time value for a datetime-local
 * input, derived from formatToParts (hourCycle h23) — never a raw
 * toISOString() slice, which would show UTC, not UK time. "" for null.
 */
export function toAdminDateTimeInputValue(iso: string | null): string {
  if (iso === null) {
    return "";
  }
  return wallTimeInputValue(new Date(iso));
}

const INPUT_SHAPE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Parses a datetime-local input's London wall-time string into a UTC ISO
 * instant. This is the one place wall time is ever converted — it only
 * ever compares wall-time strings (never round state). Tries both UK
 * standard-time offsets (UTC and UTC+1) and keeps whichever candidate's
 * own London wall time round-trips back to the input, picking the
 * earliest if both do (the autumn "clocks go back" ambiguous hour);
 * neither round-tripping means the time doesn't exist (the spring
 * "clocks go forward" gap).
 */
export function parseAdminDateTimeInput(
  value: string
): { ok: true; iso: string | null } | { ok: false; reason: "invalid" | "nonexistent" } {
  if (value === "") {
    return { ok: true, iso: null };
  }

  const match = INPUT_SHAPE.exec(value);
  if (!match) {
    return { ok: false, reason: "invalid" };
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // Guard against out-of-range components (e.g. month 13, day 32) that
  // Date.UTC would otherwise silently roll over into a different date.
  const rolledBack = new Date(utcMs);
  if (
    rolledBack.getUTCFullYear() !== year ||
    rolledBack.getUTCMonth() !== month - 1 ||
    rolledBack.getUTCDate() !== day ||
    rolledBack.getUTCHours() !== hour ||
    rolledBack.getUTCMinutes() !== minute
  ) {
    return { ok: false, reason: "invalid" };
  }

  const candidateOffsetsMinutes = [0, -60]; // UTC, then UTC+1 (BST)
  const matching: Date[] = [];
  for (const offsetMinutes of candidateOffsetsMinutes) {
    const candidate = new Date(utcMs + offsetMinutes * 60 * 1000);
    if (wallTimeInputValue(candidate) === value) {
      matching.push(candidate);
    }
  }

  if (matching.length === 0) {
    return { ok: false, reason: "nonexistent" };
  }

  matching.sort((a, b) => a.getTime() - b.getTime());
  return { ok: true, iso: matching[0].toISOString() };
}
