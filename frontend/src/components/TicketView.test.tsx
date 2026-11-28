// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { draftTicket, approvedTicket, noMatchRun } from '../mocks/fixtures';
import { draftTicketFixtures } from '../mocks/ticketFixtures';
import TicketView from './TicketView';
import { mockDialogMethods } from './dialog.test-utils';

describe('TicketView', () => {
  let restore: () => void;
  beforeEach(() => { restore = mockDialogMethods(); });
  afterEach(() => { cleanup(); restore(); });

  it('renders the returned title, severity, timeline, hypothesis/basis, IoCs, assets and CVEs', () => {
    render(<TicketView ticket={draftTicket} />);
    expect(screen.getByRole('heading', { name: draftTicket.title })).toBeTruthy();
    expect(screen.getByText(draftTicket.severity)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Hypothesis' })).toBeTruthy();
    expect(screen.getByText(draftTicket.root_cause.hypothesis)).toBeTruthy();
    expect(screen.getByText('55%')).toBeTruthy();
    draftTicket.root_cause.basis.forEach((basis) => expect(screen.getByText(basis)).toBeTruthy());
    for (const event of draftTicket.timeline) expect(screen.getByText(event.event)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Timeline' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Copy 198.51.100.23' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Affected assets' })).getByText('FIN-WS-014')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'CVEs' })).getByText('CVE-2026-1001')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Containment actions' })).getAllByRole('listitem')).toHaveLength(6);
  });

  it('reuses citation chips and returns focus after viewing the exact source', () => {
    render(<TicketView ticket={draftTicket} />);
    const chip = screen.getByRole('button', { name: 'View source for PB-RAN-02' });
    fireEvent.click(chip);
    expect(screen.getByRole('region', { name: 'Exact playbook source' }).textContent)
      .toBe(draftTicket.containment_actions[1]!.citation.source_text);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close citation panel' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('does not derive action status from the ticket status', () => {
    render(<TicketView ticket={{ ...approvedTicket, containment_actions: [draftTicket.containment_actions[0]!] }} />);
    expect(screen.getByText('recommended')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders an escalation-only no-match ticket without adding actions', () => {
    const ticket = draftTicketFixtures.find((item) => item.run_id === noMatchRun.run_id)!;
    render(<TicketView ticket={ticket} />);
    expect(screen.getByText(noMatchRun.checklist.escalation_note)).toBeTruthy();
    expect(screen.getByText('No containment actions returned.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /View source/ })).toBeNull();
  });

  it('handles empty optional collections and nullable timeline times', () => {
    render(<TicketView ticket={{ ...draftTicket, timeline: [{ time: null, event: 'Event' }], containment_actions: [], affected_assets: [], cves: [], root_cause: { ...draftTicket.root_cause, basis: [] } }} />);
    for (const value of ['Time not provided', 'No basis returned.', 'No containment actions returned.', 'No affected assets returned.', 'No CVEs returned.']) expect(screen.getByText(value)).toBeTruthy();
  });

  it('has an empty state before generation', () => {
    render(<TicketView />);
    expect(screen.getByText('Generate an incident ticket to review it here.')).toBeTruthy();
  });

  it('renders untrusted ticket fields as text', () => {
    const value = '<img src=x onerror=alert(1)>';
    const { container } = render(<TicketView ticket={{ ...draftTicket, title: value, timeline: [{ time: null, event: '<script>run()</script>' }], affected_assets: ['<b>asset</b>'] }} />);
    expect(screen.getByRole('heading', { name: value })).toBeTruthy();
    expect(screen.getByText('<script>run()</script>')).toBeTruthy();
    expect(container.querySelector('img, script, b')).toBeNull();
  });
});
