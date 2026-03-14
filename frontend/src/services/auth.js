/**
 * Authentication service — localStorage-based demo auth.
 * UI components call these functions; no auth logic lives in components.
 */

const SESSION_KEY = 'cc_session';
const USERS_KEY   = 'cc_users';

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
}

function setUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

/**
 * Register a new account.
 * @returns {object} user object (no password)
 * @throws if email already taken
 */
export function signup(email, password, displayName) {
  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('An account with this email already exists.');
  }
  const user = {
    id: `user-${Date.now()}`,
    email: email.toLowerCase().trim(),
    displayName: displayName.trim() || email.split('@')[0],
    createdAt: Date.now(),
  };
  // NOTE: storing plaintext password is only acceptable for a local demo.
  setUsers([...users, { ...user, password }]);
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

/**
 * Sign in with email + password.
 * @returns {object} user object (no password)
 * @throws if credentials are wrong
 */
export function login(email, password) {
  const users = getUsers();
  const match = users.find(
    u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password
  );
  if (!match) throw new Error('Incorrect email or password.');
  const { password: _, ...user } = match;
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

/** Remove the current session. */
export function logout() {
  localStorage.removeItem(SESSION_KEY);
}

/** @returns {object|null} current user or null */
export function getUser() {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** @returns {boolean} */
export function isAuthenticated() {
  return !!getUser();
}
