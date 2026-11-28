import { Moon, Sun } from 'lucide-react';

interface ThemeToggleProps {
  theme: 'dark' | 'light';
  onToggle: () => void;
}

export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const Icon = theme === 'dark' ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label="Light theme"
      aria-pressed={theme === 'light'}
      onClick={onToggle}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-outline bg-panel px-3 text-sm text-content hover:bg-content/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
    >
      <Icon size={16} aria-hidden="true" />
      <span>Light theme</span>
    </button>
  );
}
