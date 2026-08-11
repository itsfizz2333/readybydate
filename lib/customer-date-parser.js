const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_NAME =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec";
const NAME_SEPARATOR = String.raw`(?:\s+|\s*[-/.]\s*)`;
const YEAR_SEPARATOR = String.raw`(?:,?\s+|\s*[-/.]\s*)`;

const YEAR_FIRST_NUMERIC = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const YEAR_FIRST_NAMED = new RegExp(
  String.raw`\b(20\d{2})${NAME_SEPARATOR}(${MONTH_NAME})\.?${NAME_SEPARATOR}(\d{1,2})(?:st|nd|rd|th)?\b`,
  "i",
);
const MONTH_FIRST_NAMED = new RegExp(
  String.raw`\b(${MONTH_NAME})\.?${NAME_SEPARATOR}(\d{1,2})(?:st|nd|rd|th)?(?:${YEAR_SEPARATOR}'?(\d{2,4}))?\b`,
  "i",
);
const DAY_FIRST_NAMED = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?${NAME_SEPARATOR}(${MONTH_NAME})\.?(?:${YEAR_SEPARATOR}'?(\d{2,4}))?\b`,
  "i",
);
const SHORT_NUMERIC = /\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/;

function normalizeYear(value) {
  const parsed = Number(value);
  return parsed < 100 ? 2000 + parsed : parsed;
}

/**
 * Finds the first recognizable date in a timeline row.
 * Dates without a year inherit the current timeline year. Ambiguous numeric
 * dates remain US-first (8/11 = Aug 11), matching the product's default.
 *
 * @param {string} line
 * @param {number} defaultYear
 * @param {Date | null} previousDate
 */
export function parseCustomerDate(line, defaultYear, previousDate) {
  let match = line.match(YEAR_FIRST_NUMERIC);
  let year;
  let month;
  let day;
  let format = "";
  let assumedUS = false;
  let inferredYear = false;

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]) - 1;
    day = Number(match[3]);
    format = "Year first";
  } else {
    match = line.match(YEAR_FIRST_NAMED);
    if (match) {
      year = Number(match[1]);
      month = MONTHS[match[2].toLowerCase()] ?? -1;
      day = Number(match[3]);
      format = "Year first";
    } else {
      match = line.match(MONTH_FIRST_NAMED);
      if (match) {
        month = MONTHS[match[1].toLowerCase()] ?? -1;
        day = Number(match[2]);
        year = match[3]
          ? normalizeYear(match[3])
          : (previousDate?.getUTCFullYear() ?? defaultYear);
        inferredYear = !match[3];
        format = "Month name first";
      } else {
        match = line.match(DAY_FIRST_NAMED);
        if (match) {
          day = Number(match[1]);
          month = MONTHS[match[2].toLowerCase()] ?? -1;
          year = match[3]
            ? normalizeYear(match[3])
            : (previousDate?.getUTCFullYear() ?? defaultYear);
          inferredYear = !match[3];
          format = "Day first";
        } else {
          match = line.match(SHORT_NUMERIC);
          if (!match) return null;

          const first = Number(match[1]);
          const second = Number(match[2]);
          if (first > 12 && second <= 12) {
            day = first;
            month = second - 1;
            format = "DD/MM";
          } else {
            month = first - 1;
            day = second;
            format = "US MM/DD";
            assumedUS = first <= 12 && second <= 12;
          }

          year = match[3]
            ? normalizeYear(match[3])
            : (previousDate?.getUTCFullYear() ?? defaultYear);
          inferredYear = !match[3];
        }
      }
    }
  }

  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  let date = new Date(Date.UTC(year, month, day));
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;

  if (
    inferredYear &&
    previousDate &&
    previousDate.getUTCMonth() >= 9 &&
    month <= 2 &&
    date.getTime() < previousDate.getTime()
  ) {
    year = previousDate.getUTCFullYear() + 1;
    date = new Date(Date.UTC(year, month, day));
  }

  return {
    date,
    matched: match[0],
    format,
    assumedUS,
    inferredYear,
  };
}
