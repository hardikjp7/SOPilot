# INC-20261118-002: Phishing alert ALR-PHI from synthetic-mail

Status: approved
Severity: high

## Root cause hypothesis

Hypothesis: A phishing email with mismatched sender and reply-to information, failed SPF/DKIM/DMARC authentication, and a deceptive login destination was delivered to the recipient; the reported click may have exposed the user to a deceptive sign-in page, but credential compromise is not confirmed.

## Timeline

- 2026-11-18T09:00:00Z: The message shows classic phishing indicators: sender and reply-to mismatch, a deceptive display name, failed SPF/DKIM/DMARC authentication, and a login URL that differs from the displayed destination. The recipient reported clicking the link and noticing the sign-in page address changed, but they did not enter any information, so credential compromise is not confirmed.
- 2026-11-18T18:48:56.682538+00:00: parse stage completed
- 2026-11-18T18:48:59.069616+00:00: retrieve stage completed
- 2026-11-18T18:49:09.864244+00:00: generate stage completed
- 2026-11-18T18:49:11.723209+00:00: verify stage completed

## Containment actions

- Review the reported message headers and URL in the mail security console. Context from alert: {&quot;ips&quot;: &#91;&quot;203.0.113.42&quot;&#93;, &quot;domains&quot;: &#91;&quot;example.com&quot;, &quot;example.net&quot;, &quot;example.org&quot;, &quot;mail.example.org&quot;, &quot;relay.example.net&quot;, &quot;documents.example.org&quot;, &quot;review.example.net&quot;&#93;, &quot;emails&quot;: &#91;&quot;sender@example.com&quot;, &quot;review-desk@example.net&quot;, &quot;analyst@example.org&quot;, &quot;synthetic-msg-0042@example.com&quot;&#93;} &#91;PB-PHI-01&#93; (approved)
- Quarantine the reported message using the mail security console. Context from alert: {&quot;ips&quot;: &#91;&quot;203.0.113.42&quot;&#93;, &quot;domains&quot;: &#91;&quot;example.com&quot;, &quot;example.net&quot;, &quot;example.org&quot;, &quot;mail.example.org&quot;, &quot;relay.example.net&quot;, &quot;documents.example.org&quot;, &quot;review.example.net&quot;&#93;, &quot;emails&quot;: &#91;&quot;sender@example.com&quot;, &quot;review-desk@example.net&quot;, &quot;analyst@example.org&quot;, &quot;synthetic-msg-0042@example.com&quot;&#93;} &#91;PB-PHI-02&#93; (approved)
- Review sign-in logs for the reported account for suspicious activity. Context from alert: {&quot;ips&quot;: &#91;&quot;203.0.113.42&quot;&#93;, &quot;domains&quot;: &#91;&quot;example.com&quot;, &quot;example.net&quot;, &quot;example.org&quot;, &quot;mail.example.org&quot;, &quot;relay.example.net&quot;, &quot;documents.example.org&quot;, &quot;review.example.net&quot;&#93;, &quot;emails&quot;: &#91;&quot;sender@example.com&quot;, &quot;review-desk@example.net&quot;, &quot;analyst@example.org&quot;, &quot;synthetic-msg-0042@example.com&quot;&#93;} &#91;PB-PHI-03&#93; (approved)
- Search mail telemetry for messages sharing the confirmed sender, subject, or URL and record affected recipients. Context from alert: {&quot;ips&quot;: &#91;&quot;203.0.113.42&quot;&#93;, &quot;domains&quot;: &#91;&quot;example.com&quot;, &quot;example.net&quot;, &quot;example.org&quot;, &quot;mail.example.org&quot;, &quot;relay.example.net&quot;, &quot;documents.example.org&quot;, &quot;review.example.net&quot;&#93;, &quot;emails&quot;: &#91;&quot;sender@example.com&quot;, &quot;review-desk@example.net&quot;, &quot;analyst@example.org&quot;, &quot;synthetic-msg-0042@example.com&quot;&#93;} &#91;PB-PHI-05&#93; (approved)
- After analyst confirmation, block the malicious sender and URL in the mail security controls with an expiry and rollback owner. Context from alert: {&quot;ips&quot;: &#91;&quot;203.0.113.42&quot;&#93;, &quot;domains&quot;: &#91;&quot;example.com&quot;, &quot;example.net&quot;, &quot;example.org&quot;, &quot;mail.example.org&quot;, &quot;relay.example.net&quot;, &quot;documents.example.org&quot;, &quot;review.example.net&quot;&#93;, &quot;emails&quot;: &#91;&quot;sender@example.com&quot;, &quot;review-desk@example.net&quot;, &quot;analyst@example.org&quot;, &quot;synthetic-msg-0042@example.com&quot;&#93;} &#91;PB-PHI-06&#93; (approved)
- Confirm that affected users can sign in safely and monitor their accounts for repeated suspicious activity. Context from alert: {&quot;ips&quot;: &#91;&quot;203.0.113.42&quot;&#93;, &quot;domains&quot;: &#91;&quot;example.com&quot;, &quot;example.net&quot;, &quot;example.org&quot;, &quot;mail.example.org&quot;, &quot;relay.example.net&quot;, &quot;documents.example.org&quot;, &quot;review.example.net&quot;&#93;, &quot;emails&quot;: &#91;&quot;sender@example.com&quot;, &quot;review-desk@example.net&quot;, &quot;analyst@example.org&quot;, &quot;synthetic-msg-0042@example.com&quot;&#93;} &#91;PB-PHI-09&#93; (approved)

Approved by: Demo Analyst at 2026-11-18T18:50:15.363862+00:00

Audit reference: RUN-9f3f77f18ec0

## Root cause confidence and basis

0.41280859277300064
- The message shows classic phishing indicators: sender and reply-to mismatch, a deceptive display name, failed SPF/DKIM/DMARC authentication, and a login URL that differs from the displayed destination. The recipient reported clicking the link and noticing the sign-in page address changed, but they did not enter any information, so credential compromise is not confirmed.
- $.message.from
- $.message.replyTo
- $.message.display_name
- $.message.url
- $.message.headers&#91;&quot;Authentication-Results&quot;&#93;
- $.message.links&#91;0&#93;.display
- $.message.links&#91;0&#93;.href
- $.message.links&#91;0&#93;.redirects&#91;0&#93;

## Affected assets

- 203.0.113.42
- example.com
- example.net
- example.org
- mail.example.org
- relay.example.net
- documents.example.org
- review.example.net

## CVEs

- CVE-2099-900002

## Indicators

- ips: 203.0.113.42
- domains: example.com, example.net, example.org, mail.example.org, relay.example.net, documents.example.org, review.example.net
- urls: https://example.com/login, https://documents.example.org/review, https://review.example.net/session
- emails: sender@example.com, review-desk@example.net, analyst@example.org, synthetic-msg-0042@example.com
- cve_ids: CVE-2099-900002

## Citation sources

- PB-PHI / PB-PHI-01: PB-PHI-01 | Detect | Review the reported message headers and URL in the mail security console. | SOC Tier 2
- PB-PHI / PB-PHI-02: PB-PHI-02 | Contain | Quarantine the reported message using the mail security console. | SOC Tier 2
- PB-PHI / PB-PHI-03: PB-PHI-03 | Investigate | Review sign-in logs for the reported account for suspicious activity. | SOC Tier 2
- PB-PHI / PB-PHI-05: PB-PHI-05 | Investigate | Search mail telemetry for messages sharing the confirmed sender, subject, or URL and record affected recipients. | Mail Security Analyst
- PB-PHI / PB-PHI-06: PB-PHI-06 | Contain | After analyst confirmation, block the malicious sender and URL in the mail security controls with an expiry and rollback owner. | Mail Security Administrator
- PB-PHI / PB-PHI-09: PB-PHI-09 | Recover | Confirm that affected users can sign in safely and monitor their accounts for repeated suspicious activity. | SOC Tier 2
