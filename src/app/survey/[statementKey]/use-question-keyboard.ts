"use client";

import { useEffect } from "react";

function isTextEntryTarget(target: EventTarget | null): boolean {
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

// Base UI's Radio and Checkbox roots render a <span role="radio"|"checkbox">
// (not a <button>) and preventDefault Enter themselves, so a focused
// option is never a button target — Enter typed there is meant to reach
// this hook's handler, not be swallowed as a duplicate activation. A real
// focused <button> (Back, Skip, Submit) already does the right thing
// natively on Enter, so the handler below must not ALSO fire then.
function isButtonTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" || target.getAttribute("role") === "button")
  );
}

/**
 * Document-level keyboard support shared by every question kind:
 *  - Enter activates the primary action (Submit / Next / Skip) from
 *    anywhere except a focused button or a textarea — including the
 *    prediction's number input and slider, where Enter means "submit".
 *  - Digits 0–9 call onDigit (select / toggle option n) when focus is not
 *    in a text field. Existing forms already ignore n < 1 (the rating
 *    form is the only one that uses 0).
 *  - ← / → page-navigate like Back / Next (never saving), except inside a
 *    radio group (its own roving focus owns the arrows) or a text field /
 *    slider (where arrows edit the value).
 */
export function useQuestionKeyboard({
  isPending,
  onPrimary,
  onDigit,
  onPrev,
  onNext,
}: {
  isPending: boolean;
  onPrimary: () => void;
  onDigit?: (n: number) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      // Checked before the defaultPrevented guard: Base UI's Radio/Checkbox
      // roots preventDefault their own Enter keydown, but that must not
      // stop Enter from reaching the primary action.
      if (event.key === "Enter") {
        if (
          isPending ||
          isButtonTarget(event.target) ||
          (event.target instanceof HTMLElement &&
            event.target.tagName === "TEXTAREA")
        ) {
          return;
        }
        event.preventDefault();
        onPrimary();
        return;
      }

      if (isTextEntryTarget(event.target) || event.defaultPrevented) {
        return;
      }

      if (/^[0-9]$/.test(event.key)) {
        if (isPending || !onDigit) {
          return;
        }
        event.preventDefault();
        onDigit(Number(event.key));
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (isInsideRadioGroup(event.target) || isPending) {
          return;
        }
        event.preventDefault();
        if (event.key === "ArrowLeft") {
          onPrev();
        } else {
          onNext();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isPending, onPrimary, onDigit, onPrev, onNext]);
}
