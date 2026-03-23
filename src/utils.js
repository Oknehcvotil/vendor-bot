function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSkipValue(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return (
    normalized === "-" ||
    normalized === "skip" ||
    normalized === "none" ||
    normalized === "no" ||
    normalized === "нет" ||
    normalized === "пропустить"
  );
}

function isValidEmail(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePhone(text) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (!value) {
    return "";
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 20) {
    return "";
  }
  if (!/^[+()\- 0-9]+$/.test(value)) {
    return "";
  }
  return value;
}

function userDisplayName(from) {
  const first = from.first_name || "";
  const last = from.last_name || "";
  return `${first} ${last}`.trim() || from.username || `User ${from.id}`;
}

module.exports = {
  escapeHtml,
  isSkipValue,
  isValidEmail,
  normalizePhone,
  userDisplayName,
};
