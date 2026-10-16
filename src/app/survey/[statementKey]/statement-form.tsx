"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { saveAnswer } from "@/lib/survey/actions";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import type { ScaleOption } from "@/lib/survey/queries";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function isInsideRadioGroup(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[role="radiogroup"]') !== null
  );
}

// Base UI's Radio root renders a <span role="radio"> (not a <button>) and
// explicitly preventDefaults Enter itself ("Radio only activates with
// Space"), so a focused radio is never a button target — Enter typed there
// is meant to reach this component's own global handler below, not be
// swallowed as a duplicate activation.
function isButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.getAttribute("role") === "button")
  );
}

export function StatementForm({
  statementId,
  labelledById,
  options,
  initialValue,
  prevHref,
  nextHref,
}: {
  statementId: string;
  labelledById: string;
  options: ScaleOption[];
  initialValue: number | null;
  /** Always a concrete route — the first statement of a section points
   * Back at that section's own break screen (see resolveStatementNav). */
  prevHref: string;
  nextHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Always a defined string (never undefined) so RadioGroup stays
  // controlled for the component's entire lifetime — switching between
  // controlled and uncontrolled left base-ui's internal selection stuck on
  // the last choice instead of clearing it. "" is not a valid option
  // value, so it renders as "nothing selected."
  const initialValueStr = initialValue != null ? String(initialValue) : "";
  const [value, setValue] = useState<string>(initialValueStr);
  const [error, setError] = useState<string | null>(null);

  // The most recently confirmed-saved value (from the initial server
  // snapshot, or from this component's own successful saves). Used only to
  // revert the visible selection on the definitive "already submitted"
  // race — a selection that can never be saved. A retryable save failure
  // (network/server error) keeps the participant's selection on screen so
  // Submit can simply be pressed again.
  const lastSavedValueRef = useRef<string>(initialValueStr);

  // Choosing an option (click, Space, a digit shortcut, or the radio
  // group's own arrow-key roving focus) only updates local selection — it
  // never saves or navigates. Saving and advancing happen only through the
  // primary button (Submit when something is selected, Next otherwise) or
  // Enter, which activates that same primary action.
  const selectOption = useCallback((next: string) => {
    setError(null);
    setValue(next);
  }, []);

  const handlePrimary = useCallback(() => {
    if (isPending) {
      return;
    }

    if (value === "") {
      // Nothing selected: behave exactly like today's Next — advance
      // without saving.
      startTransition(() => {
        router.push(nextHref);
      });
      return;
    }

    // Something selected: Submit saves first, then advances on success.
    setError(null);
    startTransition(async () => {
      try {
        const result = await saveAnswer({
          statementId,
          value: Number(value),
        });

        if (result.ok) {
          lastSavedValueRef.current = value;
          router.push(nextHref);
          return;
        }

        if (result.reason === "not-open") {
          router.replace("/");
          return;
        }

        if (result.reason === "submitted") {
          setValue(lastSavedValueRef.current);
        }

        setError(result.error);
      } catch {
        setError(SURVEY_MESSAGES.saveFailed);
      }
    });
  }, [isPending, value, statementId, nextHref, router, startTransition]);

  // Document-level shortcuts: digits only select (same as a click);
  // Enter activates the primary button (Submit or Next); ArrowLeft/
  // ArrowRight page-navigate like Back/Next — ArrowRight never saves,
  // even when an unsaved selection is present — but only when focus is
  // outside the radio group, where the group's own native arrow
  // navigation (roving tabindex) owns the keys instead.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      // Checked before the defaultPrevented guard below: Base UI's Radio
      // root deliberately calls preventDefault() on its own Enter keydown
      // (to stop its internal useButton from turning Enter into a click),
      // but that must not stop THIS Enter from reaching the primary
      // action — Enter is meant to activate Submit/Next from anywhere,
      // including a focused radio.
      if (event.key === "Enter") {
        if (isPending || isButtonTarget(event.target)) {
          return;
        }
        event.preventDefault();
        handlePrimary();
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        if (isPending) {
          return;
        }
        const n = Number(event.key);
        if (n >= 1 && n <= options.length) {
          event.preventDefault();
          selectOption(String(options[n - 1].value));
        }
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (isInsideRadioGroup(event.target) || isPending) {
          return;
        }
        event.preventDefault();
        if (event.key === "ArrowLeft") {
          startTransition(() => {
            router.push(prevHref);
          });
        } else if (event.key === "ArrowRight") {
          startTransition(() => {
            router.push(nextHref);
          });
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    options,
    prevHref,
    nextHref,
    isPending,
    selectOption,
    handlePrimary,
    router,
    startTransition,
  ]);

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={value}
        onValueChange={(next) => selectOption(String(next))}
        aria-labelledby={labelledById}
        disabled={isPending}
      >
        {options.map((option) => {
          const optionLabelId = `${statementId}-option-${option.value}`;
          return (
            <label
              key={option.value}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-2 text-base break-words has-data-checked:border-primary has-data-checked:ring-1 has-data-checked:ring-primary"
            >
              <RadioGroupItem
                value={String(option.value)}
                aria-labelledby={optionLabelId}
              />
              <span id={optionLabelId} className="break-words">
                {option.label}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-between gap-4 pt-8">
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4 text-base"
          disabled={isPending}
          onClick={() => {
            startTransition(() => {
              router.push(prevHref);
            });
          }}
        >
          {SURVEY_MESSAGES.back}
        </Button>
        <Button
          type="button"
          variant="default"
          className="h-11 px-4 text-base"
          disabled={isPending}
          onClick={handlePrimary}
        >
          {value === "" ? SURVEY_MESSAGES.next : SURVEY_MESSAGES.submit}
        </Button>
      </div>
      <p className="pointer-coarse:hidden text-sm text-zinc-600 dark:text-zinc-400">
        {"Press "}
        <Kbd>{`1–${options.length}`}</Kbd>
        {" to choose, "}
        <Kbd>{"Enter"}</Kbd>
        {" to submit, "}
        <Kbd>{"←"}</Kbd>
        {" "}
        <Kbd>{"→"}</Kbd>
        {" to move between statements"}
      </p>
    </div>
  );
}
