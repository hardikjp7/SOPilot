import type {
  ApiClient, ApiError, ApiErrorCode, AttackType, AuditRow, AuditStage, Checklist,
  ChecklistStatus, Citation, ContainmentAction, HealthResponse, IncidentTicket,
  Iocs, ParsedAlert, RelatedCve, RootCause, RunResponse, SampleAlert, SearchHit,
  Severity, Step, TimelineEvent, TimingsMs,
} from '../api/types';

type Responses = { [K in keyof ApiClient]: Awaited<ReturnType<ApiClient[K]>> } & { error: ApiError };
export type ResponseContract = keyof Responses;
export interface ContractIssue { path: string; expected: string; got: string }

// The phantom type makes schema fields and enum members checked by TypeScript.
interface Rule<T> {
  readonly valueType?: T;
  readonly optional?: boolean;
  readonly expected: string;
  check: (value: unknown, path: string, issues: ContractIssue[]) => void;
}
type Shape<T> = { [K in keyof T]-?: Rule<T[K]> };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function describe(value: unknown): string {
  // Never log alert contents, source text, names, arbitrary strings or objects.
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return String(value);
  return typeof value;
}

function rule<T>(expected: string, accepts: (value: unknown) => boolean): Rule<T> {
  return { expected, check: (value, path, issues) => {
    if (!accepts(value)) issues.push({ path, expected, got: describe(value) });
  } };
}
const text = rule<string>('string', (value) => typeof value === 'string');
const bool = rule<boolean>('boolean', (value) => typeof value === 'boolean');
const record = rule<Record<string, unknown>>('object', isObject);
const anything = rule<unknown>('any value', () => true);
function number(min = -Infinity, max = Infinity, integer = false): Rule<number> {
  const expected = `${integer ? 'integer' : 'finite number'}${min !== -Infinity ? ` >= ${min}` : ''}${max !== Infinity ? ` <= ${max}` : ''}`;
  return rule(expected, (value) => typeof value === 'number' && Number.isFinite(value)
    && (!integer || Number.isInteger(value)) && value >= min && value <= max);
}
function enumeration<T extends string>(members: Record<T, true>): Rule<T> {
  const values = Object.keys(members);
  return rule(values.map((value) => JSON.stringify(value)).join(' | '), (value) => typeof value === 'string' && Object.hasOwn(members, value));
}
function nullable<T>(item: Rule<T>): Rule<T | null> {
  return { expected: `${item.expected} | null`, check: (value, path, issues) => {
    if (value !== null) {
      const start = issues.length;
      item.check(value, path, issues);
      for (const issue of issues.slice(start)) if (issue.path === path) issue.expected += ' | null';
    }
  } };
}
function optional<T>(item: Rule<T>): Rule<T | undefined> {
  return { ...item, optional: true };
}
function array<T>(item: Rule<T>): Rule<T[]> {
  return { expected: 'array', check: (value, path, issues) => {
    if (!Array.isArray(value)) { issues.push({ path, expected: 'array', got: describe(value) }); return; }
    for (let index = 0; index < value.length; index++) item.check(value[index], `${path}[${index}]`, issues);
  } };
}
function object<T>(shape: Shape<T>): Rule<T> {
  return { expected: 'object', check: (value, path, issues) => {
    if (!isObject(value)) { issues.push({ path, expected: 'object', got: describe(value) }); return; }
    for (const [field, member] of Object.entries(shape) as [string, Rule<unknown>][]) {
      const fieldPath = `${path}.${field}`;
      if (!Object.hasOwn(value, field)) {
        if (!member.optional) issues.push({ path: fieldPath, expected: member.expected, got: 'missing' });
      } else member.check(value[field], fieldPath, issues);
    }
    // Additive fields are allowed by TS structural interfaces. They are never
    // read by the UI; record-valued alert/details objects remain unrestricted.
  } };
}

const severity = enumeration<Severity>({ low: true, medium: true, high: true, critical: true });
const attack = enumeration<AttackType>({ phishing: true, ransomware: true, credential_stuffing: true, ddos: true, public_s3_bucket: true, unknown: true });
const status = enumeration<ChecklistStatus>({ grounded: true, low_confidence: true, no_matching_sop: true });
const stage = enumeration<AuditStage>({ parse: true, retrieve: true, generate: true, verify: true, ticket: true, approve: true });
const errorCode = enumeration<ApiErrorCode>({ invalid_json: true, payload_too_large: true, validation_error: true, not_found: true, already_approved: true, llm_unavailable: true, internal_error: true });
const confidence = number(0, 1);
const count = number(0, Infinity, true);
const strings = array(text);
const isoTimestamp = rule<string>('ISO 8601 timestamp', (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)
  && Number.isFinite(Date.parse(value)));

const iocs = object<Iocs>({ ips: strings, domains: strings, urls: strings, hashes: strings, emails: strings, users: strings, cve_ids: strings, resources: strings });
const citation = object<Citation>({ playbook_id: text, step_id: text, source_text: text });
const parsed = object<ParsedAlert>({
  alert_id: text, source: text, timestamp: nullable(isoTimestamp), attack_type: attack,
  severity, confidence, summary: text, iocs, evidence_fields: strings, redacted: bool,
});
const step = object<Step>({
  order: number(1, Infinity, true), action: text, rationale: text, citation,
  verified: bool, support: enumeration<Step['support']>({ supported: true, partial: true }),
});
const steps: Rule<Step[]> = { expected: 'array', check: (value, path, issues) => {
  array(step).check(value, path, issues);
  if (Array.isArray(value)) value.forEach((item: unknown, index) => {
    if (isObject(item) && typeof item.order === 'number' && Number.isInteger(item.order) && item.order >= 1 && item.order !== index + 1) {
      issues.push({ path: `${path}[${index}].order`, expected: `${index + 1} (1-based contiguous order)`, got: String(item.order) });
    }
  });
} };
const cve = object<RelatedCve>({ id: text, severity, cvss: nullable(number(0, 10)), remediation: text });
const checklist = object<Checklist>({
  alert_id: text, status, playbook_id: nullable(text), retrieval_confidence: confidence,
  steps, related_cves: array(cve), escalation_note: text, dropped_count: count,
});
const timings = object<TimingsMs>({ parse: number(0), retrieve: number(0), generate: number(0), verify: number(0), total: number(0) });
const run = object<RunResponse>({ run_id: text, parsed, checklist, timings_ms: timings });
const timeline = object<TimelineEvent>({ time: nullable(isoTimestamp), event: text });
const rootCause = object<RootCause>({ hypothesis: text, confidence, basis: strings });
const containment = object<ContainmentAction>({ action: text, citation, status: enumeration<ContainmentAction['status']>({ recommended: true, approved: true }) });
const ticket = object<IncidentTicket>({
  ticket_id: rule('INC-YYYYMMDD-NNN string', (value) => typeof value === 'string' && /^INC-\d{8}-\d{3}$/.test(value)),
  run_id: text, title: text, severity, status: enumeration<IncidentTicket['status']>({ draft: true, approved: true }),
  timeline: array(timeline), root_cause: rootCause, iocs, containment_actions: array(containment),
  affected_assets: strings, cves: strings, approved_by: nullable(text), approved_at: nullable(isoTimestamp), audit_ref: text,
});
const health = object<HealthResponse>({ status: enumeration<HealthResponse['status']>({ ok: true }), mock: bool, index_chunks: count });
const sample = object<SampleAlert>({ id: text, name: text, alert: record });
const audit = object<AuditRow>({ id: number(-Infinity, Infinity, true), run_id: text, stage, ts: isoTimestamp, model: nullable(text), input_hash: text, output_hash: text, details_json: record });
const search = object<SearchHit>({ playbook_id: text, step_id: text, text, score: confidence });
const apiError = object<ApiError>({ error: object<ApiError['error']>({ code: errorCode, message: text, details: optional(anything) }) });

const responses: { [K in ResponseContract]: Rule<Responses[K]> } = {
  health, samples: array(sample), run, parse: parsed, checklist, createTicket: ticket,
  approve: ticket, exportTicketMarkdown: text, search: array(search), audit: array(audit), error: apiError,
};

/** Pure validation for fixture tests/tools. It never changes or throws the payload. */
export function validateContract(contract: ResponseContract, value: unknown): ContractIssue[] {
  const issues: ContractIssue[] = [];
  try { responses[contract].check(value, '$', issues); }
  catch { issues.push({ path: '$', expected: 'readable response fields', got: 'unreadable value' }); }
  return issues;
}

/** Development entry point. Diagnostics contain paths/types, never response bodies. */
export function checkContract(contract: ResponseContract, value: unknown): ContractIssue[] {
  if (!import.meta.env.DEV) return [];
  const issues = validateContract(contract, value);
  reportContractIssues(contract, issues);
  return issues;
}

export function reportContractIssues(contract: ResponseContract, issues: readonly ContractIssue[]): void {
  if (!import.meta.env.DEV) return;
  for (const issue of issues) {
    try {
      console.warn(`[SOPilot contract v2] ${contract} ${issue.path}: expected ${issue.expected}; got ${issue.got}`, issue);
    } catch { /* A broken console must not interrupt a request or the UI. */ }
  }
}
