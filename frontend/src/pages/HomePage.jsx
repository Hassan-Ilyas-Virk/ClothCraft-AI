import React, { useState, useRef } from 'react';
import {
  Sparkles, Plus, LogOut, Trash2, FolderOpen,
  PenLine, Clock, MoreVertical, ImageIcon, Settings
} from 'lucide-react';
import { formatProjectDate } from '../services/projects';
import ClothCraftLogo from '../components/ClothCraftLogo';
import ProfileModal from '../components/ProfileModal';
import './HomePage.css';

/* ── ProjectCard ──────────────────────────────────────────────────── */

const ProjectCard = ({ project, onOpen, onDelete, onRename }) => {
  const [menuOpen, setMenuOpen]       = useState(false);
  const [renaming, setRenaming]       = useState(false);
  const [nameVal, setNameVal]         = useState(project.name);
  const [renameError, setRenameError] = useState('');
  const nameInputRef                  = useRef(null);

  const startRename = () => {
    setMenuOpen(false);
    setRenaming(true);
    setRenameError('');
    setTimeout(() => nameInputRef.current?.select(), 20);
  };

  const commitRename = async () => {
    const trimmed = nameVal.trim();
    if (!trimmed) { setNameVal(project.name); setRenaming(false); setRenameError(''); return; }
    if (trimmed === project.name) { setRenaming(false); setRenameError(''); return; }
    try {
      await onRename(project.id, trimmed);
      setRenameError('');
      setRenaming(false);
    } catch (err) {
      setRenameError(err?.message || 'Name unavailable');
      setRenaming(true);
      setTimeout(() => nameInputRef.current?.focus(), 0);
    }
  };

  return (
    <div className="hp-card-stack">
      <div className="hp-card" onClick={() => !renaming && !menuOpen && onOpen(project)}>
        <div className="hp-card-thumb">
          {project.thumbnail ? (
            <img src={project.thumbnail} alt={project.name} draggable={false} />
          ) : (
            <div className="hp-card-thumb-empty"><ImageIcon size={36} strokeWidth={1} /></div>
          )}
          <div className="hp-card-overlay">
            <button className="hp-card-open-btn" onClick={e => { e.stopPropagation(); onOpen(project); }}>
              <FolderOpen size={16} /> Open
            </button>
          </div>
        </div>

        <div className="hp-card-footer">
          <div className="hp-card-meta">
            {renaming ? (
              <div className="hp-rename-wrap">
                <input
                  ref={nameInputRef}
                  className="hp-card-rename-input"
                  value={nameVal}
                  onChange={e => { setNameVal(e.target.value); if (renameError) setRenameError(''); }}
                  onBlur={() => { void commitRename(); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                    if (e.key === 'Escape') { setNameVal(project.name); setRenaming(false); setRenameError(''); }
                    e.stopPropagation();
                  }}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                />
              </div>
            ) : (
              <span className="hp-card-name">{project.name}</span>
            )}
            <span className="hp-card-date">
              <Clock size={11} />
              {formatProjectDate(project.updatedAt)}
            </span>
          </div>

          <div className="hp-card-menu-wrap" onClick={e => e.stopPropagation()}>
            <button className="hp-card-menu-btn" onClick={() => setMenuOpen(v => !v)} aria-label="More options">
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <div className="hp-card-menu">
                <button onClick={startRename}><PenLine size={14} /> Rename</button>
                <button className="hp-card-menu--danger" onClick={() => { setMenuOpen(false); onDelete(project.id); }}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {renameError && <div className="hp-card-error-below">{renameError}</div>}
    </div>
  );
};

const NewProjectCard = ({ onClick }) => (
  <button className="hp-card hp-card--new" onClick={onClick}>
    <div className="hp-card-thumb hp-card-thumb--new"><Plus size={32} strokeWidth={1.5} /></div>
    <div className="hp-card-footer hp-card-footer--new">
      <span className="hp-card-name">New Design</span>
      <span className="hp-card-date">Start fresh</span>
    </div>
  </button>
);

/* ── Main ─────────────────────────────────────────────────────────── */

const HomePage = ({ user, projects, onNewProject, onOpenProject, onDeleteProject, onRenameProject, onLogout, onUserUpdate }) => {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showProfile, setShowProfile]     = useState(false);
  const [localUser, setLocalUser]         = useState(user);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const handleUserUpdate = (updated) => {
    setLocalUser(updated);
    onUserUpdate?.(updated);
  };

  const initials = (name) =>
    (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="hp-root">
      {/* ── Header ── */}
      <header className="hp-header">
        <div className="hp-header-brand">
          <div className="hp-header-logo">
            <ClothCraftLogo size={18} color="white" />
          </div>
          <span className="hp-header-title">ClothCraft AI</span>
        </div>

        <div className="hp-header-actions">
          <button className="hp-new-btn hp-new-btn--header" onClick={onNewProject}>
            <Plus size={15} strokeWidth={2.5} /> New Design
          </button>

          <button className="hp-user-btn" onClick={() => setShowProfile(true)} title="Profile settings">
            {localUser?.avatarUrl ? (
              <img src={localUser.avatarUrl} alt="avatar" className="hp-avatar-img" />
            ) : (
              <div className="hp-avatar">{initials(localUser?.displayName)}</div>
            )}
            <span className="hp-header-username">{localUser?.displayName}</span>
            <Settings size={14} className="hp-user-settings-icon" />
          </button>

          <button className="hp-logout-btn" onClick={onLogout} title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* ── Hero strip ── */}
      <div className="hp-hero">
        <p className="hp-hero-greeting">{greeting()}, {localUser?.displayName?.split(' ')[0]} ✦</p>
        <h2 className="hp-hero-heading">Your designs</h2>
      </div>

      {/* ── Projects grid ── */}
      <main className="hp-main">
        {projects.length === 0 ? (
          <div className="hp-empty">
            <div className="hp-empty-icon"><Sparkles size={52} strokeWidth={1} /></div>
            <h3 className="hp-empty-title">No designs yet</h3>
            <p className="hp-empty-text">Start a new project and bring your fashion ideas to life.</p>
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

      {/* ── Delete confirm ── */}
      {confirmDelete && (
        <div className="hp-dialog-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="hp-dialog" onClick={e => e.stopPropagation()}>
            <Trash2 size={28} strokeWidth={1.5} style={{ color: '#f87171', marginBottom: 12 }} />
            <h3 className="hp-dialog-title">Delete this design?</h3>
            <p className="hp-dialog-text">This action cannot be undone.</p>
            <div className="hp-dialog-actions">
              <button className="hp-dialog-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="hp-dialog-confirm" onClick={() => { onDeleteProject(confirmDelete); setConfirmDelete(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Profile modal ── */}
      {showProfile && (
        <ProfileModal
          user={localUser}
          onClose={() => setShowProfile(false)}
          onUserUpdate={handleUserUpdate}
        />
      )}
    </div>
  );
};

export default HomePage;
