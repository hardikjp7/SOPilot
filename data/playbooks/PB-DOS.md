# PB-DOS DDoS Response
attack_type: ddos
severity_default: high

## Detection signals
- Request rate or connection volume exceeds the service baseline while availability falls.
- Edge telemetry shows concentrated request patterns from many source addresses.
- Upstream bandwidth, connection queues, or application workers are saturated.
- A planned load test or release does not explain the traffic change.

## Steps
PB-DOS-01 | Detect | Confirm the traffic surge and service impact in monitoring. | SOC Tier 2
PB-DOS-02 | Contain | Enable the approved DDoS mitigation profile for the affected service. | SOC Tier 2
PB-DOS-03 | Escalate | Notify the network incident lead of the service impact. | SOC Tier 2
PB-DOS-04 | Investigate | Preserve aggregate edge metrics, sampled request metadata, affected routes, and the start of the availability impact. | Network Analyst
PB-DOS-05 | Investigate | Compare traffic with the service baseline and approved test calendar to distinguish an attack from a release or capacity issue. | Service Owner
PB-DOS-06 | Contain | Apply approved route-specific rate limits or traffic challenges and record the expected user impact and rollback conditions. | Network Administrator
PB-DOS-07 | Contain | Coordinate upstream traffic filtering through the established support channel when local mitigation cannot protect the affected service. | Network Incident Lead
PB-DOS-08 | Recover | Validate service health, latency, and error rates from independent monitoring after the mitigation stabilizes traffic. | Service Owner
PB-DOS-09 | Recover | Remove temporary controls in stages after traffic returns to baseline and verify that legitimate clients remain reachable. | Network Administrator
PB-DOS-10 | Escalate | Record the traffic timeline, availability impact, mitigation results, and remaining capacity risks for incident review. | Network Incident Lead

## Escalation
Escalate immediately to the network incident lead for sustained availability loss or upstream link saturation. Involve the service owner before changes that could block legitimate clients, and activate the established upstream support path if local controls are insufficient. Do not infer hostile intent from traffic volume alone. This playbook is a synthetic training procedure.
