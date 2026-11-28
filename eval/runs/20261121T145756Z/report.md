# Live paired evaluation report

Final evaluated run: `20261121T145756Z`. Completed: 2026-11-21T14:59:19.024652+00:00. Contract v2. Live gateway, persisted 65-chunk index, 12/12 cases executed.

## Result

**Citation-validity gate PASS: 100% in both branches (31/31 citations each); evaluator exit 0.** Task pass rate is **10/12 (83.3%)**, up from 7/12 (58.3%) in the baseline. Two false fallbacks remain; this is not a claim that every case passes. No invalid citations, unsupported-step verdicts, or execution errors occurred in either run.

**Chosen and tested configuration:** `RETRIEVAL_MIN_SCORE=0.29`, `RETRIEVAL_MIN_MARGIN=0.03`. The user selected these conservative values. They were supplied as explicit per-process environment variables for the rerun. A fresh settings load without overrides still returns `0.35 / 0.03`, including after the rerun. The selected values are proven for this evaluation process; persistent configuration is not confirmed. The environment file was neither inspected nor edited by the agent.

## Measurement definitions

Correct expected playbook, branch-appropriate status, all citations valid, and zero production-verifier-judged unsupported steps. For an expected grounded case, the raw branch is expected to be low_confidence (pending verification), while the verified branch must be grounded. Execution errors count as failures.

Exact final-status-plus-playbook match is reported separately. Raw generated drafts deliberately have `low_confidence` until verification; this expected pending status is not a task-quality failure.

Each run parses, retrieves, and generates once per case. Its two branches share that exact draft; verification adds deterministic citation and MODEL_FAST support checks. Unsupported-step labels are production verifier judgments, not independent human ground truth, so the post-verifier rate is a consistency measure. Partial support is retained and not counted as unsupported.

Citations must match an indexed step, chosen playbook, exact source text, and retrieved input. No returned steps means N/A citation/support rates, not automatic 100%. Correct fallback uses only the four expected fallback cases; false fallbacks on positive cases reduce task pass rate. Latency excludes index initialization and report writing; percentiles use linear interpolation over completed cases.

## Overall — final run

| Metric | Without verifier | With verifier |
|---|---:|---:|
| Task pass rate | 83.3% | 83.3% |
| Exact final status + playbook | 33.3% | 83.3% |
| Citation validity | 100.0% | 100.0% |
| Unsupported-step rate | 0.0% | 0.0% |
| Correct fallback rate | 100.0% | 100.0% |
| p50 latency (s) | 5.244 | 6.041 |
| p95 latency (s) | 10.944 | 12.547 |
| Passed cases | 10/12 | 10/12 |
| Returned steps | 31 | 31 |

## Per-category metrics — final run

| Category | Branch | Task pass | Citation validity | Unsupported | Correct fallback | p50 (s) | p95 (s) |
|---|---|---:|---:|---:|---:|---:|---:|
| clean | Without | 4/5 (80.0%) | 100.0% | 0.0% | N/A | 9.204 | 11.807 |
| clean | With | 4/5 (80.0%) | 100.0% | 0.0% | N/A | 11.025 | 13.366 |
| reworded | Without | 1/2 (50.0%) | 100.0% | 0.0% | N/A | 5.209 | 7.174 |
| reworded | With | 1/2 (50.0%) | 100.0% | 0.0% | N/A | 6.007 | 8.689 |
| ambiguous | Without | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.937 | 2.937 |
| ambiguous | With | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.937 | 2.937 |
| no_match | Without | 2/2 (100.0%) | N/A | N/A | 100.0% | 2.284 | 2.532 |
| no_match | With | 2/2 (100.0%) | N/A | N/A | 100.0% | 2.284 | 2.532 |
| injection | Without | 1/1 (100.0%) | 100.0% | 0.0% | N/A | 7.770 | 7.770 |
| injection | With | 1/1 (100.0%) | 100.0% | 0.0% | N/A | 9.428 | 9.428 |
| missing_fields | Without | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.772 | 2.772 |
| missing_fields | With | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.772 | 2.772 |

## Every failing case — final run

E01-E12 denote one-based positions in data/eval/cases.json; stored CASE-* IDs remain authoritative.

Both branches returned the same status/playbook for the failures below. Retrieval thresholds prevented generation, so verification could not rescue them.

| Case | Returned status | Returned playbook | Expected | Reason |
|---|---|---|---|---|
| E03 `CASE-clean-credential_stuffing` | no_matching_sop | null | grounded / PB-CRD | margin 0.014395 < 0.03 |
| E06 `CASE-reworded-phishing` | no_matching_sop | null | grounded / PB-PHI | score 0.251570 < 0.29; margin 0.000000 < 0.03 |

## Run comparison

| Run | Score / margin cutoff | Task pass, without / with | Citations, without / with | Unsupported, without / with | Correct fallback, without / with | p50 s, without / with | p95 s, without / with |
|---|---|---|---|---|---|---|---|
| Baseline `2026-11-21T14:53:58.217689+00:00` | 0.35 / 0.03 | 58.3% / 58.3% | 100.0% / 100.0% | 0.0% / 0.0% | 100.0% / 100.0% | 2.669 / 2.669 | 10.051 / 11.615 |
| Chosen conservative `2026-11-21T14:59:19.024652+00:00` | 0.29 / 0.03 | 83.3% / 83.3% | 100.0% / 100.0% | 0.0% / 0.0% | 100.0% / 100.0% | 5.244 / 6.041 | 10.944 / 12.547 |

Baseline failures (all returned `no_matching_sop`, null playbook, in both branches):

| Case | Expected playbook | Reason at 0.35 / 0.03 |
|---|---|---|
| E02 `CASE-clean-ransomware` | PB-RAN | retrieval score 0.324962 < 0.35 |
| E05 `CASE-clean-ddos` | PB-DOS | retrieval score 0.299608 < 0.35 |
| E06 `CASE-reworded-phishing` | PB-PHI | retrieval score 0.189695 < 0.35; margin 0.000000 < 0.03 |
| E07 `CASE-reworded-ransomware` | PB-RAN | retrieval score 0.295751 < 0.35 |
| E11 `CASE-injection` | PB-RAN | retrieval score 0.348623 < 0.35 |

Parsing is rerun against live models, so summaries and retrieval scores vary between runs. For example, E03’s margin fell from 0.126907 to 0.014395. The observed improvement is not a controlled threshold-only A/B experiment. Within each run, the verifier comparison is paired. The baseline’s recorded scores predicted 11/12 at 0.29/0.03; the new live run measured 10/12.

## Threshold evidence

| Case | Parsed attack in both runs | Baseline score | Baseline margin | Rerun score | Rerun margin |
|---|---|---:|---:|---:|---:|
| E02 `CASE-clean-ransomware` | ransomware | 0.324962 | 0.140877 | 0.375882 | 0.190053 |
| E03 `CASE-clean-credential_stuffing` | credential_stuffing | 0.423645 | 0.126907 | 0.359343 | 0.014395 |
| E05 `CASE-clean-ddos` | ddos | 0.299608 | 0.143409 | 0.319215 | 0.146102 |
| E06 `CASE-reworded-phishing` | phishing | 0.189695 | 0.000000 | 0.251570 | 0.000000 |
| E07 `CASE-reworded-ransomware` | ransomware | 0.295751 | 0.153565 | 0.304054 | 0.162569 |
| E08 `CASE-ambiguous` | unknown | 0.384301 | 0.142992 | 0.402162 | 0.113947 |
| E09 `CASE-no-match-temperature` | unknown | 0.311828 | 0.026593 | 0.313859 | 0.029367 |
| E10 `CASE-no-match-print` | unknown | 0.212570 | 0.002038 | 0.233450 | 0.034676 |
| E11 `CASE-injection` | ransomware | 0.348623 | 0.175700 | 0.347752 | 0.176532 |
| E12 `CASE-missing-fields` | unknown | 0.274870 | 0.003304 | 0.281270 | 0.010453 |

## Configuration decision and remaining proposal

**Chosen and evaluated, preserving margin protection:**

```dotenv
RETRIEVAL_MIN_SCORE=0.29
RETRIEVAL_MIN_MARGIN=0.03
```

These are the user-selected conservative values and the effective settings in the final results. They leave E03 and E06 unresolved. They were applied only to the evaluation process because ordinary settings loads still reported the old score cutoff. Any running backend also retains its startup settings until restarted.

**Further corpus-recall candidate, not applied or evaluated:**

```dotenv
RETRIEVAL_MIN_SCORE=0.18
RETRIEVAL_MIN_MARGIN=0.00
```

Across both runs, E06’s lowest score is 0.189695 and its margin is always 0.000000. A score cutoff of 0.18 leaves a small observed buffer; a zero margin cutoff is necessary to admit E06. Replaying either recorded score set with this candidate admits all eight positives, while E08–E10 and E12 still fall back because `attack_type == unknown` is unconditional. This is a retrieval-decision replay, not proof that generation/verification would pass in a new live run.

**No threshold-only separator exists across these observations.** The ambiguous/no-match cases have scores as high as 0.402162, and E06 has lower score and margin than several negatives. The candidate therefore depends on correct unknown-attack classification and removes cross-playbook margin protection. No broader safety or generalization claim follows from these 12 cases. The agent has retained the selected conservative pair; any further configuration change belongs to the user and should be followed by another timestamped run.

## Preserved artifacts and checks

- Baseline: `eval/runs/20261121T145259Z/` (original raw evaluator outputs plus analysis).
- Final: `eval/runs/20261121T145756Z/` (original evaluator outputs saved as `evaluator-results.json` and `evaluator-report.md`; effective configuration context in `run-context.json`).
- The earlier supplied run is preserved separately under its original timestamp.
- `eval/results.json` and `eval/report.md` mirror this final run and contain both-branch overall/category metrics, failures, and threshold decisions.
- Backend regression suite last line: `247 passed, 1 skipped, 1 deselected in 25.31s`. The opt-in live smoke is skipped; the excluded packaging test creates environment files contrary to the user’s restriction. The evaluation itself used the live gateway.
- Frontend build last line: `✓ built in 4.11s`.
- Frontend tests: `Test Files 28 passed (28)`; `Tests 390 passed (390)`.
- Application/contract/corpus source SHA-256 values match the pre-run snapshot. No prompts, pipeline code, contracts, or environment files were changed by the agent.
