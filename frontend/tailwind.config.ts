import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.25rem' }],
        sm: ['0.9375rem', { lineHeight: '1.5rem' }],
      },
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        content: 'rgb(var(--content) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        outline: 'rgb(var(--outline) / <alpha-value>)',
        focus: 'rgb(var(--focus) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        severity: {
          critical: 'rgb(var(--severity-critical) / <alpha-value>)',
          high: 'rgb(var(--severity-high) / <alpha-value>)',
          medium: 'rgb(var(--severity-medium) / <alpha-value>)',
          low: 'rgb(var(--severity-low) / <alpha-value>)',
        },
        checklist: {
          grounded: 'rgb(var(--checklist-grounded) / <alpha-value>)',
          low_confidence: 'rgb(var(--checklist-low-confidence) / <alpha-value>)',
          no_matching_sop: 'rgb(var(--checklist-no-matching-sop) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
} satisfies Config;
