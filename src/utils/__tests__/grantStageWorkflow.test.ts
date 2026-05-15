import { describe, it, expect, vi } from 'vitest';
import {
  applyGrantStageTransition,
  transitionKey,
} from '../grantStageWorkflow';
import type { CSRCard } from '../../store/useStore';

const card: CSRCard = {
  id: '42',
  company: 'Tata Trusts',
  amount: 2_500_000,
  project: 'Digital Literacy 2026',
  tags: ['Education'],
  agent: 'RS',
  col: 'prospecting',
  date: 'today',
};

function mockDeps() {
  const tasks: unknown[] = [];
  return {
    upsertTask: (t: unknown) => { tasks.push(t); },
    addComplianceDoc: vi.fn(),
    addComplianceGrantLink: vi.fn(),
    upsertGrantBudgetHead: vi.fn(),
    addProgramGrantLink: vi.fn(),
    upsertGrantReport: vi.fn(),
    updateCSRCard: vi.fn(),
    grantTranches: [],
    programGrantLinks: [],
    complianceGrantLinks: [],
    complianceDocs: [],
    grantBudgetHeads: [],
    beneficiaries: [{ program: 'Digital Literacy 2026' }],
    customPrograms: [],
    _tasks: tasks,
  };
}

describe('grantStageWorkflow', () => {
  it('maps pipeline transitions', () => {
    expect(transitionKey('prospecting', 'pitch')).toBe('prospecting→pitch');
    expect(transitionKey('mou', 'live')).toBe('mou→live');
    expect(transitionKey('live', 'closed')).toBeNull();
  });

  it('creates proposal task on prospecting to pitch', () => {
    const deps = mockDeps();
    const result = applyGrantStageTransition({
      card,
      fromCol: 'prospecting',
      toCol: 'pitch',
      deps: deps as never,
    });
    expect(result.tasksCreated).toBe(1);
    expect((deps._tasks[0] as { sourceIntentId?: string }).sourceIntentId).toBe('grant-proposal:42');
  });

  it('runs live bundle on mou to live', () => {
    const deps = mockDeps();
    const result = applyGrantStageTransition({
      card: { ...card, col: 'mou' },
      fromCol: 'mou',
      toCol: 'live',
      deps: deps as never,
    });
    expect(result.liveBundleApplied).toBe(true);
    expect(result.reportStubId).toBe('rpt-grant-42');
    expect(deps.upsertGrantReport).toHaveBeenCalled();
  });
});
