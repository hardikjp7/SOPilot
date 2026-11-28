// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { RelatedCve, Severity } from '../api/types';
import { groundedRun } from '../mocks/fixtures';
import CveCard from './CveCard';

afterEach(cleanup);
const cve = groundedRun.checklist.related_cves[0]!;

describe('CveCard', () => {
  it('shows the returned CVE ID, severity, score and remediation', () => {
    render(<CveCard cve={cve} />);
    expect(screen.getByRole('article', { name: cve.id })).toBeTruthy();
    expect(screen.getByRole('heading', { name: cve.id })).toBeTruthy();
    expect(screen.getByText(cve.severity)).toBeTruthy();
    expect(screen.getByText('8.1')).toBeTruthy();
    expect(screen.getByText(cve.remediation)).toBeTruthy();
  });

  it.each(['low', 'medium', 'high', 'critical'] satisfies Severity[])('uses the %s API severity without deriving it from CVSS', (severity) => {
    render(<CveCard cve={{ ...cve, severity, cvss: 8.1 }} />);
    const badge = screen.getByText(severity).parentElement!;
    expect(badge.className).toContain(`text-severity-${severity}`);
  });

  it.each([null, 0] satisfies RelatedCve['cvss'][])('handles CVSS %s without treating zero as missing', (cvss) => {
    render(<CveCard cve={{ ...cve, cvss }} />);
    expect(screen.getByText(cvss === null ? 'Not provided' : '0')).toBeTruthy();
  });

  it('renders all CVE strings as text', () => {
    const { container } = render(<CveCard cve={{ ...cve, id: '<b>CVE</b>', remediation: '<img src=x onerror=alert(1)>' }} />);
    expect(screen.getByText('<b>CVE</b>')).toBeTruthy();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('b, img')).toBeNull();
  });
});
