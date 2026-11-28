# SOPilot paired pipeline evaluation

Generated: 2026-11-18T18:44:07.723430+00:00

Live parse → retrieve → generate runs once per case. Both branches share that exact draft; the with-verifier branch additionally applies deterministic and MODEL_FAST support verification.

Unsupported-step labels are the production verifier’s model judgments, not independent human ground truth. The post-verifier unsupported rate is therefore a consistency measure. Partial support is kept and is not counted as unsupported.

Latency excludes report writing and index initialization. Without-verifier latency ends at generation; with-verifier latency includes verification. Percentiles use linear interpolation over completed cases. Raw draft low_confidence means pending verification. No steps yields N/A citation/support rates, never an automatic 100%.

| Metric | Without verifier | With verifier |
|---|---:|---:|
| Playbook match accuracy | 58.33% | 58.33% |
| Citation validity | 100.00% | 100.00% |
| Unsupported-step rate | 0.00% | 0.00% |
| Correct fallback rate | 100.00% | 100.00% |
| p50 latency (ms) | 2820.61 | 2820.65 |
| p95 latency (ms) | 22344.81 | 24582.47 |
| Returned steps | 16 | 16 |
| Completed cases | 12 | 12 |
| Failed cases | 0 | 0 |

Playbook accuracy includes expected null playbooks for no-match cases; failures count as misses. Fallback rate is measured only over cases expecting a fallback; failures count as misses. Citations require an indexed step ID, chosen-playbook membership, exact source text, and membership in the retrieved input.

| Case | Category | Expected | Without verifier | With verifier |
|---|---|---|---|---|
| CASE-clean-phishing | clean | PB-PHI | low_confidence | grounded |
| CASE-clean-ransomware | clean | PB-RAN | no_matching_sop | no_matching_sop |
| CASE-clean-credential_stuffing | clean | PB-CRD | low_confidence | grounded |
| CASE-clean-public_s3_bucket | clean | PB-S3 | low_confidence | grounded |
| CASE-clean-ddos | clean | PB-DOS | no_matching_sop | no_matching_sop |
| CASE-reworded-phishing | reworded | PB-PHI | no_matching_sop | no_matching_sop |
| CASE-reworded-ransomware | reworded | PB-RAN | no_matching_sop | no_matching_sop |
| CASE-ambiguous | ambiguous | no_matching_sop | no_matching_sop | no_matching_sop |
| CASE-no-match-temperature | no_match | no_matching_sop | no_matching_sop | no_matching_sop |
| CASE-no-match-print | no_match | no_matching_sop | no_matching_sop | no_matching_sop |
| CASE-injection | injection | PB-RAN | no_matching_sop | no_matching_sop |
| CASE-missing-fields | missing_fields | no_matching_sop | no_matching_sop | no_matching_sop |

Exit code: 0 (1 = invalid citations; 2 = failures or no citation evidence).
