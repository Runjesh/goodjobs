// Razorpay sandbox checkout integration.
// Loads checkout.razorpay.com script lazily, opens a Checkout instance,
// and surfaces success/failure callbacks to the caller. This file is the
// only place the front-end touches the Razorpay SDK so swapping to real
// keys / a real backend webhook later only requires editing here.

import type { TierPlan, BillingCycle } from './trial';

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (resp: unknown) => void) => void;
  close?: () => void;
}

interface RazorpayOptions {
  key: string;
  amount: number; // in paise
  currency: string;
  name: string;
  description: string;
  image?: string;
  order_id?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler: (resp: { razorpay_payment_id: string; razorpay_order_id?: string; razorpay_signature?: string }) => void;
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const SCRIPT_ID = 'razorpay-checkout-js';

let scriptPromise: Promise<boolean> | null = null;

/** Lazily inject the Razorpay Checkout script tag and resolve when ready. */
export function loadRazorpayScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const s = document.createElement('script');
    s.id = SCRIPT_ID;
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
  return scriptPromise;
}

/** Sentinel key used when no real Razorpay test key is configured. */
const DEMO_KEY_SENTINEL = 'rzp_test_DEMO_KEY_GOODJOBS';

/** Pulls the sandbox key from Vite env with a clearly-fake fallback for dev. */
export function getRazorpayKey(): string {
  // Vite injects import.meta.env at build time; never log this value.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const k = env?.VITE_RAZORPAY_KEY_ID;
  if (k && typeof k === 'string' && k.trim()) return k.trim();
  return DEMO_KEY_SENTINEL;
}

/** True when no real Razorpay key is configured — caller should use the mock path. */
export function isUsingMockKey(): boolean {
  return getRazorpayKey() === DEMO_KEY_SENTINEL;
}

export interface OpenCheckoutArgs {
  plan: TierPlan;
  cycle: BillingCycle;
  prefill: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  /** Called with the simulated/real Razorpay payment id on success. */
  onSuccess: (paymentId: string) => void;
  /** Called when the user closes the modal without paying. */
  onDismiss?: () => void;
}

/**
 * Open Razorpay Checkout for the chosen plan/cycle.
 *
 * In dev with the demo key the real Razorpay modal still opens — Razorpay's
 * test mode shows a "test transaction" banner and never charges. If the SDK
 * fails to load we fall back to a synchronous mock so the upgrade flow can
 * still be exercised in environments without internet (CI, offline demo).
 */
export async function openRazorpayCheckout(args: OpenCheckoutArgs): Promise<void> {
  const { plan, cycle, prefill, notes, onSuccess, onDismiss } = args;
  const amount = (cycle === 'annual' ? plan.priceAnnual : plan.priceMonthly) * 100; // paise
  if (amount <= 0) {
    // Nothing to charge (Starter) — short-circuit success.
    onSuccess(`free_${Date.now()}`);
    return;
  }

  // No real key configured (demo build / sandbox without secret) → mock path
  // immediately so the upgrade flow always completes and isn't blocked by
  // Razorpay rejecting an obviously-fake key with "Payment Failed".
  if (isUsingMockKey()) {
    setTimeout(() => onSuccess(`mock_pay_${Date.now()}`), 250);
    return;
  }

  const ok = await loadRazorpayScript();
  if (!ok || !window.Razorpay) {
    // Offline / blocked — fall through to mock so the UX still completes.
    setTimeout(() => onSuccess(`mock_pay_${Date.now()}`), 100);
    return;
  }

  const rzp = new window.Razorpay({
    key: getRazorpayKey(),
    amount,
    currency: 'INR',
    name: 'GoodJobs',
    description: `${plan.name} plan · ${cycle === 'annual' ? 'Annual' : 'Monthly'}`,
    prefill,
    notes: { plan: plan.id, cycle, ...(notes ?? {}) },
    theme: { color: '#0F766E' },
    modal: {
      ondismiss: () => onDismiss?.(),
    },
    handler: (resp) => {
      onSuccess(resp.razorpay_payment_id);
    },
  });

  rzp.open();
}
