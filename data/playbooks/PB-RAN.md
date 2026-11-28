# PB-RAN Ransomware Response
attack_type: ransomware
severity_default: critical

## Detection signals
- Many files on one host are renamed or rewritten in a short interval.
- A ransom-style note appears alongside inaccessible documents.
- Endpoint telemetry reports attempted recovery-copy deletion or backup interference.
- Similar file changes appear on connected shares or additional endpoints.

## Steps
PB-RAN-01 | Detect | Confirm encryption activity on the reported host in the EDR console. | SOC Tier 2
PB-RAN-02 | Contain | Isolate the affected host from the network via EDR. | SOC Tier 2
PB-RAN-03 | Escalate | Notify the incident commander with the host and alert evidence. | SOC Tier 2
PB-RAN-04 | Investigate | Preserve endpoint process telemetry, file-change events, recovery-copy alerts, and relevant timestamps without executing suspect files. | Endpoint Analyst
PB-RAN-05 | Investigate | Identify affected shares and peer hosts from existing endpoint and file-access logs to establish the incident scope. | SOC Tier 2
PB-RAN-06 | Contain | With the incident commander's approval, restrict affected service accounts and share access while documenting dependencies and rollback steps. | Identity Administrator
PB-RAN-07 | Contain | Ask the backup owner to protect known-good recovery points from modification and verify the last successful offline backup. | Backup Administrator
PB-RAN-08 | Eradicate | Rebuild confirmed affected endpoints from a trusted baseline after evidence preservation and incident commander approval. | Endpoint Administrator
PB-RAN-09 | Recover | Restore approved data from verified clean backups in an isolated recovery environment and validate integrity with the asset owner. | Recovery Lead
PB-RAN-10 | Recover | Reconnect recovered systems only after endpoint checks pass and monitor for renewed encryption or unauthorized access. | Incident Commander

## Escalation
Escalate immediately to the incident commander for confirmed encryption, backup interference, or spread beyond one endpoint. Notify the recovery lead when recovery objectives are at risk and the privacy lead if evidence suggests sensitive data access. Preserve evidence before rebuild or restore decisions; do not interact with ransom-payment instructions. This playbook is a synthetic training procedure.
