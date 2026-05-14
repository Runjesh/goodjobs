/**
 * Shared programme / Today signals so inactive or stale service windows
 * stay consistent between Programs and the dashboard brief.
 */
export function daysSinceLastRecordedService(details?: Record<string, unknown> | null): number | null {
  const raw =
    details?.last_service_date ??
    details?.last_visit ??
    details?.last_activity_at ??
    details?.last_mis_date ??
    details?.last_field_visit;
  if (raw == null || typeof raw !== 'string') return null;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function beneficiariesStaleOnService(
  beneficiaries: Array<{ status?: string; name: string; details?: Record<string, unknown> }>,
  minDays = 30,
): typeof beneficiaries {
  return beneficiaries.filter((b) => {
    const st = String(b.status ?? '').toLowerCase();
    if (st === 'inactive') return false;
    const days = daysSinceLastRecordedService(b.details ?? undefined);
    if (days == null) return false;
    return days >= minDays;
  });
}
