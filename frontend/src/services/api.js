import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json"
  }
});

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

api.interceptors.response.use(
  response => response,
  error => {
    const normalized = new Error(humanizeError(error));
    normalized.__humanizedMessage = true;
    normalized.response = error.response;
    normalized.status = error.response?.status;
    normalized.originalError = error;
    return Promise.reject(normalized);
  }
);
