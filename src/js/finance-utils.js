export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function transactionDate(transaction) {
  return toDate(transaction.date) || toDate(transaction.createdAt);
}

export function isSameMonth(date, reference = new Date()) {
  const value = toDate(date);
  return Boolean(value && value.getFullYear() === reference.getFullYear() && value.getMonth() === reference.getMonth());
}

export function isPreviousMonth(date, reference = new Date()) {
  const value = toDate(date);
  if (!value) return false;
  const previous = new Date(reference.getFullYear(), reference.getMonth() - 1, 1);
  return value.getFullYear() === previous.getFullYear() && value.getMonth() === previous.getMonth();
}

export function startOfDay(date = new Date()) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function nextOccurrence(schedule, from = new Date()) {
  const start = toDate(schedule.startDate) || toDate(schedule.nextDate);
  if (!start) return null;

  const candidate = new Date(start);
  const reference = startOfDay(from);
  while (candidate < reference) {
    if (schedule.frequency === "weekly") candidate.setDate(candidate.getDate() + 7);
    else if (schedule.frequency === "yearly") candidate.setFullYear(candidate.getFullYear() + 1);
    else candidate.setMonth(candidate.getMonth() + 1);
  }
  return candidate;
}

export function getUpcomingSchedules(schedules, days = 30, from = new Date()) {
  const start = startOfDay(from);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  return schedules
    .filter((schedule) => schedule.active !== false)
    .map((schedule) => ({ ...schedule, occurrence: nextOccurrence(schedule, start) }))
    .filter((schedule) => schedule.occurrence && schedule.occurrence <= end)
    .sort((first, second) => first.occurrence - second.occurrence);
}

export function calculateSafeToSpend(balance, schedules, days = 30) {
  const upcomingExpenses = getUpcomingSchedules(schedules, days)
    .filter((schedule) => schedule.type === "expense")
    .reduce((total, schedule) => total + (Number(schedule.amount) || 0), 0);
  return {
    upcomingExpenses,
    safeToSpend: balance - upcomingExpenses
  };
}

export function formatMMK(amount) {
  return `${Math.round(Number(amount) || 0).toLocaleString()} MMK`;
}
