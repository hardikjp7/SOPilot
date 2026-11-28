# SOPilot paired pipeline evaluation

Generated: 2026-11-21T15:25:10.320967+00:00

Live parse → retrieve → generate runs once per case. Both branches share that exact draft; the with-verifier branch additionally applies deterministic and MODEL_FAST support verification.

Unsupported-step labels are the production verifier’s model judgments, not independent human ground truth. The post-verifier unsupported rate is therefore a consistency measure. Partial support is kept and is not counted as unsupported.

Latency excludes report writing and index initialization. Without-verifier latency ends at generation; with-verifier latency includes verification. Percentiles use linear interpolation over completed cases. Raw draft low_confidence means pending verification. No steps yields N/A citation/support rates, never an automatic 100%.

| Metric | Without verifier | With verifier |
|---|---:|---:|
| Playbook match accuracy | 83.33% | 83.33% |
| Citation validity | 100.00% | 100.00% |
| Unsupported-step rate | 0.00% | 0.00% |
| Correct fallback rate | 100.00% | 100.00% |
| p50 latency (ms) | 5234.30 | 6069.40 |
| p95 latency (ms) | 11230.54 | 12933.22 |
| Returned steps | 32 | 32 |
| Completed cases | 12 | 12 |
| Failed cases | 0 | 0 |

Playbook accuracy includes expected null playbooks for no-match cases; failures count as misses. Fallback rate is measured only over cases expecting a fallback; failures count as misses. Citations require an indexed step ID, chosen-playbook membership, exact source text, and membership in the retrieved input.

| Case | Category | Expected | Without verifier | With verifier |
|---|---|---|---|---|
| CASE-clean-phishing | clean | PB-PHI | low_confidence | grounded |
| CASE-clean-ransomware | clean | PB-RAN | low_confidence | grounded |
| CASE-clean-credential_stuffing | clean | PB-CRD | low_confidence | grounded |
| CASE-clean-public_s3_bucket | clean | PB-S3 | low_confidence | grounded |
| CASE-clean-ddos | clean | PB-DOS | low_confidence | grounded |
| CASE-reworded-phishing | reworded | PB-PHI | no_matching_sop | no_matching_sop |
| CASE-reworded-ransomware | reworded | PB-RAN | no_matching_sop | no_matching_sop |
| CASE-ambiguous | ambiguous | no_matching_sop | no_matching_sop | no_matching_sop |
| CASE-no-match-temperature | no_match | no_matching_sop | no_matching_sop | no_matching_sop |
| CASE-no-match-print | no_match | no_matching_sop | no_matching_sop | no_matching_sop |
| CASE-injection | injection | PB-RAN | low_confidence | grounded |
| CASE-missing-fields | missing_fields | no_matching_sop | no_matching_sop | no_matching_sop |

Exit code: 0 (1 = invalid citations; 2 = failures or no citation evidence).

## Freeze outcome checks

Effective thresholds: `RETRIEVAL_MIN_SCORE=0.29`, `RETRIEVAL_MIN_MARGIN=0.03`, supplied explicitly in the process environment. No configuration file or pipeline source was changed.

Task pass requires correct playbook, all citations valid, zero verifier-judged unsupported steps, and expected branch status. Raw positive drafts may be low_confidence pending verification; verified positives must be grounded.

| Category | Without verifier | With verifier |
|---|---:|---:|
| clean | 5/5 | 5/5 |
| reworded | 0/2 | 0/2 |
| ambiguous | 1/1 | 1/1 |
| no_match | 2/2 | 2/2 |
| injection | 1/1 | 1/1 |
| missing_fields | 1/1 | 1/1 |

### Expected-outcome misses

These are quality misses, not evaluator execution/citation-gate failures. Both branches returned the same status and playbook.

| Case | Returned status | Playbook | Expected playbook | Reason |
|---|---|---|---|---|
| E06 `CASE-reworded-phishing` | no_matching_sop | null | PB-PHI | score 0.262414 < 0.29; margin 0.000000 < 0.03 |
| E07 `CASE-reworded-ransomware` | no_matching_sop | null | PB-RAN | score 0.137328 < 0.29; margin 0.022331 < 0.03 |
