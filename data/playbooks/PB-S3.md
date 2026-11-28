# PB-S3 Public S3 Bucket Response
attack_type: public_s3_bucket
severity_default: high

## Detection signals
- A storage finding reports anonymous read or write access on a bucket.
- A bucket policy or access-control entry grants access to a public principal.
- Public-access protection is disabled or differs from the approved baseline.
- Access logs show anonymous requests against objects intended to remain private.

## Steps
PB-S3-01 | Detect | Confirm public access on the reported bucket in the cloud console. | SOC Tier 2
PB-S3-02 | Contain | Enable Block Public Access on the reported bucket after owner confirmation. | SOC Tier 2
PB-S3-03 | Investigate | Review the bucket access logs for unexpected downloads. | SOC Tier 2
PB-S3-04 | Investigate | Preserve the bucket policy, access-control configuration, public-access settings, and recent change events before further changes. | Cloud Security Analyst
PB-S3-05 | Investigate | Confirm the bucket owner, intended audience, and data classification without downloading exposed object contents. | Data Owner
PB-S3-06 | Contain | Remove unintended public policy grants and access-control entries through the approved change workflow while preserving required private access. | Cloud Administrator
PB-S3-07 | Investigate | Establish the exposure window and distinguish confirmed object access from missing or incomplete access logs. | Cloud Security Analyst
PB-S3-08 | Eradicate | Correct the deployment template or configuration rule that introduced the public access so subsequent deployments preserve the approved baseline. | Platform Engineer
PB-S3-09 | Recover | Verify that anonymous access is denied and the intended application identities can still access their authorized objects. | Cloud Administrator
PB-S3-10 | Escalate | Send the incident commander the exposure window, data classification, observed access, and unresolved evidence gaps. | SOC Tier 2

## Escalation
Escalate immediately to the incident commander and data owner when sensitive objects may have been publicly accessible or anonymous writes are possible. Consult the privacy lead for potential data exposure. If public access is intentional, obtain the owner's documented exception before applying disruptive controls; missing logs must not be treated as proof that no access occurred. This playbook is a synthetic training procedure.
