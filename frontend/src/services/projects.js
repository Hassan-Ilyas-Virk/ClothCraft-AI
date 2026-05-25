/**
 * projects.js — Project persistence service.
 *
 * Wraps all /projects/* backend endpoints. Every function is async and
 * throws on non-2xx responses (propagated from apiRequest).
 *
 * Note on list vs item endpoints:
 *   GET /projects        — returns project summaries WITHOUT layersSnapshot.
 *                          Used by the home page grid for fast loading.
 *   GET /projects/item/:id — returns the FULL project including layersSnapshot.
 *                          Used when actually opening a project to the canvas.
 */
import { apiRequest } from './api';

/** Get all projects for current authenticated user, newest first. */
export async function getProjects() {
  return apiRequest('/projects');
}

/** Get a single project by id, including its full layersSnapshot. */
export async function getProject(projectId) {
  return apiRequest(`/projects/item/${projectId}`);
}

/** Create and persist a new empty project. Returns the project object. */
export async function createProject(name = 'Untitled Design') {
  return apiRequest('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/**
 * Persist the full project state to the backend.
 *
 * The layers array and canvas dimensions are serialised into a JSON string
 * called layersSnapshot. Storing this as a single JSON string in MongoDB
 * avoids schema migrations when the layer format evolves.
 *
 * @param {string} projectId
 * @param {{ name, thumbnail, layers, activeLayerId, canvasWidth, canvasHeight }} data
 * @returns {Promise<object>} Updated project document
 */
export async function saveProject(projectId, { name, thumbnail, layers, activeLayerId, canvasWidth, canvasHeight }) {
  // Serialise the entire canvas state into a single JSON string.
  // canvasWidth/Height default to 1024 if not provided, matching the canvas default.
  const snapshot = JSON.stringify({ layers, activeLayerId, canvasWidth: canvasWidth || 1024, canvasHeight: canvasHeight || 1024 });
  return apiRequest(`/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name,
      thumbnail: thumbnail || null,
      layersSnapshot: snapshot,
    }),
  });
}

/**
 * Rename a project. The backend validates that the new name is unique
 * per user (case-insensitive, whitespace-normalised).
 */
export async function renameProject(projectId, name) {
  return apiRequest(`/projects/${projectId}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** Permanently delete a project and all its stored data. */
export async function deleteProject(projectId) {
  return apiRequest(`/projects/${projectId}`, {
    method: 'DELETE',
  });
}

/**
 * Convert a Unix millisecond timestamp into a human-readable relative label.
 * Falls back to a short locale date string for timestamps older than one week.
 *
 * @param {number} timestamp - Unix ms timestamp (e.g. project.updatedAt)
 * @returns {string}         - e.g. "Just now", "5m ago", "2h ago", "3d ago", "Jan 5"
 */
export function formatProjectDate(timestamp) {
  const diff = Date.now() - timestamp;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  < 1)   return 'Just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
