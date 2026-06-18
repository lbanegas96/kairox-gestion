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

// Formats a stored ISO string as "HH:MM" (Argentina local time).
export const formatTimeAR = (isoStr) => {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins  = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
};

// Formats a stored ISO string using toLocaleDateString with AR-safe offset.
// Since dates are stored as AR-local-as-UTC, we read UTC parts.
export const formatDateLocaleAR = (isoStr, options = {}) => {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  const defaultOpts = { day: '2-digit', month: '2-digit', year: 'numeric', ...options };
  // Build a date from UTC parts to avoid browser timezone shift
  const local = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
                         d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  return local.toLocaleDateString('es-AR', defaultOpts);
};

// Adds N days to a stored ISO string/Date and returns a YYYY-MM-DD date string
// (Argentina-local date, read via UTC parts per the convention above).
export const addDaysAR = (isoStrOrDate, days) => {
  const d = new Date(isoStrOrDate);
  const result = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + Number(days || 0)
  ));
  return result.toISOString().split('T')[0];
};

// Converts YYYY-MM-DD input string to ISO.
// - Si la fecha es HOY (en AR) → usa la hora actual (operación en tiempo real).
// - Si es otro día (pasado o futuro) → fija 12:00 para evitar boundary issues
//   entre zonas horarias y mostrar una hora "neutra" en el listado.
export const getDateFromInputAR = (dateString) => {
  if (!dateString) return getNowAR().toISOString();
  if (dateString === getTodayAR()) return getNowAR().toISOString();
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).toISOString();
};
