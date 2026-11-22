// Announced badges often have no dates yet, only a month in the text ("… during December 2026").
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** First day of the announced month (UTC ms), or NaN */
export function plannedMonth(b) {
  const m = String(b?.description || "").match(/\b(?:during|in|from|starting)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d\d)\b/i);
  return m ? Date.UTC(Number(m[2]), MONTHS.indexOf(m[1].toLowerCase()), 1) : NaN;
}

/** "Dec 2026" */
export const plannedLabel = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
