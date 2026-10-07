"use client";

import { useState } from "react";
import { DndContext, DragOverlay, type DragEndEvent, type DragOverEvent } from "@dnd-kit/core";
import { useReducedMotion } from "motion/react";
import { CalendarClock, ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useMediaQuery } from "@/hooks/use-media-query";
import { addDays, daysBetween, formatDay, formatPickerDay } from "@/lib/dates/calendar";
import { getUserToday } from "@/lib/dates/today";
import {
  daysOf,
  itemsByDay,
  shiftAnchor,
  visibleRange,
  weeksOf,
  type CalendarMode,
} from "@/lib/views/calendar";
import { startOfWeek } from "@/lib/views/due-buckets";
import type { AnyItem, ViewTask, ViewTodo } from "@/lib/views/items";
import type { MoveCommand } from "@/lib/views/move-card";
import { cn } from "@/lib/utils";
import { applyEdit } from "./apply";
import { overlayEvents } from "./calendar-overlay";
import { DatePopover } from "./date-popover";
import {
  announcements,
  dropCollision,
  screenReaderInstructions,
  useDragSensors,
  useLiveMessage,
  type DragData,
} from "./dnd";
import { DragCard, DropZone } from "./dnd-nodes";
import { OpenTitle } from "./item-parts";
import type { ViewState } from "./view-state";

// The Calendar (V2 feature 06 §5): tasks and todos on their due date, in a month or a week; tasks
// with a start and a due date span the days between. Dragging an item to another day reschedules it
// (a task that spans days moves as a whole), and an "Undated" list holds what has no date yet, to
// be dragged onto a day. Under 640px it is a week agenda, and every item has "Move to date…".

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const UNDATED = "none";
const MAX_PER_DAY = 3;

const utcDate = (day: string) => new Date(`${day}T00:00:00Z`);

type Dated = ViewTask | ViewTodo;

const isClosed = (item: Dated) =>
  "status" in item ? item.status === "DONE" || item.status === "CANCELLED" : item.isComplete;

export function CalendarView({ state }: { state: ViewState }) {
  const { collection, config, result, ctx, update } = state;
  const phone = useMediaQuery("(max-width: 639px)");
  const reduced = useReducedMotion();
  const sensors = useDragSensors();
  const { say, region } = useLiveMessage();
  const today = getUserToday(ctx.prefs, ctx.now);
  const [anchor, setAnchor] = useState(today);
  const [active, setActive] = useState<Extract<DragData, { type: "card" }> | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const mode: CalendarMode = phone ? "week" : (config.calendar?.mode ?? "month");
  const showCompleted = config.calendar?.showCompleted ?? false;
  const range = visibleRange(anchor, mode, ctx.weekStart);
  const days = daysOf(range.from, range.to);
  const items = (result.items as Dated[]).filter((i) => showCompleted || !isClosed(i));
  const dated = itemsByDay(items, range);
  const undated = items.filter((i) => !i.dueDate);
  const overlay = overlayEvents(range);
  const weekdays = daysOf(
    startOfWeek(today, ctx.weekStart),
    addDays(startOfWeek(today, ctx.weekStart), 6),
  );

  const title =
    mode === "month"
      ? MONTH.format(utcDate(anchor))
      : `${formatDay(range.from, today)} – ${formatDay(range.to, today)}`;

  /** Reschedules `item`. A task that spans days moves as a whole: both dates shift by the days dragged. */
  async function reschedule(item: Dated, from: string | null, to: string | null) {
    const isTask = collection === "TASKS";
    if (to === null && isTask && (item as ViewTask).recurrenceRule) {
      say("A repeating task needs a due date.");
      return;
    }
    const commands: MoveCommand[] = [];
    if (to === null) {
      if (item.dueDate === null) return;
      commands.push(
        isTask
          ? { type: "task.dueDate", id: item.id, dueDate: null, from: item.dueDate }
          : { type: "todo.dueDate", id: item.id, dueDate: null, from: item.dueDate },
      );
    } else if (from === null || item.dueDate === null) {
      commands.push(
        isTask
          ? { type: "task.dueDate", id: item.id, dueDate: to, from: item.dueDate }
          : { type: "todo.dueDate", id: item.id, dueDate: to, from: item.dueDate },
      );
    } else {
      const shift = daysBetween(from, to);
      if (shift === 0) return;
      const due = addDays(item.dueDate, shift);
      commands.push(
        isTask
          ? { type: "task.dueDate", id: item.id, dueDate: due, from: item.dueDate }
          : { type: "todo.dueDate", id: item.id, dueDate: due, from: item.dueDate },
      );
      const start = isTask ? (item as ViewTask).startDate : null;
      if (start) {
        commands.push({
          type: "task.startDate",
          id: item.id,
          startDate: addDays(start, shift),
          from: start,
        });
      }
    }
    const message = to ? `Moved to ${formatPickerDay(to)}.` : "Date cleared.";
    say(message);
    await applyEdit(state, [{ item, commands }], message);
  }

  function onDragEnd(event: DragEndEvent) {
    const data = event.active.data.current as DragData | undefined;
    setActive(null);
    setOverDay(null);
    const over = event.over?.data.current as DragData | undefined;
    if (data?.type !== "card" || over?.type !== "day") return;
    const item = items.find((i) => i.id === data.id);
    if (!item) return;
    void reschedule(
      item,
      data.columnKey === UNDATED ? null : data.columnKey,
      over.date === UNDATED ? null : over.date,
    );
  }

  function onDragOver(event: DragOverEvent) {
    const data = event.over?.data.current as DragData | undefined;
    setOverDay(data?.type === "day" ? data.date : null);
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 py-3">
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          aria-label={mode === "month" ? "Previous month" : "Previous week"}
          onClick={() => setAnchor(shiftAnchor(anchor, mode, -1))}
        >
          <ChevronLeft strokeWidth={1.5} aria-hidden />
        </Button>
        <Button
          variant="secondary"
          aria-label={mode === "month" ? "Next month" : "Next week"}
          onClick={() => setAnchor(shiftAnchor(anchor, mode, 1))}
        >
          <ChevronRight strokeWidth={1.5} aria-hidden />
        </Button>
        <Button variant="secondary" onClick={() => setAnchor(today)}>
          Today
        </Button>
      </div>
      <h2 className="type-headline-sm" aria-live="polite">
        {title}
      </h2>
      {!phone ? (
        <div className="ml-auto">
          <SegmentedControl
            label="Calendar layout"
            value={mode}
            onValueChange={(next) =>
              update((c) => ({ ...c, calendar: { showCompleted, ...c.calendar, mode: next } }))
            }
            options={[
              { value: "month", label: "Month" },
              { value: "week", label: "Week" },
            ]}
          />
        </div>
      ) : null}
    </div>
  );

  if (phone) {
    return (
      <div>
        {toolbar}
        <ul className="flex flex-col gap-4" aria-label="Week agenda">
          {days.map((day) => (
            <li key={day}>
              <h3
                className={cn(
                  "flex items-baseline gap-2 pb-1 type-label-caps text-muted-foreground",
                  day === today && "text-primary",
                )}
              >
                {formatPickerDay(day)}
                {day === today ? <span className="type-data-sm">Today</span> : null}
              </h3>
              <ul className="border-t border-border">
                {(dated.get(day) ?? []).map((item) => (
                  <li key={item.id} className="flex items-center gap-1 border-b border-border">
                    <OpenTitle
                      collection={collection}
                      item={item}
                      openIn={config.openIn}
                      className="min-h-11 min-w-0 flex-1 truncate px-2 text-left type-body-md"
                    >
                      <span className={cn(isClosed(item) && "text-muted-foreground line-through")}>
                        {item.title}
                      </span>
                    </OpenTitle>
                    <MoveToDate state={state} item={item} />
                  </li>
                ))}
                {(overlay.get(day) ?? []).map((event) => (
                  <li
                    key={event.id}
                    className="border-b border-border px-2 py-2 type-body-sm text-muted-foreground"
                  >
                    {event.time ? `${event.time} ` : ""}
                    {event.title}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {undated.length > 0 ? (
          <section className="mt-6" aria-labelledby="undated-heading">
            <h3 id="undated-heading" className="pb-1 type-label-caps text-muted-foreground">
              No date <span className="type-data-sm">{undated.length}</span>
            </h3>
            <ul className="border-t border-border">
              {undated.map((item) => (
                <li key={item.id} className="flex items-center gap-1 border-b border-border">
                  <OpenTitle
                    collection={collection}
                    item={item}
                    openIn={config.openIn}
                    className="min-h-11 min-w-0 flex-1 truncate px-2 text-left type-body-md"
                  >
                    {item.title}
                  </OpenTitle>
                  <MoveToDate state={state} item={item} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  const weeks = weeksOf(days);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropCollision}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={(e) => {
        const data = e.active.data.current as DragData | undefined;
        if (data?.type === "card") setActive(data);
      }}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActive(null);
        setOverDay(null);
      }}
    >
      {toolbar}
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <div
            role="grid"
            aria-label={title}
            className="min-w-[44rem] rounded-lg border border-border"
          >
            <div role="row" className="grid grid-cols-7 border-b border-border bg-secondary/50">
              {weekdays.map((day) => (
                <div
                  key={day}
                  role="columnheader"
                  className="px-2 py-1.5 type-label-caps text-muted-foreground"
                >
                  {WEEKDAY.format(utcDate(day))}
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div
                key={week[0]}
                role="row"
                className="grid grid-cols-7 border-b border-border last:border-b-0"
              >
                {week.map((day) => (
                  <DayCell
                    key={day}
                    state={state}
                    day={day}
                    today={today}
                    outside={mode === "month" && day.slice(0, 7) !== anchor.slice(0, 7)}
                    items={dated.get(day) ?? []}
                    overlay={overlay.get(day) ?? []}
                    isOver={overDay === day && active !== null}
                    tall={mode === "week"}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        <UndatedList
          state={state}
          items={undated}
          isOver={overDay === UNDATED && active !== null}
        />
      </div>

      <DragOverlay dropAnimation={reduced ? null : undefined}>
        {active ? (
          <div className="w-48 cursor-grabbing card px-2 py-1.5 type-body-sm shadow-lg">
            {active.label}
          </div>
        ) : null}
      </DragOverlay>
      {region}
    </DndContext>
  );
}

function DayCell({
  state,
  day,
  today,
  outside,
  items,
  overlay,
  isOver,
  tall,
}: {
  state: ViewState;
  day: string;
  today: string;
  outside: boolean;
  items: Dated[];
  overlay: { id: string; title: string; time?: string }[];
  isOver: boolean;
  tall: boolean;
}) {
  const label = formatPickerDay(day);
  const shown = items.slice(0, MAX_PER_DAY);
  const rest = items.slice(MAX_PER_DAY);
  const data: DragData = { type: "day", date: day, label };

  return (
    <DropZone
      id={`day:${day}`}
      data={data}
      role="gridcell"
      aria-label={`${label}${day === today ? ", today" : ""}, ${items.length === 0 ? "nothing due" : `${items.length} due`}`}
      className={cn(
        "flex min-w-0 flex-col gap-1 border-r border-border p-1.5 last:border-r-0",
        tall ? "min-h-56" : "min-h-28",
        outside && "bg-secondary/30 text-muted-foreground",
        isOver && "bg-primary-subtle",
      )}
    >
      <span
        className={cn(
          "inline-flex size-6 items-center justify-center self-start rounded-full type-data-sm",
          day === today && "bg-primary text-primary-foreground",
        )}
        aria-hidden
      >
        {Number(day.slice(8))}
      </span>
      <ul className="flex flex-col gap-1">
        {shown.map((item) => (
          <DayItem key={`${day}|${item.id}`} state={state} item={item} day={day} />
        ))}
        {overlay.map((event) => (
          <li
            key={event.id}
            className="truncate rounded-sm bg-secondary/60 px-1.5 py-0.5 type-body-sm text-muted-foreground"
          >
            {event.time ? `${event.time} ` : ""}
            {event.title}
          </li>
        ))}
      </ul>
      {rest.length > 0 ? (
        <Popover>
          <PopoverTrigger className="self-start rounded-sm px-1 type-body-sm text-muted-foreground hover:bg-accent">
            +{rest.length} more
          </PopoverTrigger>
          <PopoverContent className="w-64">
            <h3 className="pb-2 type-label-caps text-muted-foreground">{label}</h3>
            <ul className="flex flex-col">
              {items.map((item) => (
                <li key={item.id}>
                  <OpenTitle
                    collection={state.collection}
                    item={item}
                    openIn={state.config.openIn}
                    className="block w-full truncate rounded-sm px-2 py-1.5 text-left type-body-md hover:bg-accent"
                  >
                    {item.title}
                  </OpenTitle>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </DropZone>
  );
}

function DayItem({ state, item, day }: { state: ViewState; item: Dated; day: string }) {
  const task = state.collection === "TASKS" ? (item as ViewTask) : null;
  const continuation = Boolean(task?.startDate && task.dueDate && day !== task.dueDate);
  const data: DragData = {
    type: "card",
    id: item.id,
    label: item.title,
    columnKey: day,
    index: 0,
    count: 1,
    columnLabel: day === UNDATED ? "No date" : formatPickerDay(day),
  };
  return (
    <DragCard
      dragId={`${day}|${item.id}`}
      itemId={item.id}
      data={data}
      label={item.title}
      dropTarget={false}
      render={({ handle }) => (
        <div
          className={cn(
            "group/chip flex items-center gap-0.5 rounded-sm bg-card px-0.5 shadow-xs ring-1 ring-border",
            continuation && "border-l-2 border-primary/50",
          )}
        >
          <span className="opacity-0 group-focus-within/chip:opacity-100 group-hover/chip:opacity-100 [@media(hover:none)]:opacity-100">
            {handle}
          </span>
          <OpenTitle
            collection={state.collection}
            item={item}
            openIn={state.config.openIn}
            className="min-w-0 flex-1 truncate py-1 text-left type-body-sm"
          >
            <span className={cn(isClosed(item) && "text-muted-foreground line-through")}>
              {(item as { emoji: string | null }).emoji
                ? `${(item as { emoji: string }).emoji} `
                : ""}
              {item.title}
            </span>
            {continuation ? <span className="sr-only"> (continues)</span> : null}
          </OpenTitle>
          <MoveToDate state={state} item={item} small />
        </div>
      )}
    />
  );
}

function UndatedList({
  state,
  items,
  isOver,
}: {
  state: ViewState;
  items: Dated[];
  isOver: boolean;
}) {
  const data: DragData = { type: "day", date: UNDATED, label: "No date" };
  return (
    <DropZone
      as="section"
      id={`day:${UNDATED}`}
      data={data}
      aria-labelledby="undated-heading"
      className={cn(
        "w-56 shrink-0 rounded-lg border border-border bg-secondary/30 p-2",
        isOver && "border-primary bg-primary-subtle",
      )}
    >
      <h3
        id="undated-heading"
        className="flex items-baseline gap-2 px-1 pb-2 type-label-caps text-muted-foreground"
      >
        No date <span className="type-data-sm">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="px-1 type-body-sm text-muted-foreground">Everything has a date.</p>
      ) : (
        <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
          {items.slice(0, 50).map((item) => (
            <DayItem key={item.id} state={state} item={item} day={UNDATED} />
          ))}
        </ul>
      )}
    </DropZone>
  );
}

/** The keyboard and touch way to reschedule: a menu with a date picker, the same change as a drop. */
function MoveToDate({ state, item, small }: { state: ViewState; item: Dated; small?: boolean }) {
  const recurring = "recurrenceRule" in item && Boolean(item.recurrenceRule);
  return (
    <DatePopover
      id={`move-${item.id}`}
      label="Move to date"
      date={item.dueDate}
      clearDisabledReason={recurring ? "A repeating task needs a due date." : undefined}
      onPick={(date) => {
        const commands: MoveCommand[] = [];
        if ("status" in item) {
          if (date !== item.dueDate)
            commands.push({ type: "task.dueDate", id: item.id, dueDate: date, from: item.dueDate });
          if (item.startDate && date && item.dueDate) {
            commands.push({
              type: "task.startDate",
              id: item.id,
              startDate: addDays(item.startDate, daysBetween(item.dueDate, date)),
              from: item.startDate,
            });
          }
        } else if (date !== item.dueDate) {
          commands.push({ type: "todo.dueDate", id: item.id, dueDate: date, from: item.dueDate });
        }
        if (commands.length > 0) {
          void applyEdit(
            state,
            [{ item: item as AnyItem, commands }],
            date ? `Moved to ${formatPickerDay(date)}.` : "Date cleared.",
          );
        }
      }}
    >
      <button
        type="button"
        aria-label={`Move ${item.title} to date`}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent",
          small ? "size-6" : "size-11",
        )}
      >
        {small ? (
          <CalendarClock className="size-3.5" strokeWidth={1.5} aria-hidden />
        ) : (
          <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
        )}
      </button>
    </DatePopover>
  );
}
