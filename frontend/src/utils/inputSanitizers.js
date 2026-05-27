export function digitsOnly(value, maxLength) {
  const digits = String(value || "").replace(/\D/g, "");
  return maxLength ? digits.slice(0, maxLength) : digits;
}

export function integerInput(value, maxDigits = 6) {
  return digitsOnly(value, maxDigits);
}

export function decimalInput(value, maxDigits = 5, decimalPlaces = 2) {
  const text = String(value || "").replace(/[^\d.]/g, "");
  const [rawWhole = "", ...rest] = text.split(".");
  const whole = rawWhole.slice(0, maxDigits);
  if (rest.length === 0) return whole;
  const decimals = rest.join("").replace(/\./g, "").slice(0, decimalPlaces);
  return `${whole}.${decimals}`;
}

export function clampInteger(value, min, max, fallback = min) {
  const parsed = Number.parseInt(digitsOnly(value), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
