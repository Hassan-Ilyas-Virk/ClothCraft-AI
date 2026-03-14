/**
 * Project persistence service — localStorage-based.
 * Handles CRUD for design projects.  UI calls these functions directly.
 *
 * Project shape:
 *   { id, userId, name, createdAt, updatedAt, thumbnail, layersSnapshot }
 *
 * layersSnapshot is a JSON string of { layers, activeLayerId }.
 * canvasData strings can be large — we degrade gracefully on quota errors.
 */

const KEY = 'cc_projects';

function readAll() {
  return JSON.parse(localStorage.getItem(KEY) || '[]');
}

function writeAll(projects) {
  localStorage.setItem(KEY, JSON.stringify(projects));
}

/** Get all projects belonging to a user, newest first. */
export function getProjects(userId) {
  return readAll()
    .filter(p => p.userId === userId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Get a single project by id. */
export function getProject(projectId) {
  return readAll().find(p => p.id === projectId) || null;
}

/** Create and persist a new empty project. Returns the project object. */
export function createProject(userId, name = 'Untitled Design') {
  const project = {
    id: `proj-${Date.now()}`,
    userId,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    thumbnail: null,
    layersSnapshot: null,
  };
  writeAll([project, ...readAll()]);
  return project;
}

/**
 * Persist project state.
 * @param {string} projectId
 * @param {{ name, thumbnail, layers, activeLayerId }} data
 * @returns {object|null} updated project or null
 */
export function saveProject(projectId, { name, thumbnail, layers, activeLayerId, canvasWidth, canvasHeight }) {
  const all = readAll();
  const idx = all.findIndex(p => p.id === projectId);
  if (idx === -1) return null;

  const updated = {
    ...all[idx],
    name,
    thumbnail: thumbnail || all[idx].thumbnail,
    updatedAt: Date.now(),
  };

  // Try saving full layer data (canvasData can be large — handle quota)
  const snapshot = JSON.stringify({ layers, activeLayerId, canvasWidth: canvasWidth || 1024, canvasHeight: canvasHeight || 1024 });
  const tryWrite = (record) => {
    all[idx] = record;
    writeAll(all);
  };

  try {
    tryWrite({ ...updated, layersSnapshot: snapshot });
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      // Fall back: strip canvasData, keep thumbnails + metadata
      const lightLayers = (layers || []).map(({ canvasData: _, ...rest }) => rest);
      try {
        tryWrite({ ...updated, layersSnapshot: JSON.stringify({ layers: lightLayers, activeLayerId, canvasWidth: canvasWidth || 1024, canvasHeight: canvasHeight || 1024 }) });
      } catch {
        // Total failure: just update metadata
        try { tryWrite(updated); } catch {}
      }
      return { ...all[idx], __saveWarning: 'Canvas data too large to save fully.' };
    }
  }
  return all[idx];
}

/** Rename a project. */
export function renameProject(projectId, name) {
  const all = readAll();
  const idx = all.findIndex(p => p.id === projectId);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], name, updatedAt: Date.now() };
  writeAll(all);
  return all[idx];
}

/** Delete a project permanently. */
export function deleteProject(projectId) {
  writeAll(readAll().filter(p => p.id !== projectId));
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
