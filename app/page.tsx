"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  buildUtcMonthCells,
  buildUtcRangeSegments,
  listUtcMonths,
} from "@/lib/calendar-utils";
import { parseCustomerDate } from "@/lib/customer-date-parser";
import { normalizeWholeNumberDraft } from "@/lib/number-input";

type ApprovalMethod = "physical" | "photo";
type ShippingMethod = "air" | "fast-sea" | "standard-sea";
type QuickDatePreset = ShippingMethod | "custom";
type ActiveTab = "build" | "date" | "analyze";
type ResultView = "timeline" | "calendar";

type ShippingLeadDays = Record<ShippingMethod, number>;

type SampleLeadTimes = {
  sampleProduction: number;
  physicalApproval: number;
  photoApproval: number;
};

type LegacyLeadTimes = SampleLeadTimes & {
  materialPreparation: number;
  bulkProduction: number;
  qualityInspection: number;
  shipmentPreparation: number;
};

type ProductionStage = {
  id: string;
  name: string;
  days: number;
  tone: "production" | "quality";
};

type SavedCalculation = {
  version: 3;
  savedAt: string;
  startDate: string;
  sampleRounds: number;
  approvalMethods: ApprovalMethod[];
  sampleLeadTimes: SampleLeadTimes;
  productionStages: ProductionStage[];
  selectedShippingMethods: ShippingMethod[];
  shippingLeadDays: ShippingLeadDays;
};

type TimelineItem = {
  id: string;
  title: string;
  meta: string;
  leadDays: number;
  rawDate: Date;
  finalDate: Date;
  adjustmentDays: number;
  tone: "start" | "sample" | "approval" | "production" | "quality" | "shipping";
};

type AnalysisRow = {
  id: string;
  label: string;
  date: Date;
  daysFromPrevious: number | null;
  format: string;
  note: string;
};

type ShippingResult = {
  id: ShippingMethod;
  label: string;
  leadDays: number;
  finalDate: Date;
  totalDays: number;
};

type CalendarEvent = {
  id: string;
  title: string;
  date: Date;
  rawDate: Date;
  leadDays: number;
  notes: string;
  adjustmentDays: number;
  isStart: boolean;
  kind: "milestone" | "shipping";
  tone: TimelineItem["tone"] | ShippingMethod;
};

type CalendarPhase = {
  id: string;
  label: string;
  summary: string;
  startDate: Date;
  endDate: Date;
  fromTitle: string;
  fromDate: Date;
  toTitle: string;
  toDate: Date;
  notes: string;
  durationDays: number;
  lane: number;
  kind: "timeline" | "shipping" | "adjustment";
  tone: TimelineItem["tone"] | ShippingMethod | "adjustment";
};

const STORAGE_KEY = "production-timeline-calculator:v3";
const LEGACY_V2_STORAGE_KEY = "production-timeline-calculator:v2";
const LEGACY_V1_STORAGE_KEY = "production-timeline-calculator:v1";

const DEFAULT_SAMPLE_LEAD_TIMES: SampleLeadTimes = {
  sampleProduction: 10,
  physicalApproval: 7,
  photoApproval: 2,
};

const SAMPLE_LEAD_TIME_FIELDS: Array<{
  key: keyof SampleLeadTimes;
  label: string;
  hint: string;
}> = [
  { key: "sampleProduction", label: "Sample production", hint: "Per round" },
  { key: "physicalApproval", label: "Delivery & approval", hint: "Physical sample" },
  { key: "photoApproval", label: "Photo approval", hint: "No shipping" },
];

const DEFAULT_PRODUCTION_STAGES: ReadonlyArray<ProductionStage> = [
  { id: "materials", name: "Materials ready", days: 7, tone: "production" },
  { id: "bulk", name: "Bulk production complete", days: 30, tone: "production" },
  { id: "quality", name: "Quality inspection", days: 3, tone: "quality" },
  { id: "shipment", name: "Ready for shipment", days: 2, tone: "quality" },
];

const SHIPPING_METHODS: Array<{
  id: ShippingMethod;
  label: string;
}> = [
  { id: "air", label: "Air freight" },
  { id: "fast-sea", label: "Fast sea freight" },
  { id: "standard-sea", label: "Standard sea freight" },
];

const DEFAULT_SHIPPING_LEAD_DAYS: ShippingLeadDays = {
  air: 13,
  "fast-sea": 35,
  "standard-sea": 55,
};

function cloneDefaultShippingMethods(): ShippingMethod[] {
  return SHIPPING_METHODS.map((method) => method.id);
}

function cloneDefaultShippingLeadDays(): ShippingLeadDays {
  return { ...DEFAULT_SHIPPING_LEAD_DAYS };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseIso(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIso(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetween(from: Date, to: Date) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function adjustToWeekday(date: Date) {
  const day = date.getUTCDay();
  if (day === 6) return addDays(date, 2);
  if (day === 0) return addDays(date, 1);
  return date;
}

function formatDate(date: Date, includeWeekday = true) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeWeekday ? { weekday: "short" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
}

function formatDateRange(first: Date, last: Date) {
  if (first.getTime() === last.getTime()) return formatDate(first, false);

  const firstYear = first.getUTCFullYear();
  const lastYear = last.getUTCFullYear();
  const firstMonth = first.getUTCMonth();
  const lastMonth = last.getUTCMonth();

  if (firstYear !== lastYear) {
    return `${formatDate(first, false)} – ${formatDate(last, false)}`;
  }

  if (firstMonth === lastMonth) {
    return `${formatShortDate(first)} – ${last.getUTCDate()}, ${lastYear}`;
  }

  return `${formatShortDate(first)} – ${formatDate(last, false)}`;
}

function safeNumber(value: string, maximum = 180) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(maximum, Math.max(0, Math.round(parsed)));
}

function cloneDefaultProductionStages(
  legacy?: Partial<LegacyLeadTimes>,
): ProductionStage[] {
  const legacyDays: Record<string, number | undefined> = {
    materials: legacy?.materialPreparation,
    bulk: legacy?.bulkProduction,
    quality: legacy?.qualityInspection,
    shipment: legacy?.shipmentPreparation,
  };
  return DEFAULT_PRODUCTION_STAGES.map((stage) => ({
    ...stage,
    days: Number.isFinite(legacyDays[stage.id])
      ? safeNumber(String(legacyDays[stage.id]), 999)
      : stage.days,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedDays(
  value: unknown,
  fallback: number,
): number {
  return Number.isFinite(Number(value)) ? safeNumber(String(value), 999) : fallback;
}

function normalizeShippingMethods(value: unknown): ShippingMethod[] {
  if (!Array.isArray(value)) return cloneDefaultShippingMethods();
  const selected = new Set(
    value.filter(
      (method): method is ShippingMethod =>
        method === "air" || method === "fast-sea" || method === "standard-sea",
    ),
  );
  const ordered = SHIPPING_METHODS.flatMap((method) =>
    selected.has(method.id) ? [method.id] : [],
  );
  return ordered.length ? ordered : cloneDefaultShippingMethods();
}

function normalizeSavedCalculation(value: unknown): SavedCalculation | null {
  if (!isRecord(value)) return null;

  const startDate = typeof value.startDate === "string" ? value.startDate : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const parsedStart = parseIso(startDate);
  if (Number.isNaN(parsedStart.getTime()) || toIso(parsedStart) !== startDate) return null;

  const sampleRounds = Math.min(4, Math.max(1, Math.round(Number(value.sampleRounds) || 1)));
  const rawMethods = Array.isArray(value.approvalMethods) ? value.approvalMethods : [];
  const approvalMethods = Array.from({ length: sampleRounds }, (_, index) =>
    rawMethods[index] === "photo" ? "photo" : "physical",
  ) satisfies ApprovalMethod[];
  const savedAt =
    typeof value.savedAt === "string" && !Number.isNaN(Date.parse(value.savedAt))
      ? value.savedAt
      : new Date().toISOString();

  if (value.version === 3 || value.version === 2) {
    const rawLeadTimes = isRecord(value.sampleLeadTimes) ? value.sampleLeadTimes : {};
    const sampleLeadTimes: SampleLeadTimes = {
      sampleProduction: storedDays(
        rawLeadTimes.sampleProduction,
        DEFAULT_SAMPLE_LEAD_TIMES.sampleProduction,
      ),
      physicalApproval: storedDays(
        rawLeadTimes.physicalApproval,
        DEFAULT_SAMPLE_LEAD_TIMES.physicalApproval,
      ),
      photoApproval: storedDays(
        rawLeadTimes.photoApproval,
        DEFAULT_SAMPLE_LEAD_TIMES.photoApproval,
      ),
    };

    const seenIds = new Set<string>();
    const productionStages = Array.isArray(value.productionStages)
      ? value.productionStages.slice(0, 12).flatMap((rawStage) => {
          if (!isRecord(rawStage)) return [];
          const id = typeof rawStage.id === "string" ? rawStage.id.trim() : "";
          const storedName =
            typeof rawStage.name === "string" ? rawStage.name.trim().slice(0, 80) : "";
          if (!id || seenIds.has(id)) return [];
          seenIds.add(id);
          return [{
            id,
            name: storedName || "Untitled production step",
            days: storedDays(rawStage.days, 0),
            tone: rawStage.tone === "quality" ? "quality" as const : "production" as const,
          }];
        })
      : cloneDefaultProductionStages();
    const rawShippingLeadDays =
      value.version === 3 && isRecord(value.shippingLeadDays)
        ? value.shippingLeadDays
        : {};
    const shippingLeadDays: ShippingLeadDays = {
      air: storedDays(rawShippingLeadDays.air, DEFAULT_SHIPPING_LEAD_DAYS.air),
      "fast-sea": storedDays(
        rawShippingLeadDays["fast-sea"],
        DEFAULT_SHIPPING_LEAD_DAYS["fast-sea"],
      ),
      "standard-sea": storedDays(
        rawShippingLeadDays["standard-sea"],
        DEFAULT_SHIPPING_LEAD_DAYS["standard-sea"],
      ),
    };
    const selectedShippingMethods =
      value.version === 3
        ? normalizeShippingMethods(value.selectedShippingMethods)
        : cloneDefaultShippingMethods();

    return {
      version: 3,
      savedAt,
      startDate,
      sampleRounds,
      approvalMethods,
      sampleLeadTimes,
      productionStages,
      selectedShippingMethods,
      shippingLeadDays,
    };
  }

  if (value.version === 1 && isRecord(value.leadTimes)) {
    const legacy = value.leadTimes;
    const sampleLeadTimes: SampleLeadTimes = {
      sampleProduction: storedDays(
        legacy.sampleProduction,
        DEFAULT_SAMPLE_LEAD_TIMES.sampleProduction,
      ),
      physicalApproval: storedDays(
        legacy.physicalApproval,
        DEFAULT_SAMPLE_LEAD_TIMES.physicalApproval,
      ),
      photoApproval: storedDays(
        legacy.photoApproval,
        DEFAULT_SAMPLE_LEAD_TIMES.photoApproval,
      ),
    };
    const legacyLeadTimes: Partial<LegacyLeadTimes> = {
      materialPreparation: storedDays(legacy.materialPreparation, 7),
      bulkProduction: storedDays(legacy.bulkProduction, 30),
      qualityInspection: storedDays(legacy.qualityInspection, 3),
      shipmentPreparation: storedDays(legacy.shipmentPreparation, 2),
    };

    return {
      version: 3,
      savedAt,
      startDate,
      sampleRounds,
      approvalMethods,
      sampleLeadTimes,
      productionStages: cloneDefaultProductionStages(legacyLeadTimes),
      selectedShippingMethods: cloneDefaultShippingMethods(),
      shippingLeadDays: cloneDefaultShippingLeadDays(),
    };
  }

  return null;
}

function escapeCsv(value: string | number) {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const browserToday = useSyncExternalStore(
    () => () => undefined,
    todayIso,
    () => "",
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>("build");
  const [resultView, setResultView] = useState<ResultView>("timeline");
  const [calendarMonthIndex, setCalendarMonthIndex] = useState(0);
  const [selectedCalendarEventId, setSelectedCalendarEventId] = useState<
    string | null
  >(null);
  const [selectedCalendarPhaseId, setSelectedCalendarPhaseId] = useState<
    string | null
  >(null);
  const [calendarDetailTriggerId, setCalendarDetailTriggerId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [sampleRounds, setSampleRounds] = useState(1);
  const [approvalMethods, setApprovalMethods] = useState<ApprovalMethod[]>([
    "physical",
  ]);
  const [sampleLeadTimes, setSampleLeadTimes] = useState<SampleLeadTimes>(
    DEFAULT_SAMPLE_LEAD_TIMES,
  );
  const [productionStages, setProductionStages] = useState<ProductionStage[]>(
    cloneDefaultProductionStages,
  );
  const [selectedShippingMethods, setSelectedShippingMethods] = useState<
    ShippingMethod[]
  >(cloneDefaultShippingMethods);
  const [shippingLeadDays, setShippingLeadDays] = useState<ShippingLeadDays>(
    cloneDefaultShippingLeadDays,
  );
  const [lastSaved, setLastSaved] = useState<SavedCalculation | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [copyState, setCopyState] = useState("");
  const [analyzerInput, setAnalyzerInput] = useState("");
  const [dateCalcStart, setDateCalcStart] = useState("");
  const [dateCalcDaysInput, setDateCalcDaysInput] = useState("35");
  const [dateCalcPreset, setDateCalcPreset] =
    useState<QuickDatePreset>("fast-sea");
  const effectiveStartDate = startDate || browserToday;
  const effectiveDateCalcStart = dateCalcStart || browserToday;
  const dateCalcDays =
    dateCalcDaysInput === "" ? 0 : safeNumber(dateCalcDaysInput, 999);
  const dateCalcBaseDate = parseIso(effectiveDateCalcStart || "2000-01-01");
  const dateCalcResultDate = addDays(dateCalcBaseDate, dateCalcDays);
  const dateCalcLabel =
    dateCalcPreset === "custom"
      ? "Custom calculation"
      : SHIPPING_METHODS.find((method) => method.id === dateCalcPreset)?.label ??
        "Date calculation";
  const dateCalcFallsOnWeekend = [0, 6].includes(
    dateCalcResultDate.getUTCDay(),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let parsed: SavedCalculation | null = null;
      for (const key of [
        STORAGE_KEY,
        LEGACY_V2_STORAGE_KEY,
        LEGACY_V1_STORAGE_KEY,
      ]) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          parsed = normalizeSavedCalculation(JSON.parse(raw));
        } catch {
          window.localStorage.removeItem(key);
        }
        if (parsed) break;
      }

      if (parsed) {
        setLastSaved(parsed);
        setStartDate(parsed.startDate);
        setSampleRounds(parsed.sampleRounds);
        setApprovalMethods([...parsed.approvalMethods]);
        setSampleLeadTimes({ ...parsed.sampleLeadTimes });
        setProductionStages(parsed.productionStages.map((stage) => ({ ...stage })));
        setSelectedShippingMethods([...parsed.selectedShippingMethods]);
        setShippingLeadDays({ ...parsed.shippingLeadDays });
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!storageReady || !hasInteracted) return;
    const snapshot: SavedCalculation = {
      version: 3,
      savedAt: new Date().toISOString(),
      startDate: effectiveStartDate,
      sampleRounds,
      approvalMethods,
      sampleLeadTimes,
      productionStages,
      selectedShippingMethods,
      shippingLeadDays,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [
    approvalMethods,
    hasInteracted,
    productionStages,
    sampleRounds,
    sampleLeadTimes,
    selectedShippingMethods,
    shippingLeadDays,
    effectiveStartDate,
    storageReady,
  ]);

  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    const firstDate = parseIso(effectiveStartDate || "2000-01-01");
    let cursor = firstDate;

    items.push({
      id: "project-start",
      title: "Sample round 1 started",
      meta: "Selected starting date",
      leadDays: 0,
      rawDate: cursor,
      finalDate: cursor,
      adjustmentDays: 0,
      tone: "start",
    });

    const append = (
      id: string,
      title: string,
      meta: string,
      leadDays: number,
      tone: TimelineItem["tone"],
      weekdayOnly = false,
    ) => {
      const rawDate = addDays(cursor, leadDays);
      const finalDate = weekdayOnly ? adjustToWeekday(rawDate) : rawDate;
      const adjustmentDays = daysBetween(rawDate, finalDate);
      cursor = finalDate;
      items.push({
        id,
        title,
        meta,
        leadDays,
        rawDate,
        finalDate,
        adjustmentDays,
        tone,
      });
    };

    for (let index = 0; index < sampleRounds; index += 1) {
      const round = index + 1;
      append(
        `sample-${round}-ready`,
        `Sample round ${round} ready`,
        "Sample production",
        sampleLeadTimes.sampleProduction,
        "sample",
      );

      const method = approvalMethods[index] ?? "physical";
      const startsAnotherRound = round < sampleRounds;
      append(
        `sample-${round}-approved`,
        startsAnotherRound
          ? `Sample round ${round} approved; sample round ${round + 1} started`
          : "PO received & final sample approved",
        startsAnotherRound
          ? method === "physical"
            ? `Round ${round} physical sample approved · next round begins`
            : `Round ${round} photo approved · next round begins`
          : method === "physical"
            ? "Physical sample · delivery & final approval"
            : "Photo approval · no shipping required",
        method === "physical"
          ? sampleLeadTimes.physicalApproval
          : sampleLeadTimes.photoApproval,
        "approval",
        true,
      );
    }

    for (const stage of productionStages) {
      append(
        `production-${stage.id}`,
        stage.name.trim() || "Untitled production step",
        "Production step",
        stage.days,
        stage.tone,
      );
    }

    const shippingBaseDate = cursor;
    const selectedSet = new Set(
      selectedShippingMethods.length ? selectedShippingMethods : ["air"],
    );
    const shippingResults: ShippingResult[] = SHIPPING_METHODS.filter((method) =>
      selectedSet.has(method.id),
    ).map((method) => {
      const leadDays = shippingLeadDays[method.id];
      const finalDate = addDays(shippingBaseDate, leadDays);
      return {
        id: method.id,
        label: method.label,
        leadDays,
        finalDate,
        totalDays: daysBetween(firstDate, finalDate),
      };
    });
    const firstShippingResult = shippingResults[0]!;
    const earliestShippingResult = shippingResults.reduce(
      (earliest, result) =>
        result.finalDate < earliest.finalDate ? result : earliest,
      firstShippingResult,
    );
    const latestShippingResult = shippingResults.reduce(
      (latest, result) =>
        result.finalDate > latest.finalDate ? result : latest,
      firstShippingResult,
    );

    return {
      items,
      start: firstDate,
      shippingBaseDate,
      shippingResults,
      earliestInHands: earliestShippingResult.finalDate,
      latestInHands: latestShippingResult.finalDate,
      inHandsRange: formatDateRange(
        earliestShippingResult.finalDate,
        latestShippingResult.finalDate,
      ),
      earliestTotalDays: earliestShippingResult.totalDays,
      latestTotalDays: latestShippingResult.totalDays,
      adjustmentCount: items.filter((item) => item.adjustmentDays > 0).length,
      adjustmentDays: items.reduce((sum, item) => sum + item.adjustmentDays, 0),
    };
  }, [
    approvalMethods,
    effectiveStartDate,
    productionStages,
    sampleLeadTimes,
    sampleRounds,
    selectedShippingMethods,
    shippingLeadDays,
  ]);

  const calendarView = useMemo(() => {
    const events: CalendarEvent[] = [
      ...timeline.items.map((item) => ({
        id: `milestone-${item.id}`,
        title: item.title,
        date: item.finalDate,
        rawDate: item.rawDate,
        leadDays: item.leadDays,
        notes: item.meta,
        adjustmentDays: item.adjustmentDays,
        isStart: item.id === "project-start",
        kind: "milestone" as const,
        tone: item.tone,
      })),
      ...timeline.shippingResults.map((result) => ({
        id: `shipping-${result.id}`,
        title: `${result.label} · In-hands`,
        date: result.finalDate,
        rawDate: result.finalDate,
        leadDays: result.leadDays,
        notes: `Transit time from Ready for shipment on ${formatDate(timeline.shippingBaseDate, false)}`,
        adjustmentDays: 0,
        isStart: false,
        kind: "shipping" as const,
        tone: result.id,
      })),
    ];
    const timelinePhases: CalendarPhase[] = timeline.items
      .slice(1)
      .flatMap((item, index) => {
        const previous = timeline.items[index];
        const normalStart = addDays(previous.finalDate, 1);
        const normalDays = daysBetween(previous.finalDate, item.rawDate);
        const label =
          item.tone === "sample"
            ? "Sample production"
            : item.tone === "approval"
              ? "Sample review & approval"
              : `To ${item.title}`;
        const phases: CalendarPhase[] = [];

        if (normalStart.getTime() <= item.rawDate.getTime()) {
          phases.push({
            id: `phase-${previous.id}-to-${item.id}`,
            label,
            summary: `${label}, ${formatDateRange(normalStart, item.rawDate)}, ${normalDays} calendar ${normalDays === 1 ? "day" : "days"}`,
            startDate: normalStart,
            endDate: item.rawDate,
            fromTitle: previous.title,
            fromDate: previous.finalDate,
            toTitle:
              item.adjustmentDays > 0
                ? `Original target for ${item.title}`
                : item.title,
            toDate: item.rawDate,
            notes: item.meta,
            durationDays: normalDays,
            lane: 0,
            kind: "timeline",
            tone: item.tone,
          });
        }

        if (item.adjustmentDays > 0) {
          const adjustmentStart = addDays(item.rawDate, 1);
          phases.push({
            id: `phase-${previous.id}-to-${item.id}-adjustment`,
            label: `Weekend +${item.adjustmentDays}d`,
            summary: `Weekend adjustment for ${item.title}, ${formatDateRange(adjustmentStart, item.finalDate)}, ${item.adjustmentDays} additional ${item.adjustmentDays === 1 ? "day" : "days"}`,
            startDate: adjustmentStart,
            endDate: item.finalDate,
            fromTitle: `Original target for ${item.title}`,
            fromDate: item.rawDate,
            toTitle: item.title,
            toDate: item.finalDate,
            notes: "Moved to the next weekday because the configured date fell on a weekend.",
            durationDays: item.adjustmentDays,
            lane: 0,
            kind: "adjustment",
            tone: "adjustment",
          });
        }

        return phases;
      });
    const shippingPhases: CalendarPhase[] = timeline.shippingResults.flatMap(
      (result, lane) => {
        const startDate = addDays(timeline.shippingBaseDate, 1);
        if (startDate.getTime() > result.finalDate.getTime()) return [];

        return [
          {
            id: `shipping-phase-${result.id}`,
            label: result.label.replace(" freight", ""),
            summary: `${result.label}, ${formatDateRange(startDate, result.finalDate)}, ${result.leadDays} calendar ${result.leadDays === 1 ? "day" : "days"}`,
            startDate,
            endDate: result.finalDate,
            fromTitle: "Ready for shipment",
            fromDate: timeline.shippingBaseDate,
            toTitle: `${result.label} in-hands`,
            toDate: result.finalDate,
            notes: "Transit dates use calendar days and are not adjusted for weekends.",
            durationDays: result.leadDays,
            lane,
            kind: "shipping" as const,
            tone: result.id,
          },
        ];
      },
    );
    const phases = [...timelinePhases, ...shippingPhases];
    const eventsByDate = new Map<string, CalendarEvent[]>();

    for (const event of events) {
      const key = toIso(event.date);
      const current = eventsByDate.get(key) ?? [];
      current.push(event);
      eventsByDate.set(key, current);
    }

    const months = listUtcMonths(timeline.start, timeline.latestInHands).map(
      (month) => ({
        ...month,
        label: formatMonthLabel(month.year, month.month),
      }),
    );

    return { events, eventsByDate, months, phases };
  }, [timeline]);

  const activeCalendarMonthIndex = Math.max(
    0,
    Math.min(calendarMonthIndex, Math.max(0, calendarView.months.length - 1)),
  );
  const activeCalendarMonth =
    calendarView.months[activeCalendarMonthIndex] ?? calendarView.months[0];
  const selectedCalendarEvent = calendarView.events.find(
    (event) => event.id === selectedCalendarEventId,
  );
  const selectedCalendarPhase = calendarView.phases.find(
    (phase) => phase.id === selectedCalendarPhaseId,
  );

  function focusCalendarDetails(triggerId: string) {
    setCalendarDetailTriggerId(triggerId);
    window.setTimeout(() => {
      const detail = document.getElementById("calendar-event-detail");
      detail?.scrollIntoView({ behavior: "auto", block: "nearest" });
      detail?.focus({ preventScroll: true });
    }, 0);
  }

  function closeCalendarDetails() {
    const triggerId = calendarDetailTriggerId;
    setSelectedCalendarEventId(null);
    setSelectedCalendarPhaseId(null);
    window.setTimeout(() => {
      if (triggerId) document.getElementById(triggerId)?.focus();
    }, 0);
  }

  const analysis = useMemo(() => {
    const lines = analyzerInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const rows: AnalysisRow[] = [];
    const unmatched: string[] = [];
    let previousDate: Date | null = null;
    const defaultYear = Number((browserToday || "2000-01-01").slice(0, 4));

    for (const [index, line] of lines.entries()) {
      const parsed = parseCustomerDate(line, defaultYear, previousDate);
      if (!parsed) {
        unmatched.push(line);
        continue;
      }

      const label =
        line
          .replace(parsed.matched, "")
          .replace(/^[\s\t:|\-–—]+|[\s\t:|\-–—]+$/g, "")
          .replace(/\s{2,}/g, " ") || `Milestone ${index + 1}`;
      const difference = previousDate ? daysBetween(previousDate, parsed.date) : null;
      const notes: string[] = [];
      if (parsed.assumedUS) notes.push("US format assumed");
      if (parsed.inferredYear) notes.push(`Year ${parsed.date.getUTCFullYear()} inferred`);
      if (difference !== null && difference < 0) notes.push("Date is before previous row");

      rows.push({
        id: `${index}-${toIso(parsed.date)}`,
        label,
        date: parsed.date,
        daysFromPrevious: difference,
        format: parsed.format,
        note: notes.join(" · "),
      });
      previousDate = parsed.date;
    }

    return { rows, unmatched };
  }, [analyzerInput, browserToday]);

  const markChanged = () => setHasInteracted(true);

  const changeRounds = (nextValue: number) => {
    const next = Math.min(4, Math.max(1, nextValue));
    setSampleRounds(next);
    setApprovalMethods((current) =>
      Array.from({ length: next }, (_, index) => current[index] ?? "physical"),
    );
    markChanged();
  };

  const changeApprovalMethod = (index: number, method: ApprovalMethod) => {
    setApprovalMethods((current) =>
      Array.from({ length: sampleRounds }, (_, itemIndex) =>
        itemIndex === index ? method : current[itemIndex] ?? "physical",
      ),
    );
    markChanged();
  };

  const changeSampleLeadTime = (key: keyof SampleLeadTimes, value: string) => {
    setSampleLeadTimes((current) => ({
      ...current,
      [key]: safeNumber(value, 999),
    }));
    markChanged();
  };

  const changeProductionStageName = (id: string, name: string) => {
    setProductionStages((current) =>
      current.map((stage) =>
        stage.id === id ? { ...stage, name: name.slice(0, 80) } : stage,
      ),
    );
    markChanged();
  };

  const changeProductionStageDays = (id: string, value: string) => {
    setProductionStages((current) =>
      current.map((stage) =>
        stage.id === id
          ? { ...stage, days: safeNumber(value, 999) }
          : stage,
      ),
    );
    markChanged();
  };

  const addProductionStage = () => {
    if (productionStages.length >= 12) return;
    const id = window.crypto.randomUUID();
    setProductionStages((current) => [
      ...current,
      {
        id: `custom-${id}`,
        name: "New production step",
        days: 1,
        tone: "production",
      },
    ]);
    markChanged();
  };

  const removeProductionStage = (id: string) => {
    setProductionStages((current) => current.filter((stage) => stage.id !== id));
    markChanged();
  };

  const moveProductionStage = (id: string, direction: -1 | 1) => {
    setProductionStages((current) => {
      const index = current.findIndex((stage) => stage.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    markChanged();
  };

  const toggleShippingMethod = (id: ShippingMethod) => {
    setSelectedShippingMethods((current) => {
      const isSelected = current.includes(id);
      if (isSelected && current.length === 1) return current;
      const next = new Set(current);
      if (isSelected) next.delete(id);
      else next.add(id);
      return SHIPPING_METHODS.flatMap((method) =>
        next.has(method.id) ? [method.id] : [],
      );
    });
    markChanged();
  };

  const changeShippingLeadDays = (id: ShippingMethod, value: string) => {
    setShippingLeadDays((current) => ({
      ...current,
      [id]: safeNumber(value, 999),
    }));
    markChanged();
  };

  const resetToStandard = () => {
    setStartDate(browserToday || todayIso());
    setSampleRounds(1);
    setApprovalMethods(["physical"]);
    setSampleLeadTimes(DEFAULT_SAMPLE_LEAD_TIMES);
    setProductionStages(cloneDefaultProductionStages());
    setSelectedShippingMethods(cloneDefaultShippingMethods());
    setShippingLeadDays(cloneDefaultShippingLeadDays());
    markChanged();
  };

  const clearSavedData = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_V2_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_V1_STORAGE_KEY);
    setLastSaved(null);
    setHasInteracted(false);
  };

  const copyText = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(message);
      window.setTimeout(() => setCopyState(""), 2200);
    } catch {
      setCopyState("Copy was blocked by the browser");
      window.setTimeout(() => setCopyState(""), 2600);
    }
  };

  const copyTimeline = () => {
    const milestoneLines = timeline.items.map(
      (item) => `${formatDate(item.finalDate, false)}: ${item.title}`,
    );
    const shippingLines = timeline.shippingResults.map(
      (result) =>
        `${formatDate(result.finalDate, false)}: In-hands — ${result.label} (${result.leadDays} calendar days)`,
    );
    const lines = [
      ...milestoneLines,
      "",
      timeline.shippingResults.length === 1
        ? "Estimated in-hands date"
        : "Estimated in-hands dates",
      ...shippingLines,
    ];
    void copyText(lines.join("\n"), "Timeline copied");
  };

  const selectDatePreset = (preset: QuickDatePreset) => {
    setDateCalcPreset(preset);
    if (preset !== "custom") {
      setDateCalcDaysInput(String(DEFAULT_SHIPPING_LEAD_DAYS[preset]));
    }
  };

  const changeDateCalcDays = (value: string) => {
    const normalized = normalizeWholeNumberDraft(value, 999);
    if (normalized !== null) setDateCalcDaysInput(normalized);
  };

  const resetDateCalculator = () => {
    setDateCalcStart(browserToday || todayIso());
    setDateCalcDaysInput(String(DEFAULT_SHIPPING_LEAD_DAYS["fast-sea"]));
    setDateCalcPreset("fast-sea");
  };

  const copyDateCalculation = () => {
    const resultLabel =
      dateCalcPreset === "custom" ? "Calculated date" : dateCalcLabel;
    const text = [
      `${formatDate(dateCalcResultDate, false)}: ${resultLabel}`,
      `${dateCalcDays} calendar days from ${formatDate(dateCalcBaseDate, false)}`,
      "Start date not counted · No weekend adjustment",
    ].join("\n");
    void copyText(text, "Date copied");
  };

  const exportTimeline = () => {
    const rows = [
      [
        "Category",
        "Milestone / option",
        "Lead time (days)",
        "Planned date",
        "Calculated from",
        "Notes",
      ],
      ...timeline.items.map((item) => [
        "Timeline",
        item.title,
        item.id === "project-start" ? "" : item.leadDays,
        toIso(item.finalDate),
        item.id === "project-start" ? "" : "Previous milestone",
        item.adjustmentDays
          ? `Weekend adjustment +${item.adjustmentDays} day${item.adjustmentDays > 1 ? "s" : ""}`
          : item.meta,
      ]),
      ...timeline.shippingResults.map((result) => [
        "Shipping option",
        `In-hands — ${result.label}`,
        result.leadDays,
        toIso(result.finalDate),
        toIso(timeline.shippingBaseDate),
        "Transit time from the final production milestone",
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    downloadFile(
      `readybydate-timeline-${effectiveStartDate}.csv`,
      csv,
      "text/csv;charset=utf-8",
    );
  };

  const copyAnalysis = () => {
    const lines = [
      ["Customer milestone", "Date", "Days from previous", "Notes"].join("\t"),
      ...analysis.rows.map((row) =>
        [
          row.label,
          formatDate(row.date, false),
          row.daysFromPrevious ?? "—",
          row.note,
        ].join("\t"),
      ),
    ];
    void copyText(lines.join("\n"), "Analysis copied");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ReadyByDate.com home">
          <span className="brand-mark" aria-hidden="true" />
          <span>
            <strong className="brand-name">
              ReadyByDate<em>.com</em>
            </strong>
            <small>Timeline & date calculator</small>
          </span>
        </a>
        <div className="topbar-meta">
          <span className="status-pill">
            <span className="status-dot" aria-hidden="true" />
            Flexible planning template
          </span>
          <span className="device-note">
            {activeTab === "build"
              ? "Saved on this device"
              : "Calculated in your browser"}
          </span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Production and delivery planning, simplified</span>
          <h1>
            From one date to a full production plan,
            <span> ready in seconds.</span>
          </h1>
          <p>
            Add transit days, build a complete production timeline, or check dates
            copied from a customer.
          </p>
        </div>
        {activeTab === "date" ? (
          <div className="hero-metric" aria-label="Current calculated date">
            <span>Calculated date</span>
            <strong>{formatShortDate(dateCalcResultDate)}</strong>
            <small>
              {dateCalcDays} calendar days · {dateCalcLabel}
            </small>
          </div>
        ) : activeTab === "analyze" ? (
          <div className="hero-metric" aria-label="Supported customer date formats">
            <span>Date recognition</span>
            <strong>Flexible</strong>
            <small>US, ISO, and written-month formats</small>
          </div>
        ) : (
          <div className="hero-metric" aria-label="Current estimated in-hands dates">
            <span>
              {timeline.shippingResults.length === 1
                ? "Estimated in-hands"
                : "In-hands range"}
            </span>
            <strong
              className={timeline.shippingResults.length > 1 ? "date-range" : ""}
            >
              {timeline.inHandsRange}
            </strong>
            <small>
              {timeline.shippingResults.length === 1
                ? `${timeline.earliestTotalDays} calendar days · ${timeline.shippingResults[0]?.label ?? "Shipping"}`
                : `${timeline.shippingResults.length} shipping options · ${timeline.earliestTotalDays}–${timeline.latestTotalDays} calendar days`}
            </small>
          </div>
        )}
      </section>

      <nav className="mode-tabs" aria-label="Calculator mode">
        <button
          type="button"
          className={activeTab === "build" ? "active" : ""}
          aria-pressed={activeTab === "build"}
          onClick={() => setActiveTab("build")}
        >
          <span>01</span>
          Build timeline
        </button>
        <button
          type="button"
          className={activeTab === "date" ? "active" : ""}
          aria-pressed={activeTab === "date"}
          onClick={() => setActiveTab("date")}
        >
          <span>02</span>
          Add days
        </button>
        <button
          type="button"
          className={activeTab === "analyze" ? "active" : ""}
          aria-pressed={activeTab === "analyze"}
          onClick={() => setActiveTab("analyze")}
        >
          <span>03</span>
          Analyze dates
        </button>
      </nav>

      {activeTab === "build" ? (
        <section
          className={`workspace-grid ${resultView === "calendar" ? "calendar-layout" : ""}`}
        >
          <aside className="control-card">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Quick setup</span>
                <h2>Plan settings</h2>
              </div>
              <button type="button" className="text-button" onClick={resetToStandard}>
                Reset
              </button>
            </div>

            {lastSaved ? (
              <div className="resume-card">
                <div>
                  <span>Restored from this device</span>
                  <strong>
                    {lastSaved.productionStages.length} production step
                    {lastSaved.productionStages.length === 1 ? "" : "s"} loaded
                  </strong>
                  <small>
                    Saved {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lastSaved.savedAt))}
                  </small>
                </div>
                <span className="resume-status" aria-label="Saved plan restored">✓</span>
              </div>
            ) : null}

            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="start-date">Start date</label>
                <span>Day one is not counted</span>
              </div>
              <div className="date-control">
                <input
                  id="start-date"
                  type="date"
                  value={effectiveStartDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    markChanged();
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setStartDate(browserToday || todayIso());
                    markChanged();
                  }}
                >
                  Today
                </button>
              </div>
            </div>

            <div className="field-group">
              <div className="field-label-row">
                <span className="label-like">Sample rounds</span>
                <span>1–4 rounds</span>
              </div>
              <div className="stepper" aria-label="Number of sample rounds">
                <button
                  type="button"
                  aria-label="Decrease sample rounds"
                  disabled={sampleRounds === 1}
                  onClick={() => changeRounds(sampleRounds - 1)}
                >
                  −
                </button>
                <strong>{sampleRounds}</strong>
                <button
                  type="button"
                  aria-label="Increase sample rounds"
                  disabled={sampleRounds === 4}
                  onClick={() => changeRounds(sampleRounds + 1)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="field-group">
              <div className="field-label-row">
                <span className="label-like">Approval method</span>
                <span>Set per round</span>
              </div>
              <div className="round-list">
                {Array.from({ length: sampleRounds }, (_, index) => (
                  <div className="round-control" key={`round-${index + 1}`}>
                    <span>Round {index + 1}</span>
                    <div className="segmented" role="group" aria-label={`Round ${index + 1} approval method`}>
                      <button
                        type="button"
                        className={approvalMethods[index] === "physical" ? "selected" : ""}
                        aria-pressed={approvalMethods[index] === "physical"}
                        onClick={() => changeApprovalMethod(index, "physical")}
                      >
                        Physical
                      </button>
                      <button
                        type="button"
                        className={approvalMethods[index] === "photo" ? "selected" : ""}
                        aria-pressed={approvalMethods[index] === "photo"}
                        onClick={() => changeApprovalMethod(index, "photo")}
                      >
                        Photo
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <section className="lead-times-panel" aria-labelledby="lead-times-title">
              <div className="lead-times-heading">
                <span>
                  <strong id="lead-times-title">Timeline steps & lead times</strong>
                  <small>Review these values for each customer.</small>
                </span>
                <span className="visible-badge">Always visible</span>
              </div>

              <div className="lead-time-section-label">
                <strong>Sample & approval</strong>
                <small>Applied to each selected sample round</small>
              </div>
              <div className="lead-time-list">
                {SAMPLE_LEAD_TIME_FIELDS.map((field) => (
                  <label key={field.key} className="lead-time-row">
                    <span>
                      <strong>{field.label}</strong>
                      <small>{field.hint}</small>
                    </span>
                    <span className="number-input">
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={sampleLeadTimes[field.key]}
                        onChange={(event) =>
                          changeSampleLeadTime(field.key, event.target.value)
                        }
                      />
                      days
                    </span>
                  </label>
                ))}
              </div>

              <div className="stage-section-heading">
                <span>
                  <strong>Production steps</strong>
                  <small>Add, rename, reorder, or remove any step.</small>
                </span>
                <button
                  type="button"
                  className="add-stage-button"
                  onClick={addProductionStage}
                  disabled={productionStages.length >= 12}
                >
                  + Add step
                </button>
              </div>

              <div className="stage-editor-list">
                {productionStages.map((stage, index) => (
                  <div className="stage-editor-row" key={stage.id}>
                    <span className="stage-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <input
                      className="stage-name-input"
                      type="text"
                      value={stage.name}
                      maxLength={80}
                      aria-label={`Production step ${index + 1} name`}
                      onChange={(event) =>
                        changeProductionStageName(stage.id, event.target.value)
                      }
                    />
                    <span className="number-input stage-days-input">
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={stage.days}
                        aria-label={`${stage.name || `Production step ${index + 1}`} lead time in days`}
                        onChange={(event) =>
                          changeProductionStageDays(stage.id, event.target.value)
                        }
                      />
                      days
                    </span>
                    <span className="stage-actions">
                      <button
                        type="button"
                        aria-label={`Move ${stage.name || `production step ${index + 1}`} up`}
                        disabled={index === 0}
                        onClick={() => moveProductionStage(stage.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${stage.name || `production step ${index + 1}`} down`}
                        disabled={index === productionStages.length - 1}
                        onClick={() => moveProductionStage(stage.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="remove-stage-button"
                        aria-label={`Remove ${stage.name || `production step ${index + 1}`}`}
                        onClick={() => removeProductionStage(stage.id)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                ))}
                {!productionStages.length ? (
                  <div className="stage-empty-state">
                    No production steps. Add one when this order needs it.
                  </div>
                ) : null}
              </div>
            </section>

            <div className="field-group shipping-field">
              <div className="field-label-row">
                <span className="label-like">Shipping options</span>
                <span>
                  {selectedShippingMethods.length} selected · edit days
                </span>
              </div>
              <p className="shipping-help">
                Each option starts from the same final production date.
              </p>
              <div className="shipping-options">
                {SHIPPING_METHODS.map((method) => {
                  const isSelected = selectedShippingMethods.includes(method.id);
                  const isLastSelected =
                    isSelected && selectedShippingMethods.length === 1;
                  return (
                    <article
                      className={`shipping-option-card${isSelected ? " selected" : ""}`}
                      key={method.id}
                    >
                      <button
                        type="button"
                        className="shipping-option-toggle"
                        aria-pressed={isSelected}
                        disabled={isLastSelected}
                        title={
                          isLastSelected
                            ? "Keep at least one shipping option"
                            : undefined
                        }
                        onClick={() => toggleShippingMethod(method.id)}
                      >
                        <span className="shipping-check" aria-hidden="true">
                          {isSelected ? "✓" : "+"}
                        </span>
                        <span className="shipping-option-copy">
                          <strong>{method.label}</strong>
                          <small>
                            {isSelected ? "Included in timeline" : "Add to timeline"}
                          </small>
                        </span>
                      </button>
                      <label className="shipping-days-editor">
                        <input
                          type="number"
                          min="0"
                          max="999"
                          inputMode="numeric"
                          aria-label={`${method.label} transit time in calendar days`}
                          value={shippingLeadDays[method.id]}
                          onChange={(event) =>
                            changeShippingLeadDays(method.id, event.target.value)
                          }
                        />
                        <span>days</span>
                      </label>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="local-note">
              <span aria-hidden="true">✓</span>
              <p>
                Changes are saved and restored automatically on this device. No
                account is required.
              </p>
              {lastSaved || hasInteracted ? (
                <button type="button" onClick={clearSavedData}>
                  Clear
                </button>
              ) : null}
            </div>
          </aside>

          <section
            className={`result-card ${resultView === "calendar" ? "calendar-active" : ""}`}
          >
            <div className="result-header">
              <div>
                <span className="section-kicker">Calculated plan</span>
                <h2>Production timeline</h2>
                <p>Dates update instantly as the plan changes.</p>
              </div>
              <div className="result-actions">
                <button type="button" className="secondary-action" onClick={copyTimeline}>
                  Copy
                </button>
                <button type="button" className="primary-action" onClick={exportTimeline}>
                  Export CSV
                </button>
              </div>
            </div>

            <div className="summary-grid">
              <article className="summary-card finish-card">
                <span>
                  {timeline.shippingResults.length === 1
                    ? "Estimated in-hands"
                    : "In-hands range"}
                </span>
                <strong
                  className={timeline.shippingResults.length > 1 ? "date-range" : ""}
                >
                  {timeline.inHandsRange}
                </strong>
                <small>
                  {timeline.shippingResults.length} shipping option
                  {timeline.shippingResults.length === 1 ? "" : "s"}
                </small>
              </article>
              <article className="summary-card">
                <span>Shipping starts</span>
                <strong>{formatShortDate(timeline.shippingBaseDate)}</strong>
                <small>{timeline.shippingBaseDate.getUTCFullYear()} · final production date</small>
              </article>
              <article className="summary-card">
                <span>Shipping options</span>
                <strong>{timeline.shippingResults.length}</strong>
                <small>included in copy and export</small>
              </article>
              <article className="summary-card">
                <span>Weekend shifts</span>
                <strong>{timeline.adjustmentDays}</strong>
                <small>
                  {timeline.adjustmentCount} adjusted milestone
                  {timeline.adjustmentCount === 1 ? "" : "s"}
                </small>
              </article>
            </div>

            <div className="result-view-toolbar">
              <div
                className="result-view-switch"
                role="group"
                aria-label="Production plan view"
              >
                <button
                  type="button"
                  className={resultView === "timeline" ? "selected" : ""}
                  aria-pressed={resultView === "timeline"}
                  onClick={() => setResultView("timeline")}
                >
                  Timeline view
                </button>
                <button
                  type="button"
                  className={resultView === "calendar" ? "selected" : ""}
                  aria-pressed={resultView === "calendar"}
                  onClick={() => setResultView("calendar")}
                >
                  Calendar view
                </button>
              </div>
              <p>
                {resultView === "timeline"
                  ? "Best for reviewing sequence, lead times, and customer copy."
                  : "Connected bands show every elapsed day between milestones."}
              </p>
            </div>

            {resultView === "timeline" ? (
              <>
                <div className="timeline-list" aria-label="Calculated timeline">
              {timeline.items.map((item, index) => (
                <article className={`timeline-row tone-${item.tone}`} key={item.id}>
                  <div className="timeline-rail" aria-hidden="true">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <div className="timeline-content">
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.meta}</p>
                    </div>
                    <span className="lead-chip">
                      {item.id === "project-start" ? "Day 0" : `+${item.leadDays} days`}
                    </span>
                  </div>
                  <div className="timeline-date">
                    <strong>{formatShortDate(item.finalDate)}</strong>
                    <span>{item.finalDate.getUTCFullYear()}</span>
                    {item.adjustmentDays ? (
                      <small>
                        Weekend → +{item.adjustmentDays} day
                        {item.adjustmentDays > 1 ? "s" : ""}
                      </small>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <section className="shipping-results" aria-label="Estimated in-hands dates">
              <div className="shipping-results-heading">
                <div>
                  <span className="section-kicker">Delivery choices</span>
                  <h3>
                    Estimated in-hands date
                    {timeline.shippingResults.length === 1 ? "" : "s"}
                  </h3>
                </div>
                <p>
                  All calculated from {formatDate(timeline.shippingBaseDate, false)}
                </p>
              </div>
              <div className="shipping-result-grid">
                {timeline.shippingResults.map((result) => (
                  <article
                    className={`shipping-result-card shipping-result-${result.id}`}
                    key={result.id}
                  >
                    <span>{result.label}</span>
                    <strong>{formatDate(result.finalDate, false)}</strong>
                    <small>
                      {result.leadDays} transit days · {result.totalDays} days from
                      sample start
                    </small>
                  </article>
                ))}
              </div>
            </section>

              </>
            ) : (
              <section className="calendar-view" aria-label="Production calendar">
                <div className="calendar-toolbar">
                  <button
                    type="button"
                    aria-label="Previous calendar month"
                    disabled={activeCalendarMonthIndex === 0}
                    onClick={() => {
                      setCalendarMonthIndex(
                        Math.max(0, activeCalendarMonthIndex - 1),
                      );
                      setSelectedCalendarEventId(null);
                      setSelectedCalendarPhaseId(null);
                    }}
                  >
                    ←
                  </button>
                  <div>
                    <span className="calendar-count-desktop">
                      {calendarView.months[activeCalendarMonthIndex + 1]
                        ? `Months ${activeCalendarMonthIndex + 1}–${activeCalendarMonthIndex + 2} of ${calendarView.months.length}`
                        : `Month ${activeCalendarMonthIndex + 1} of ${calendarView.months.length}`}
                    </span>
                    <span className="calendar-count-compact">
                      Month {activeCalendarMonthIndex + 1} of{" "}
                      {calendarView.months.length}
                    </span>
                    <strong>
                      <span>{activeCalendarMonth?.label}</span>
                      {calendarView.months[activeCalendarMonthIndex + 1] ? (
                        <>
                          <span className="calendar-range-separator"> – </span>
                          <span className="calendar-range-next">
                            {calendarView.months[activeCalendarMonthIndex + 1].label}
                          </span>
                        </>
                      ) : null}
                    </strong>
                  </div>
                  <button
                    type="button"
                    aria-label="Next calendar month"
                    disabled={
                      activeCalendarMonthIndex >= calendarView.months.length - 1
                    }
                    onClick={() => {
                      setCalendarMonthIndex(
                        Math.min(
                          calendarView.months.length - 1,
                          activeCalendarMonthIndex + 1,
                        ),
                      );
                      setSelectedCalendarEventId(null);
                      setSelectedCalendarPhaseId(null);
                    }}
                  >
                    →
                  </button>
                </div>

                <div className="calendar-legend" aria-label="Calendar legend">
                  <span className="legend-phase">Lead-time bands</span>
                  <span className="legend-weekend">Weekend</span>
                  <span className="legend-shift">Weekend extension</span>
                  {timeline.shippingResults.some((result) => result.id === "air") ? (
                    <span className="legend-air">Air freight</span>
                  ) : null}
                  {timeline.shippingResults.some(
                    (result) => result.id === "fast-sea",
                  ) ? (
                    <span className="legend-fast-sea">Fast sea</span>
                  ) : null}
                  {timeline.shippingResults.some(
                    (result) => result.id === "standard-sea",
                  ) ? (
                    <span className="legend-standard-sea">Standard sea</span>
                  ) : null}
                </div>
                <p className="calendar-band-note">
                  Bands cover the calendar days after one milestone through the
                  next scheduled date. Milestone chips mark final scheduled dates.
                </p>
                <ul className="sr-only" aria-label="Lead-time band details">
                  {calendarView.phases.map((phase) => (
                    <li key={phase.id}>{phase.summary}</li>
                  ))}
                </ul>

                <div className="calendar-months">
                  {calendarView.months
                    .slice(
                      activeCalendarMonthIndex,
                      activeCalendarMonthIndex + 2,
                    )
                    .map((month, visibleMonthIndex) => {
                      const monthEventCount = calendarView.events.filter(
                        (event) =>
                          event.date.getUTCFullYear() === month.year &&
                          event.date.getUTCMonth() === month.month,
                      ).length;
                      const cells = buildUtcMonthCells(month.year, month.month);
                      const phaseSegments = buildUtcRangeSegments(
                        cells,
                        calendarView.phases,
                      );
                      const weeks = Array.from(
                        { length: Math.ceil(cells.length / 7) },
                        (_, weekIndex) =>
                          cells.slice(weekIndex * 7, weekIndex * 7 + 7),
                      );
                      const isMobileActive = visibleMonthIndex === 0;

                      return (
                        <article
                          className={`calendar-month desktop-visible ${isMobileActive ? "mobile-active" : ""}`}
                          key={month.key}
                        >
                        <header>
                          <h3>{month.label}</h3>
                          <span>
                            {monthEventCount} event{monthEventCount === 1 ? "" : "s"}
                          </span>
                        </header>
                        <div className="calendar-weekdays" aria-hidden="true">
                          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                            (weekday) => <span key={weekday}>{weekday}</span>,
                          )}
                        </div>
                        <div className="calendar-days">
                          {weeks.map((week, weekIndex) => {
                            const weekSegments = phaseSegments.filter(
                              (segment) => segment.week === weekIndex + 1,
                            );

                            return (
                              <div
                                className="calendar-week"
                                key={`${month.key}-week-${weekIndex + 1}`}
                              >
                                <div className="calendar-week-days">
                                  {week.map((cell) => {
                                    const events = cell.isCurrentMonth
                                      ? calendarView.eventsByDate.get(cell.iso) ?? []
                                      : [];

                                    return (
                                      <div
                                        className={`calendar-day ${cell.isWeekend ? "is-weekend" : ""} ${cell.isCurrentMonth ? "" : "is-outside"} ${events.length ? "has-events" : ""}`}
                                        key={`${month.key}-${cell.iso}`}
                                      >
                                        <time dateTime={cell.iso}>
                                          {cell.dayNumber}
                                        </time>
                                        <div className="calendar-day-events">
                                          {events.map((event) => (
                                            <button
                                              type="button"
                                              id={`calendar-trigger-${event.id}`}
                                              className={`calendar-event calendar-event-${event.tone} ${event.adjustmentDays ? "is-adjusted" : ""} ${selectedCalendarEventId === event.id ? "selected" : ""}`}
                                              aria-label={`${event.title}, ${formatDate(event.date)}`}
                                              aria-pressed={
                                                selectedCalendarEventId === event.id
                                              }
                                              title={event.title}
                                              key={event.id}
                                              onClick={() => {
                                                setSelectedCalendarEventId(event.id);
                                                setSelectedCalendarPhaseId(null);
                                                focusCalendarDetails(
                                                  `calendar-trigger-${event.id}`,
                                                );
                                              }}
                                            >
                                              <span>{event.title}</span>
                                              {event.adjustmentDays ? (
                                                <strong
                                                  title={`Moved ${event.adjustmentDays} day${event.adjustmentDays === 1 ? "" : "s"} because of a weekend`}
                                                >
                                                  W+{event.adjustmentDays}
                                                </strong>
                                              ) : null}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                {weekSegments.length ? (
                                  <div
                                    className={`calendar-week-bands ${weekSegments.every((segment) => segment.kind === "shipping") ? "shipping-band-group" : ""}`}
                                  >
                                    {weekSegments.map((segment) => (
                                      <button
                                        type="button"
                                        id={`calendar-phase-trigger-${month.key}-${segment.segmentId}`}
                                        className={`calendar-phase-segment calendar-event-${segment.tone} ${segment.startsRange ? "starts-range" : "continues-before"} ${segment.endsRange ? "ends-range" : "continues-after"} ${selectedCalendarPhaseId === segment.id ? "selected" : ""}`}
                                        style={{
                                          gridColumn: `${segment.startColumn} / ${segment.endColumn + 1}`,
                                          gridRow: segment.lane + 1,
                                        }}
                                        tabIndex={
                                          segment.isFirstVisibleSegment ? 0 : -1
                                        }
                                        aria-label={segment.summary}
                                        aria-pressed={
                                          selectedCalendarPhaseId === segment.id
                                        }
                                        title={segment.summary}
                                        key={`${month.key}-${segment.segmentId}`}
                                        onClick={() => {
                                          const triggerId = `calendar-phase-trigger-${month.key}-${segment.segmentId}`;
                                          setSelectedCalendarEventId(null);
                                          setSelectedCalendarPhaseId(segment.id);
                                          focusCalendarDetails(triggerId);
                                        }}
                                      >
                                        <span>
                                          {segment.startsRange ? "" : "← "}
                                          {segment.label}
                                          {segment.endsRange ? "" : " →"}
                                        </span>
                                        {segment.startsRange ? (
                                          <small>{segment.durationDays}d total</small>
                                        ) : null}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        </article>
                      );
                    })}
                </div>

                <aside
                  className="calendar-event-detail"
                  id="calendar-event-detail"
                  tabIndex={-1}
                  aria-live="polite"
                >
                  {selectedCalendarEvent ? (
                    <>
                      <div className="calendar-detail-heading">
                        <span
                          className={`calendar-detail-swatch calendar-event-${selectedCalendarEvent.tone}`}
                          aria-hidden="true"
                        />
                        <div>
                          <span>
                            {selectedCalendarEvent.kind === "shipping"
                              ? "Shipping option"
                              : "Timeline milestone"}
                          </span>
                          <h4>{selectedCalendarEvent.title}</h4>
                          <time dateTime={toIso(selectedCalendarEvent.date)}>
                            {formatDate(selectedCalendarEvent.date)}
                          </time>
                        </div>
                        <button
                          type="button"
                          aria-label="Close calendar details"
                          onClick={closeCalendarDetails}
                        >
                          ×
                        </button>
                      </div>
                      <dl>
                        <div>
                          <dt>Lead time</dt>
                          <dd>
                            {selectedCalendarEvent.isStart
                              ? "Day 0"
                              : `${selectedCalendarEvent.leadDays} calendar ${selectedCalendarEvent.leadDays === 1 ? "day" : "days"}`}
                          </dd>
                        </div>
                        <div>
                          <dt>Notes</dt>
                          <dd>{selectedCalendarEvent.notes}</dd>
                        </div>
                        {selectedCalendarEvent.adjustmentDays ? (
                          <div>
                            <dt>Weekend adjustment</dt>
                            <dd>
                              Originally {formatDate(selectedCalendarEvent.rawDate)} ·
                              moved +{selectedCalendarEvent.adjustmentDays} day
                              {selectedCalendarEvent.adjustmentDays === 1 ? "" : "s"}
                            </dd>
                          </div>
                        ) : null}
                        {selectedCalendarEvent.kind === "shipping" ? (
                          <div>
                            <dt>Weekend rule</dt>
                            <dd>Shipping dates are not adjusted for weekends.</dd>
                          </div>
                        ) : null}
                      </dl>
                    </>
                  ) : selectedCalendarPhase ? (
                    <>
                      <div className="calendar-detail-heading">
                        <span
                          className={`calendar-detail-swatch calendar-event-${selectedCalendarPhase.tone}`}
                          aria-hidden="true"
                        />
                        <div>
                          <span>
                            {selectedCalendarPhase.kind === "shipping"
                              ? "Shipping lead-time band"
                              : selectedCalendarPhase.kind === "adjustment"
                                ? "Weekend extension"
                                : "Lead-time band"}
                          </span>
                          <h4>{selectedCalendarPhase.label}</h4>
                          <span className="calendar-detail-date-range">
                            {formatDateRange(
                              selectedCalendarPhase.startDate,
                              selectedCalendarPhase.endDate,
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label="Close calendar details"
                          onClick={closeCalendarDetails}
                        >
                          ×
                        </button>
                      </div>
                      <dl>
                        <div>
                          <dt>Elapsed time</dt>
                          <dd>
                            {selectedCalendarPhase.durationDays} calendar{" "}
                            {selectedCalendarPhase.durationDays === 1
                              ? "day"
                              : "days"}
                          </dd>
                        </div>
                        <div>
                          <dt>Starts after</dt>
                          <dd>
                            {selectedCalendarPhase.fromTitle} ·{" "}
                            {formatDate(selectedCalendarPhase.fromDate)}
                          </dd>
                        </div>
                        <div>
                          <dt>Ends at</dt>
                          <dd>
                            {selectedCalendarPhase.toTitle} ·{" "}
                            {formatDate(selectedCalendarPhase.toDate)}
                          </dd>
                        </div>
                        <div>
                          <dt>Notes</dt>
                          <dd>{selectedCalendarPhase.notes}</dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <div className="calendar-detail-empty">
                      <strong>Select a milestone or band</strong>
                      <span>
                        Click a milestone chip or connected band to see its dates
                        and lead time.
                      </span>
                    </div>
                  )}
                </aside>
              </section>
            )}

            <footer className="result-footer">
              <p>
                {resultView === "timeline"
                  ? "Shipping options are calculated in parallel. Customer approval milestones move to the next weekday when they fall on a weekend."
                  : "Calendar view is read-only. Switch to Timeline view for a complete printout."}
              </p>
              {resultView === "timeline" ? (
                <button type="button" onClick={() => window.print()}>
                  Print / Save PDF
                </button>
              ) : null}
            </footer>
          </section>
        </section>
      ) : null}

      {activeTab === "date" ? (
        <section className="date-calculator-grid">
          <section className="date-calculator-card">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Standalone calculation</span>
                <h2>Add calendar days</h2>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={resetDateCalculator}
              >
                Reset
              </button>
            </div>

            <p className="date-calculator-intro">
              Calculate a shipping or delivery date without adding sample,
              approval, or production steps.
            </p>

            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="date-calculator-start">Start date</label>
                <span>Day one is not counted</span>
              </div>
              <div className="date-control">
                <input
                  id="date-calculator-start"
                  type="date"
                  value={effectiveDateCalcStart}
                  onChange={(event) => setDateCalcStart(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setDateCalcStart(browserToday || todayIso())}
                >
                  Today
                </button>
              </div>
            </div>

            <div className="field-group">
              <div className="field-label-row">
                <span className="label-like">Quick lead times</span>
                <span>Choose a starting value</span>
              </div>
              <div className="quick-date-presets" aria-label="Quick lead time presets">
                {SHIPPING_METHODS.map((method) => (
                  <button
                    type="button"
                    className={dateCalcPreset === method.id ? "selected" : ""}
                    aria-pressed={dateCalcPreset === method.id}
                    key={method.id}
                    onClick={() => selectDatePreset(method.id)}
                  >
                    <span>{method.label}</span>
                    <strong>
                      {dateCalcPreset === method.id
                        ? dateCalcDays
                        : DEFAULT_SHIPPING_LEAD_DAYS[method.id]}{" "}
                      days
                    </strong>
                  </button>
                ))}
                <button
                  type="button"
                  className={dateCalcPreset === "custom" ? "selected" : ""}
                  aria-pressed={dateCalcPreset === "custom"}
                  onClick={() => selectDatePreset("custom")}
                >
                  <span>Custom</span>
                  <strong>
                    {dateCalcPreset === "custom"
                      ? `${dateCalcDays} days`
                      : "Any lead time"}
                  </strong>
                </button>
              </div>
            </div>

            <div className="field-group date-days-group">
              <div className="field-label-row">
                <label htmlFor="date-calculator-days">Days to add</label>
                <span>0–999 calendar days</span>
              </div>
              <label className="date-days-control" htmlFor="date-calculator-days">
                <input
                  id="date-calculator-days"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={dateCalcDaysInput}
                  placeholder="0"
                  onChange={(event) =>
                    changeDateCalcDays(event.target.value)
                  }
                  onBlur={() => {
                    if (dateCalcDaysInput === "") setDateCalcDaysInput("0");
                  }}
                />
                <span>calendar days</span>
              </label>
              <small className="date-days-help">
                You can change the days without changing the selected shipping label.
              </small>
            </div>

            <div className="date-rule-strip">
              <strong>Calculation rule</strong>
              <span>Start date not counted · Weekends are not adjusted</span>
            </div>
          </section>

          <section className="date-result-card">
            <div className="result-header compact">
              <div>
                <span className="section-kicker">Instant result</span>
                <h2>Calculated date</h2>
                <p>Updates as soon as the date or lead time changes.</p>
              </div>
              <button
                type="button"
                className="primary-action"
                onClick={copyDateCalculation}
              >
                Copy date
              </button>
            </div>

            <div className="date-result-body">
              <div className="date-calculation-path" aria-label="Date calculation">
                <article className="date-path-node">
                  <span>Start date</span>
                  <strong>{formatShortDate(dateCalcBaseDate)}</strong>
                  <small>{dateCalcBaseDate.getUTCFullYear()}</small>
                </article>
                <div className="date-path-operator" aria-hidden="true">
                  <strong>+{dateCalcDays}</strong>
                  <span>days</span>
                </div>
                <article className="date-path-node result">
                  <span>Result date</span>
                  <strong>{formatShortDate(dateCalcResultDate)}</strong>
                  <small>{dateCalcResultDate.getUTCFullYear()}</small>
                </article>
              </div>

              <article className="date-result-feature">
                <span>{dateCalcLabel}</span>
                <strong>{formatDate(dateCalcResultDate)}</strong>
                <p>
                  {dateCalcDays} calendar days after {formatDate(dateCalcBaseDate)}.
                </p>
                {dateCalcFallsOnWeekend ? (
                  <small>
                    Falls on a weekend · No adjustment applied
                  </small>
                ) : (
                  <small>Calendar-day result · No weekend adjustment</small>
                )}
              </article>

              <p className="date-result-note">
                Use the goods-ready or departure date as the start date when
                calculating freight time.
              </p>
            </div>
          </section>
        </section>
      ) : null}

      {activeTab === "analyze" ? (
        <section className="analyzer-grid">
          <section className="analyzer-input-card">
            <div className="section-heading">
              <div>
                <span className="section-kicker">Paste & calculate</span>
                <h2>Customer timeline</h2>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setAnalyzerInput(
                    "Artwork approval    8/11\nSample ready       8/21\nSample approval    Aug 28\nBulk complete      9/27\nReady for shipment 10/2",
                  )
                }
              >
                Try example
              </button>
            </div>
            <p className="analyzer-intro">
              Paste dates from Excel or an email. Common date styles are detected
              automatically, and dates without a year use the current year.
            </p>
            <textarea
              value={analyzerInput}
              onChange={(event) => setAnalyzerInput(event.target.value)}
              placeholder={"Sample ready       14-Aug\nSample approval    Aug 21, 2026\nBulk complete      2026-09-20"}
              aria-label="Customer timeline text"
            />
            <div className="detection-strip">
              <span>Auto detection</span>
              <strong>Flexible dates · Current year</strong>
            </div>
            <div className="format-support">
              <span>Supported</span>
              <code>8/11</code>
              <code>14-Aug</code>
              <code>Aug 11</code>
              <code>11 Aug 2026</code>
              <code>2026-08-11</code>
            </div>
          </section>

          <section className="analysis-result-card">
            <div className="result-header compact">
              <div>
                <span className="section-kicker">Detected intervals</span>
                <h2>Date differences</h2>
                <p>
                  {analysis.rows.length
                    ? `${analysis.rows.length} dated milestones found`
                    : "Results appear here as soon as dates are found"}
                </p>
              </div>
              {analysis.rows.length ? (
                <button type="button" className="primary-action" onClick={copyAnalysis}>
                  Copy result
                </button>
              ) : null}
            </div>

            {analysis.rows.length ? (
              <div className="analysis-table-wrap">
                <table className="analysis-table">
                  <thead>
                    <tr>
                      <th>Milestone</th>
                      <th>Date</th>
                      <th>Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.rows.map((row) => (
                      <tr key={row.id} className={row.daysFromPrevious !== null && row.daysFromPrevious < 0 ? "warning-row" : ""}>
                        <td>
                          <strong>{row.label}</strong>
                          <span>{row.note || row.format}</span>
                        </td>
                        <td>{formatDate(row.date, false)}</td>
                        <td>
                          {row.daysFromPrevious === null ? (
                            <span className="gap-start">Start</span>
                          ) : (
                            <strong className={row.daysFromPrevious < 0 ? "negative" : ""}>
                              {row.daysFromPrevious > 0 ? "+" : ""}
                              {row.daysFromPrevious} days
                            </strong>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-analysis">
                <div aria-hidden="true">01 → 02</div>
                <h3>Paste a timeline to begin</h3>
                <p>The original milestone wording stays exactly as the customer wrote it.</p>
              </div>
            )}

            {analysis.unmatched.length ? (
              <div className="unmatched-note">
                <strong>{analysis.unmatched.length} line{analysis.unmatched.length > 1 ? "s" : ""} need review</strong>
                <span>No recognizable date was found.</span>
              </div>
            ) : null}
          </section>
        </section>
      ) : null}

      <footer className="page-footer">
        <span>ReadyByDate.com · Timeline and date planning made simple.</span>
        <span>Dates are calculated locally in your browser.</span>
      </footer>

      {copyState ? <div className="toast" role="status">{copyState}</div> : null}
    </main>
  );
}
