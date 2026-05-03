// Wizard → backend persistence helpers (Task #12).
//
// Each helper mirrors one wizard step. They are best-effort: when the
// backend is reachable we POST the step's data so the org survives a
// browser wipe / different device; when it isn't we let apiFetch's mock
// fallback take over so the wizard still completes end-to-end.
//
// We deliberately do NOT block the wizard on these calls — the local
// store / AuthContext patch already happens inside SignupWizard.commitStep
// before we fire these. If a write fails, we surface a quiet toast so the
// ED knows to retry from Settings; we don't strand them mid-onboarding.

import toast from 'react-hot-toast';
import { apiFetch } from '../../api/client';
import type { WizardData } from '../../utils/wizard';

async function postJson(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Save org-profile fields (registration #, 80G, FCRA, logo) onto the ngo. */
export async function persistOrgProfile(
  ngoName: string,
  op: NonNullable<WizardData['orgProfile']>,
): Promise<void> {
  const ok = await postJson('/settings/ngo', {
    name: ngoName,
    reg_no: op.registrationNumber || null,
    fcra_reg: null,
    pan: null,
    state: null,
    section_80g: op.section80GNumber || null,
    fcra_status: op.fcraStatus || null,
    logo_data_url: op.logoDataUrl || null,
  });
  if (!ok) toast.error('Org profile saved locally — sync from Settings when backend is back.');
}

/** Create the wizard's first program server-side as a draft campaign. */
export async function persistFirstProgram(
  fp: NonNullable<WizardData['firstProgram']>,
): Promise<void> {
  if (!fp.name?.trim() || !fp.causeArea) return;
  const ok = await postJson('/fundraising/campaigns', {
    title: fp.name.trim(),
    cause: fp.causeArea,
    goal: 250000,
    status: 'draft',
    image: 'linear-gradient(135deg, #0F766E, #14b8a6)',
    details: {
      source: 'signup-wizard',
      startDate: fp.startDate ?? null,
      geography: fp.geography ?? null,
    },
  });
  if (!ok) toast.error('Program saved locally — it will sync once the backend is reachable.');
}

/** Queue invites server-side (rows insert; email send is a future worker). */
export async function persistInvites(
  invites: NonNullable<WizardData['inviteTeam']>['invites'],
): Promise<void> {
  const cleaned = (invites ?? []).filter((i) => i.email.trim() && i.role);
  if (!cleaned.length) return;
  const ok = await postJson('/onboarding/invites', { invites: cleaned });
  if (!ok) toast.error('Invites saved locally — re-send from Settings → Team later.');
}

/** Bulk-upsert manually entered beneficiaries onto the org. */
export async function persistBeneficiaries(
  rows: { name: string; program: string; familySize: string }[],
): Promise<void> {
  const valid = rows
    .filter((r) => r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      program: r.program.trim() || 'General',
      location: '—',
      aadhaar: false,
      familySize: Math.max(1, Number(r.familySize) || 1),
      details: { source: 'signup-wizard' },
    }));
  if (!valid.length) return;
  const ok = await postJson('/programs/beneficiaries/bulk', { beneficiaries: valid });
  if (!ok) toast.error('Beneficiaries saved locally — sync from Programs when backend is back.');
}

/** Save the verified WhatsApp number onto the ngo. */
export async function persistWhatsApp(
  ngoName: string,
  cw: NonNullable<WizardData['connectWhatsapp']>,
): Promise<void> {
  if (!cw.phone) return;
  const ok = await postJson('/settings/ngo', {
    name: ngoName,
    whatsapp_phone: cw.phone,
    whatsapp_verified: !!cw.verified,
    whatsapp_connected_at: new Date().toISOString(),
  });
  if (!ok) toast.error('WhatsApp number saved locally — sync from Settings when backend is back.');
}
