import axios from "axios";

const CSRF_HEADER = "X-CSRF-Token";
const SAFE_METHODS = new Set(["get", "head", "options"]);
let csrfToken = "";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

const pendingGetRequests = new Map();
const getResponseCache = new Map();

export function setCsrfToken(token) {
  csrfToken = token ? String(token) : "";
}

function stableValue(value) {
  if (!value || typeof value !== "object") return value;
  if (value instanceof URLSearchParams) return Array.from(value.entries()).sort();
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function getKey(url, config = {}) {
  return JSON.stringify({
    url,
    params: stableValue(config.params),
    headers: stableValue(config.headers)
  });
}

export function clearApiCache(prefix = "") {
  for (const key of getResponseCache.keys()) {
    if (!prefix || key.includes(prefix)) getResponseCache.delete(key);
  }
}

export function cachedGet(url, config = {}) {
  const { cacheTtl = 8000, dedupe = true, ...requestConfig } = config;
  const key = getKey(url, requestConfig);
  const cached = getResponseCache.get(key);
  const now = Date.now();

  if (cacheTtl > 0 && cached && now - cached.timestamp < cacheTtl) {
    return Promise.resolve(cached.response);
  }
  if (dedupe && pendingGetRequests.has(key)) {
    return pendingGetRequests.get(key);
  }

  const request = api.get(url, requestConfig)
    .then(response => {
      if (cacheTtl > 0) {
        getResponseCache.set(key, { timestamp: Date.now(), response });
      }
      return response;
    })
    .finally(() => pendingGetRequests.delete(key));

  if (dedupe) pendingGetRequests.set(key, request);
  return request;
}

export function humanizeError(error) {
  if (!error) return "Unexpected error. Check your connection.";
  if (error.__humanizedMessage) return error.message;
  if (!error.response) return "Unexpected error. Check your connection.";

  const data = error.response.data;
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed && !trimmed.startsWith("<") ? trimmed : "Request failed. Please try again.";
  }
  if (data?.message) return data.message;
  if (data?.error) return data.error;
  if (error.response.status === 401) return "Please log in again.";
  if (error.response.status === 403) return "You do not have permission to perform this action.";
  if (error.response.status === 404) return "The requested resource was not found.";
  if (error.response.status >= 500) return "Server error. Please try again.";
  return "Request failed. Please try again.";
}

api.interceptors.request.use(config => {
  const method = String(config.method || "get").toLowerCase();
  if (!SAFE_METHODS.has(method) && csrfToken) {
    config.headers = config.headers || {};
    config.headers[CSRF_HEADER] = csrfToken;
  }
  return config;
});

api.interceptors.response.use(
  response => {
    setCsrfToken(response.headers?.["x-csrf-token"] || response.data?.csrf_token || csrfToken);
    const method = String(response.config?.method || "get").toLowerCase();
    if (!["get", "head", "options"].includes(method)) clearApiCache();
    return response;
  },
  error => {
    setCsrfToken(error.response?.headers?.["x-csrf-token"] || error.response?.data?.csrf_token || csrfToken);
    const normalized = new Error(humanizeError(error));
    normalized.__humanizedMessage = true;
    normalized.response = error.response;
    normalized.status = error.response?.status;
    normalized.originalError = error;
    return Promise.reject(normalized);
  }
);
