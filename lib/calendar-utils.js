const DAY_MS = 86_400_000;

function pad(value) {
  return String(value).padStart(2, "0");
}

function toIso(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function listUtcMonths(startDate, endDate) {
  const startIndex = startDate.getUTCFullYear() * 12 + startDate.getUTCMonth();
  const endIndex = endDate.getUTCFullYear() * 12 + endDate.getUTCMonth();
  const firstIndex = Math.min(startIndex, endIndex);
  const lastIndex = Math.max(startIndex, endIndex);

  return Array.from({ length: lastIndex - firstIndex + 1 }, (_, offset) => {
    const index = firstIndex + offset;
    const year = Math.floor(index / 12);
    const month = index % 12;
    return { key: `${year}-${pad(month + 1)}`, year, month };
  });
}

export function buildUtcMonthCells(year, month) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const leadingDays = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cellCount = Math.max(35, Math.ceil((leadingDays + daysInMonth) / 7) * 7);
  const gridStart = new Date(firstDay.getTime() - leadingDays * DAY_MS);

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(gridStart.getTime() + index * DAY_MS);
    return {
      iso: toIso(date),
      date,
      dayNumber: date.getUTCDate(),
      isCurrentMonth:
        date.getUTCFullYear() === year && date.getUTCMonth() === month,
      isWeekend: date.getUTCDay() === 0 || date.getUTCDay() === 6,
    };
  });
}

export function buildUtcRangeSegments(cells, ranges) {
  const segments = [];
  const weekCount = Math.ceil(cells.length / 7);

  for (const range of ranges) {
    const rangeStart = range.startDate.getTime();
    const rangeEnd = range.endDate.getTime();
    if (rangeEnd < rangeStart) continue;
    let visibleSegmentIndex = 0;

    for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
      const week = cells.slice(weekIndex * 7, weekIndex * 7 + 7);
      const activeColumns = week
        .map((cell, columnIndex) => ({ cell, columnIndex }))
        .filter(({ cell }) => {
          const value = cell.date.getTime();
          return cell.isCurrentMonth && value >= rangeStart && value <= rangeEnd;
        });

      if (!activeColumns.length) continue;

      const first = activeColumns[0];
      const last = activeColumns[activeColumns.length - 1];
      segments.push({
        ...range,
        segmentId: `${range.id}-week-${weekIndex + 1}`,
        week: weekIndex + 1,
        startColumn: first.columnIndex + 1,
        endColumn: last.columnIndex + 1,
        isFirstVisibleSegment: visibleSegmentIndex === 0,
        startsRange: first.cell.date.getTime() === rangeStart,
        endsRange: last.cell.date.getTime() === rangeEnd,
      });
      visibleSegmentIndex += 1;
    }
  }

  return segments;
}
