"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DraggableAttributes,
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
  moveRank,
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
 * first.
 *  - N numbered slots (1..N) sit on top, "Most important" above slot 1 and
 *    "Least important" below slot N. Empty slots are dashed. Under them is
 *    a pool, "Still to rank (n)", of the unranked items in the fixed order
 *    they were written in. Nothing is ranked on a first visit.
 *  - The ranking is one gap-free array: ranked items always fill slots
 *    1..k, so the empty slots are always k+1..N.
 *  - Tap a pool item and it takes the next empty slot. Every item (pool or
 *    slot) also has a visible grip handle: drag it onto a filled slot to
 *    insert it there (later items shift down), onto an empty slot to put it
 *    in the next free number, between filled slots to reorder, or from a
 *    slot onto the pool to unrank it. A drag starts from the handle only
 *    (touch-action none on the handle alone), so the page still scrolls
 *    everywhere else. @dnd-kit supplies pointer, touch and keyboard
 *    sensors plus the screen-reader announcements.
 *  - Filled slots also have Move up / Move down (swap with the neighbour)
 *    and Remove (back to the pool; later ranks close up).
 *  - Continue stays disabled until every slot is filled, and saves the
 *    whole ranking in rank order.
 * There is no digit-key shortcut here (there are too many ways to read
 * "press 3"); Enter and the arrow keys behave as on the other forms, except
 * while a drag is active, when they belong to the drag.
 */

const POOL_ID = "pool";
const itemId = (value: number) => `item-${value}`;
const slotId = (index: number) => `slot-${index}`;

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
 * Where a drop of `value` onto `overId` leaves the ranking, or null for "no
 * change". Over a filled item: insert / reorder at that item's index. Over
 * any empty slot: the item goes to the next free number (placeRank clamps),
 * because the ranking never has gaps. Over the pool: unrank. Pure.
 */
function resolveDrop(
  ranked: number[],
  value: number,
  overId: UniqueIdentifier | null | undefined
): number[] | null {
  if (overId == null) {
    return null;
  }
  const over = String(overId);
  if (over === POOL_ID) {
    return ranked.includes(value) ? unrank(ranked, value) : null;
  }
  if (over.startsWith("slot-")) {
    return placeRank(ranked, value, ranked.length);
  }
  const overValue = valueFromId(overId);
  if (overValue == null || overValue === value) {
    return null;
  }
  const index = ranked.indexOf(overValue);
  if (index === -1) {
    return null;
  }
  return placeRank(ranked, value, index);
}

// pointerWithin when there is a pointer; the keyboard has none, so fall back
// to the nearest centre.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

type RegisterFocus = (key: string, element: HTMLElement | null) => void;

type DragHandleProps = {
  label: string;
  activatorRef: (element: HTMLElement | null) => void;
  listeners: ReturnType<typeof useDraggable>["listeners"];
  attributes: DraggableAttributes;
  disabled: boolean;
};

function DragHandle({
  label,
  activatorRef,
  listeners,
  attributes,
  disabled,
}: DragHandleProps) {
  return (
    <button
      type="button"
      ref={activatorRef}
      {...attributes}
      {...listeners}
      aria-label={SURVEY_MESSAGES.rankingDragHandle(label)}
      className={cn(
        "flex size-11 shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-lg text-zinc-500 outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing dark:text-zinc-400",
        disabled && "cursor-default opacity-60"
      )}
    >
      <GripVertical aria-hidden="true" className="size-5" />
    </button>
  );
}

function PoolItem({
  option,
  isPending,
  onTap,
  register,
}: {
  option: ChoiceOption;
  isPending: boolean;
  onTap: (value: number) => void;
  register: RegisterFocus;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: itemId(option.value), disabled: isPending });

  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-stretch rounded-lg border",
        isDragging && "opacity-40"
      )}
    >
      <DragHandle
        label={option.label}
        activatorRef={setActivatorNodeRef}
        listeners={listeners}
        attributes={attributes}
        disabled={isPending}
      />
      <button
        type="button"
        ref={(element) => register(`pool-${option.value}`, element)}
        aria-label={SURVEY_MESSAGES.rankingItemUnranked(option.label)}
        disabled={isPending}
        onClick={() => onTap(option.value)}
        className="flex min-h-11 min-w-0 flex-1 items-center rounded-r-lg py-2 pr-3 text-left text-base break-words outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <span className="min-w-0 break-words">{option.label}</span>
      </button>
    </li>
  );
}

function FilledSlot({
  option,
  rank,
  total,
  rankedCount,
  isPending,
  highlighted,
  onMove,
  onRemove,
  register,
}: {
  option: ChoiceOption;
  rank: number;
  total: number;
  // How many slots are filled: Move down stops at the last filled slot
  // (there is nothing below it to swap with).
  rankedCount: number;
  isPending: boolean;
  highlighted: boolean;
  onMove: (value: number, direction: -1 | 1) => void;
  onRemove: (value: number) => void;
  register: RegisterFocus;
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
  const atTop = rank === 1;
  const atBottom = rank === rankedCount;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={SURVEY_MESSAGES.rankingItemRanked(option.label, rank, total)}
      className={cn(
        "flex flex-col gap-1 min-[480px]:flex-row min-[480px]:items-stretch min-[480px]:gap-2",
        isDragging && "opacity-40"
      )}
    >
      <div
        className={cn(
          "flex min-h-11 w-full min-w-0 flex-1 items-center gap-1 rounded-lg border border-primary ring-1 ring-primary",
          highlighted && "bg-primary/10 ring-2"
        )}
      >
        <DragHandle
          label={option.label}
          activatorRef={setActivatorNodeRef}
          listeners={listeners}
          attributes={attributes}
          disabled={isPending}
        />
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground"
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1 break-words py-2 pr-3 pl-2 text-base">
          {option.label}
        </span>
      </div>
      <div className="flex shrink-0 justify-end gap-1 min-[480px]:gap-2">
        <button
          type="button"
          ref={(element) => register(`up-${option.value}`, element)}
          aria-label={SURVEY_MESSAGES.rankingMoveUp(option.label)}
          aria-disabled={isPending || atTop}
          onClick={() => {
            if (!isPending && !atTop) {
              onMove(option.value, -1);
            }
          }}
          className={cn(
            "flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
            (isPending || atTop) && "opacity-40"
          )}
        >
          <ChevronUp aria-hidden="true" className="size-5" />
        </button>
        <button
          type="button"
          ref={(element) => register(`down-${option.value}`, element)}
          aria-label={SURVEY_MESSAGES.rankingMoveDown(option.label)}
          aria-disabled={isPending || atBottom}
          onClick={() => {
            if (!isPending && !atBottom) {
              onMove(option.value, 1);
            }
          }}
          className={cn(
            "flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
            (isPending || atBottom) && "opacity-40"
          )}
        >
          <ChevronDown aria-hidden="true" className="size-5" />
        </button>
        <button
          type="button"
          aria-label={SURVEY_MESSAGES.rankingRemove(option.label)}
          disabled={isPending}
          onClick={() => onRemove(option.value)}
          className="flex size-11 items-center justify-center rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
    </li>
  );
}

function EmptySlot({
  index,
  highlighted,
  isPending,
}: {
  index: number;
  highlighted: boolean;
  isPending: boolean;
}) {
  const { setNodeRef } = useDroppable({
    id: slotId(index),
    disabled: isPending,
  });
  return (
    <li
      ref={setNodeRef}
      aria-label={SURVEY_MESSAGES.rankingSlotEmpty(index + 1)}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-lg border border-dashed px-3 py-2 text-zinc-500 dark:text-zinc-400",
        highlighted && "border-primary bg-primary/10"
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-sm font-semibold"
      >
        {index + 1}
      </span>
    </li>
  );
}

function Pool({
  options,
  highlighted,
  isPending,
  onTap,
  register,
  headingId,
}: {
  options: ChoiceOption[];
  highlighted: boolean;
  isPending: boolean;
  onTap: (value: number) => void;
  register: RegisterFocus;
  headingId: string;
}) {
  const { setNodeRef } = useDroppable({ id: POOL_ID, disabled: isPending });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col gap-2 rounded-lg p-1",
        highlighted && "bg-primary/10 ring-2 ring-primary"
      )}
    >
      {options.length === 0 ? (
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {SURVEY_MESSAGES.rankingAllRanked}
        </p>
      ) : (
        <>
          <h2
            id={headingId}
            className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            {SURVEY_MESSAGES.rankingPoolHeading(options.length)}
          </h2>
          <ul aria-labelledby={headingId} className="grid w-full gap-2">
            {options.map((option) => (
              <PoolItem
                key={option.value}
                option={option}
                isPending={isPending}
                onTap={onTap}
                register={register}
              />
            ))}
          </ul>
        </>
      )}
    </div>
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
      { choiceValues: initialValues }
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
  const poolOptions = options.filter((o) => !ranked.includes(o.value));

  // Focus: after a tap / Remove / Move the control the participant was using
  // moves or unmounts, so the key of the element to focus is recorded here
  // and applied in an effect once the new ranking has rendered.
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

  const place = useCallback(
    (value: number) => {
      setError(null);
      const pool = options.filter((o) => !ranked.includes(o.value));
      const index = pool.findIndex((o) => o.value === value);
      const neighbour = pool[index + 1] ?? pool[index - 1];
      focusAfterRef.current = neighbour ? `pool-${neighbour.value}` : null;
      setRanked((current) => rankNext(current, value));
    },
    [setError, options, ranked]
  );

  const remove = useCallback(
    (value: number) => {
      setError(null);
      focusAfterRef.current = `pool-${value}`;
      setRanked((current) => unrank(current, value));
    },
    [setError]
  );

  const move = useCallback(
    (value: number, direction: -1 | 1) => {
      setError(null);
      focusAfterRef.current = `${direction === -1 ? "up" : "down"}-${value}`;
      setRanked((current) => moveRank(current, value, direction));
    },
    [setError]
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
      () => setRanked(lastSavedRef.current)
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
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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
      if (value == null || !over) {
        return SURVEY_MESSAGES.rankingDragOverNone(label);
      }
      if (String(over.id) === POOL_ID) {
        return SURVEY_MESSAGES.rankingDragOverPool(label);
      }
      const next = resolveDrop(ranked, value, over.id);
      const slot = (next ?? ranked).indexOf(value) + 1;
      return slot > 0
        ? SURVEY_MESSAGES.rankingDragOverSlot(label, slot)
        : SURVEY_MESSAGES.rankingDragOverNone(label);
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
        : SURVEY_MESSAGES.rankingDroppedPool(label);
    },
    onDragCancel({ active }) {
      return SURVEY_MESSAGES.rankingDragCancel(labelOf(valueFromId(active.id)));
    },
  };

  // The same resolver that applies a drop drives the highlight, so the ring
  // always shows where the item will really land.
  const dropResult =
    activeValue !== null && overId !== null
      ? resolveDrop(ranked, activeValue, overId)
      : null;
  const highlightPool =
    dropResult !== null && overId !== null && String(overId) === POOL_ID;
  const highlightIndex =
    dropResult !== null && activeValue !== null && !highlightPool
      ? dropResult.indexOf(activeValue)
      : -1;

  const hintId = `${statementId}-hint`;
  const poolHeadingId = `${statementId}-pool`;
  const activeOption = activeValue !== null ? optionByValue.get(activeValue) : undefined;
  const activeRank = activeValue !== null ? ranked.indexOf(activeValue) + 1 : 0;

  return (
    <div
      className="flex flex-col gap-4"
      data-ranking-dragging={activeValue !== null ? "true" : "false"}
    >
      <p id={hintId} className="text-sm text-zinc-600 dark:text-zinc-400">
        {SURVEY_MESSAGES.rankingHint}
      </p>
      <p
        className="text-sm font-medium text-zinc-600 dark:text-zinc-400"
        aria-live="polite"
      >
        {SURVEY_MESSAGES.rankingProgress(ranked.length, total)}
      </p>
      <DndContext
        id={`ranking-${statementId}`}
        sensors={sensors}
        collisionDetection={collisionDetection}
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
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {SURVEY_MESSAGES.rankingMostImportant}
          </p>
          <SortableContext
            items={ranked.map(itemId)}
            strategy={verticalListSortingStrategy}
          >
            <ol
              aria-labelledby={labelledById}
              aria-describedby={hintId}
              className="grid w-full gap-2"
            >
              {options.map((_, index) => {
                const value = ranked[index];
                const option =
                  value !== undefined ? optionByValue.get(value) : undefined;
                return option ? (
                  <FilledSlot
                    key={itemId(option.value)}
                    option={option}
                    rank={index + 1}
                    total={total}
                    rankedCount={ranked.length}
                    isPending={isPending}
                    highlighted={highlightIndex === index}
                    onMove={move}
                    onRemove={remove}
                    register={register}
                  />
                ) : (
                  <EmptySlot
                    key={slotId(index)}
                    index={index}
                    isPending={isPending}
                    highlighted={highlightIndex === index}
                  />
                );
              })}
            </ol>
          </SortableContext>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {SURVEY_MESSAGES.rankingLeastImportant}
          </p>
        </div>
        <Pool
          options={poolOptions}
          highlighted={highlightPool}
          isPending={isPending}
          onTap={place}
          register={register}
          headingId={poolHeadingId}
        />
        <DragOverlay dropAnimation={null}>
          {activeOption ? (
            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-primary bg-background px-3 py-2 text-base shadow-lg">
              <GripVertical
                aria-hidden="true"
                className="size-5 shrink-0 text-zinc-500 dark:text-zinc-400"
              />
              {activeRank > 0 ? (
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground"
                >
                  {activeRank}
                </span>
              ) : null}
              <span className="min-w-0 break-words">{activeOption.label}</span>
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
