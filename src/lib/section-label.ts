/**
 * Pure section-label helpers shared by the participant pages (state.ts) and
 * presentation mode (build-slides.ts). A Session 2 question can be split
 * into parts labelled with a capital letter and a digit ("B1", "B2"); to
 * the reader both parts are the one question "B". Numeric labels ("2a")
 * and bare letters ("A") are never rewritten.
 */

/** "B1" -> "B"; every other label (including null) is returned unchanged. */
export function displaySectionLabel(label: string | null): string | null {
  if (!label) {
    return label;
  }
  return label.match(/^([A-Z])\d$/)?.[1] ?? label;
}

/**
 * The key that groups section parts into one numbered question: the parent
 * letter for a letter+digit label ("B1" and "B2" -> "B"), otherwise the
 * section's own id (every other section is its own question).
 */
export function questionGroupKey(
  label: string | null,
  sectionId: string
): string {
  const letter = label?.match(/^([A-Z])\d$/)?.[1];
  return letter ? `label:${letter}` : `section:${sectionId}`;
}
