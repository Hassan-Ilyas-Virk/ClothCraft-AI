const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5001';

const TOKEN_KEY = 'cc_auth_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid server response');
  }
}

export async function apiRequest(path, options = {}) {
  const token = tokenStore.get();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
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
