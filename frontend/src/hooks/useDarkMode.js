/**
 * useDarkMode — persists the user's dark/light preference across sessions.
 *
 * Priority order for the initial value:
 *   1. Value stored in localStorage ('dark' | 'light')
 *   2. OS-level preference via the prefers-color-scheme media query
 *
 * The hook sets data-theme="dark" on <html> so that CSS variables in
 * dark-mode.css take effect globally. Removing the attribute reverts to
 * the default light theme without any inline style pollution.
 *
 * @returns {[boolean, () => void]} [isDark, toggleDark]
 */
import { useState, useEffect } from 'react';

export const useDarkMode = () => {
    // Lazy initialiser runs once: check localStorage first, then OS preference.
    const [isDark, setIsDark] = useState(() => {
        const stored = localStorage.getItem('theme');
        if (stored) return stored === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    });

    // Keep the <html> attribute and localStorage in sync with state.
    useEffect(() => {
        const html = document.documentElement;
        if (isDark) {
            html.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            html.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        }
    }, [isDark]);

    return [isDark, () => setIsDark(d => !d)];
};
