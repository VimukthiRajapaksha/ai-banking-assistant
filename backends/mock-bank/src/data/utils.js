/** Dates are computed at runtime, never hard-coded.
 *
 * Fixed dates rot: a transaction list frozen in the past stops looking like
 * recent activity, and "last 10 transactions" stops being a meaningful
 * question. Deriving them from today keeps the data sensible whenever it runs.
 */

/** Today, as YYYY-MM-DD. */
export const today = () => new Date().toISOString().split('T')[0];

/** `days` before today, as YYYY-MM-DD. */
export const daysAgo = (days) =>
  new Date(new Date().setDate(new Date().getDate() - days)).toISOString().split('T')[0];

/** Now, as a full ISO timestamp. */
export const now = () => new Date().toISOString();
