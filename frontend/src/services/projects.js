import { apiRequest } from './api';

/** Get all projects for current authenticated user, newest first. */
export async function getProjects() {
  return apiRequest('/projects');
}

/** Get a single project by id. */
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
 * Persist project state.
 * @param {string} projectId
 * @param {{ name, thumbnail, layers, activeLayerId }} data
 * @returns {object} updated project
 */
export async function saveProject(projectId, { name, thumbnail, layers, activeLayerId, canvasWidth, canvasHeight }) {
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

/** Rename a project. */
export async function renameProject(projectId, name) {
  return apiRequest(`/projects/${projectId}/rename`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** Delete a project permanently. */
export async function deleteProject(projectId) {
  return apiRequest(`/projects/${projectId}`, {
    method: 'DELETE',
  });
}

/** Format a timestamp into a human-readable relative label. */
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
