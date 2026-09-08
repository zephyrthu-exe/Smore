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
