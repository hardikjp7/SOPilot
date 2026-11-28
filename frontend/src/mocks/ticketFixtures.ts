// Additional canned ticket responses for the existing demo runs. Synthetic data;
// the original fixtures.ts and all contract shapes remain unchanged.
import type { IncidentTicket } from '../api/types';
import { draftTicket, lowConfidenceRun, noMatchRun } from './fixtures';

const phishingTicket: IncidentTicket = {
  ticket_id: 'INC-20261117-002', run_id: lowConfidenceRun.run_id,
  title: 'Credential-harvesting email with a clicked link',
  severity: 'high', status: 'draft',
  timeline: [
    { time: lowConfidenceRun.parsed.timestamp, event: lowConfidenceRun.parsed.summary },
    { time: null, event: lowConfidenceRun.checklist.escalation_note },
  ],
  root_cause: {
    hypothesis: 'The clicked email may have exposed user credentials.', confidence: 0.5,
    basis: ['The alert reports a credential-harvesting link and a user click.'],
  },
  iocs: lowConfidenceRun.parsed.iocs,
  containment_actions: lowConfidenceRun.checklist.steps.map((step) => ({
    action: step.action, citation: step.citation, status: 'recommended',
  })),
  affected_assets: [], cves: [], approved_by: null, approved_at: null,
  audit_ref: lowConfidenceRun.run_id,
};

const usbTicket: IncidentTicket = {
  ticket_id: 'INC-20261117-003', run_id: noMatchRun.run_id,
  title: 'USB file-copy alert requiring manual escalation', severity: 'medium', status: 'draft',
  timeline: [
    { time: null, event: noMatchRun.parsed.summary },
    { time: null, event: noMatchRun.checklist.escalation_note },
  ],
  root_cause: {
    hypothesis: 'The recorded USB copy may represent data removal; intent remains unconfirmed.', confidence: 0.4,
    basis: ['EndpointDLP recorded a large file copy to a removable USB drive.'],
  },
  iocs: noMatchRun.parsed.iocs, containment_actions: [], affected_assets: ['HR-LT-031'],
  cves: [], approved_by: null, approved_at: null, audit_ref: noMatchRun.run_id,
};

export const draftTicketFixtures: IncidentTicket[] = [draftTicket, phishingTicket, usbTicket];
