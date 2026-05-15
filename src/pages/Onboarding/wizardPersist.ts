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
import { apiFetch, expectsRealBackend } from '../../api/client';
import { readApiError } from '../../utils/apiPersist';
import type { WizardData } from '../../utils/wizard';

async function postJson(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      noMockFallback: expectsRealBackend(),
    });
    if (res.ok) return true;
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (data && (data.ok === true || data.status === 'created' || typeof data.imported === 'number')) {
      return true;
    }
    if (expectsRealBackend()) {
      toast.error(await readApiError(res));
    }
    return false;
  } catch {
    return false;
  }
}

/** Save org-profile fields (registration #, 80G, FCRA, logo) onto the ngo.
 *  Sends only the fields the user actually filled — backend uses COALESCE
 *  so missing keys never null prior step writes. */
export async function persistOrgProfile(
  ngoName: string,
  op: NonNullable<WizardData['orgProfile']>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (ngoName) payload.name = ngoName;
  if (op.registrationNumber) payload.reg_no = op.registrationNumber;
  if (op.section80GNumber) payload.section_80g = op.section80GNumber;
  if (op.fcraStatus) payload.fcra_status = op.fcraStatus;
  if (op.logoDataUrl) payload.logo_data_url = op.logoDataUrl;
  if (Object.keys(payload).length === 0) return;
  const ok = await postJson('/settings/ngo', payload);
  if (!ok && !expectsRealBackend()) toast.error('Org profile saved locally — sync from Settings when backend is back.');
}

/** Create the wizard's first program server-side.
 *  Two writes: a draft fundraising campaign (so the program shows up in the
 *  Fundraising surface) AND an append into ngos.meta.programs (so it shows
 *  up in /programs after a fresh login on a different device — that's the
 *  list the Programs page derives from). */
export async function persistFirstProgram(
  fp: NonNullable<WizardData['firstProgram']>,
): Promise<void> {
  if (!fp.name?.trim() || !fp.causeArea) return;
  const title = fp.name.trim();
  const okCampaign = await postJson('/fundraising/campaigns', {
    title,
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
  const okProgram = await postJson('/settings/ngo', {
    program_name: title,
    cause_area: fp.causeArea,
  });
  if ((!okCampaign || !okProgram) && !expectsRealBackend()) {
    toast.error('Program saved locally — it will sync once the backend is reachable.');
  }
}

// Mirrors the backend's lightweight RFC-5322-ish check. We don't try to
// be exhaustive — just enough to keep "not-an-email" / "asha" / "x@" out
// of the queue. The backend re-validates so this is purely a UX guard.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Queue invites server-side (rows insert; email send is a future worker). */
export async function persistInvites(
  invites: NonNullable<WizardData['inviteTeam']>['invites'],
): Promise<void> {
  const cleaned = (invites ?? []).filter(
    (i) => i.email.trim() && i.role && EMAIL_RE.test(i.email.trim()),
  );
  if (!cleaned.length) return;
  const ok = await postJson('/onboarding/invites', { invites: cleaned });
  if (!ok && !expectsRealBackend()) toast.error('Invites saved locally — re-send from Settings → Team later.');
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
  if (!ok && !expectsRealBackend()) toast.error('Beneficiaries saved locally — sync from Programs when backend is back.');
}

/** Save the verified WhatsApp number onto the ngo.
 *  Sends ONLY the whatsapp_* fields — backend COALESCEs the rest, so the
 *  registration number / 80G saved in step 1 are not blanked out here. */
export async function persistWhatsApp(
  _ngoName: string,
  cw: NonNullable<WizardData['connectWhatsapp']>,
): Promise<void> {
  if (!cw.phone) return;
  const ok = await postJson('/settings/ngo', {
    whatsapp_phone: cw.phone,
    whatsapp_verified: !!cw.verified,
    whatsapp_connected_at: new Date().toISOString(),
  });
  if (!ok && !expectsRealBackend()) toast.error('WhatsApp number saved locally — sync from Settings when backend is back.');
}
