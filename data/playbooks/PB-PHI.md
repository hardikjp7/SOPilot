# PB-PHI Phishing Response
attack_type: phishing
severity_default: high

## Detection signals
- A reported message impersonates an internal workflow and requests an urgent sign-in.
- Sender, reply-to address, and displayed link destination disagree.
- Mail authentication fails or a redirect leads to an unexpected example domain.
- A recipient reports opening a link or attachment shortly before an unusual sign-in.

## Steps
PB-PHI-01 | Detect | Review the reported message headers and URL in the mail security console. | SOC Tier 2
PB-PHI-02 | Contain | Quarantine the reported message using the mail security console. | SOC Tier 2
PB-PHI-03 | Investigate | Review sign-in logs for the reported account for suspicious activity. | SOC Tier 2
PB-PHI-04 | Investigate | Preserve the original message, headers, delivery identifiers, and reported user actions in the incident record. | SOC Tier 1
PB-PHI-05 | Investigate | Search mail telemetry for messages sharing the confirmed sender, subject, or URL and record affected recipients. | Mail Security Analyst
PB-PHI-06 | Contain | After analyst confirmation, block the malicious sender and URL in the mail security controls with an expiry and rollback owner. | Mail Security Administrator
PB-PHI-07 | Contain | If account compromise is supported by sign-in evidence, revoke active sessions and require a password reset through the approved identity workflow. | Identity Administrator
PB-PHI-08 | Eradicate | Remove confirmed malicious inbox rules and forwarding rules after preserving their configuration as evidence. | Mail Security Administrator
PB-PHI-09 | Recover | Confirm that affected users can sign in safely and monitor their accounts for repeated suspicious activity. | SOC Tier 2
PB-PHI-10 | Escalate | Send the SOC lead the recipient scope, confirmed account impact, evidence references, and outstanding containment decisions. | Incident Commander

## Escalation
Escalate immediately to the SOC lead if a privileged account is affected, account takeover is confirmed, or message scope cannot be established. Engage the identity owner for session revocation and the incident commander if sensitive data may have been accessed. If the message cannot be verified as malicious, preserve evidence and request analyst review before applying blocks. This playbook is a synthetic training procedure.
