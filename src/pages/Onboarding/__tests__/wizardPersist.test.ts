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
    // Critical: must NOT send keys for fields the user left empty —
    // backend uses COALESCE so absent keys keep their prior value, but
    // explicitly sending null would still null core columns.
    expect(body).not.toHaveProperty('reg_no_other');
    expect(Object.keys(body)).not.toContain('fcra_reg');
    expect(Object.keys(body)).not.toContain('pan');
    expect(Object.keys(body)).not.toContain('state');
  });

  it('persistOrgProfile is a no-op when the user filled nothing', async () => {
    const calls = captureFetch();
    await persistOrgProfile('', {});
    expect(calls).toHaveLength(0);
  });

  it('persistFirstProgram POSTs both /fundraising/campaigns AND /settings/ngo', async () => {
    const calls = captureFetch();
    await persistFirstProgram({
      name: 'Digital Literacy',
      causeArea: 'Education',
      geography: 'Nashik',
      startDate: '2026-01-01',
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toMatch(/\/fundraising\/campaigns$/);
    const body0 = bodyOf(calls[0]);
    expect(body0).toMatchObject({
      title: 'Digital Literacy',
      cause: 'Education',
      status: 'draft',
    });
    expect((body0 as { details: { source: string; geography: string } }).details).toMatchObject({
      source: 'signup-wizard',
      geography: 'Nashik',
    });
    // The second write is what makes the program visible in /programs after
    // a fresh login (Layout hydrates customPrograms from ngo.meta.programs).
    expect(calls[1].url).toMatch(/\/settings\/ngo$/);
    expect(bodyOf(calls[1])).toMatchObject({
      program_name: 'Digital Literacy',
      cause_area: 'Education',
    });
  });

  it('persistFirstProgram skips when name or cause area is missing', async () => {
    const calls = captureFetch();
    await persistFirstProgram({ name: '   ', causeArea: 'Education' });
    await persistFirstProgram({ name: 'X', causeArea: undefined });
    expect(calls).toHaveLength(0);
  });

  it('persistInvites POSTs /onboarding/invites with cleaned + format-validated rows', async () => {
    const calls = captureFetch();
    await persistInvites([
      { email: 'a@x.org', role: 'finance' },
      { email: '   ', role: 'programs' },     // dropped — empty email
      { email: 'b@x.org', role: '' },          // dropped — empty role
      { email: 'not-an-email', role: 'field' },// dropped — bad format
      { email: 'asha@', role: 'field' },       // dropped — bad format
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

  it('persistWhatsApp POSTs ONLY whatsapp_* fields (must not blank reg_no/name)', async () => {
    const calls = captureFetch();
    await persistWhatsApp('Asha Foundation', { phone: '+91 98200 12345', verified: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/settings\/ngo$/);
    const body = bodyOf(calls[0]);
    expect(body).toMatchObject({
      whatsapp_phone: '+91 98200 12345',
      whatsapp_verified: true,
    });
    expect(typeof (body as { whatsapp_connected_at: string }).whatsapp_connected_at).toBe('string');
    // Regression guard for the original code-review reject: payload must
    // NOT carry name/reg_no/etc. or the backend's COALESCE-protected
    // UPDATE will accept them and overwrite earlier wizard step writes.
    const keys = Object.keys(body);
    expect(keys).not.toContain('name');
    expect(keys).not.toContain('reg_no');
    expect(keys).not.toContain('fcra_reg');
    expect(keys).not.toContain('pan');
    expect(keys).not.toContain('state');
  });

  it('persistWhatsApp skips when no phone has been entered', async () => {
    const calls = captureFetch();
    await persistWhatsApp('Asha Foundation', {});
    expect(calls).toHaveLength(0);
  });
});
