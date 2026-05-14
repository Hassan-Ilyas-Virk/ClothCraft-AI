/**
 * config.js — Shared runtime configuration.
 *
 * VITE_API_URL is injected at build time via Vite's import.meta.env mechanism.
 * Set it in frontend/.env (or frontend/.env.local) to point at a remote server
 * or ngrok tunnel; the default targets a local backend on port 5001.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5001';

/**
 * ngrok adds a browser-warning redirect for free-tier tunnels unless this
 * header is present. Including it on every AI fetch keeps the response a
 * clean binary/JSON blob rather than an HTML warning page.
 */
export const NGROK_HEADERS = { 'ngrok-skip-browser-warning': '1' };

export default API_BASE;
