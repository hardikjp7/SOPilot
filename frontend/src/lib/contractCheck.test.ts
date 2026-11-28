import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkContract, validateContract } from './contractCheck';
import type { ResponseContract } from './contractCheck';
import { approvedTicket, auditRows, groundedRun, lowConfidenceRun, noMatchRun, samples } from '../mocks/fixtures';

const files = import.meta.glob<string>('../mocks/golden/*', { eager: true, query: '?raw', import: 'default' });
const contracts: Record<string, ResponseContract> = {
  'health.json': 'health', 'samples.json': 'samples', 'audit.json': 'audit',
  'run-ambiguous.json': 'run', 'run-credential_stuffing.json': 'run', 'run-phishing.json': 'run',
  'run-public_s3_bucket.json': 'run', 'run-ransomware.json': 'run', 'run-unknown.json': 'run',
  'ticket-draft.json': 'createTicket', 'ticket-approved.json': 'approve', 'ticket-export.md': 'exportTicketMarkdown',
};
const golden = Object.entries(files).map(([path, raw]) => {
  const file = path.split('/').at(-1)!;
  const contract = contracts[file];
  if (!contract) throw new Error(`Golden response has no contract assignment: ${file}`);
  return { file, contract, value: file.endsWith('.json') ? JSON.parse(raw) as unknown : raw };
});
function response(file: string): unknown { return golden.find((entry) => entry.file === file)!.value; }
const missing = Symbol('missing');
function changed(file: string, path: string, replacement: unknown): unknown {
  const value = structuredClone(response(file));
  const keys = path.replace(/^\$/, '').replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '').split('.');
  let parent = value as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  const last = keys.at(-1)!;
  if (replacement === missing) delete parent[last]; else parent[last] = replacement;
  return value;
}

beforeEach(() => { vi.stubEnv('DEV', true); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Hardik golden responses (unaltered files)', () => {
  it('requires all supplied files and all six runs to be covered', () => {
    expect(golden.map(({ file }) => file).sort()).toEqual(Object.keys(contracts).sort());
    expect(golden.filter(({ contract }) => contract === 'run')).toHaveLength(6);
  });
  it.each(golden)('accepts $file without warnings or mutation', ({ contract, value }) => {
    const before = structuredClone(value);
    expect(checkContract(contract, value)).toEqual([]);
    expect(value).toEqual(before);
    expect(console.warn).not.toHaveBeenCalled();
  });
  it.each(golden.filter(({ contract }) => contract === 'run'))('accepts parse/checklist responses extracted from $file', ({ value }) => {
    const run = value as typeof groundedRun;
    expect(validateContract('parse', run.parsed)).toEqual([]);
    expect(validateContract('checklist', run.checklist)).toEqual([]);
    expect(run.timings_ms.parse % 1).not.toBe(0); // Real timings must retain fractional milliseconds.
  });
});

const broken: { file: string; path: string; value: unknown }[] = [
  { file: 'health.json', path: '$.status', value: 'healthy' },
  { file: 'health.json', path: '$.mock', value: 'false' },
  { file: 'health.json', path: '$.index_chunks', value: -1 },
  { file: 'health.json', path: '$.index_chunks', value: 1.5 },
  { file: 'samples.json', path: '$[0].alert', value: [] },
  { file: 'samples.json', path: '$[0].name', value: missing },
  { file: 'run-ransomware.json', path: '$.run_id', value: missing },
  { file: 'run-ransomware.json', path: '$.parsed.timestamp', value: 'yesterday' },
  { file: 'run-ransomware.json', path: '$.parsed.attack_type', value: 'Ransomware' },
  { file: 'run-ransomware.json', path: '$.parsed.severity', value: 'urgent' },
  ...[-0.01, 1.01, NaN, Infinity, '0.9'].map((value) => ({ file: 'run-ransomware.json', path: '$.parsed.confidence', value })),
  { file: 'run-ransomware.json', path: '$.parsed.summary', value: null },
  { file: 'run-ransomware.json', path: '$.parsed.redacted', value: 'true' },
  { file: 'run-ransomware.json', path: '$.parsed.evidence_fields[0]', value: 42 },
  { file: 'run-ransomware.json', path: '$.parsed.iocs.ips', value: null },
  ...['ips', 'domains', 'urls', 'hashes', 'emails', 'users', 'cve_ids', 'resources'].map((field) => ({ file: 'run-ransomware.json', path: `$.parsed.iocs.${field}`, value: missing })),
  { file: 'run-ransomware.json', path: '$.checklist.status', value: 'lowConfidence' },
  { file: 'run-ransomware.json', path: '$.checklist.playbook_id', value: missing },
  { file: 'run-ransomware.json', path: '$.checklist.retrieval_confidence', value: 1.01 },
  { file: 'run-ransomware.json', path: '$.checklist.steps', value: null },
  ...[0, 1.5, 2].map((value) => ({ file: 'run-ransomware.json', path: '$.checklist.steps[0].order', value })),
  { file: 'run-ransomware.json', path: '$.checklist.steps[0].citation.source_text', value: missing },
  { file: 'run-ransomware.json', path: '$.checklist.steps[0].support', value: 'unsupported' },
  { file: 'run-ransomware.json', path: '$.checklist.steps[0].verified', value: 1 },
  { file: 'run-ransomware.json', path: '$.checklist.dropped_count', value: -1 },
  { file: 'run-ransomware.json', path: '$.checklist.dropped_count', value: 0.5 },
  ...[-0.1, 10.1, NaN].map((value) => ({ file: 'run-ransomware.json', path: '$.checklist.related_cves[0].cvss', value })),
  ...['parse', 'retrieve', 'generate', 'verify', 'total'].map((field) => ({ file: 'run-ransomware.json', path: `$.timings_ms.${field}`, value: -1 })),
  { file: 'ticket-draft.json', path: '$.ticket_id', value: 'ticket-2' },
  { file: 'ticket-draft.json', path: '$.status', value: 'pending' },
  { file: 'ticket-draft.json', path: '$.timeline[0].time', value: 123 },
  { file: 'ticket-draft.json', path: '$.timeline[0].event', value: missing },
  { file: 'ticket-draft.json', path: '$.root_cause.confidence', value: -1 },
  { file: 'ticket-draft.json', path: '$.root_cause.basis[0]', value: false },
  { file: 'ticket-draft.json', path: '$.containment_actions[0].status', value: 'complete' },
  { file: 'ticket-approved.json', path: '$.approved_at', value: missing },
  { file: 'ticket-approved.json', path: '$.approved_by', value: {} },
  { file: 'audit.json', path: '$[0].stage', value: 'approval' },
  { file: 'audit.json', path: '$[0].id', value: 2.5 },
  { file: 'audit.json', path: '$[0].ts', value: 'invalid' },
  { file: 'audit.json', path: '$[0].model', value: 42 },
  { file: 'audit.json', path: '$[0].details_json', value: [] },
];

describe('deliberately broken copies', () => {
  it.each(broken)('rejects $file at $path ($value)', ({ file, path, value }) => {
    const contract = contracts[file]!;
    const copy = changed(file, path, value);
    const issues = checkContract(contract, copy);
    expect(issues.some((issue) => issue.path === path)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(path), expect.objectContaining({ path, expected: expect.any(String), got: expect.any(String) }));
    expect(validateContract(contract, response(file))).toEqual([]);
  });
});

describe('contract edges and non-throwing diagnostics', () => {
  it.each(Object.entries(contracts))('detects every required top-level field in %s', (file, contract) => {
    const value = response(file);
    const target = Array.isArray(value) ? value[0] : value;
    if (typeof target !== 'object' || target === null) return; // Markdown has no fields.
    for (const field of Object.keys(target)) {
      const path = `${Array.isArray(value) ? '$[0]' : '$'}.${field}`;
      expect(validateContract(contract, changed(file, path, missing)).some((issue) => issue.path === path && issue.got === 'missing')).toBe(true);
    }
  });
  it('accepts nullable fields, optional error details and unrestricted record contents', () => {
    expect(validateContract('run', noMatchRun)).toEqual([]);
    expect(validateContract('run', lowConfidenceRun)).toEqual([]);
    expect(validateContract('approve', approvedTicket)).toEqual([]);
    expect(validateContract('audit', auditRows)).toEqual([]);
    expect(validateContract('samples', samples)).toEqual([]);
    expect(validateContract('error', { error: { code: 'not_found', message: '' } })).toEqual([]);
    expect(validateContract('error', { error: { code: 'not_found', message: '', details: [null, 1, 'anything'] } })).toEqual([]);
    expect(validateContract('health', { status: 'ok', mock: false, index_chunks: 0, future_metadata: {} })).toEqual([]);
  });
  it.each(['invalid_json', 'payload_too_large', 'validation_error', 'not_found', 'already_approved', 'llm_unavailable', 'internal_error'])('accepts contract error code %s', (code) => {
    expect(validateContract('error', { error: { code, message: 'untrusted' } })).toEqual([]);
  });
  it('checks search hits, Markdown and unknown error codes without inventing fixtures', () => {
    const hit = { playbook_id: 'PB-PHI', step_id: 'PB-PHI-01', text: 'source', score: 0.5 };
    expect(validateContract('search', [hit])).toEqual([]);
    expect(validateContract('search', [{ ...hit, score: 1.01 }])).toEqual([{ path: '$[0].score', expected: 'finite number >= 0 <= 1', got: '1.01' }]);
    expect(validateContract('exportTicketMarkdown', {})).toEqual([{ path: '$', expected: 'string', got: 'object' }]);
    expect(validateContract('error', { error: { code: 'new_code', message: '' } })[0]?.path).toBe('$.error.code');
    expect(validateContract('error', { error: { code: 'not_found' } })[0]?.path).toBe('$.error.message');
  });
  it('does not coerce, expose strings or log bodies', () => {
    const broken = { status: 'PRIVATE_ALERT_CONTENT', mock: false, index_chunks: '42' };
    const issues = checkContract('health', broken);
    expect(issues).toHaveLength(2);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('PRIVATE_ALERT_CONTENT');
    expect(broken.index_chunks).toBe('42');
  });
  it('never throws when properties or the console throw', () => {
    const value = Object.defineProperty({}, 'status', { get: () => { throw new Error('private'); } });
    expect(validateContract('health', value)).toEqual([{ path: '$', expected: 'readable response fields', got: 'unreadable value' }]);
    vi.mocked(console.warn).mockImplementation(() => { throw new Error('console disabled'); });
    expect(() => checkContract('health', null)).not.toThrow();
    expect(checkContract('health', null)).toHaveLength(1);
  });
  it('does not inspect values or warn in production', () => {
    vi.stubEnv('DEV', false);
    const value = Object.defineProperty({}, 'status', { get: () => { throw new Error('must not read'); } });
    expect(checkContract('health', value)).toEqual([]);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
