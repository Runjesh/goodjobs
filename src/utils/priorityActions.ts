export type PriorityLevel = 'urgent' | 'attention' | 'well';

export interface PriorityItemLike {
  id: string;
  text: string;
  action?: string;
  path?: string;
  level: PriorityLevel;
  ageDays?: number;
  delta?: string;
  deltaDir?: 'up' | 'down' | 'flat';
  actionType?: 'receipts' | 'whatsapp' | 'ack-lapse-risk';
  donorIds?: (string | number)[];
}

function labelFromPath(path: string): string {
  const p = path.toLowerCase();
  if (p.includes('action=enroll')) return 'Enroll';
  if (p.includes('tab=mis')) return 'Review MIS';
  if (p.includes('view=exceptions')) return 'Classify';
  if (p.includes('action=receipts') || p.includes('receipt')) return 'Receipts';
  if (p.includes('alert=true') || p.includes('compliance')) return 'Open compliance';
  if (p.includes('/reports')) return 'Open report';
  if (p.includes('/grants/')) return 'Open grant';
  if (p.includes('/programs')) return 'Open programme';
  if (p.includes('/crm')) return 'Open CRM';
  if (p.includes('/finance') || p.includes('/funding')) return 'Open finance';
  if (p.includes('/tasks')) return 'Open task';
  return 'Take action';
}

/** Ensure every priority row with a destination has a visible inline CTA label. */
export function withPriorityAction<T extends PriorityItemLike>(item: T): T {
  if (item.actionType === 'ack-lapse-risk') {
    return { ...item, action: item.action ?? 'Acknowledge' };
  }
  if (item.actionType === 'receipts') {
    return { ...item, action: item.action ?? 'Bulk generate', path: item.path ?? '/funding?action=receipts' };
  }
  if (item.actionType === 'whatsapp') {
    return { ...item, action: item.action ?? 'Send WhatsApp', path: item.path };
  }
  if (item.path && !item.action) {
    return { ...item, action: labelFromPath(item.path) };
  }
  return item;
}

export function withPriorityActions<T extends PriorityItemLike>(items: T[]): T[] {
  return items.map(withPriorityAction);
}
