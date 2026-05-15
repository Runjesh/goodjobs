import type { DonationCompletionSnapshot } from './donationCompletion';
import { donationCompletionHeadline } from './donationCompletion';
import { renewalWorkspacePath } from './complianceRenewal';
import type { ComplianceDocument } from '../store/useStore';
import { toastSuccessWithNext } from './toastNext';
import { appNavigate } from './appNavigate';

export function toastEnrollSuccess(name: string, beneficiaryId: string): void {
  const id = encodeURIComponent(beneficiaryId);
  toastSuccessWithNext(
    `${name.trim()} enrolled.`,
    {
      label: 'Record baseline outcome',
      onClick: () => appNavigate(`/programs?beneficiary=${id}&action=outcome`),
    },
  );
}

export function toastDonationSuccess(snap: DonationCompletionSnapshot): void {
  const donorPath = `/crm?donor=${encodeURIComponent(snap.donorId)}`;
  const next = snap.receiptGenerated
    ? { label: 'Open donor profile', onClick: () => appNavigate(donorPath) }
    : {
        label: 'Send pending receipt',
        onClick: () => appNavigate('/finance?view=exceptions'),
      };
  toastSuccessWithNext(donationCompletionHeadline(snap), next);
}

export function toastGrantLiveSuccess(grantId: string | number, company?: string): void {
  const label = company ? `${company} is live` : 'Grant is live';
  toastSuccessWithNext(
    `${label}. Programme, compliance, budget, and stewardship started.`,
    {
      label: 'Open grant workspace',
      onClick: () => appNavigate(`/grants/${encodeURIComponent(String(grantId))}`),
    },
    '✓',
  );
}

export function toastGrantStageSuccess(grantId: string | number, stageLabel: string): void {
  toastSuccessWithNext(
    `Grant moved to ${stageLabel}.`,
    {
      label: 'Open grant workspace',
      onClick: () => appNavigate(`/grants/${encodeURIComponent(String(grantId))}`),
    },
  );
}

export function toastMisApprovedSuccess(beneficiaryName: string, beneficiaryId?: string): void {
  const path = beneficiaryId
    ? `/programs?beneficiary=${encodeURIComponent(beneficiaryId)}`
    : '/programs?tab=mis';
  toastSuccessWithNext(
    beneficiaryName
      ? `MIS approved for ${beneficiaryName}.`
      : 'MIS submission approved.',
    {
      label: beneficiaryId ? 'View beneficiary timeline' : 'Open MIS queue',
      onClick: () => appNavigate(path),
    },
  );
}

export function toastComplianceUploadSuccess(doc: ComplianceDocument, allDocs: ComplianceDocument[]): void {
  const expiring =
    doc.status === 'Expiring Soon' ||
    doc.status === 'Expired' ||
    (doc.expiry && new Date(doc.expiry).getTime() - Date.now() < 45 * 86_400_000);

  if (expiring) {
    toastSuccessWithNext(
      `${doc.name} uploaded to Compliance Vault.`,
      {
        label: 'Start renewal checklist',
        onClick: () => appNavigate(renewalWorkspacePath(doc.id)),
      },
    );
    return;
  }

  toastSuccessWithNext(
    `${doc.name} uploaded to Compliance Vault.`,
    {
      label: 'View registration vault',
      onClick: () => appNavigate(`/compliance?focus=${encodeURIComponent(doc.id)}`),
    },
  );
}

export function toastComplianceRenewedSuccess(docName: string): void {
  toastSuccessWithNext(
    `${docName} renewed — tasks closed.`,
    {
      label: 'View registration vault',
      onClick: () => appNavigate('/compliance'),
    },
    '✓',
  );
}
