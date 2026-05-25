/**
 * api.js — Base HTTP layer for all backend communication.
 *
 * Responsibilities:
 *  1. Store the JWT access token in localStorage under a fixed key.
 *  2. Attach the token as a Bearer header on every request.
 *  3. Parse JSON responses and convert non-2xx HTTP statuses into thrown Errors,
 *     extracting the human-readable message from the FastAPI error shape
 *     ({ detail: string | [{msg}] }).
 */
const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5001';

/** Key used to persist the JWT in localStorage across page refreshes. */
const TOKEN_KEY = 'cc_auth_token';

/**
 * Thin wrapper around localStorage that keeps token access centralised.
 * All other modules should read/write the token exclusively through this object.
 */
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * Read the response body as text and parse it as JSON.
 * Returns null for empty bodies (e.g. 204 No Content) rather than throwing.
 */
async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid server response');
  }
}

/**
 * Authenticated JSON request helper used by all service modules.
 *
 * @param {string} path    - Path relative to API_BASE_URL (e.g. '/auth/login')
 * @param {object} options - fetch() options (method, body, headers, etc.)
 * @returns {Promise<any>} - Parsed JSON payload, or null for empty responses
 * @throws {Error}         - Human-readable message extracted from FastAPI error shape
 */
export async function apiRequest(path, options = {}) {
  const token = tokenStore.get();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      // Required to bypass ngrok's browser-warning redirect page on free tunnels.
      'ngrok-skip-browser-warning': '1',
      // Attach the JWT only when we actually have one (avoids sending "Bearer null").
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    // FastAPI returns validation errors as { detail: [{ msg, loc, type }] }
    // and business logic errors as { detail: "string" }.
    let message = 'Request failed';
    if (Array.isArray(payload?.detail)) {
      message = payload.detail.map(err => err.msg).join(', ');
    } else if (payload?.detail) {
      message = payload.detail;
    } else if (payload?.message) {
      message = payload.message;
    }
    throw new Error(message);
  }

  return payload;
}

export { API_BASE_URL };
