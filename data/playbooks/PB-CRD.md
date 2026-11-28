# PB-CRD Credential Stuffing Response
attack_type: credential_stuffing
severity_default: high

## Detection signals
- Login failures spike across many accounts within a short time window.
- Requests arrive from multiple source addresses with repeated client fingerprints.
- A small number of successful sign-ins follow the failed-login burst.
- Login traffic differs from a known service integration or approved load test.

## Steps
PB-CRD-01 | Detect | Confirm the failed login burst in authentication logs. | SOC Tier 2
PB-CRD-02 | Contain | Apply the approved temporary rate limit to the affected login endpoint. | SOC Tier 2
PB-CRD-03 | Investigate | Review successful sign-ins associated with the alert. | SOC Tier 2
PB-CRD-04 | Investigate | Preserve authentication timestamps, account identifiers, client fingerprints, and outcome counts without collecting passwords or session secrets. | Identity Analyst
PB-CRD-05 | Investigate | Compare the request pattern with expected integrations and approved test windows to exclude a benign retry loop. | Application Owner
PB-CRD-06 | Contain | Apply the approved additional sign-in challenge to the affected population and record the change window and rollback criteria. | Identity Administrator
PB-CRD-07 | Contain | Revoke sessions and require an approved account recovery workflow only for accounts with evidence of unauthorized successful access. | Identity Administrator
PB-CRD-08 | Eradicate | Remove unauthorized recovery methods or application grants from confirmed compromised accounts after preserving the changes as evidence. | Identity Administrator
PB-CRD-09 | Recover | Verify normal sign-in success rates and relax temporary rate limits gradually after malicious traffic subsides. | Application Owner
PB-CRD-10 | Escalate | Provide the SOC lead with attempted accounts, confirmed compromises, control changes, and unresolved access concerns. | SOC Tier 2

## Escalation
Escalate to the SOC lead for confirmed account access, privileged-account targeting, or continued attacks after approved controls are applied. Engage the application owner if rate limits affect legitimate users. If the evidence only shows failed attempts, retain that distinction and do not assert account compromise. This playbook is a synthetic training procedure.
