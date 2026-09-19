import { useCallback, useEffect, useState } from 'react';

/*
 * Light or dark, chosen by the reader.
 *
 * The tokens for both already exist in tokens.css; all that is needed is data-bs-theme on
 * the document element, which Bootstrap reads as well. The default follows the operating
 * system rather than being hardcoded, and only stops following it once a choice has been
 * made here, so a machine in light mode does not open a dark page for no reason.
 */

// Shared with the inline script in index.html, which applies the choice before first paint
// so the page never flashes the wrong theme on its way to the right one.
const STORAGE_KEY = 'wz.theme';

const systemTheme = () =>
  typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';

const stored = () => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    // Private windows and blocked storage both throw; the system preference is fine.
    return null;
  }
};

export const useTheme = () => {
  const [theme, setTheme] = useState(() => stored() ?? systemTheme());
  const [followsSystem, setFollowsSystem] = useState(() => stored() === null);

  // Apply on every change, including the first render.
  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // Keep following the system until the reader picks a side.
  useEffect(() => {
    if (!followsSystem || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (event) => setTheme(event.matches ? 'light' : 'dark');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [followsSystem]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Not remembering the choice is not a reason to refuse to make it.
      }
      return next;
    });
    setFollowsSystem(false);
  }, []);

  return { theme, toggle };
};

export default useTheme;
