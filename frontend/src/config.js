const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:5001';

export const NGROK_HEADERS = { 'ngrok-skip-browser-warning': '1' };

export default API_BASE;
