// Argentina timezone helpers (UTC-3, no DST)
//
// DESIGN: Timestamps are stored as "Argentina-local-as-UTC" — the epoch value
// is shifted so that getUTC*() methods read as Argentina local time.
// Example: Argentina 23:00 on May 30 is stored as "2026-05-30T23:00:00Z"
// (real UTC would be "2026-05-31T02:00:00Z").
//
// This means:
//   - getNowAR()        → subtract exactly 3h from UTC epoch (timezone-safe, no browser dependency)
//   - getStartOfDayAR() → use getUTC* methods, set to 00:00 of that AR date
//   - formatDateAR()    → read getUTC* parts directly, never use toLocaleDateString()

// Returns a Date where .getUTC*() gives Argentina local time (UTC - 3h).
export const getNowAR = () => {
  return new Date(new Date().getTime() - (3 * 3600000));
};

// Returns YYYY-MM-DD string for today in Argentina time.
export const getTodayAR = () => {
  return getNowAR().toISOString().split('T')[0];
};

// Formats a stored ISO string as "dd/mm/yyyy" (Argentina local date).
export const formatDateAR = (isoStr) => {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year  = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

// Formats a stored ISO string as "dd/mm/yyyy HH:MM" (Argentina local datetime).
export const formatDateTimeAR = (isoStr) => {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const day   = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year  = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
};

// Returns ISO string for 00:00:00.000 of the given Date's UTC date (= AR day start).
export const getStartOfDayAR = (date) => {
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0
  )).toISOString();
};

// Returns ISO string for 23:59:59.999 of the given Date's UTC date (= AR day end).
export const getEndOfDayAR = (date) => {
  return new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999
  )).toISOString();
};

// Converts YYYY-MM-DD input string to ISO at 12:00 AR time to avoid boundary issues.
export const getDateFromInputAR = (dateString) => {
  if (!dateString) return getNowAR().toISOString();
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).toISOString();
};
