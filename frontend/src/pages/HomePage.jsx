/**
 * HomePage — project listing and creation.
 * All data operations are delegated to service callbacks passed as props.
 *
 * Props:
 *   user           {object}   current user { id, email, displayName }
 *   projects       {array}    list of project objects
 *   onNewProject   {function} () => void
 *   onOpenProject  {function} (project) => void
 *   onDeleteProject{function} (projectId) => void
 *   onRenameProject{function} (projectId, newName) => void
 *   onLogout       {function} () => void
 */
import React, { useState, useRef } from 'react';
import {
  Sparkles, Plus, LogOut, Trash2, FolderOpen,
  PenLine, Clock, MoreVertical, ImageIcon
} from 'lucide-react';
import { formatProjectDate } from '../services/projects';
import './HomePage.css';

/* ── Sub-components ─────────────────────────────────────────────────── */

const ProjectCard = ({ project, onOpen, onDelete, onRename }) => {
  const [menuOpen, setMenuOpen]     = useState(false);
  const [renaming, setRenaming]     = useState(false);
  const [nameVal, setNameVal]       = useState(project.name);
  const nameInputRef                = useRef(null);

  const startRename = () => {
    setMenuOpen(false);
    setRenaming(true);
    setTimeout(() => nameInputRef.current?.select(), 20);
  };

  const commitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== project.name) onRename(project.id, trimmed);
    else setNameVal(project.name);
    setRenaming(false);
  };

  return (
    <div className="hp-card" onClick={() => !renaming && !menuOpen && onOpen(project)}>
      {/* Thumbnail */}
      <div className="hp-card-thumb">
        {project.thumbnail ? (
          <img src={project.thumbnail} alt={project.name} draggable={false} />
        ) : (
          <div className="hp-card-thumb-empty">
            <ImageIcon size={36} strokeWidth={1} />
          </div>
        )}
        {/* Hover overlay */}
        <div className="hp-card-overlay">
          <button
            className="hp-card-open-btn"
            onClick={e => { e.stopPropagation(); onOpen(project); }}
          >
            <FolderOpen size={16} />
            Open
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="hp-card-footer">
        <div className="hp-card-meta">
          {renaming ? (
            <input
              ref={nameInputRef}
              className="hp-card-rename-input"
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setNameVal(project.name); setRenaming(false); }
                e.stopPropagation();
              }}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span className="hp-card-name">{project.name}</span>
          )}
          <span className="hp-card-date">
            <Clock size={11} />
            {formatProjectDate(project.updatedAt)}
          </span>
        </div>

        {/* Context menu */}
        <div className="hp-card-menu-wrap" onClick={e => e.stopPropagation()}>
          <button
            className="hp-card-menu-btn"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="More options"
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <div className="hp-card-menu">
              <button onClick={startRename}>
                <PenLine size={14} /> Rename
              </button>
              <button
                className="hp-card-menu--danger"
                onClick={() => { setMenuOpen(false); onDelete(project.id); }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const NewProjectCard = ({ onClick }) => (
  <button className="hp-card hp-card--new" onClick={onClick}>
    <div className="hp-card-thumb hp-card-thumb--new">
      <Plus size={32} strokeWidth={1.5} />
    </div>
    <div className="hp-card-footer hp-card-footer--new">
      <span className="hp-card-name">New Design</span>
      <span className="hp-card-date">Start fresh</span>
    </div>
  </button>
);

/* ── Main component ─────────────────────────────────────────────────── */

const HomePage = ({ user, projects, onNewProject, onOpenProject, onDeleteProject, onRenameProject, onLogout }) => {
  const [confirmDelete, setConfirmDelete] = useState(null); // projectId to confirm

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const handleDeleteConfirm = (id) => {
    onDeleteProject(id);
    setConfirmDelete(null);
  };

  const initials = (name) =>
    (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="hp-root">
      {/* Header */}
      <header className="hp-header">
        <div className="hp-header-brand">
          <div className="hp-header-logo">
            <Sparkles size={18} strokeWidth={1.5} />
          </div>
          <span className="hp-header-title">ClothCraft AI</span>
        </div>

        <div className="hp-header-user">
          <div className="hp-avatar">{initials(user?.displayName)}</div>
          <span className="hp-header-username">{user?.displayName}</span>
          <button className="hp-logout-btn" onClick={onLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Hero strip */}
      <div className="hp-hero">
        <p className="hp-hero-greeting">{greeting()}, {user?.displayName?.split(' ')[0]} ✦</p>
        <h2 className="hp-hero-heading">Your designs</h2>
        <button className="hp-new-btn" onClick={onNewProject}>
          <Plus size={16} strokeWidth={2.5} />
          New Design
        </button>
      </div>

      {/* Projects grid */}
      <main className="hp-main">
        {projects.length === 0 ? (
          <div className="hp-empty">
            <div className="hp-empty-icon">
              <Sparkles size={52} strokeWidth={1} />
            </div>
            <h3 className="hp-empty-title">No designs yet</h3>
            <p className="hp-empty-text">
              Start a new project and bring your fashion ideas to life.
            </p>
            <button className="hp-new-btn" onClick={onNewProject}>
              <Plus size={15} /> Create your first design
            </button>
          </div>
        ) : (
          <div className="hp-grid">
            <NewProjectCard onClick={onNewProject} />
            {projects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={onOpenProject}
                onDelete={(id) => setConfirmDelete(id)}
                onRename={onRenameProject}
              />
            ))}
          </div>
        )}
      </main>

      {/* Delete confirm dialog */}
      {confirmDelete && (
        <div className="hp-dialog-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="hp-dialog" onClick={e => e.stopPropagation()}>
            <Trash2 size={28} strokeWidth={1.5} style={{ color: '#f87171', marginBottom: 12 }} />
            <h3 className="hp-dialog-title">Delete this design?</h3>
            <p className="hp-dialog-text">This action cannot be undone.</p>
            <div className="hp-dialog-actions">
              <button className="hp-dialog-cancel" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className="hp-dialog-confirm" onClick={() => handleDeleteConfirm(confirmDelete)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
