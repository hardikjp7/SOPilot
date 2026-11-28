# Demo accessibility checks

Checked on 21 November 2026 against the local production build in mock mode,
using Chrome and Lighthouse 13.6.0. All 18 audited states scored **100/100** for
accessibility with no failing automated checks, including the visible-label /
accessible-name check for citation chips.

| Views | Variants checked |
| --- | --- |
| Intake | Dark, light |
| Grounded checklist | Dark; also visible in the approved-ticket checks |
| Citation panel | Dark, light |
| Draft ticket | Dark |
| Approved ticket | Dark, light, light with larger text, light with larger text on mobile |
| Expanded badge and status guide | Dark with larger text |
| Expanded audit details | Dark and light with larger text |
| Low confidence | Dark and light with reduced motion |
| No matching SOP | Dark, light, light with larger text on mobile |

The browser walkthrough uses Tab, arrow keys, Enter, Space, Escape, and typing
only for interactions. It selects a sample, checks focus in the JSON editor,
runs analysis, checks pending/result focus, opens a citation, checks the modal
Tab cycle and Escape focus return, generates a draft, enters the analyst name,
and approves the ticket. Approval removes editable ticket controls and focuses
the read-only confirmation. It also opens Audit, expands a row, and disables
the D shortcut from the guide.

Additional checks confirm no page overflow at 390, 768, 899, 900, and 1440 px
with larger text enabled. Workspace uses one column below 900 px and two at
900 px and above. Audit has its own horizontal scroll area. Reduced motion is
checked during an active request; CSS animations stop and the stepper does not
simulate stage changes. No browser JavaScript errors occurred.

The component suite covers invalid/oversize input, all API error messages,
fallback states, focus after errors and exports, required approval names,
storage-unavailable behavior, persisted display settings, and focus preservation
when results arrive while Audit is selected. Latest result: **264 passing tests**
in 26 files. `npm run build` also passes. The API layer, supplied contract files,
and project dependency declarations are unchanged.

## Evidence

- [Lighthouse HTML report](../test-results/lighthouse-flow.html)
- [Lighthouse JSON report](../test-results/lighthouse-flow.json)
- [Scores and keyboard/layout checks](../test-results/demo-checks.json)
- [Dark workspace screenshot](../test-results/demo-workspace.png)
- [Light intake screenshot](../test-results/demo-intake-light.png)
- [Approved ticket on mobile](../test-results/demo-approved-mobile.png)

Evidence files are local outputs in the ignored `test-results/` directory.
These checks cover automated rules and the listed browser interactions; no
screen-reader session was part of this run.

## Rerun

Build with `VITE_USE_MOCK=true` in `.env.local`, then run
`npm run preview -- --host localhost --port 4173 --strictPort`.

The browser check uses standalone Lighthouse tooling from an external tool
directory; it adds no dependencies to this application. Set
`SOPILOT_AUDIT_TOOLS` to that installation's `node_modules` directory, containing
Lighthouse 13.6.0 and its Puppeteer dependency. Then run:

```sh
SOPILOT_URL=http://localhost:4173 \
SOPILOT_AUDIT_TOOLS=/absolute/path/to/audit-tools/node_modules \
node scripts/check-demo.mjs
```

Chrome defaults to `/usr/bin/google-chrome`; `SOPILOT_CHROME` can override it.
The script writes reports/screenshots to `test-results/`, uses an isolated
browser profile in `.tools/`, and exits with an error if a keyboard/layout check
fails, any automated accessibility check fails, or any score falls below 90.
