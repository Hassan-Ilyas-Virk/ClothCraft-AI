import React, { useState, useRef } from 'react';
import { X, Camera, Check, Lock, User, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { updateProfile, changePassword } from '../services/auth';
import './ProfileModal.css';

async function resizeImageToDataUrl(file, maxPx = 240) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', 0.82));
    };
    img.src = URL.createObjectURL(file);
  });
}

const ProfileModal = ({ user, onClose, onUserUpdate }) => {
  const [avatarPreview, setAvatarPreview] = useState(user?.avatarUrl || null);
  const [avatarFile, setAvatarFile]       = useState(null);
  const [displayName, setDisplayName]     = useState(user?.displayName || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg]       = useState(null); // {type:'ok'|'err', text}

  const [currentPw, setCurrentPw]   = useState('');
  const [newPw, setNewPw]           = useState('');
  const [confirmPw, setConfirmPw]   = useState('');
  const [showCur, setShowCur]       = useState(false);
  const [showNew, setShowNew]       = useState(false);
  const [showConf, setShowConf]     = useState(false);
  const [pwSaving, setPwSaving]     = useState(false);
  const [pwMsg, setPwMsg]           = useState(null);

  const avatarInputRef = useRef(null);

  const initials = (name) =>
    (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const handleAvatarPick = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await resizeImageToDataUrl(file);
    setAvatarPreview(dataUrl);
    setAvatarFile(dataUrl);
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const updates = {};
      if (displayName.trim() && displayName.trim() !== user?.displayName)
        updates.displayName = displayName.trim();
      if (avatarFile)
        updates.avatarUrl = avatarFile;
      if (!Object.keys(updates).length) {
        setProfileMsg({ type: 'ok', text: 'Nothing to update.' });
        return;
      }
      const updated = await updateProfile(updates);
      onUserUpdate(updated);
      setAvatarFile(null);
      setProfileMsg({ type: 'ok', text: 'Profile saved.' });
    } catch (err) {
      setProfileMsg({ type: 'err', text: err.message || 'Failed to save.' });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPw) return setPwMsg({ type: 'err', text: 'Enter your current password.' });
    if (newPw.length < 8) return setPwMsg({ type: 'err', text: 'New password must be at least 8 characters.' });
    if (newPw !== confirmPw) return setPwMsg({ type: 'err', text: 'Passwords do not match.' });
    setPwSaving(true);
    setPwMsg(null);
    try {
      await changePassword({ currentPassword: currentPw, newPassword: newPw });
      setPwMsg({ type: 'ok', text: 'Password updated.' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setPwMsg({ type: 'err', text: err.message || 'Failed to change password.' });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="pm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pm-panel">
        {/* Header */}
        <div className="pm-header">
          <h2 className="pm-title">Profile Settings</h2>
          <button className="pm-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="pm-body">
          {/* Avatar */}
          <div className="pm-avatar-row">
            <button className="pm-avatar-wrap" onClick={() => avatarInputRef.current?.click()} title="Change photo">
              {avatarPreview ? (
                <img src={avatarPreview} alt="avatar" className="pm-avatar-img" />
              ) : (
                <div className="pm-avatar-placeholder">{initials(displayName || user?.displayName)}</div>
              )}
              <div className="pm-avatar-overlay"><Camera size={18} /></div>
            </button>
            <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: 'none' }} onChange={handleAvatarPick} />
            <div className="pm-avatar-info">
              <p className="pm-avatar-name">{user?.displayName}</p>
              <p className="pm-avatar-email">{user?.email}</p>
              <p className="pm-avatar-hint">Click photo to change · Max 180 KB after compression</p>
            </div>
          </div>

          <div className="pm-divider" />

          {/* Display name */}
          <section className="pm-section">
            <div className="pm-section-title"><User size={15} /> Account Info</div>
            <label className="pm-label">Display Name</label>
            <input
              className="pm-input"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={120}
            />
            {profileMsg && (
              <div className={`pm-msg ${profileMsg.type === 'ok' ? 'pm-msg--ok' : 'pm-msg--err'}`}>
                {profileMsg.type === 'ok' ? <Check size={13} /> : <AlertCircle size={13} />}
                {profileMsg.text}
              </div>
            )}
            <button className="pm-save-btn" onClick={handleSaveProfile} disabled={profileSaving}>
              {profileSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </section>

          <div className="pm-divider" />

          {/* Password */}
          <section className="pm-section">
            <div className="pm-section-title"><Lock size={15} /> Change Password</div>

            <label className="pm-label">Current Password</label>
            <div className="pm-pw-wrap">
              <input
                className="pm-input"
                type={showCur ? 'text' : 'password'}
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                placeholder="Current password"
              />
              <button className="pm-pw-eye" onClick={() => setShowCur(v => !v)}>{showCur ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>

            <label className="pm-label">New Password</label>
            <div className="pm-pw-wrap">
              <input
                className="pm-input"
                type={showNew ? 'text' : 'password'}
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Min 8 characters"
              />
              <button className="pm-pw-eye" onClick={() => setShowNew(v => !v)}>{showNew ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>

            <label className="pm-label">Confirm New Password</label>
            <div className="pm-pw-wrap">
              <input
                className="pm-input"
                type={showConf ? 'text' : 'password'}
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Repeat new password"
              />
              <button className="pm-pw-eye" onClick={() => setShowConf(v => !v)}>{showConf ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>

            {pwMsg && (
              <div className={`pm-msg ${pwMsg.type === 'ok' ? 'pm-msg--ok' : 'pm-msg--err'}`}>
                {pwMsg.type === 'ok' ? <Check size={13} /> : <AlertCircle size={13} />}
                {pwMsg.text}
              </div>
            )}
            <button className="pm-save-btn" onClick={handleChangePassword} disabled={pwSaving}>
              {pwSaving ? 'Updating…' : 'Update Password'}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
