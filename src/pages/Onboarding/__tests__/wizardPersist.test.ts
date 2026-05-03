import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  persistOrgProfile, persistFirstProgram, persistInvites,
  persistBeneficiaries, persistWhatsApp,
} from '../wizardPersist';

// Stub react-hot-toast — these helpers fire toast.error on backend failure;
// we just need to ensure the helpers don't throw and route to the right paths.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

interface FetchCall { url: string; init?: RequestInit }

function captureFetch(ok = true): FetchCall[] {
  const calls: FetchCall[] = [];
  const fakeFetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    }));
  };
  // apiFetch internally calls global.fetch — stub it.
  // @ts-expect-error  test-only override
  globalThis.fetch = fakeFetch;
  return calls;
}

function bodyOf(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body ?? '{}'));
}

describe('wizard backend persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persistOrgProfile POSTs /settings/ngo with reg + 80G + FCRA + logo', async () => {
    const calls = captureFetch();
    await persistOrgProfile('Asha Foundation', {
      registrationNumber: 'F-1234',
      section80GNumber: 'AAAAA1234A/01/2023',
      fcraStatus: 'pending',
      logoDataUrl: 'data:image/png;base64,xyz',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/settings\/ngo$/);
    expect(calls[0].init?.method).toBe('POST');
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({
      name: 'Asha Foundation',
      reg_no: 'F-1234',
      section_80g: 'AAAAA1234A/01/2023',
      fcra_status: 'pending',
      logo_data_url: 'data:image/png;base64,xyz',
    });
  });

  it('persistFirstProgram POSTs /fundraising/campaigns with wizard source tag', async () => {
    const calls = captureFetch();
    await persistFirstProgram({
      name: 'Digital Literacy',
      causeArea: 'Education',
      geography: 'Nashik',
      startDate: '2026-01-01',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/fundraising\/campaigns$/);
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({
      title: 'Digital Literacy',
      cause: 'Education',
      status: 'draft',
    });
    expect((body as { details: { source: string; geography: string } }).details).toMatchObject({
      source: 'signup-wizard',
      geography: 'Nashik',
    });
  });

  it('persistFirstProgram skips when name or cause area is missing', async () => {
    const calls = captureFetch();
    await persistFirstProgram({ name: '   ', causeArea: 'Education' });
    await persistFirstProgram({ name: 'X', causeArea: undefined });
    expect(calls).toHaveLength(0);
  });

  it('persistInvites POSTs /onboarding/invites with cleaned rows', async () => {
    const calls = captureFetch();
    await persistInvites([
      { email: 'a@x.org', role: 'finance' },
      { email: '   ', role: 'programs' },     // dropped — empty email
      { email: 'b@x.org', role: '' },          // dropped — empty role
      { email: 'c@x.org', role: 'field' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/onboarding\/invites$/);
    const body = bodyOf(calls[0]) as { invites: { email: string; role: string }[] };
    expect(body.invites).toEqual([
      { email: 'a@x.org', role: 'finance' },
      { email: 'c@x.org', role: 'field' },
    ]);
  });

  it('persistInvites skips network call when no valid invites remain', async () => {
    const calls = captureFetch();
    await persistInvites([{ email: '', role: '' }]);
    expect(calls).toHaveLength(0);
  });

  it('persistBeneficiaries POSTs /programs/beneficiaries/bulk with normalised rows', async () => {
    const calls = captureFetch();
    await persistBeneficiaries([
      { name: 'Asha', program: 'Education', familySize: '4' },
      { name: '   ', program: 'X', familySize: '2' },         // dropped
      { name: 'Ravi', program: '',     familySize: 'oops' },  // program → 'General', familySize → 1
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/programs\/beneficiaries\/bulk$/);
    const body = bodyOf(calls[0]) as { beneficiaries: Array<Record<string, unknown>> };
    expect(body.beneficiaries).toHaveLength(2);
    expect(body.beneficiaries[0]).toMatchObject({ name: 'Asha', program: 'Education', familySize: 4 });
    expect(body.beneficiaries[1]).toMatchObject({ name: 'Ravi', program: 'General',   familySize: 1 });
  });

  it('persistWhatsApp POSTs /settings/ngo with the verified phone payload', async () => {
    const calls = captureFetch();
    await persistWhatsApp('Asha Foundation', { phone: '+91 98200 12345', verified: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/settings\/ngo$/);
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({
      name: 'Asha Foundation',
      whatsapp_phone: '+91 98200 12345',
      whatsapp_verified: true,
    });
    expect(typeof (body as { whatsapp_connected_at: string }).whatsapp_connected_at).toBe('string');
  });

  it('persistWhatsApp skips when no phone has been entered', async () => {
    const calls = captureFetch();
    await persistWhatsApp('Asha Foundation', {});
    expect(calls).toHaveLength(0);
  });
});
