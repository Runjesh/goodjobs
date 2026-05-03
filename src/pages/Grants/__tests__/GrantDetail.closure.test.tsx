/**
 * Closure-gate tests (Task #8).
 *
 * The 6-step closure checklist is a compliance gate — a grant must NEVER
 * become Closed without UC filing, ED sign-off, etc. These tests lock that
 * in so a future refactor can't silently bypass it.
 *
 * What we cover:
 *   1. While the checklist is incomplete, the "Mark grant Closed" button is
 *      not in the DOM (positive gate).
 *   2. Each later checkbox is `disabled` until the previous one is ticked
 *      (the in-order gate).
 *   3. After every box is ticked the button appears, clicking it persists
 *      `isClosed: true` to localStorage (durability across reload).
 *   4. NEGATIVE: directly setting `card.col = 'closed'` in the store does
 *      NOT make the button appear when the checklist is incomplete — i.e.
 *      the gate is anchored to `closureChecklist` + `isClosed`, not to the
 *      pipeline column. This is what stops a column drag from skipping the
 *      closure flow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

// Suppress toasts (jsdom can't render the portal cleanly) and stub apiFetch
// so the parser-rows fetch in GrantDetail doesn't 404 against jsdom.
vi.mock('react-hot-toast', () => ({
  default: Object.assign(() => {}, { success: () => {}, error: () => {} }),
  Toaster: () => null,
}));
vi.mock('../../../api/client', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ extraction: null, state: null }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })),
}));
// AuthContext is consumed transitively by RecordTasksPanel — stub it so we
// don't have to wrap the tree in <AuthProvider/> just for this test.
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Test ED', role: 'ed', ngoId: 'n1' },
  }),
}));

import GrantDetail from '../GrantDetail';
import { useStore, type CSRCard } from '../../../store/useStore';

const CARD_ID = '5';

const makeCard = (overrides: Partial<CSRCard> = {}): CSRCard => ({
  id: CARD_ID,
  company: 'Mahindra Finance',
  amount: 4_500_000,
  project: 'Farmer Support Init',
  tags: ['Agriculture'],
  agent: 'RS',
  col: 'live',
  date: 'Report due: Nov 30',
  win_probability: 80,
  ...overrides,
});

const seedActiveCard = (overrides: Partial<CSRCard> = {}) => {
  useStore.setState({ csrCards: [makeCard(overrides)] });
};

const renderGrantDetail = () =>
  render(
    <MemoryRouter initialEntries={[`/grants/${CARD_ID}`]}>
      <Routes>
        <Route path="/grants/:id" element={<GrantDetail />} />
      </Routes>
    </MemoryRouter>
  );

const STORAGE_KEY = `goodjobs.grant.${CARD_ID}.v1`;

describe('Grant closure gate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedActiveCard();
  });

  it('hides "Mark grant Closed" until every checklist item is ticked', async () => {
    // Pre-seed state so we land in closing mode (checklist visible) without
    // having to click through the Begin Closure transition.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      closingMode: true, closureChecklist: {}, isClosed: false,
    }));
    renderGrantDetail();

    // Checklist is rendered, Close button is NOT.
    expect(await screen.findByText(/Grant Closure Checklist/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark grant Closed/i })).toBeNull();

    // Locked-message tells the user why the summary isn't released yet.
    expect(screen.getByText(/Complete the checklist to release this summary/i)).toBeInTheDocument();
  });

  it('enforces the in-order checklist (each box disabled until previous ticked)', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      closingMode: true, closureChecklist: {}, isClosed: false,
    }));
    const { container } = renderGrantDetail();
    await screen.findByText(/Grant Closure Checklist/i);

    // Scope strictly to the closure list so future unrelated checkboxes
    // (e.g. RecordTasksPanel) can't make this test brittle.
    const listBoxes = () =>
      Array.from(container.querySelectorAll<HTMLInputElement>(
        '.grant-closure-list input[type="checkbox"]'
      ));

    const boxes = listBoxes();
    expect(boxes).toHaveLength(6);
    expect(boxes[0]).toBeEnabled();
    for (let i = 1; i < 6; i++) expect(boxes[i]).toBeDisabled();

    // Tick the first → second unlocks; the rest stay locked.
    fireEvent.click(boxes[0]);
    const after = listBoxes();
    expect(after[1]).toBeEnabled();
    expect(after[2]).toBeDisabled();
  });

  it('shows the close button only after all 6 ticked, and persists isClosed', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      closingMode: true,
      closureChecklist: { uc: true, unspent: true, deliverables: true,
                          beneficiaries: true, archive: true, ed: true },
      isClosed: false,
    }));
    renderGrantDetail();

    const closeBtn = await screen.findByRole('button', { name: /Mark grant Closed/i });
    await act(async () => { fireEvent.click(closeBtn); });

    // Persisted to LS so a reload keeps the closed state — even if the
    // backend's card.col were reset to 'live', `isClosed: true` overrides it.
    const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.isClosed).toBe(true);
    expect(persisted.closingMode).toBe(false);

    // Store mutation also fires (column → 'closed').
    const cards = useStore.getState().csrCards;
    expect(cards.find(c => String(c.id) === CARD_ID)?.col).toBe('closed');
  });

  it('NEGATIVE: setting card.col = "closed" does not bypass the checklist gate', async () => {
    // Direct manipulation of the pipeline column (e.g. a drag-and-drop or a
    // future bug that calls updateCSRCard with col:'closed') must NOT make
    // the close button appear when the checklist is incomplete. The gate is
    // anchored to closureChecklist + isClosed, never to the column alone.
    seedActiveCard({ col: 'closed', date: '' }); // ← bypass attempt
    // Empty checklist, isClosed false.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      closingMode: false, closureChecklist: {}, isClosed: false,
    }));
    renderGrantDetail();

    expect(await screen.findByText(/Grant Closure Checklist/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark grant Closed/i })).toBeNull();
    expect(screen.getByText(/Complete the checklist to release this summary/i)).toBeInTheDocument();
  });
});
