/**
 * Pure per-kind answer rules shared by the participant forms (client) and
 * the saveAnswer server action. No @supabase / next / react imports. The
 * database trigger answers_before_write
 * (supabase/migrations/20261018000100_session_1_content_v3.sql) enforces
 * the same rules as the final word.
 */
import { z } from "zod";

export const QUESTION_KINDS = [
  "scale",
  "choice_one",
  "choice_multi",
  "choice_exact",
  "prediction",
  "rating",
  "two_ended",
  "choice_up_to",
] as const;

export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type ChoiceOption = {
  value: number;
  label: string;
  /** choice_multi only: picking this option ("None of these") clears all others. */
  exclusive: boolean;
};

/** A saved answer: `value` for scale/choice_one/prediction, `choiceValues` for choice_multi/choice_exact. */
export type AnswerValue = {
  value: number | null;
  choiceValues: number[] | null;
};

export const PREDICTION_MIN = 0;
export const PREDICTION_MAX = 100;
export const RATING_MIN = 0;
export const RATING_MAX = 10;
export const TWO_ENDED_MIN = 0;
export const TWO_ENDED_MAX = 100;

const ChoiceOptionSchema = z.object({
  value: z.number().int().min(1).max(50),
  label: z.string().trim().min(1),
  exclusive: z.boolean().optional(),
});

/** Parses statements.options (jsonb). Anything malformed yields []. */
export function parseChoiceOptions(raw: unknown): ChoiceOption[] {
  const parsed = z.array(ChoiceOptionSchema).safeParse(raw);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.map((o) => ({
    value: o.value,
    label: o.label,
    exclusive: o.exclusive === true,
  }));
}

export type AnswerRuleQuestion = {
  kind: QuestionKind;
  /** Scale options for `scale`, statement options for choice kinds. */
  options: ChoiceOption[];
  choiceCount: number | null;
};

export type AnswerPayload =
  | { value: number; choiceValues: null }
  | { value: null; choiceValues: number[] };

/** Whether a kind stores its answer in choice_values (vs value). */
export function isListKind(kind: QuestionKind): boolean {
  return (
    kind === "choice_multi" || kind === "choice_exact" || kind === "choice_up_to"
  );
}

/**
 * Validates a submitted answer against its question and returns the
 * normalised payload to store (choice values deduplicated-checked and
 * sorted ascending), or null when the answer isn't valid for that kind.
 */
export function normaliseAnswer(
  question: AnswerRuleQuestion,
  input: { value?: number | null; choiceValues?: number[] | null }
): AnswerPayload | null {
  const optionValues = new Set(question.options.map((o) => o.value));

  if (!isListKind(question.kind)) {
    if (input.choiceValues != null) {
      return null;
    }
    const value = input.value;
    if (value == null || !Number.isInteger(value)) {
      return null;
    }
    if (question.kind === "prediction") {
      return value >= PREDICTION_MIN && value <= PREDICTION_MAX
        ? { value, choiceValues: null }
        : null;
    }
    if (question.kind === "rating") {
      return value >= RATING_MIN && value <= RATING_MAX
        ? { value, choiceValues: null }
        : null;
    }
    if (question.kind === "two_ended") {
      return value >= TWO_ENDED_MIN && value <= TWO_ENDED_MAX
        ? { value, choiceValues: null }
        : null;
    }
    // scale / choice_one
    return optionValues.has(value) ? { value, choiceValues: null } : null;
  }

  if (input.value != null) {
    return null;
  }
  const picks = input.choiceValues;
  if (!picks || picks.length === 0) {
    return null;
  }
  if (!picks.every((v) => Number.isInteger(v) && optionValues.has(v))) {
    return null;
  }
  const unique = new Set(picks);
  if (unique.size !== picks.length) {
    return null;
  }

  if (question.kind === "choice_exact") {
    if (question.choiceCount == null || picks.length !== question.choiceCount) {
      return null;
    }
  } else if (question.kind === "choice_up_to") {
    // 1..choiceCount distinct options; an exclusive option must be alone.
    if (question.choiceCount == null || picks.length > question.choiceCount) {
      return null;
    }
    const exclusive = new Set(
      question.options.filter((o) => o.exclusive).map((o) => o.value)
    );
    if (picks.length > 1 && picks.some((v) => exclusive.has(v))) {
      return null;
    }
  } else {
    // choice_multi: an exclusive option must be picked alone.
    const exclusive = new Set(
      question.options.filter((o) => o.exclusive).map((o) => o.value)
    );
    if (picks.length > 1 && picks.some((v) => exclusive.has(v))) {
      return null;
    }
  }

  return { value: null, choiceValues: [...picks].sort((a, b) => a - b) };
}

/**
 * choice_multi toggle: picking an exclusive option clears every other
 * pick; picking any other option clears the exclusive ones.
 */
export function toggleMultiChoice(
  options: ChoiceOption[],
  current: number[],
  value: number
): number[] {
  if (current.includes(value)) {
    return current.filter((v) => v !== value);
  }
  const option = options.find((o) => o.value === value);
  if (!option) {
    return current;
  }
  if (option.exclusive) {
    return [value];
  }
  const exclusive = new Set(
    options.filter((o) => o.exclusive).map((o) => o.value)
  );
  return [...current.filter((v) => !exclusive.has(v)), value];
}

/** choice_exact toggle: never exceeds `count` picks. */
export function toggleExactChoice(
  current: number[],
  value: number,
  count: number
): number[] {
  if (current.includes(value)) {
    return current.filter((v) => v !== value);
  }
  if (current.length >= count) {
    return current;
  }
  return [...current, value];
}

/**
 * choice_up_to toggle: unticking removes the value; an exclusive option
 * replaces everything; a normal option first clears any exclusive pick,
 * then is refused (current returned unchanged) once `max` normal picks
 * are already chosen.
 */
export function toggleUpToChoice(
  options: ChoiceOption[],
  current: number[],
  value: number,
  max: number
): number[] {
  if (current.includes(value)) {
    return current.filter((v) => v !== value);
  }
  const option = options.find((o) => o.value === value);
  if (!option) {
    return current;
  }
  if (option.exclusive) {
    return [value];
  }
  const exclusive = new Set(
    options.filter((o) => o.exclusive).map((o) => o.value)
  );
  const withoutExclusive = current.filter((v) => !exclusive.has(v));
  if (withoutExclusive.length >= max) {
    return withoutExclusive;
  }
  return [...withoutExclusive, value];
}

/** True when a saved answer exists for the question (any kind). */
export function hasAnswer(answer: AnswerValue | undefined): boolean {
  if (!answer) {
    return false;
  }
  return (
    answer.value != null ||
    (answer.choiceValues != null && answer.choiceValues.length > 0)
  );
}
