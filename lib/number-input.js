export function normalizeWholeNumberDraft(value, maximum = 999) {
  if (value === "") return "";
  if (!/^\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return String(Math.min(maximum, Math.max(0, Math.round(parsed))));
}
