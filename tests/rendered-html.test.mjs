import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildUtcMonthCells,
  buildUtcRangeSegments,
  listUtcMonths,
} from "../lib/calendar-utils.js";
import { parseCustomerDate } from "../lib/customer-date-parser.js";
import { normalizeWholeNumberDraft } from "../lib/number-input.js";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the production timeline calculator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>ReadyByDate\.com \| Production Timeline Calculator<\/title>/i,
  );
  assert.match(html, /From one date to a full production plan/);
  assert.match(html, /ReadyByDate<em>\.com<\/em>/);
  assert.match(html, /Build timeline/);
  assert.match(html, /Add days/);
  assert.match(html, /Analyze dates/);
  assert.match(html, /Timeline steps &amp; lead times/);
  assert.match(html, /Timeline view/);
  assert.match(html, /Calendar view/);
  assert.match(html, /Production steps/);
  assert.match(html, /Shipping options/);
  assert.match(html, /3<!-- --> selected/);
  assert.match(html, /Estimated in-hands dates/);
  assert.match(html, /Mar 13, 2000/);
  assert.match(html, /Apr 4, 2000/);
  assert.match(html, /Apr 24, 2000/);
  assert.match(html, /Estimated in-hands dates/);
  assert.match(html, /Sample round 1 started/);
  assert.match(html, /PO received &amp; final sample approved/);
  assert.match(html, /Air freight/);
  assert.match(html, /readybydate-icon-v2\.png/);
  assert.match(html, /readybydate-brand-v1\.png/);
  assert.doesNotMatch(html, /Schedule buffer|Advanced lead times|Recommended finish/i);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});

test("ships product state, date rules, and social metadata without starter assets", async () => {
  const [page, layout, packageJson, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /type ActiveTab = "build" \| "date" \| "analyze"/);
  assert.match(page, /type ResultView = "timeline" \| "calendar"/);
  assert.match(page, /listUtcMonths\(timeline\.start, timeline\.latestInHands\)/);
  assert.match(page, /eventsByDate = new Map<string, CalendarEvent\[\]>/);
  assert.match(page, /activeCalendarMonthIndex \+ 2/);
  assert.match(page, /Weekend extension/);
  assert.match(page, /calendar-event-\$\{event\.tone\}/);
  assert.match(page, /buildUtcRangeSegments/);
  assert.match(page, /Bands cover the calendar days after one milestone/);
  assert.match(page, /shipping-phase-\$\{result\.id\}/);
  assert.match(page, /Weekend \+\$\{item\.adjustmentDays\}d/);
  assert.match(page, /selectedCalendarPhaseId/);
  assert.match(page, /Shipping lead-time band/);
  assert.match(page, /isStart: item\.id === "project-start"/);
  assert.match(page, /selectedCalendarEvent\.isStart/);
  assert.match(page, /id="calendar-event-detail"[\s\S]*tabIndex=\{-1\}/);
  assert.match(page, /dateCalcStart/);
  assert.match(page, /dateCalcDays/);
  assert.match(page, /dateCalcDaysInput === "" \? 0/);
  assert.match(page, /normalizeWholeNumberDraft\(value, 999\)/);
  assert.match(page, /id="date-calculator-days"[\s\S]*type="text"[\s\S]*inputMode="numeric"/);
  assert.match(page, /placeholder="0"/);
  assert.match(page, /if \(dateCalcDaysInput === ""\) setDateCalcDaysInput\("0"\)/);
  assert.match(page, /dateCalcPreset/);
  assert.match(page, /addDays\(dateCalcBaseDate, dateCalcDays\)/);
  assert.match(page, /Add calendar days/);
  assert.match(page, /Start date not counted · Weekends are not adjusted/);
  assert.match(page, /copyDateCalculation/);
  assert.match(page, /production-timeline-calculator:v3/);
  assert.match(page, /LEGACY_V2_STORAGE_KEY/);
  assert.match(page, /LEGACY_V1_STORAGE_KEY/);
  assert.match(page, /adjustToWeekday/);
  assert.match(page, /sampleRounds/);
  assert.match(page, /photoApproval/);
  assert.match(page, /productionStages/);
  assert.match(page, /addProductionStage/);
  assert.match(page, /removeProductionStage/);
  assert.match(page, /moveProductionStage/);
  assert.match(page, /selectedShippingMethods/);
  assert.match(page, /shippingLeadDays/);
  assert.match(page, /shippingResults/);
  assert.match(
    page,
    /Sample round \$\{round\} approved; sample round \$\{round \+ 1\} started/,
  );
  assert.match(page, /Fast sea freight/);
  assert.match(page, /Standard sea freight/);
  assert.match(page, /window\.localStorage/);
  assert.match(page, /Restored from this device/);
  assert.match(page, /setProductionStages\(parsed\.productionStages/);
  assert.match(page, /storedName \|\| "Untitled production step"/);
  assert.doesNotMatch(page, /restoreLastCalculation|>\s*Resume\s*</);
  assert.match(page, /navigator\.clipboard/);
  const copyTimelineSource = page.slice(
    page.indexOf("const copyTimeline"),
    page.indexOf("const exportTimeline"),
  );
  assert.match(
    copyTimelineSource,
    /`\$\{formatDate\(item\.finalDate, false\)\}: \$\{item\.title\}`/,
  );
  assert.match(copyTimelineSource, /timeline\.shippingResults/);
  assert.match(copyTimelineSource, /Estimated in-hands dates/);
  assert.doesNotMatch(copyTimelineSource, /Milestone|Lead time|Notes|adjustmentDays/);
  const exportTimelineSource = page.slice(
    page.indexOf("const exportTimeline"),
    page.indexOf("const copyAnalysis"),
  );
  assert.match(exportTimelineSource, /Shipping option/);
  assert.match(exportTimelineSource, /timeline\.shippingBaseDate/);
  assert.doesNotMatch(page, /bufferPreset|customBuffer|schedule-buffer/i);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /ReadyByDate\.com/);
  assert.match(css, /stage-editor-row/);
  assert.match(css, /shipping-options/);
  assert.match(css, /date-calculator-grid/);
  assert.match(css, /quick-date-presets/);
  assert.match(css, /date-calculation-path/);
  assert.match(css, /calendar-months/);
  assert.match(css, /calendar-day\.is-weekend/);
  assert.match(css, /calendar-event-air/);
  assert.match(css, /calendar-event-fast-sea/);
  assert.match(css, /calendar-event-standard-sea/);
  assert.match(css, /calendar-week-bands/);
  assert.match(css, /calendar-phase-segment/);
  assert.match(css, /calendar-event-adjustment/);
  assert.match(css, /calendar-month\.mobile-active/);
  assert.match(css, /@media \(max-width: 780px\)/);
  assert.match(css, /readybydate-icon-v2\.png/);
  assert.doesNotMatch(css, /background-image:\s*url\("\/readybydate-brand-v1\.png"\)/);
  assert.match(css, /--green: #08b874/);
  assert.match(css, /Readable type scale/);
  assert.match(css, /\.timeline-content h3\s*\{\s*font-size: 15px;/);
  assert.match(css, /\.stage-name-input,[\s\S]*font-size: 16px;/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);

  await access(new URL("../public/readybydate-icon-v2.png", import.meta.url));
  await access(new URL("../public/readybydate-brand-v1.png", import.meta.url));
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});

test("replaces the zero fallback on the next add-days input", () => {
  assert.equal(normalizeWholeNumberDraft("", 999), "");
  assert.equal(normalizeWholeNumberDraft("4", 999), "4");
  assert.equal(normalizeWholeNumberDraft("45", 999), "45");
  assert.equal(normalizeWholeNumberDraft("0045", 999), "45");
  assert.equal(normalizeWholeNumberDraft("1000", 999), "999");
  assert.equal(normalizeWholeNumberDraft("-8", 999), null);
  assert.equal(normalizeWholeNumberDraft("4.5", 999), null);
  assert.equal(normalizeWholeNumberDraft("abc", 999), null);
});

test("builds continuous UTC calendar months and weekend-aware month grids", () => {
  const months = listUtcMonths(
    new Date(Date.UTC(2026, 11, 28)),
    new Date(Date.UTC(2027, 1, 5)),
  );

  assert.deepEqual(
    months.map((month) => month.key),
    ["2026-12", "2027-01", "2027-02"],
  );

  const leapFebruary = buildUtcMonthCells(2028, 1);
  assert.equal(
    leapFebruary.filter((cell) => cell.isCurrentMonth).length,
    29,
  );
  assert.ok([35, 42].includes(leapFebruary.length));
  assert.equal(leapFebruary[0].date.getUTCDay(), 0);
  assert.equal(leapFebruary[6].date.getUTCDay(), 6);
  assert.equal(leapFebruary[0].isWeekend, true);
  assert.equal(leapFebruary[6].isWeekend, true);

  const august = buildUtcMonthCells(2026, 7);
  assert.equal(august.length, 42);
  assert.equal(august[0].iso, "2026-07-26");
  assert.equal(august.at(-1).iso, "2026-09-05");
});

test("clips connected lead-time bands into UTC calendar weeks", () => {
  const augustCells = buildUtcMonthCells(2026, 7);
  const septemberCells = buildUtcMonthCells(2026, 8);
  const range = {
    id: "cross-month",
    label: "Bulk production",
    startDate: new Date(Date.UTC(2026, 7, 30)),
    endDate: new Date(Date.UTC(2026, 8, 2)),
    lane: 0,
    durationDays: 4,
  };

  const augustSegments = buildUtcRangeSegments(augustCells, [range]);
  const septemberSegments = buildUtcRangeSegments(septemberCells, [range]);

  assert.equal(augustSegments.length, 1);
  assert.equal(augustSegments[0].startColumn, 1);
  assert.equal(augustSegments[0].endColumn, 2);
  assert.equal(augustSegments[0].startsRange, true);
  assert.equal(augustSegments[0].endsRange, false);
  assert.equal(augustSegments[0].isFirstVisibleSegment, true);

  assert.equal(septemberSegments.length, 1);
  assert.equal(septemberSegments[0].startColumn, 3);
  assert.equal(septemberSegments[0].endColumn, 4);
  assert.equal(septemberSegments[0].startsRange, false);
  assert.equal(septemberSegments[0].endsRange, true);

  const oneDay = buildUtcRangeSegments(augustCells, [
    {
      ...range,
      id: "one-day",
      startDate: new Date(Date.UTC(2026, 7, 12)),
      endDate: new Date(Date.UTC(2026, 7, 12)),
    },
  ]);
  assert.equal(oneDay.length, 1);
  assert.equal(oneDay[0].startColumn, oneDay[0].endColumn);
  assert.equal(oneDay[0].startsRange, true);
  assert.equal(oneDay[0].endsRange, true);

  const empty = buildUtcRangeSegments(augustCells, [
    {
      ...range,
      id: "invalid",
      startDate: new Date(Date.UTC(2026, 7, 13)),
      endDate: new Date(Date.UTC(2026, 7, 12)),
    },
  ]);
  assert.deepEqual(empty, []);
});

test("recognizes common customer date formats without requiring reformatting", () => {
  const cases = [
    ["Ready 8/11", "2026-08-11"],
    ["Ready Aug 11", "2026-08-11"],
    ["Ready 11 Aug 2026", "2026-08-11"],
    ["Ready 14-Aug", "2026-08-14"],
    ["Ready Aug-14-26", "2026-08-14"],
    ["Ready 14/Aug/2026", "2026-08-14"],
    ["Ready 2026-08-14", "2026-08-14"],
    ["Ready 2026.Aug.14", "2026-08-14"],
  ];

  for (const [line, expected] of cases) {
    const parsed = parseCustomerDate(line, 2026, null);
    assert.ok(parsed, `Expected a date in: ${line}`);
    assert.equal(parsed.date.toISOString().slice(0, 10), expected);
  }
});

test("parses the reported timeline and keeps inferred years across New Year", () => {
  const lines = [
    "Sample approved & Order confirmation: 14-Aug",
    "Order Material: 15-Aug",
    "Material Ready: 30-Aug",
    "Pre-production Sample Sent from Factory: 31-Aug",
    "Pre-production Sample Approved: 7-Sep",
    "Start Production: 8-Sep",
    "Finish Production: 13-Oct",
    "QC Inspection: 14-Oct",
    "Ex-factory: 15-Oct",
  ];
  let previous = null;
  const parsedDates = lines.map((line) => {
    const parsed = parseCustomerDate(line, 2026, previous);
    assert.ok(parsed, `Expected a date in: ${line}`);
    previous = parsed.date;
    return parsed.date.toISOString().slice(0, 10);
  });

  assert.deepEqual(parsedDates, [
    "2026-08-14",
    "2026-08-15",
    "2026-08-30",
    "2026-08-31",
    "2026-09-07",
    "2026-09-08",
    "2026-10-13",
    "2026-10-14",
    "2026-10-15",
  ]);

  const dec = parseCustomerDate("Ready 28-Dec", 2026, null);
  assert.ok(dec);
  const jan = parseCustomerDate("Approved 5-Jan", 2026, dec.date);
  assert.ok(jan);
  const feb = parseCustomerDate("Production 5-Feb", 2026, jan.date);
  assert.ok(feb);
  assert.equal(dec.date.toISOString().slice(0, 10), "2026-12-28");
  assert.equal(jan.date.toISOString().slice(0, 10), "2027-01-05");
  assert.equal(feb.date.toISOString().slice(0, 10), "2027-02-05");
  assert.equal(parseCustomerDate("Impossible 31-Feb", 2026, null), null);
});
