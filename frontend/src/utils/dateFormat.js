const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric"
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
});

function parseDate(value) {
  if (!value) return null;
  let normalized = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const hasTime = /[T\s]\d{2}:\d{2}/.test(trimmed);
    const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    normalized = hasTime && !hasTimezone ? `${trimmed}Z` : trimmed;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  const date = parseDate(value);
  if (!date) return "-";
  return `${shortDateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

export function formatDateShort(value) {
  const date = parseDate(value);
  if (!date) return "-";
  return shortDateFormatter.format(date);
}

export function timeAgo(value) {
  const date = parseDate(value);
  if (!date) return "";

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 30) return "Just now";
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return formatDateShort(value);
}
