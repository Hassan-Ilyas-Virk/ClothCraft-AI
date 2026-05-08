import { apiRequest, tokenStore } from './api';

export async function signup(email, password, displayName) {
  const data = await apiRequest('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });
  if (data?.token) tokenStore.set(data.token);
  return data?.user ?? data;
}

export async function login(email, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data?.token) tokenStore.set(data.token);
  return data?.user ?? data;
}

export async function logout() {
  tokenStore.clear();
  await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
}

export async function getUser() {
  if (!tokenStore.get()) return null;
  try {
    return await apiRequest('/auth/me');
  } catch {
    tokenStore.clear();
    return null;
  }
}

export async function isAuthenticated() {
  const user = await getUser();
  return !!user;
}
