// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { Iocs, Severity } from '../api/types';
import { groundedRun, noMatchRun } from '../mocks/fixtures';
import ParsedAlertCard from './ParsedAlertCard';

const emptyIocs: Iocs = { ips: [], domains: [], urls: [], hashes: [], emails: [], users: [], cve_ids: [], resources: [] };
afterEach(cleanup);

describe('ParsedAlertCard', () => {
  it('renders the returned classification, summary, confidence and evidence fields', () => {
    const { parsed } = groundedRun;
    render(<ParsedAlertCard parsed={parsed} />);
    expect(screen.getByRole('region', { name: 'Parsed alert' })).toBeTruthy();
    for (const value of [parsed.alert_id, parsed.source, parsed.timestamp!, parsed.summary, 'Ransomware', 'Critical']) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    const meter = screen.getByRole('meter', { name: 'Classification confidence' });
    expect(meter.getAttribute('aria-valuenow')).toBe('0.96');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('1');
    expect(meter.getAttribute('aria-valuetext')).toBe('96%');
    for (const field of parsed.evidence_fields) expect(screen.getByText(field)).toBeTruthy();
    expect(screen.getByText('Redaction applied during processing.')).toBeTruthy();
  });

  it.each([
    ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical'],
  ] satisfies [Severity, string][])('renders API severity %s without reclassifying it from the alert', (severity, label) => {
    render(<ParsedAlertCard parsed={{ ...groundedRun.parsed, severity }} />);
    expect(screen.getByText(label).className).toContain(`text-severity-${severity}`);
    expect(screen.getByText('Ransomware')).toBeTruthy();
  });

  it('keeps unknown attack type neutral while preserving returned severity and confidence', () => {
    render(<ParsedAlertCard parsed={noMatchRun.parsed} />);
    const badge = screen.getByText('Unknown');
    expect(badge.className).toContain('text-muted');
    expect(badge.className).not.toContain('severity');
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('Not provided')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0.41');
    expect(screen.getByRole('meter').firstElementChild!.className).toContain('bg-muted');
  });

  it('only shows the redaction note when the API flag is true', () => {
    render(<ParsedAlertCard parsed={{ ...groundedRun.parsed, redacted: false }} />);
    expect(screen.queryByText('Redaction applied during processing.')).toBeNull();
  });

  it('shows pending state and hides stale parsed data until the run returns', () => {
    render(<ParsedAlertCard isLoading parsed={groundedRun.parsed} />);
    expect(screen.getByRole('status').textContent).toContain('Waiting for parsed alert');
    expect(screen.getByRole('region', { name: 'Parsed alert' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(groundedRun.parsed.summary)).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('shows an error state without displaying stale data', () => {
    render(<ParsedAlertCard isError parsed={groundedRun.parsed} />);
    expect(screen.getByRole('status').textContent).toContain('No parsed alert was returned.');
    expect(screen.queryByText(groundedRun.parsed.summary)).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('has an empty state before parsing', () => {
    render(<ParsedAlertCard />);
    expect(screen.getByText('Run an alert to see parsed details.')).toBeTruthy();
  });

  it('handles empty evidence and indicators', () => {
    render(<ParsedAlertCard parsed={{ ...noMatchRun.parsed, evidence_fields: [], iocs: emptyIocs }} />);
    expect(screen.getByText('No evidence fields returned.')).toBeTruthy();
    expect(screen.getByText('No indicators returned.')).toBeTruthy();
  });

  it('renders untrusted response strings as text', () => {
    const untrusted = '<img src=x onerror=alert(1)>';
    const { container } = render(<ParsedAlertCard parsed={{
      ...groundedRun.parsed, summary: untrusted, source: '<script>test</script>', evidence_fields: [untrusted],
    }} />);
    expect(screen.getAllByText(untrusted)).toHaveLength(2);
    expect(container.querySelector('img, script')).toBeNull();
  });

  it.each([
    ['ransomware', groundedRun.parsed],
    ['no-match', noMatchRun.parsed],
  ] as const)('matches the %s fixture card snapshot', (_name, parsed) => {
    // Server-generated useId values keep snapshots independent of test order.
    const element = document.createElement('div');
    element.innerHTML = renderToStaticMarkup(<ParsedAlertCard parsed={parsed} />);
    expect(element.firstElementChild).toMatchSnapshot();
  });
});
