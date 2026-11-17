"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SURVEY_MESSAGES } from "@/lib/survey/messages";
import {
  normaliseAnswer,
  placeRank,
  rankNext,
  unrank,
  type ChoiceOption,
} from "@/lib/survey/answer-rules";
import { cn } from "@/lib/utils";
import {
  KeyboardHint,
  QuestionButtons,
  QuestionError,
  useSaveAndAdvance,
  type QuestionNavProps,
} from "./question-controls";
import { useQuestionKeyboard } from "./use-question-keyboard";

/**
 * Ranking questions: the participant ranks EVERY item, most important
 * first, in ONE list (it takes the least space on a phone).
 *  - Ranked items sit at the top in rank order, each with its number. A
 *    line labelled "Not ranked yet" separates them from the unranked
 *    items, which follow in the fixed order they were written in, each with
 *    an empty circle. Nothing is ranked on a first visit (no default order,
 *    so nobody can just accept a pre-made ranking).
 *  - Tap an unranked item and it takes the next number, sliding up above
 *    the line (a FLIP animation; skipped for prefers-reduced-motion).
 *    Numbered items aren't tappable.
 *  - Every row has a grip handle on the right: drag it onto a numbered item
 *    to take that place (the others shift), or drag a numbered item below
 *    the line onto an unranked one to un-number it. A drag starts from the grip
 *    only (touch-action none on the grip alone), so the page still scrolls
 *    everywhere else. @dnd-kit supplies pointer, touch and keyboard sensors
 *    plus the screen-reader announcements.
 *  - Continue stays disabled until every item is ranked, and saves the
 *    whole ranking in rank order.
 * There is no digit-key shortcut here (there are too many ways to read
 * "press 3"); Enter and the arrow keys behave as on the other forms, except
 * while a drag is active, when they belong to the drag.
 */

const itemId = (value: number) => `item-${value}`;

function valueFromId(id: UniqueIdentifier | null | undefined): number | null {
  if (id == null) {
    return null;
  }
  const text = String(id);
  if (!text.startsWith("item-")) {
    return null;
  }
  const value = Number(text.slice("item-".length));
  return Number.isInteger(value) ? value : null;
}

/**
 * Where a drop of `value` onto the row `overId` leaves the ranking, or null
 * for "no change". Over a numbered item: take that item's place. Over an
 * unranked item: a numbered item is un-numbered; an unranked one stays put.
 * Pure.
 */
function resolveDrop(
  ranked: number[],
  value: number,
  overId: UniqueIdentifier | null | undefined,
): number[] | null {
  const overValue = valueFromId(overId);
  if (overValue == null || overValue === value) {
    return null;
  }
  const index = ranked.indexOf(overValue);
  if (index !== -1) {
    return placeRank(ranked, value, index);
  }
  return ranked.includes(value) ? unrank(ranked, value) : null;
}

type RegisterFocus = (key: string, element: HTMLElement | null) => void;

function RankingRow({
  option,
  rank,
  total,
  isPending,
  highlighted,
  onTap,
  register,
  rowRef,
}: {
  option: ChoiceOption;
  /** 1-based rank, or 0 when not ranked yet. */
  rank: number;
  total: number;
  isPending: boolean;
  highlighted: boolean;
  onTap: (value: number) => void;
  register: RegisterFocus;
  rowRef: (element: HTMLElement | null) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: itemId(option.value), disabled: isPending });
  const isRanked = rank > 0;

  const circle = (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
        isRanked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-dashed border-zinc-400",
      )}
    >
      {isRanked ? rank : null}
    </span>
  );
  const rowText =
    "flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left text-base";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={
        isRanked
          ? SURVEY_MESSAGES.rankingItemRanked(option.label, rank, total)
          : undefined
      }
      className={cn("relative", isDragging && "opacity-40")}
    >
      {/* The inner row is what the tap animation moves; dnd-kit owns the
          li's transform. */}
      <div
        ref={rowRef}
        className={cn(
          "flex items-stretch rounded-lg border bg-background",
          isRanked && "border-primary ring-1 ring-primary",
          highlighted && "bg-primary/10 ring-2 ring-primary",
        )}
      >
        {isRanked ? (
          <div className={rowText}>
            {circle}
            <span className="min-w-0 break-words">{option.label}</span>
          </div>
        ) : (
          <button
            type="button"
            ref={(element) => register(itemId(option.value), element)}
            aria-label={SURVEY_MESSAGES.rankingItemUnranked(option.label)}
            disabled={isPending}
            onClick={() => onTap(option.value)}
            className={cn(
              rowText,
              "rounded-l-lg outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            )}
          >
            {circle}
            <span className="min-w-0 break-words">{option.label}</span>
          </button>
        )}
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={SURVEY_MESSAGES.rankingDragHandle(option.label)}
          className={cn(
            "flex w-10 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-r-lg text-zinc-400 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
            isPending && "cursor-default opacity-60",
          )}
        >
          <GripVertical aria-hidden="true" className="size-5" />
        </button>
      </div>
    </li>
  );
}

/** The "Not ranked yet" line goes just above the first unranked row. */
function RankingRowWithDivider({
  showDivider,
  children,
}: {
  showDivider: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {showDivider ? (
        <li
          role="separator"
          className="flex items-center gap-3 py-1 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
        >
          <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
          {SURVEY_MESSAGES.rankingUnrankedDivider}
          <span className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
        </li>
      ) : null}
      {children}
    </>
  );
}

export function RankingForm({
  statementId,
  labelledById,
  options,
  initialValues,
  prevHref,
  nextHref,
}: QuestionNavProps & {
  labelledById: string;
  options: ChoiceOption[];
  initialValues: number[] | null;
}) {
  const { isPending, error, setError, goPrev, goNext, save } =
    useSaveAndAdvance({ statementId, prevHref, nextHref });

  // A saved ranking is only restored when it is a full, valid ranking of
  // these options; anything else starts the question fresh.
  const restored =
    initialValues &&
    normaliseAnswer(
      { kind: "ranking", options, choiceCount: null },
      { choiceValues: initialValues },
    )
      ? [...initialValues]
      : [];
  const [ranked, setRanked] = useState<number[]>(restored);
  const lastSavedRef = useRef<number[]>(restored);
  const [activeValue, setActiveValue] = useState<number | null>(null);
  const [overId, setOverId] = useState<UniqueIdentifier | null>(null);

  const total = options.length;
  const isComplete = ranked.length === total;
  const optionByValue = new Map(options.map((o) => [o.value, o]));
  const labelOf = (value: number | null) =>
    (value != null ? optionByValue.get(value)?.label : undefined) ?? "";
  // Display order: numbered items in rank order, then the rest as written.
  const rows = [
    ...ranked.flatMap((value) => optionByValue.get(value) ?? []),
    ...options.filter((o) => !ranked.includes(o.value)),
  ];

  // A tapped row moves, so keep focus on it once the new order has rendered.
  const focusTargets = useRef(new Map<string, HTMLElement>());
  const focusAfterRef = useRef<string | null>(null);
  const register = useCallback<RegisterFocus>((key, element) => {
    if (element) {
      focusTargets.current.set(key, element);
    } else {
      focusTargets.current.delete(key);
    }
  }, []);
  useEffect(() => {
    const key = focusAfterRef.current;
    if (!key) {
      return;
    }
    focusAfterRef.current = null;
    focusTargets.current.get(key)?.focus({ preventScroll: true });
  }, [ranked]);

  // Tap animation (FLIP): remember where every row was, let React move
  // them, then slide each one from its old place to its new one.
  const rowEls = useRef(new Map<number, HTMLElement>());
  const rowRefFor = useCallback(
    (value: number) => (element: HTMLElement | null) => {
      if (element) {
        rowEls.current.set(value, element);
      } else {
        rowEls.current.delete(value);
      }
    },
    [],
  );
  const before = useRef<{ tapped: number; tops: Map<number, number> } | null>(
    null,
  );
  useLayoutEffect(() => {
    const snapshot = before.current;
    before.current = null;
    if (
      !snapshot ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    rowEls.current.forEach((element, value) => {
      const top = snapshot.tops.get(value);
      if (top === undefined) {
        return;
      }
      const dy = top - element.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) {
        return;
      }
      const isTapped = value === snapshot.tapped;
      // The tapped row travels over the others.
      if (isTapped) {
        element.style.zIndex = "10";
        element.style.position = "relative";
      }
      const animation = element.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        {
          duration: isTapped ? 380 : 260,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
      if (isTapped) {
        animation.onfinish = animation.oncancel = () => {
          element.style.zIndex = "";
          element.style.position = "";
        };
      }
    });
  }, [ranked]);

  const rankItem = useCallback(
    (value: number) => {
      if (ranked.includes(value)) {
        return;
      }
      setError(null);
      const tops = new Map<number, number>();
      rowEls.current.forEach((element, v) =>
        tops.set(v, element.getBoundingClientRect().top),
      );
      before.current = { tapped: value, tops };
      // The tapped row stops being a button, so focus the next unranked one.
      const rest = options.filter(
        (o) => o.value !== value && !ranked.includes(o.value),
      );
      const index = options
        .filter((o) => !ranked.includes(o.value))
        .findIndex((o) => o.value === value);
      const next = rest[index] ?? rest[index - 1];
      focusAfterRef.current = next ? itemId(next.value) : null;
      setRanked((current) => rankNext(current, value));
    },
    [setError, options, ranked],
  );

  const handlePrimary = useCallback(() => {
    if (isPending || !isComplete) {
      return;
    }
    const chosen = [...ranked];
    save(
      { choiceValues: chosen },
      () => {
        lastSavedRef.current = chosen;
      },
      () => setRanked(lastSavedRef.current),
    );
  }, [isPending, isComplete, ranked, save]);

  useQuestionKeyboard({
    isPending,
    onPrimary: handlePrimary,
    onPrev: goPrev,
    onNext: goNext,
    suspended: activeValue !== null,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveValue(valueFromId(event.active.id));
    setOverId(null);
  };
  const handleDragOver = (event: DragOverEvent) => {
    setOverId(event.over ? event.over.id : null);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    const value = valueFromId(event.active.id);
    const over = event.over ? event.over.id : null;
    setActiveValue(null);
    setOverId(null);
    if (value == null) {
      return;
    }
    setError(null);
    setRanked((current) => resolveDrop(current, value, over) ?? current);
  };
  const handleDragCancel = () => {
    setActiveValue(null);
    setOverId(null);
  };

  const announcements: Announcements = {
    onDragStart({ active }) {
      return SURVEY_MESSAGES.rankingDragStart(labelOf(valueFromId(active.id)));
    },
    onDragOver({ active, over }) {
      const value = valueFromId(active.id);
      const label = labelOf(value);
      const next =
        value != null && over ? resolveDrop(ranked, value, over.id) : null;
      if (value == null || !next) {
        return SURVEY_MESSAGES.rankingDragOverNone(label);
      }
      const rank = next.indexOf(value) + 1;
      return rank > 0
        ? SURVEY_MESSAGES.rankingDragOverRank(label, rank)
        : SURVEY_MESSAGES.rankingDragOverUnranked(label);
    },
    onDragEnd({ active, over }) {
      const value = valueFromId(active.id);
      const label = labelOf(value);
      const next =
        value != null && over ? resolveDrop(ranked, value, over.id) : null;
      if (value == null || !next) {
        return SURVEY_MESSAGES.rankingDragCancel(label);
      }
      const rank = next.indexOf(value) + 1;
      return rank > 0
        ? SURVEY_MESSAGES.rankingDropped(label, rank, total)
        : SURVEY_MESSAGES.rankingDroppedUnranked(label);
    },
    onDragCancel({ active }) {
      return SURVEY_MESSAGES.rankingDragCancel(labelOf(valueFromId(active.id)));
    },
  };

  // The same resolver that applies a drop drives the highlight, so the ring
  // always shows the row the item will really take.
  const dropResult =
    activeValue !== null && overId !== null
      ? resolveDrop(ranked, activeValue, overId)
      : null;
  const highlightValue = dropResult !== null ? valueFromId(overId) : null;

  const hintId = `${statementId}-hint`;
  const activeOption =
    activeValue !== null ? optionByValue.get(activeValue) : undefined;
  const activeRank = activeValue !== null ? ranked.indexOf(activeValue) + 1 : 0;

  return (
    <div
      className="flex flex-col gap-4"
      data-ranking-dragging={activeValue !== null ? "true" : "false"}
    >
      <div className="flex flex-col gap-1">
        <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
          {SURVEY_MESSAGES.rankingHint}
        </p>
        <p
          className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          aria-live="polite"
        >
          {SURVEY_MESSAGES.rankingProgress(ranked.length, total)}
        </p>
      </div>
      <DndContext
        id={`ranking-${statementId}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: {
            draggable: SURVEY_MESSAGES.rankingDragInstructions,
          },
          announcements,
        }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext
          items={rows.map((o) => itemId(o.value))}
          strategy={verticalListSortingStrategy}
        >
          <ul
            aria-labelledby={labelledById}
            aria-describedby={hintId}
            className="grid w-full gap-2"
          >
            {rows.map((option, index) => (
              <RankingRowWithDivider
                key={itemId(option.value)}
                showDivider={index === ranked.length && index < total}
              >
                <RankingRow
                  option={option}
                  rank={ranked.indexOf(option.value) + 1}
                  total={total}
                  isPending={isPending}
                  highlighted={highlightValue === option.value}
                  onTap={rankItem}
                  register={register}
                  rowRef={rowRefFor(option.value)}
                />
              </RankingRowWithDivider>
            ))}
          </ul>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeOption ? (
            <div className="flex min-h-11 items-center gap-3 rounded-lg border border-primary bg-background px-3 py-2 text-base shadow-lg">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                  activeRank > 0
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-dashed border-zinc-400",
                )}
              >
                {activeRank > 0 ? activeRank : null}
              </span>
              <span className="min-w-0 flex-1 break-words">
                {activeOption.label}
              </span>
              <GripVertical
                aria-hidden="true"
                className="size-5 shrink-0 text-zinc-400"
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <QuestionError error={error} />
      <QuestionButtons
        isPending={isPending}
        onBack={goPrev}
        primaryLabel={SURVEY_MESSAGES.continueCta}
        primaryDisabled={!isComplete}
        onPrimary={handlePrimary}
      />
      <KeyboardHint optionCount={null} verb="choose" />
    </div>
  );
}
