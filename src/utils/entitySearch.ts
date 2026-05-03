import type { Donor, Beneficiary, CSRCard, Campaign, Volunteer } from '../store/useStore';

export type EntityKind = 'donor' | 'beneficiary' | 'csr' | 'grant' | 'campaign' | 'program' | 'report' | 'team';

/** Static catalogue of report types — mirrors the seed list in Reports.tsx. */
export const REPORT_CATALOGUE: { id: string; title: string; type: string; funder?: string }[] = [
  { id: '1', title: 'Q2 Progress Report — Tata Trusts', type: 'funder', funder: 'Tata Trusts' },
  { id: '2', title: 'Annual Impact Report 2025–26', type: 'impact' },
  { id: '3', title: 'Donor Impact Update — April 2026', type: 'donor' },
  { id: '4', title: 'Board Brief — Q1 FY 2026–27', type: 'board' },
  { id: '5', title: 'UC Report — CSR Fund Education', type: 'funder', funder: 'HDFC Bank CSR' },
];

export interface EntityResult {
  kind: EntityKind;
  id: string;
  label: string;
  /** Short context line (e.g., "Mumbai · Major Donor"). */
  context: string;
  /** Route to navigate to on Enter. */
  path: string;
}

export interface EntityIndexInput {
  donors: Donor[];
  beneficiaries: Beneficiary[];
  csrCards: CSRCard[];
  campaigns: Campaign[];
  volunteers: Volunteer[];
}

const PER_GROUP_CAP = 5;

function donorContext(d: Donor): string {
  const parts = [d.type, d.location].filter(Boolean);
  return parts.join(' · ');
}

function csrContext(c: CSRCard): string {
  const amt = `₹${(c.amount / 100000).toFixed(1)}L`;
  return `${c.col} · ${amt} · ${c.project}`;
}

function programsFromBeneficiaries(bens: Beneficiary[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const b of bens) {
    if (!b.program) continue;
    m.set(b.program, (m.get(b.program) || 0) + 1);
  }
  return [...m.entries()].map(([name, count]) => ({ name, count }));
}

function matches(needle: string, hay: string): boolean {
  if (!hay) return false;
  return hay.toLowerCase().includes(needle);
}

/**
 * Build a flat list of entity results matching the query, capped per group.
 * Returns results in a consistent group order for keyboard navigation.
 */
export function searchEntities(query: string, idx: EntityIndexInput): EntityResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const out: EntityResult[] = [];

  // Donors — match name, pan, email, phone, employer.
  const donorHits: EntityResult[] = [];
  for (const d of idx.donors) {
    const meta = (d.meta || {}) as Record<string, unknown>;
    const employer = String(meta.employer || '');
    if (
      matches(q, d.name) ||
      matches(q, d.pan) ||
      matches(q, d.email || '') ||
      matches(q, d.phone || '') ||
      matches(q, employer)
    ) {
      donorHits.push({
        kind: 'donor',
        id: String(d.id),
        label: d.name,
        context: donorContext(d),
        path: `/crm?focus=${encodeURIComponent(String(d.id))}`,
      });
    }
    if (donorHits.length >= PER_GROUP_CAP) break;
  }
  out.push(...donorHits);

  // Beneficiaries — match name, location, program.
  const benHits: EntityResult[] = [];
  for (const b of idx.beneficiaries) {
    if (matches(q, b.name) || matches(q, b.location) || matches(q, b.program)) {
      benHits.push({
        kind: 'beneficiary',
        id: String(b.id),
        label: b.name,
        context: `${b.program} · ${b.location}`,
        path: `/programs?beneficiary=${encodeURIComponent(String(b.id))}`,
      });
    }
    if (benHits.length >= PER_GROUP_CAP) break;
  }
  out.push(...benHits);

  // CSR cards (pipeline stages) and Grants (mou/live = signed/active grants).
  const csrHits: EntityResult[] = [];
  const grantHits: EntityResult[] = [];
  for (const c of idx.csrCards) {
    const hit = matches(q, c.company) || matches(q, c.project) || matches(q, c.agent);
    if (!hit) continue;
    const isGrant = c.col === 'mou' || c.col === 'live';
    if (isGrant && grantHits.length < PER_GROUP_CAP) {
      grantHits.push({
        kind: 'grant',
        id: String(c.id),
        label: `${c.project} · ${c.company}`,
        context: `${c.col === 'live' ? 'Active grant' : 'MOU signed'} · ${csrContext(c)}`,
        path: `/grants/${encodeURIComponent(String(c.id))}`,
      });
    } else if (!isGrant && csrHits.length < PER_GROUP_CAP) {
      csrHits.push({
        kind: 'csr',
        id: String(c.id),
        label: c.company,
        context: csrContext(c),
        path: `/csr?card=${encodeURIComponent(String(c.id))}`,
      });
    }
  }
  out.push(...csrHits);
  out.push(...grantHits);

  // Campaigns — match title, cause.
  const campHits: EntityResult[] = [];
  for (const c of idx.campaigns) {
    if (matches(q, c.title) || matches(q, c.cause || '')) {
      const pct = c.goal > 0 ? Math.round((c.raised / c.goal) * 100) : 0;
      campHits.push({
        kind: 'campaign',
        id: String(c.id),
        label: c.title,
        context: `${c.status} · ${pct}% of ₹${(c.goal / 100000).toFixed(1)}L`,
        path: `/fundraising?campaign=${encodeURIComponent(String(c.id))}`,
      });
    }
    if (campHits.length >= PER_GROUP_CAP) break;
  }
  out.push(...campHits);

  // Programs (derived) — match program name.
  const programHits: EntityResult[] = [];
  for (const p of programsFromBeneficiaries(idx.beneficiaries)) {
    if (matches(q, p.name)) {
      programHits.push({
        kind: 'program',
        id: p.name,
        label: p.name,
        context: `${p.count} beneficiaries enrolled`,
        path: `/programs?program=${encodeURIComponent(p.name)}`,
      });
    }
    if (programHits.length >= PER_GROUP_CAP) break;
  }
  out.push(...programHits);

  // Reports (static catalogue) — match title, funder, type.
  const reportHits: EntityResult[] = [];
  for (const r of REPORT_CATALOGUE) {
    if (matches(q, r.title) || matches(q, r.funder || '') || matches(q, r.type)) {
      reportHits.push({
        kind: 'report',
        id: r.id,
        label: r.title,
        context: r.funder ? `${r.type} report · ${r.funder}` : `${r.type} report`,
        path: `/reports?report=${encodeURIComponent(r.id)}`,
      });
    }
    if (reportHits.length >= PER_GROUP_CAP) break;
  }
  out.push(...reportHits);

  // Volunteers / team — match name, skill.
  const teamHits: EntityResult[] = [];
  for (const v of idx.volunteers) {
    const skillMatch = v.skills.some(s => matches(q, s));
    if (matches(q, v.name) || skillMatch) {
      teamHits.push({
        kind: 'team',
        id: String(v.id),
        label: v.name,
        context: `${v.skills.slice(0, 2).join(', ') || 'Volunteer'} · ${v.hours}h`,
        path: `/volunteers?focus=${encodeURIComponent(String(v.id))}`,
      });
    }
    if (teamHits.length >= PER_GROUP_CAP) break;
  }
  out.push(...teamHits);

  return out;
}

export const ENTITY_GROUP_LABEL: Record<EntityKind, string> = {
  donor: 'Donors',
  beneficiary: 'Beneficiaries',
  csr: 'CSR pipeline',
  grant: 'Grants',
  campaign: 'Campaigns',
  program: 'Programs',
  report: 'Reports',
  team: 'Team',
};
