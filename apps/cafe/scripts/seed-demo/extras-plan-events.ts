/**
 * Events + reservations planners for extras-plan.ts — split out to stay under
 * the ~300-line cap. Pure; every draw comes from `ctx.rng`/`ctx.now`.
 */
import type { PlanContext, PlannedEvent, PlannedReservation, PlannedTableState } from "./types";
import { istInstant, addMinutes } from "./rng";
import { EVENT_TEMPLATES, RESERVATION_NOTES } from "./people-data";
import { dayKeyPlusDays, roundTo } from "./extras-plan-dates";

// ── Events ────────────────────────────────────────────────────────────────
const EVENT_FUTURE_COUNT = 7;
const EVENT_FUTURE_DAYS_MIN = 2;
const EVENT_FUTURE_DAYS_MAX = 25;
const EVENT_PAST_COMPLETED_COUNT = 3;
const EVENT_PAST_COMPLETED_DAYS_MIN = 3;
const EVENT_PAST_COMPLETED_DAYS_MAX = 25;
const EVENT_PAST_CANCELLED_DAYS_MIN = 3;
const EVENT_PAST_CANCELLED_DAYS_MAX = 25;
const EVENT_CREATED_LEAD_DAYS_MIN = 3;
const EVENT_CREATED_LEAD_DAYS_MAX = 20;
const EVENT_TIME_STEP_MIN = 30; // minutes
const EVENT_TIME_START_HOUR = 11;
const EVENT_TIME_END_HOUR = 21;
const EVENT_ADVANCE_ROUND_TO = 500;
const EVENT_ADVANCE_FRACTIONS = [0, 0.25, 0.5];
const EVENT_CREATED_HOUR_MIN = 9;
const EVENT_CREATED_HOUR_MAX = 20;
const EVENT_PAY_MODE_WEIGHTS: { mode: "Cash" | "Online" | "Credit"; weight: number }[] = [
  { mode: "Cash", weight: 45 },
  { mode: "Online", weight: 45 },
  { mode: "Credit", weight: 10 },
];

function randomEventTime(ctx: PlanContext): string {
  const steps = (EVENT_TIME_END_HOUR - EVENT_TIME_START_HOUR) * (60 / EVENT_TIME_STEP_MIN);
  const stepIndex = ctx.rng.int(0, steps);
  const minutesFromStart = stepIndex * EVENT_TIME_STEP_MIN;
  const hour = EVENT_TIME_START_HOUR + Math.floor(minutesFromStart / 60);
  const minute = minutesFromStart % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function eventCreatedAt(ctx: PlanContext, date: string): Date {
  const lead = ctx.rng.int(EVENT_CREATED_LEAD_DAYS_MIN, EVENT_CREATED_LEAD_DAYS_MAX);
  return istInstant(dayKeyPlusDays(date, -lead), ctx.rng.int(EVENT_CREATED_HOUR_MIN, EVENT_CREATED_HOUR_MAX), ctx.rng.int(0, 59));
}

export function planEvents(ctx: PlanContext, todayKey: string): PlannedEvent[] {
  const events: PlannedEvent[] = [];

  for (let i = 0; i < EVENT_FUTURE_COUNT; i++) {
    const template = ctx.rng.pick(EVENT_TEMPLATES);
    const date = dayKeyPlusDays(todayKey, ctx.rng.int(EVENT_FUTURE_DAYS_MIN, EVENT_FUTURE_DAYS_MAX));
    const payable = ctx.rng.int(template.payableMin, template.payableMax);
    const advanceFraction = ctx.rng.pick(EVENT_ADVANCE_FRACTIONS);
    const advance = advanceFraction === 0 ? 0 : Math.min(payable, roundTo(payable * advanceFraction, EVENT_ADVANCE_ROUND_TO));
    const createdAt = eventCreatedAt(ctx, date);
    events.push({
      name: ctx.rng.pick(ctx.customers).name,
      mobile: ctx.rng.pick(ctx.customers).mobile,
      date,
      time: randomEventTime(ctx),
      eventName: template.eventName,
      notes: template.notes,
      payable,
      advance,
      payMode: ctx.rng.weighted(EVENT_PAY_MODE_WEIGHTS, (w) => w.weight).mode,
      status: "Booked",
      createdAt,
      updatedAt: createdAt,
    });
  }

  for (let i = 0; i < EVENT_PAST_COMPLETED_COUNT; i++) {
    const template = ctx.rng.pick(EVENT_TEMPLATES);
    const date = dayKeyPlusDays(todayKey, -ctx.rng.int(EVENT_PAST_COMPLETED_DAYS_MIN, EVENT_PAST_COMPLETED_DAYS_MAX));
    const payable = ctx.rng.int(template.payableMin, template.payableMax);
    const createdAt = eventCreatedAt(ctx, date);
    const completedAt = istInstant(date, EVENT_TIME_END_HOUR, ctx.rng.int(0, 59));
    events.push({
      name: ctx.rng.pick(ctx.customers).name,
      mobile: ctx.rng.pick(ctx.customers).mobile,
      date,
      time: randomEventTime(ctx),
      eventName: template.eventName,
      notes: template.notes,
      payable,
      advance: payable, // fully paid by completion
      payMode: ctx.rng.weighted(EVENT_PAY_MODE_WEIGHTS, (w) => w.weight).mode,
      status: "Completed",
      createdAt,
      updatedAt: completedAt,
    });
  }

  {
    const template = ctx.rng.pick(EVENT_TEMPLATES);
    const date = dayKeyPlusDays(todayKey, -ctx.rng.int(EVENT_PAST_CANCELLED_DAYS_MIN, EVENT_PAST_CANCELLED_DAYS_MAX));
    const payable = ctx.rng.int(template.payableMin, template.payableMax);
    const createdAt = eventCreatedAt(ctx, date);
    events.push({
      name: ctx.rng.pick(ctx.customers).name,
      mobile: ctx.rng.pick(ctx.customers).mobile,
      date,
      time: randomEventTime(ctx),
      eventName: template.eventName,
      notes: template.notes,
      payable,
      advance: 0,
      payMode: ctx.rng.weighted(EVENT_PAY_MODE_WEIGHTS, (w) => w.weight).mode,
      status: "Cancelled",
      createdAt,
      updatedAt: createdAt,
    });
  }

  return events;
}

// ── Reservations ─────────────────────────────────────────────────────────────
const RES_TODAY_BOOKED_COUNT = 2;
const RES_TODAY_BOOKED_HOUR_MIN = 19;
const RES_TODAY_BOOKED_HOUR_MAX = 21;
const RES_SEATED_HOURS_AGO_MIN = 1;
const RES_SEATED_HOURS_AGO_MAX = 2;
const RES_NEXT_DAYS = 12;
const RES_NEXT_BOOKED_COUNT = 14;
const RES_NEXT_TABLE_CHANCE = 0.6;
const RES_NEXT_HOUR_MIN = 11;
const RES_PAST_COMPLETED_COUNT = 10;
const RES_PAST_CANCELLED_COUNT = 2;
const RES_PAST_DAYS_MIN = 1;
const RES_PAST_DAYS_MAX = 25;
const RES_GUESTS_MIN = 2;
const RES_GUESTS_MAX = 8;
const RES_CREATED_LEAD_DAYS_MIN = 1;
const RES_CREATED_LEAD_DAYS_MAX = 10;
const RES_FROM_CUSTOMER_CHANCE = 0.7;
const RES_NOTE_CHANCE_TODAY = 0.5;
const RES_NOTE_CHANCE_PAST = 0.3;
const RES_SEATED_LEAD_MIN_MINUTES = 30;
const RES_SEATED_LEAD_MAX_MINUTES = 180;
const RES_TODAY_NO_TABLE_LEAD_MAX_MINUTES = 60 * 24 * 5;
const RES_WALKIN_NAMES = [
  "Jignesh Thakkar", "Sonal Vyas", "Hemant Joshi", "Ritu Bhatt", "Naresh Gohil",
  "Aarti Solanki", "Mahesh Pandya", "Komal Raval", "Vipul Trivedi", "Deepa Parekh",
] as const;
const RES_WALKIN_MOBILE_PREFIXES = ["98250", "98980", "99090"] as const;

function walkinReservation(ctx: PlanContext): { name: string; mobile: string } {
  const prefix = ctx.rng.pick(RES_WALKIN_MOBILE_PREFIXES);
  const suffix = String(ctx.rng.int(0, 99999)).padStart(5, "0");
  return { name: ctx.rng.pick(RES_WALKIN_NAMES), mobile: `${prefix}${suffix}` };
}

function reservationPerson(ctx: PlanContext): { name: string; mobile: string } {
  if (ctx.rng.chance(RES_FROM_CUSTOMER_CHANCE)) {
    const c = ctx.rng.pick(ctx.customers);
    return { name: c.name, mobile: c.mobile };
  }
  return walkinReservation(ctx);
}

function hhmm(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function planReservations(
  ctx: PlanContext,
  todayKey: string,
  occupiedTables: readonly string[],
): { reservations: PlannedReservation[]; reservedTable?: PlannedTableState } {
  const reservations: PlannedReservation[] = [];
  const availableTables = ctx.tables.filter((t) => !occupiedTables.includes(t.tableNo));
  let reservedTable: PlannedTableState | undefined;

  // Today: 2 Booked with a table, 1 Seated (on a non-occupied table — that
  // table becomes `reservedTable`), 1 Booked with no table.
  for (let i = 0; i < RES_TODAY_BOOKED_COUNT; i++) {
    const person = reservationPerson(ctx);
    const table = availableTables.length > 0 ? ctx.rng.pick(availableTables) : undefined;
    const createdAt = addMinutes(ctx.now, -ctx.rng.int(60, 60 * 24 * RES_CREATED_LEAD_DAYS_MAX));
    reservations.push({
      name: person.name,
      mobile: person.mobile,
      date: todayKey,
      time: hhmm(ctx.rng.int(RES_TODAY_BOOKED_HOUR_MIN, RES_TODAY_BOOKED_HOUR_MAX)),
      guests: ctx.rng.int(RES_GUESTS_MIN, RES_GUESTS_MAX),
      tableNo: table?.tableNo,
      notes: ctx.rng.chance(RES_NOTE_CHANCE_TODAY) ? ctx.rng.pick(RESERVATION_NOTES) : undefined,
      status: "Booked",
      createdAt,
      updatedAt: createdAt,
    });
  }

  {
    const person = reservationPerson(ctx);
    const seatedTable = availableTables[0];
    const hoursAgo = ctx.rng.int(RES_SEATED_HOURS_AGO_MIN, RES_SEATED_HOURS_AGO_MAX);
    const seatedAt = addMinutes(ctx.now, -hoursAgo * 60);
    const createdAt = addMinutes(seatedAt, -ctx.rng.int(RES_SEATED_LEAD_MIN_MINUTES, RES_SEATED_LEAD_MAX_MINUTES));
    reservations.push({
      name: person.name,
      mobile: person.mobile,
      date: todayKey,
      time: hhmm(seatedAt.getUTCHours()),
      guests: ctx.rng.int(RES_GUESTS_MIN, RES_GUESTS_MAX),
      tableNo: seatedTable?.tableNo,
      notes: ctx.rng.chance(RES_NOTE_CHANCE_TODAY) ? ctx.rng.pick(RESERVATION_NOTES) : undefined,
      status: "Seated",
      createdAt,
      updatedAt: seatedAt,
    });
    if (seatedTable) reservedTable = { tableNo: seatedTable.tableNo, status: "Reserved" };
  }

  {
    const person = reservationPerson(ctx);
    const createdAt = addMinutes(ctx.now, -ctx.rng.int(60, RES_TODAY_NO_TABLE_LEAD_MAX_MINUTES));
    reservations.push({
      name: person.name,
      mobile: person.mobile,
      date: todayKey,
      time: hhmm(ctx.rng.int(RES_TODAY_BOOKED_HOUR_MIN, RES_TODAY_BOOKED_HOUR_MAX)),
      guests: ctx.rng.int(RES_GUESTS_MIN, RES_GUESTS_MAX),
      notes: ctx.rng.chance(RES_NOTE_CHANCE_TODAY) ? ctx.rng.pick(RESERVATION_NOTES) : undefined,
      status: "Booked",
      createdAt,
      updatedAt: createdAt,
    });
  }

  // Next 12 days: 14 Booked, 60% with a table.
  for (let i = 0; i < RES_NEXT_BOOKED_COUNT; i++) {
    const person = reservationPerson(ctx);
    const date = dayKeyPlusDays(todayKey, ctx.rng.int(1, RES_NEXT_DAYS));
    const withTable = ctx.rng.chance(RES_NEXT_TABLE_CHANCE);
    const createdAt = istInstant(
      dayKeyPlusDays(date, -ctx.rng.int(RES_CREATED_LEAD_DAYS_MIN, RES_CREATED_LEAD_DAYS_MAX)),
      ctx.rng.int(EVENT_CREATED_HOUR_MIN, EVENT_CREATED_HOUR_MAX),
      ctx.rng.int(0, 59),
    );
    reservations.push({
      name: person.name,
      mobile: person.mobile,
      date,
      time: hhmm(ctx.rng.int(RES_NEXT_HOUR_MIN, RES_TODAY_BOOKED_HOUR_MAX)),
      guests: ctx.rng.int(RES_GUESTS_MIN, RES_GUESTS_MAX),
      tableNo: withTable ? ctx.rng.pick(ctx.tables).tableNo : undefined,
      notes: ctx.rng.chance(RES_NOTE_CHANCE_TODAY) ? ctx.rng.pick(RESERVATION_NOTES) : undefined,
      status: "Booked",
      createdAt,
      updatedAt: createdAt,
    });
  }

  // Past: 10 Completed + 2 Cancelled.
  const pastCounts: { count: number; status: "Completed" | "Cancelled" }[] = [
    { count: RES_PAST_COMPLETED_COUNT, status: "Completed" },
    { count: RES_PAST_CANCELLED_COUNT, status: "Cancelled" },
  ];
  for (const { count, status } of pastCounts) {
    for (let i = 0; i < count; i++) {
      const person = reservationPerson(ctx);
      const date = dayKeyPlusDays(todayKey, -ctx.rng.int(RES_PAST_DAYS_MIN, RES_PAST_DAYS_MAX));
      const createdAt = istInstant(
        dayKeyPlusDays(date, -ctx.rng.int(RES_CREATED_LEAD_DAYS_MIN, RES_CREATED_LEAD_DAYS_MAX)),
        ctx.rng.int(EVENT_CREATED_HOUR_MIN, EVENT_CREATED_HOUR_MAX),
        ctx.rng.int(0, 59),
      );
      reservations.push({
        name: person.name,
        mobile: person.mobile,
        date,
        time: hhmm(ctx.rng.int(RES_NEXT_HOUR_MIN, RES_TODAY_BOOKED_HOUR_MAX)),
        guests: ctx.rng.int(RES_GUESTS_MIN, RES_GUESTS_MAX),
        notes: ctx.rng.chance(RES_NOTE_CHANCE_PAST) ? ctx.rng.pick(RESERVATION_NOTES) : undefined,
        status,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  return { reservations, reservedTable };
}
