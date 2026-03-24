/**
 * LoginPage — sign in / sign up UI.
 * All auth logic is delegated to service functions passed as props.
 */
import React, { useState } from 'react';
import { Sparkles, Mail, Lock, User, ArrowRight, Eye, EyeOff } from 'lucide-react';
import ClothCraftLogo from '../components/ClothCraftLogo';
import Iridescence from '../components/Iridescence';
import './LoginPage.css';

const LoginPage = ({ onLogin, onSignup }) => {
  const [mode, setMode]           = useState('login'); // 'login' | 'signup'
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [name, setName]           = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Please fill in all fields.'); return; }
    if (mode === 'signup' && !name) { setError('Please enter your name.'); return; }
    setLoading(true);
    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else {
        await onSignup(email, password, name);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
  };

  return (
    <div className="login-root">
      <Iridescence color={[0.77, 0.52, 0.99]} speed={1.2} amplitude={0.15} />

      {/* Left Column: Form */}
      <div className="login-side">
        <div className="login-card">
          {/* Tab switcher */}
          <div className="login-tabs">
            <button
              className={`login-tab ${mode === 'login' ? 'login-tab--active' : ''}`}
              onClick={() => switchMode('login')}
              type="button"
            >
              Log in
            </button>
            <button
              className={`login-tab ${mode === 'signup' ? 'login-tab--active' : ''}`}
              onClick={() => switchMode('signup')}
              type="button"
            >
              Sign up
            </button>
            <div
              className="login-tab-indicator"
              style={{ transform: mode === 'signup' ? 'translateX(100%)' : 'translateX(0)' }}
            />
          </div>

          <button className="login-google-btn" type="button">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" width="18" />
            Continue with Google
          </button>

          <div className="login-divider">
            <span>or</span>
          </div>

          {/* Form */}
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            {mode === 'signup' && (
              <div className="login-field login-field--animate">
                <label className="login-label">
                  <User size={15} />
                  Display Name
                </label>
                <input
                  className="login-input"
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}

            <div className="login-field">
              <input
                className="login-input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="login-field">
              <div className="login-input-wrap">
                <input
                  className="login-input"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="login-forgot-wrap">
                <button type="button" className="login-forgot-btn">Forgot password</button>
              </div>
            </div>

            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            <button
              className={`login-submit ${loading ? 'login-submit--loading' : ''}`}
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="login-spinner" />
              ) : (
                <>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          {/* Footer switch */}
          <p className="login-switch">
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button
              className="login-switch-btn"
              type="button"
              onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
            >
               Sign up
            </button>
          </p>

          <button className="login-guest-btn" type="button">
            Continue as guest
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      {/* Right Column: Hero Display */}
      <div className="login-hero">
        <div className="login-hero-content">
          <ClothCraftLogo size={280} color="white" className="hero-logo-icon" />
          <h1 className="hero-logo-text">ClothCraft AI</h1>
          <p className="hero-tagline">Your Vision, Woven into Reality.</p>
        </div>
        {/* Animated background background features */}
        <div className="login-hero-glow" />
      </div>
    </div>
  );
};

export default LoginPage;
