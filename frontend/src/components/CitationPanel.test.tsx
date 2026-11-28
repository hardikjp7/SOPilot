// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groundedRun } from '../mocks/fixtures';
import ChecklistView from './ChecklistView';
import { mockDialogMethods } from './dialog.test-utils';

describe('CitationPanel source safety and modal boundaries', () => {
  let restore: () => void;
  beforeEach(() => { restore = mockDialogMethods(); });
  afterEach(() => { cleanup(); restore(); });

  it('preserves exact source text, including whitespace and HTML-like strings', () => {
    const source = '  PB-RAN-01 | Detect | <script>run()</script>\n\t<em>literal</em>  ';
    const first = groundedRun.checklist.steps[0]!;
    const { container } = render(<ChecklistView checklist={{ ...groundedRun.checklist, steps: [{
      ...first, citation: { ...first.citation, source_text: source },
    }] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-01' }));
    const region = screen.getByRole('region', { name: 'Exact playbook source' });
    expect(region.querySelector('code')!.textContent).toBe(source);
    expect(container.querySelector('script, em')).toBeNull();
  });

  it('prevents global keyboard shortcuts from running behind the panel', () => {
    const shortcut = vi.fn();
    window.addEventListener('keydown', shortcut);
    try {
      render(<ChecklistView checklist={groundedRun.checklist} />);
      fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-01' }));
      fireEvent.keyDown(screen.getByRole('button', { name: 'Close citation panel' }), { key: 'd' });
      expect(shortcut).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();
    } finally {
      window.removeEventListener('keydown', shortcut);
    }
  });

  it('restores page scrolling when unmounted with a panel open', () => {
    const { unmount } = render(<ChecklistView checklist={groundedRun.checklist} />);
    fireEvent.click(screen.getByRole('button', { name: 'View source for PB-RAN-01' }));
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
