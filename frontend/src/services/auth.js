/**
 * auth.js — Authentication service.
 *
 * All functions here communicate with the /auth/* backend routes.
 * The JWT returned on login/signup is persisted via tokenStore so that
 * subsequent calls to apiRequest() automatically include it as a Bearer token.
 */
import { apiRequest, tokenStore } from './api';

/**
 * Create a new account and immediately sign in.
 * Stores the returned JWT so the user is authenticated for subsequent requests.
 */
export async function signup(email, password, displayName) {
  const data = await apiRequest('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
  if (data?.token) tokenStore.set(data.token);
  return data?.user ?? data;
}

/**
 * Authenticate with email + password.
 * Stores the returned JWT on success.
 */
export async function login(email, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data?.token) tokenStore.set(data.token);
  return data?.user ?? data;
}

/**
 * Sign out the current user.
 * The token is removed from localStorage first so that even if the server
 * request fails, the client is logged out immediately.
 */
export async function logout() {
  tokenStore.clear();
  // The backend endpoint clears the auth cookie; failure is non-fatal.
  await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
}

/**
 * Fetch the currently authenticated user's profile.
 * Returns null (and clears the stored token) if the token is missing or invalid.
 * Used on app startup to restore session state without redirecting to login.
 */
export async function getUser() {
  if (!tokenStore.get()) return null;
  try {
    return await apiRequest('/auth/me');
  } catch {
    // Token may be expired or revoked — discard it to force re-login.
    tokenStore.clear();
    return null;
  }
}

/** Returns true if the stored token represents a valid, live session. */
export async function isAuthenticated() {
  const user = await getUser();
  return !!user;
}

/**
 * Update the current user's display name and/or avatar.
 * Only fields that are explicitly provided (non-undefined) are sent.
 */
export async function updateProfile({ displayName, avatarUrl }) {
  const body = {};
  if (displayName !== undefined) body.displayName = displayName;
  if (avatarUrl !== undefined) body.avatarUrl = avatarUrl;
  return await apiRequest('/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * Change the current user's password.
 * Requires the existing password as confirmation before accepting the new one.
 */
export async function changePassword({ currentPassword, newPassword }) {
  return await apiRequest('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
