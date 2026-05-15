import { apiFetch } from '../api/client';
import type { MisReviewIntent } from '../store/useStore';

export async function syncMisReviewsFromServer(): Promise<MisReviewIntent[]> {
  try {
    const res = await apiFetch('/programs/mis-reviews?status=pending');
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data.reviews) ? data.reviews : [];
    return rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      narrative: String(r.narrative ?? ''),
      extracted: (r.extracted as MisReviewIntent['extracted']) ?? {},
      reporterId: String(r.reporter_id ?? 'field'),
      reportDate: String(r.report_date ?? '').slice(0, 10),
      createdAt: String(r.created_at ?? new Date().toISOString()),
      status: (r.status as MisReviewIntent['status']) ?? 'pending',
      decidedAt: r.decided_at ? String(r.decided_at) : undefined,
    }));
  } catch {
    return [];
  }
}

export async function decideMisReviewOnServer(
  reviewId: string,
  status: MisReviewIntent['status'],
  extracted?: MisReviewIntent['extracted'],
  budgetIncrement?: number,
): Promise<{ budget_applied?: number; extracted?: MisReviewIntent['extracted'] } | null> {
  try {
    const res = await apiFetch(`/programs/mis-reviews/${encodeURIComponent(reviewId)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        extracted: extracted ?? undefined,
        budget_increment: budgetIncrement ?? undefined,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function createMisReviewOnServer(intent: MisReviewIntent): Promise<boolean> {
  try {
    const res = await apiFetch('/programs/mis-reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        narrative: intent.narrative,
        extracted: intent.extracted,
        reporter_id: intent.reporterId,
        report_date: intent.reportDate,
        source_id: intent.id,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Default field spend when approving ration-kit style updates (₹). */
export const MIS_RATION_KIT_COST_INR = 450;
