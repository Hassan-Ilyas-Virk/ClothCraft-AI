const inferredBaseUrl = `${window.location.protocol}//${window.location.hostname}:5001`;
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || inferredBaseUrl;

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
