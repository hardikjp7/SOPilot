import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function readPreference(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Preferences still work when storage is unavailable. */ }
}

export function useDisplayPreferences() {
  const [theme, setTheme] = useState<Theme>(() => readPreference('sopilot.theme', 'dark') === 'light' ? 'light' : 'dark');
  const [largeText, setLargeText] = useState(() => readPreference('sopilot.largeText', 'false') === 'true');
  const [demoShortcut, setDemoShortcut] = useState(() => readPreference('sopilot.demoShortcut', 'true') !== 'false');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    root.dataset.textSize = largeText ? 'large' : 'standard';
    savePreference('sopilot.theme', theme);
    savePreference('sopilot.largeText', String(largeText));
    savePreference('sopilot.demoShortcut', String(demoShortcut));
  }, [theme, largeText, demoShortcut]);

  return { theme, setTheme, largeText, setLargeText, demoShortcut, setDemoShortcut };
}
