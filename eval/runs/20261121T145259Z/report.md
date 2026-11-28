# Live paired evaluation report

Run: `20261121T145259Z`. Completed: 2026-11-21T14:53:58.217689+00:00. Contract v2. Live gateway, persisted 65-chunk index; 12/12 cases executed.

## Result and definitions

Citation-validity gate: **PASS — 100% in both branches** (16/16 citations per branch; evaluator exit 0). This gate does not imply all expected outcomes passed. There are five false fallbacks. No prompts, pipeline code, contract files, or environment files were edited.

Correct playbook, expected branch status, all citations valid, and zero verifier-judged unsupported steps. For expected grounded cases, the raw branch is expected to be low_confidence (pending verification); the verified branch is expected to be grounded. Execution failures count as failures.

Exact final-status-plus-playbook match is also reported: raw drafts deliberately remain `low_confidence` until verification. Treating that label as a failed final result would penalize the intended raw-branch behavior.

Both branches share the same parse, retrieval, and generated draft. The verified branch adds deterministic citation and model support checks. Unsupported-step labels come from the production MODEL_FAST verifier, not independent human review; the post-verifier rate is a consistency measure. Partial support is retained and is not counted as unsupported.

Citation validity requires an indexed step, the chosen playbook, exact source text, and membership in the retrieved input. Rates with no steps or no expected fallback cases are N/A. Expected fallback rate uses only the four fallback cases; it does not penalize false fallbacks on positive cases, which are captured by pass rate. Latency excludes index initialization/report writing and uses linear interpolation.

## Overall

| Metric | Without verifier | With verifier |
|---|---:|---:|
| Task pass rate | 58.3% | 58.3% |
| Exact final status + playbook | 33.3% | 58.3% |
| Citation validity | 100.0% | 100.0% |
| Unsupported-step rate | 0.0% | 0.0% |
| Correct fallback rate | 100.0% | 100.0% |
| p50 latency (s) | 2.669 | 2.669 |
| p95 latency (s) | 10.051 | 11.615 |
| Passed cases | 7/12 | 7/12 |
| Returned steps | 16 | 16 |

## Per category

| Category | Branch | Pass | Citation validity | Unsupported | Correct fallback | p50 (s) | p95 (s) |
|---|---|---:|---:|---:|---:|---:|---:|
| clean | Without | 3/5 (60.0%) | 100.0% | 0.0% | N/A | 9.504 | 10.102 |
| clean | With | 3/5 (60.0%) | 100.0% | 0.0% | N/A | 11.062 | 11.668 |
| reworded | Without | 0/2 (0.0%) | N/A | N/A | N/A | 2.127 | 2.169 |
| reworded | With | 0/2 (0.0%) | N/A | N/A | N/A | 2.127 | 2.169 |
| ambiguous | Without | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.533 | 2.533 |
| ambiguous | With | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.533 | 2.533 |
| no_match | Without | 2/2 (100.0%) | N/A | N/A | 100.0% | 2.412 | 2.682 |
| no_match | With | 2/2 (100.0%) | N/A | N/A | 100.0% | 2.412 | 2.682 |
| injection | Without | 0/1 (0.0%) | N/A | N/A | N/A | 2.626 | 2.626 |
| injection | With | 0/1 (0.0%) | N/A | N/A | N/A | 2.626 | 2.626 |
| missing_fields | Without | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.434 | 2.434 |
| missing_fields | With | 1/1 (100.0%) | N/A | N/A | 100.0% | 2.434 | 2.434 |

## Every failing case

E01-E12 are one-based positions in data/eval/cases.json; stored CASE-* IDs remain authoritative.

Both branches returned the same status and playbook for each failure below. None reached generation or verification; there were no execution errors, invalid citations, or unsupported-step failures.

| Alias / case | Returned status | Returned playbook | Expected | Reason |
|---|---|---|---|---|
| E02 `CASE-clean-ransomware` | no_matching_sop | null | grounded / PB-RAN | retrieval score 0.324962 < 0.35 |
| E05 `CASE-clean-ddos` | no_matching_sop | null | grounded / PB-DOS | retrieval score 0.299608 < 0.35 |
| E06 `CASE-reworded-phishing` | no_matching_sop | null | grounded / PB-PHI | retrieval score 0.189695 < 0.35; margin 0.000000 < 0.03 |
| E07 `CASE-reworded-ransomware` | no_matching_sop | null | grounded / PB-RAN | retrieval score 0.295751 < 0.35 |
| E11 `CASE-injection` | no_matching_sop | null | grounded / PB-RAN | retrieval score 0.348623 < 0.35 |

## Threshold evidence and proposed configuration

**Currently evaluated:** `RETRIEVAL_MIN_SCORE=0.35`, `RETRIEVAL_MIN_MARGIN=0.03`. **No new values have been applied or evaluated yet.**

| Alias / case | Parsed attack | Top score | Cross-playbook margin |
|---|---|---:|---:|
| E02 `CASE-clean-ransomware` | ransomware | 0.324962 | 0.140877 |
| E05 `CASE-clean-ddos` | ddos | 0.299608 | 0.143409 |
| E06 `CASE-reworded-phishing` | phishing | 0.189695 | 0.000000 |
| E07 `CASE-reworded-ransomware` | ransomware | 0.295751 | 0.153565 |
| E08 `CASE-ambiguous` | unknown | 0.384301 | 0.142992 |
| E09 `CASE-no-match-temperature` | unknown | 0.311828 | 0.026593 |
| E10 `CASE-no-match-print` | unknown | 0.212570 | 0.002038 |
| E11 `CASE-injection` | ransomware | 0.348623 | 0.175700 |
| E12 `CASE-missing-fields` | unknown | 0.274870 | 0.003304 |

**Corpus-recall candidate (requires user application and a new live run):**

```dotenv
RETRIEVAL_MIN_SCORE=0.18
RETRIEVAL_MIN_MARGIN=0.00
```

E06 requires a score cutoff no higher than 0.189695 and a zero margin cutoff. The proposed 0.18 leaves a small observed-score buffer. On the recorded scores, this admits all eight positive cases. E08–E10 and E12 still fall back because their parsed attack type is `unknown`, an unconditional contract rule. This is a score replay, not a measured rerun.

**Limit:** no score/margin pair can accept E06 while rejecting E08–E10 by retrieval evidence alone: all three have higher scores and margins than E06. The candidate removes cross-playbook margin protection and depends on correct `unknown` classification. Twelve cases do not establish broader safety or generalization. A second live run can vary because parsing and generation are model outputs.

**Conservative alternative:** `RETRIEVAL_MIN_SCORE=0.29`, `RETRIEVAL_MIN_MARGIN=0.03`. This preserves margin protection and, on recorded scores, recovers E02, E05, E07, and E11 (11/12 expected task outcomes); E06 still falls back. E08 still relies on the unknown-attack guard.

**Decision pending:** the user edits the environment file and confirms which pair was applied; then rerun the unchanged evaluator in a new timestamped directory. No claim of tuned-run success is made in this report.

## Artifacts and verification

- This run: `eval/runs/20261121T145259Z/`; original evaluator artifacts preserved as `evaluator-results.json` and `evaluator-report.md`.
- Prior supplied evaluation preserved separately under its original timestamp in `eval/runs/`.
- Backend regression suite: 247 passed, 1 skipped (opt-in live smoke), 1 deselected (packaging test creates environment files prohibited by the user).
- Frontend: build passed; 28 test files / 390 tests passed.
- Application/contract/corpus sources match the pre-run SHA-256 snapshot.
