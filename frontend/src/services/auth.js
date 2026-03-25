import { apiRequest } from './api';

/**
 * Register a new account and start an authenticated session.
 */
export async function signup(email, password, displayName) {
  return apiRequest('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
}

/**
 * Sign in with email + password.
 */
export async function login(email, password) {
  return apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/** Remove the current session. */
export async function logout() {
  await apiRequest('/auth/logout', { method: 'POST' });
}

/** Returns current authenticated user or null if not signed in. */
export async function getUser() {
  try {
    return await apiRequest('/auth/me');
  } catch {
    return null;
  }
}

/** @returns {boolean} */
export async function isAuthenticated() {
  const user = await getUser();
  return !!user;
}
