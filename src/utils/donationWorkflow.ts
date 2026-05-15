import { apiFetch } from '../api/client';
import { useStore } from '../store/useStore';
import {
  markDonationThanked,
  onDonationSaved,
  type DonationCompletionSnapshot,
  type DonationWorkflowInput,
} from './donationCompletion';
import { toastDonationSuccess } from './workflowSuccess';

export async function finishDonationWorkflow(
  input: DonationWorkflowInput,
): Promise<DonationCompletionSnapshot> {
  const state = useStore.getState();
  const snap = await onDonationSaved(input, {
    donors: state.donors,
    campaigns: state.campaigns,
    ngoName: state.ngoDetails.name || 'GoodJobs NGO',
    addDonorWithId: state.addDonorWithId,
    updateDonor: state.updateDonor,
    addTransactionWithId: state.addTransactionWithId,
    upsertTask: state.upsertTaskByIntent,
    addOutreachEntry: state.addOutreachEntry,
  });

  toastDonationSuccess(snap);

  if (input.source === 'fundraising') {
    try {
      const r = await apiFetch('/fundraising/campaigns');
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.campaigns)) state.setCampaigns(data.campaigns);
      }
    } catch { /* ignore */ }
  }

  return snap;
}

export function handleDonationThanked(snap: DonationCompletionSnapshot): void {
  markDonationThanked(snap, useStore.getState().addOutreachEntry);
}
