# SOPilot frontend

Frontend for contract v2. React 18, strict TypeScript, Vite, Tailwind,
TanStack Query, lucide-react, Vitest, and React Testing Library.

Use Node 20.19+ or 22.12+ and npm:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open http://localhost:5173. The port is fixed to match backend development CORS.
The initial page has a dark/light app shell, backend health badge, JSON intake,
and a response workspace. Below 900 px the two workspace columns stack.

Use **Larger text** in the header for screen recording: it increases the root
text size from 16 to 20 px, including rem-based spacing and controls. Light theme,
text size, and the demo-shortcut preference are remembered locally; all controls
still work if browser storage is unavailable. The **Badge & status guide**
explains the checklist, verification, citation, severity, ticket, and health
badges. It also provides an off switch for the single-character D shortcut.

Loading views use decorative skeletons with separate text announcements and
respect reduced-motion preferences. Analysis, ticket creation, approval, and
Markdown export move focus to their result or error. Citation panels trap focus
and return it to their trigger. Results arriving while Audit is selected leave
focus in that tab. Focus rings and input borders use the same contrast-aware
tokens in both themes; primary controls and indicator chips have at least 44 px
target heights.

See [the accessibility check notes](docs/ACCESSIBILITY.md) for the measured
Lighthouse results, keyboard walkthrough, viewport coverage, and instructions
for rerunning the standalone browser check.

In this workspace, Node and npm were made available through an ignored local
tools folder. If your terminal cannot find npm, run this from `frontend/` first:

```sh
export PATH="$PWD/.tools/bin:$PATH"
```

```sh
npm run build
npm test
```

Vitest runs once by default; `npm run test:watch` enables watch mode. Tests cover
both API clients, the environment switch, error mapping, Markdown export, query
hooks, validation, intake interactions, pipeline progress, parsed alerts, and IoC
copying, checklist rendering, CVEs, citation-panel interactions, ticket generation,
approval, repeated approvals, and exact Markdown download bytes. Two card
snapshots cover the ransomware and no-match fixtures. React
Testing Library component tests
use jsdom; API tests use Node. Hook tests also exercise the real TanStack observers
initialized through React's server renderer.

Workspace and Audit are accessible tabs with arrow-key, Home, and End navigation.
Workspace remains mounted when switching tabs so input and unfinished approvals
are preserved. Audit requests start only when the Audit tab is opened with a run
ID. Before that, the tab shows a no-run empty state without making a request.
Rows display the returned stage, timestamp, nullable model, and shortened hashes.
Details expands full hashes and `details_json` as indented plain text. The table
scrolls horizontally on narrow screens. Requests/cache keys are scoped by run;
late responses and records belonging to another run cannot replace the view.

`TimingsStrip` shows the four reported stage durations and API total in
milliseconds after a run; zero values are retained and total is not recomputed.
`HealthBadge` uses `useHealth` for Mock/Live and `index_chunks`, with connecting
and retry states. `VITE_USE_MOCK=true` selects the mock client, whose health
response supplies `mock: true`; the badge does not infer mode from the flag.

The API clients, hooks, and workflow components follow section 7 of the frontend
plan. The intake loads sample alerts through `apiClient.samples()` and the header
reads health through `useHealth`. Valid alerts are submitted through `useRun`;
the response workspace shows pending, error/retry, and basic response states.
The pipeline stepper simulates about one second per stage, holds at Verify until
the response arrives, and then displays the exact reported stage/total timings.
Simulation is labelled and does not mark stages complete while a request is
pending. Reduced-motion preferences disable the simulated stage changes and
animations. Errors mark the overall run as failed: the error contract does
not identify a failing stage, so the UI does not infer one.

The parsed-alert card sits below intake and displays the returned classification,
severity, confidence, summary, evidence fields, redaction flag, and grouped IoCs.
Unknown attack types use neutral styling. Only populated indicator groups appear;
clicking a chip copies the exact value and announces success or a manual-copy
fallback. The checklist renders returned step order, action, rationale,
verification, partial-support flags, and dropped counts. Related CVE cards show
the API severity, nullable CVSS, and remediation without deriving decisions.

Citation chips open a native modal side panel with the playbook ID, step ID, and
exact source text. Close or Escape restores focus to the chip; Tab stays inside
the panel, page scrolling is restored on dismissal, and background shortcuts
remain inactive while it is open. Source text and every other API string render
as text. The panel inherits the selected theme and fills narrow screens.
Checklist status and escalation notes come directly from the API; low-confidence
steps remain visible, and no-match responses show escalation guidance without
steps.

After a checklist is available, Generate Incident Ticket calls `createTicket`.
The ticket view shows the API title/severity, timeline, a root cause labelled
Hypothesis with confidence and basis, IoCs, cited containment actions, affected
assets, CVEs, and audit reference. Analyst approval requires a trimmed non-empty
name and uses `useApproveTicket`; pending requests block duplicate submissions.
An approved response removes the approval form and displays the returned
`approved_by` and `approved_at`. Citation review and export remain available.

An `already_approved` response locks the form and shows the draft as a read-only
snapshot. The error contract has no current-ticket response or ticket lookup
endpoint, so the UI does not invent approval metadata or silently mark the draft
object approved. A ticket belonging to another run is never displayed.

Copy and Download Markdown both call `exportTicketMarkdown` for the current
ticket. Copy writes plain text; download creates a UTF-8 Markdown file with a
safe ticket-ID filename and releases the temporary object URL. Export errors
offer a separate manual retry without resubmitting approval.
If browser clipboard access is denied or unavailable, Copy instead shows the
exact server Markdown in a read-only text area with a Select Markdown action.
Download remains available, and a successful export is not reported as a
connection failure because the clipboard is restricted.

`StatusBanner` renders an amber low-confidence notice or a stronger no-match
notice headed “Escalate,” using icons, text, and polite live announcements.
Grounded responses do not show an escalation banner.

`ErrorNotice` maps all seven v2 contract error codes to fixed friendly messages.
Server message/details and arbitrary exception messages are never displayed;
unrecognized failures receive generic connection/retry guidance. The
`already_approved` response is a polite read-only notice. `llm_unavailable`
offers a manual retry of the last submitted alert, including when the editor has
since changed; repeated clicks do not start concurrent runs. `invalid_json` and
`payload_too_large` offer “Review alert input,” which focuses the JSON editor
without resubmitting unchanged input. Tests cover each code, input focus, retry,
and both fallback fixture layouts.

Citation component tests model dialog opening in jsdom, which has no native
modal top layer. Native Enter/Space activation, Escape, focus trapping/return,
and desktop/mobile themes are also verified in the browser.

Validation accepts JSON objects only and enforces the 204,800-byte limit using
UTF-8 bytes, including the serialized request envelope. Oversized pasted text is
also blocked. Selecting a sample fills the editor without submitting it. Press D
outside an editable field to load and run the ransomware sample after samples
have loaded. The shortcut ignores modifier keys, repeat/composition events, and
active runs; manually pasted alerts work even if samples are unavailable.

`src/api/index.ts` exports `apiClient`. Set `VITE_USE_MOCK=true` for the mock, or
`VITE_USE_MOCK=false` and `VITE_API_BASE_URL` for the real backend, then restart
Vite. Only the real client calls fetch, with a 35 second deadline covering the
response body. The seven documented API errors become `AppError` instances with
friendly messages and the original `details`. Connection failures, timeouts,
and unrecognized error envelopes remain ordinary errors because the contract
defines no corresponding codes. Neither client retries requests automatically.

The mock delays every call by 300–800 ms and returns independent copies of the
provided fixtures. Run, parse, and checklist methods cover all three statuses.
The supplied grounded ticket fixtures are unchanged. Additional canned ticket
responses in `src/mocks/ticketFixtures.ts` cover the low-confidence and no-match
runs; the no-match ticket has no containment actions and includes the escalation
note in its timeline. Mock approvals use the supplied demo analyst/timestamp and
are tracked per ticket ID; repeated approvals fail with `already_approved` until
the page reloads. Audit filters the supplied `auditRows` by `run_id`; only the
grounded demo has canned audit records, so other demo runs show an empty audit
instead of unrelated rows. The original fixture file is unchanged. Search uses
exact citation text present in the fixtures.

## Real-backend integration (F9a / G3)

For the machine running both services, put this in the uncommitted
`frontend/.env.local`:

```dotenv
VITE_USE_MOCK=false
VITE_API_BASE_URL=http://localhost:8000/api
```

Start the backend using Hardik's backend setup instructions, with its live mode
enabled (`MOCK=0`). Keep backend credentials on the backend. Start the frontend
with `npm run dev`, or restart it after changing these variables, and open
**http://localhost:5173**. The backend must allow this exact origin through CORS.
Confirm the header reads **Live** and shows the returned `index_chunks` count.
The badge reads `/health.mock`; setting the frontend flag alone does not force
a Live badge. Connecting or Service unavailable means this confirmation is still
pending; a Mock badge means the selected client/service is returning mock data.

In development, every real-client JSON success, JSON error envelope and Markdown
export is checked by `src/lib/contractCheck.ts` before reaching the UI. Warnings
start with `[SOPilot contract v2]` and include the method, field path, expected
type/range and received type/value description. Invalid JSON is reported at `$`.
Arbitrary response strings and full bodies are not logged; `got` describes the
type, or the number for a range failure. The checker never coerces data, changes
server decisions, or throws. Malformed successes become an ordinary request
error handled by the existing UI, rather than reaching components with unsafe
shapes. Malformed errors still use the existing safe error normalization.

Validation covers all required and nullable fields, arrays and nested objects,
every declared enum, confidence/retrieval/search scores in 0–1, CVSS in 0–10,
non-negative counts/durations, positive contiguous step order, documented ticket
ID and ISO timestamp formats. Fractional milliseconds are valid. Additive fields
are ignored under TypeScript's structural interfaces; free-form sample alerts,
audit details and optional error details are not given invented schemas. It does
not recompute fallback decisions or the timings total. Type-checked schema maps
require coverage of interface fields, enum members and all `ApiClient` methods.

The runtime entry point is guarded by `import.meta.env.DEV`, and the real client
loads it dynamically inside that guard. Production builds exclude the checker
and its diagnostics. No validation dependency is added.

Run the offline contract gate with:

```sh
npm run test:contract
```

This checks the 12 original files in `src/mocks/golden/`, including all six real
run responses, parsed/checklist subresponses, both ticket states, health, samples,
audit and Markdown. Broken copies exercise missing fields, wrong types/enums,
null versus missing, range violations and bad nested values. Error-code and
search schemas are tested separately because the supplied golden bundle does
not include standalone error or search responses. The original golden files are
preserved. The frontend type/spec mirrors consume the supplied root v2 contract,
including `internal_error`; the canonical root contract is unchanged.

At **G3**, with the real backend available, run:

```sh
SOPILOT_LIVE_API_URL=http://localhost:8000/api npm run check:live
```

This command reuses the real client in development mode, verifies live health,
loads the backend's six samples and submits them sequentially. It exits nonzero
on request failures, any contract warning, mock health or a missing sample.
It writes `test-results/live-contract-report.json` with completion status and
mismatches as `{ context, path, expected, got }`. A failed preflight is **pending
live verification**, never a six-sample pass. Do not use a production preview
for warning checks: the checker is intentionally absent there.

Also run all six samples in the browser to confirm CORS, the Live badge and the
rendered flows. Check invalid JSON, service unavailability and repeated approval.
Report any mismatch as a list of **field path, expected, got** to the contract
owner. Fix frontend assumptions where appropriate; do not edit `types.ts` or
the supplied golden files to silence warnings. A contract change needs Hardik's
version bump and replacement bundle. Golden-file success is F9a evidence;
zero warnings on six live runs is separate F9b evidence.

For the complete browser integration check, keep the live dev server running and
run `node scripts/check-live-browser.mjs` from `frontend/`. This uses the same
`apiClient` as the UI, the backend `.venv` with `jsonschema` for canonical response
checks, and standalone Puppeteer tooling already used for accessibility checks.
Set `SOPILOT_AUDIT_TOOLS` to that tool installation's `node_modules` directory if
it is not in the local cached location. No application dependency is added.

The check exercises all six samples through cited guidance, draft creation,
approval, copy/manual-copy, download, and expanded audit details. The last sample
also tests a stale draft receiving a second approval and its friendly read-only
notice. CORS preflights are recorded separately from JSON API responses. Reports,
screenshots, downloaded Markdown, contract warnings, console errors, and failed
requests go to `test-results/live-integration/`. An expected 409 is identified as
the duplicate-approval test. A canonical backend deviation is written to root
`docs/INTEGRATION-ISSUES.md` and immediately stops the check. `SOPILOT_RESUME=1`
can resume a run after collector-only issues without repeating completed flows.

Hooks export `useRun`, `useTicket` (draft creation), `useApproveTicket`,
`useAudit(runId?)`, and `useHealth`. Ticket mutations cache the returned ticket
under `['ticket', run_id]` and invalidate `['audit', run_id]`. Audit queries wait
for a run ID. Approval is never retried automatically. Mock Markdown export
serializes the current draft/approved fixture; the real client uses the export
endpoint.

`AGENTS.md`, `docs/spec.md`, `src/api/types.ts`, and `src/mocks/fixtures.ts`
remain the provided contract context. Environment files, dependencies, build
output, local tooling, and test results are ignored by Git.

## Live end-to-end check

For final 1440 × 900 dark screenshots, reset the demo with the backend stopped,
restart the backend, then run `LIVE=1 npm run screenshots`. The Playwright capture
saves nine PNGs and a sample/mode note to `../docs/screens/`. It checks all real
samples for low confidence; only that one shot may use the normal mock app if
none qualifies. USB is the supplied frontend input pasted into the real intake
(the backend sample picker currently has no USB alert). `LIVE=1 node
scripts/check-demo.mjs` uses the same capture. Without `LIVE=1`, the screenshot
command uses mock mode throughout. No backend response is replaced in live mode.

Start the real backend with its populated vector index first. Set
`VITE_API_BASE_URL` in the shell or `frontend/.env.local` to its API base URL,
including `/api` (for example `http://localhost:8000/api`). No keys belong in
frontend configuration. Then, from `frontend/`:

```sh
npm ci
npx playwright install chromium
npm run e2e
```

The suite starts Vite in live mode at `http://localhost:5173` when needed, or
reuses the server there. An existing server must also be configured for the
same live API; the tests reject Mock mode and responses from another API base.
Set `E2E_BASE_URL` to test an already running frontend at another URL instead
of managing Vite. Chromium installation follows the
[Playwright browser setup](https://playwright.dev/docs/browsers).

The two tests use real UI actions and API responses, with no mocked routes or
automatic retries. They cover ransomware grounding, at least three citation
chips, exact source text, Escape/focus return, draft generation, required analyst
name, approval/read-only state, exactly one row for each of the six audit stages,
and the no-match escalation banner without steps. Browser errors, failed
requests, and development contract warnings fail the suite. Results and failure
screenshots go under ignored `test-results/`; traces and videos are disabled.

This check creates two runs and one approved ticket. To clean the demo afterward,
stop the backend and run `python scripts/reset_demo.py` from the repository root
using the backend virtual environment, then restart the backend and reload the UI.
The reset clears run/ticket/audit rows and preserves the vector index.
