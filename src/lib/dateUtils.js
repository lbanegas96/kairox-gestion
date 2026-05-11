// Helper utility to enforce America/Argentina/Buenos_Aires timezone (UTC-3)
// This shifts the time so that the UTC timestamp visually matches Argentina time.
// This allows simple storage in DBs that expect ISO strings, effectively treating them as "Local Argentina Time".

export const getNowAR = () => {
  const d = new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  // Argentina is UTC-3
  return new Date(utc + (3600000 * -3));
};

export const getTodayAR = () => {
  return getNowAR().toISOString().split('T')[0];
};

export const getStartOfDayAR = (date) => {
  // Returns ISO string for 00:00:00.000 of the given date (treating date as AR time)
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
};

export const getEndOfDayAR = (date) => {
  // Returns ISO string for 23:59:59.999 of the given date
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)).toISOString();
};

export const getDateFromInputAR = (dateString) => {
  // Converts YYYY-MM-DD string to ISO string at 12:00 PM AR time to avoid boundary issues
  if (!dateString) return getNowAR().toISOString();
  const [y, m, d] = dateString.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).toISOString();
};