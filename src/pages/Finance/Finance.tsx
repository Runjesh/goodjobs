import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IndianRupee, RefreshCw, FileText, Download, AlertCircle, ArrowUpRight, Plus, X, Bot, Globe, Tag, PackageOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import PermissionGate from '../../components/Auth/PermissionGate';
import './Finance.css';
import { apiFetch } from '../../api/client';
import { isMockEnabled } from '../../api/mockBackend';
import { programIdFromName } from '../../utils/programFinance';
import { ModalOverlay } from '../../components/ui/ModalOverlay';
import { useStore } from '../../store/useStore';
import { resolvePersistedJournalEntryId } from '../../utils/journalEntryId';

// ── Persistent receipt sequence (Feature 2) ──────────────────────────────────
// Counter stored in localStorage so it never resets on refresh.
// Returns the next formatted receipt number and advances the counter.
const RECEIPT_SEQ_KEY = 'goodjobs.receipt_seq.v1';
function nextReceiptNumber(ngoName: string): string {
  let seq = 1;
  try {
    const raw = localStorage.getItem(RECEIPT_SEQ_KEY);
    seq = raw ? (parseInt(raw, 10) + 1) : 1;
    localStorage.setItem(RECEIPT_SEQ_KEY, String(seq));
  } catch { /* ignore */ }
  const fy = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
  })();
  const prefix = ngoName.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'NGO';
  return `${prefix}/80G/${fy}/${String(seq).padStart(5, '0')}`;
}

// ── Pure-JS ZIP creator (STORE/no-compression) ───────────────────────────────
// Builds a valid ZIP binary in memory without any external library dependency.
// Each file is stored uncompressed (method 0 = STORED). Compliant with
// ZIP specification APPNOTE.TXT 6.3.10 and readable by all major extractors.
function createZip(files: Array<{ name: string; content: string }>): Uint8Array {
  const enc = new TextEncoder();
  const u16 = (n: number) => { const a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n >>> 0, true); return a; };
  const u32 = (n: number) => { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0, true); return a; };

  // CRC-32 lookup table
  const crcTab = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTab[i] = c;
  }
  const crc32 = (data: Uint8Array): number => {
    let c = 0xFFFFFFFF;
    for (const b of data) c = crcTab[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };

  const now = new Date();
  const dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F);
  const dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | (Math.floor(now.getSeconds() / 2) & 0x1F);

  interface ZipEntry { nameBytes: Uint8Array; dataBytes: Uint8Array; crc: number; localOff: number; }
  const entries: ZipEntry[] = [];
  const parts: Uint8Array[] = [];
  let off = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataBytes = enc.encode(f.content);
    const crc = crc32(dataBytes);
    const localOff = off;

    const lh = new Uint8Array([
      0x50, 0x4B, 0x03, 0x04,  // local file header signature
      0x14, 0x00,               // version needed (2.0)
      0x00, 0x00,               // general purpose bit flag
      0x00, 0x00,               // compression method: STORED
      ...u16(dosTime), ...u16(dosDate),
      ...u32(crc),
      ...u32(dataBytes.length), // compressed size
      ...u32(dataBytes.length), // uncompressed size
      ...u16(nameBytes.length),
      0x00, 0x00,               // extra field length
    ]);
    parts.push(lh, nameBytes, dataBytes);
    off += lh.length + nameBytes.length + dataBytes.length;
    entries.push({ nameBytes, dataBytes, crc, localOff });
  }

  const cdStart = off;
  for (const e of entries) {
    const cdh = new Uint8Array([
      0x50, 0x4B, 0x01, 0x02,  // central directory file header signature
      0x14, 0x00,               // version made by (2.0)
      0x14, 0x00,               // version needed (2.0)
      0x00, 0x00,               // general purpose bit flag
      0x00, 0x00,               // compression method: STORED
      ...u16(dosTime), ...u16(dosDate),
      ...u32(e.crc),
      ...u32(e.dataBytes.length),
      ...u32(e.dataBytes.length),
      ...u16(e.nameBytes.length),
      0x00, 0x00,               // extra field length
      0x00, 0x00,               // file comment length
      0x00, 0x00,               // disk number start
      0x00, 0x00,               // internal file attributes
      0x00, 0x00, 0x00, 0x00,   // external file attributes
      ...u32(e.localOff),
    ]);
    parts.push(cdh, e.nameBytes);
    off += cdh.length + e.nameBytes.length;
  }

  const cdSize = off - cdStart;
  const eocd = new Uint8Array([
    0x50, 0x4B, 0x05, 0x06,    // end of central directory signature
    0x00, 0x00, 0x00, 0x00,
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(cdStart),
    0x00, 0x00,                 // ZIP file comment length
  ]);
  parts.push(eocd);

  const total = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

// ── 80G receipt PDF generator ─────────────────────────────────────────────────
function generate80GReceiptPdf(opts: {
  receiptNo: string;
  donorName: string;
  donorPan: string;
  amount: number;
  date: string;
  description: string;
  ngoName: string;
  ngoPan: string;
  eighty_g_no: string;
}): jsPDF {
  const amountWords = (n: number): string => {
    if (n === 0) return 'Zero';
    const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
    const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
    const cvt = (x: number): string => {
      if (x < 20) return ones[x];
      if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
      if (x < 1000) return ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + cvt(x % 100) : '');
      if (x < 100000) return cvt(Math.floor(x / 1000)) + ' Thousand' + (x % 1000 ? ' ' + cvt(x % 1000) : '');
      return cvt(Math.floor(x / 100000)) + ' Lakh' + (x % 100000 ? ' ' + cvt(x % 100000) : '');
    };
    return cvt(Math.round(n)) + ' Only';
  };

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  let y = 16;

  // Border
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.6);
  doc.rect(10, 10, W - 20, 277);

  // NGO name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 118, 110); // teal-700
  doc.text(opts.ngoName, W / 2, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text('80G Donation Receipt — Section 80G, Income Tax Act 1961', W / 2, y, { align: 'center' });
  y += 5;
  doc.text(
    `80G Cert No: ${opts.eighty_g_no || 'N/A'}   |   NGO PAN: ${opts.ngoPan || 'N/A'}`,
    W / 2, y, { align: 'center' }
  );
  y += 4;
  doc.setDrawColor(180, 180, 180);
  doc.line(M, y, W - M, y);
  y += 7;

  // Fields — two-column grid
  const labelW = 38;
  const col2 = W / 2 + 3;
  const lh = 7;
  const field = (label: string, value: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(label + ':', x, yy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    doc.text(value, x + labelW, yy);
  };

  field('Receipt No', opts.receiptNo, M, y);
  field('Date', opts.date, col2, y);
  y += lh;
  field('Donor Name', opts.donorName, M, y);
  field('Donor PAN', opts.donorPan || 'N/A', col2, y);
  y += lh;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 118, 110);
  doc.text(`Amount: Rs. ${Number(opts.amount).toLocaleString('en-IN')}`, M, y);
  y += lh;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  field('In words', amountWords(opts.amount), M, y);
  y += lh;
  field('Purpose', opts.description || 'Donation', M, y);
  y += 6;

  doc.setDrawColor(200, 200, 200);
  doc.line(M, y, W - M, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  const note = 'This receipt is issued for the donation received and qualifies for tax deduction under Section 80G of the Income Tax Act, 1961.';
  const noteLines = doc.splitTextToSize(note, W - 2 * M);
  doc.text(noteLines, M, y);
  y += (noteLines.length * 5) + 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(40, 40, 40);
  doc.text(`For ${opts.ngoName}`, M, y);
  y += 18;
  doc.line(M, y, M + 55, y);
  y += 4;
  doc.text('Authorised Signatory', M, y);
  y += 8;
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text('Computer-generated receipt. No physical signature required.', M, y);

  return doc;
}

const Finance: React.FC = () => {
  const grantBudgetHeads = useStore(s => s.grantBudgetHeads);
  const journalEntries   = useStore(s => s.journalEntries);
  const upsertJournalEntry      = useStore(s => s.upsertJournalEntry);
  const setJournalEntryGrantTag = useStore(s => s.setJournalEntryGrantTag);
  const csrCards         = useStore(s => s.csrCards);
  const donors           = useStore(s => s.donors);
  const ngoDetails       = useStore(s => s.ngoDetails);
  const complianceDocs   = useStore(s => s.complianceDocs);
  const beneficiaries    = useStore(s => s.beneficiaries);
  const customPrograms   = useStore(s => s.customPrograms);

  // All distinct programme names from beneficiaries + custom programmes,
  // de-duped. Used for the programme dropdown in the journal entry form.
  const allProgrammes = useMemo(() => {
    const fromBens = beneficiaries.map(b => b.program).filter(Boolean);
    const merged = Array.from(new Set([...fromBens, ...customPrograms])).sort();
    return merged;
  }, [beneficiaries, customPrograms]);
  const [grants, setGrants] = useState<any[]>([]);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [grantForm, setGrantForm] = useState<{ name: string; total: number; spent: number; status: string }>({
    name: '',
    total: 1000000,
    spent: 0,
    status: 'On Track',
  });
  const [entry, setEntry] = useState<{
    description: string; amount: number; type: 'Expense' | 'Income' | 'Transfer'; fund: string;
    grantId: string; budgetHeadId: string; donorId: string; programmeId: string;
    /** Income-receipt auto-fill fields — populated from the linked CRM donor. */
    receiptDonorName: string; receiptDonorPan: string;
    /** AI-returned category label; shown in form + stored on the entry for audit. */
    category: string;
    /** FCRA admin overhead flag — only admin-flagged FCRA expenses count toward the 18% cap. */
    isAdminOverhead: boolean;
  }>({ description: '', amount: 1000, type: 'Expense', fund: 'General', grantId: '', budgetHeadId: '', donorId: '', programmeId: '', receiptDonorName: '', receiptDonorPan: '', category: '', isAdminOverhead: false });
  const [donorSearch, setDonorSearch] = useState('');
  const [classification, setClassification] = useState<{category: string, confidence: number} | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [grantsLoading, setGrantsLoading] = useState(false);
  // ngoName is now read from the Zustand ngoDetails slice (single source of truth).
  // The local useState fallback is kept only for the rare moment before store hydrates.
  const ngoName = ngoDetails.name || 'GoodJobs NGO';

  // 80G registration number — single source of truth is the Donor Deduction doc
  // in the Compliance registry. No Settings fallback: if the registry is missing
  // a doc with registration_number, receipts show '—' and a warning banner appears.
  const eightyGDoc = complianceDocs.find(d => d.type === 'Donor Deduction' && d.registration_number);
  const eightyGRegNo = eightyGDoc?.registration_number ?? '';
  const eightyGMissing = !eightyGDoc;
  const [aaBannerDismissed, setAaBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem('gj_finance_aa_banner_dismiss') === '1';
    } catch {
      return false;
    }
  });
  const [exceptionMode, setExceptionMode] = useState(false);
  const [minConf, setMinConf] = useState(0.85);
  const [exTx, setExTx] = useState<any[]>([]);
  const [exLoading, setExLoading] = useState(false);
  const [classifiedStream, setClassifiedStream] = useState<any[]>([]);
  const [streamExceptionOnly, setStreamExceptionOnly] = useState(false);
  // Inline FCRA reclassification — per-row pending category selection + busy lock.
  const [exPending, setExPending] = useState<Record<string, string>>({});
  const [exBusy, setExBusy] = useState<Record<string, boolean>>({});
  const [exBulkBusy, setExBulkBusy] = useState(false);
  const [exSentToBk, setExSentToBk] = useState<Record<string, boolean>>({});

  // ── Feature 3: FCRA admin 18% pre-save guard ─────────────────────────────
  // When an FCRA expense would breach 18%, we park the pending entry here and
  // show a blocking confirm. The user can "Save anyway" or dismiss.
  const [fcraGuardEntry, setFcraGuardEntry] = useState<null | {
    currentPct: number;
    projectedPct: number;
    remainingHeadroom: number;
    onConfirm: () => void;
  }>(null);

  // ── Deep-link query-param consumers ────────────────────────────────────────
  // Dashboard clawback-risk links navigate here with ?filter=clawback&grantId=<id>
  // so the matching grant is highlighted in the grants section.
  const [highlightGrantId, setHighlightGrantId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('filter') === 'clawback') {
      setHighlightGrantId(params.get('grantId'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Feature 5: bulk receipt generation ───────────────────────────────────
  const [bulkReceiptBusy, setBulkReceiptBusy] = useState(false);

  // ── Feature 6: live programme spend (computed in useMemo) ─────────────────
  const programBudgets = useStore(s => s.programBudgets);

  const FCRA_CATEGORIES = ['FCRA', 'Domestic', 'CSR', 'Grant', 'Donation', 'Other'];

  const loadGrants = async () => {
    setGrantsLoading(true);
    try {
      const res = await apiFetch('/finance/grants');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.grants)) setGrants(data.grants);
      }
    } catch {
      // ignore (demo fallback)
    } finally {
      setGrantsLoading(false);
    }
  };

  const loadExceptionTx = useCallback(async () => {
    setExLoading(true);
    try {
      const res = await apiFetch(
        `/finance/transactions?classify=true&exception_only=true&min_confidence=${encodeURIComponent(String(minConf))}`
      );
      if (!res.ok) throw new Error('tx');
      const data = await res.json();
      setExTx(Array.isArray(data.transactions) ? data.transactions : []);
    } catch {
      toast.error('Failed to load low-confidence transactions.');
      setExTx([]);
    } finally {
      setExLoading(false);
    }
  }, [minConf]);

  useEffect(() => {
    loadGrants();
    (async () => {
      try {
        const txRes = await apiFetch('/finance/transactions?classify=true');
        if (txRes.ok) {
          const txData = await txRes.json();
          const list = Array.isArray(txData.transactions) ? txData.transactions : [];
          setClassifiedStream(list.slice(0, 400));
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleClassifiedStream = useMemo(() => {
    if (!streamExceptionOnly) return classifiedStream;
    return classifiedStream.filter(t => (Number(t.agent_confidence) || 0) < 0.9);
  }, [classifiedStream, streamExceptionOnly]);

  const classifiedScrollRef = useRef<HTMLDivElement>(null);
  const classifiedVirtualizer = useVirtualizer({
    count: visibleClassifiedStream.length,
    getScrollElement: () => classifiedScrollRef.current,
    estimateSize: () => 46,
    overscan: 14,
  });

  const exScrollRef = useRef<HTMLDivElement>(null);
  const exVirtualizer = useVirtualizer({
    count: exTx.length,
    getScrollElement: () => exScrollRef.current,
    estimateSize: () => 48,
    overscan: 10,
  });

  const grantsScrollRef = useRef<HTMLDivElement>(null);
  const grantsVirtualizer = useVirtualizer({
    count: grants.length,
    getScrollElement: () => grantsScrollRef.current,
    estimateSize: () => 100,
    overscan: 8,
  });

  useEffect(() => {
    if (exceptionMode) loadExceptionTx();
  }, [exceptionMode, loadExceptionTx]);

  // Approve a low-confidence transaction with the operator's chosen FCRA category.
  // Tries the dedicated classify endpoint first, then falls back to a journal-entry
  // memo so the action is auditable even when the classify route isn't deployed.
  const approveExceptionRow = async (t: any) => {
    const id = String(t.id ?? '');
    if (!id) return;
    const category = exPending[id] || t.agent_category || 'Domestic';
    setExBusy(prev => ({ ...prev, [id]: true }));
    try {
      let ok = false;
      try {
        const r = await apiFetch(`/finance/transactions/${encodeURIComponent(id)}/classify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, approved_by: 'operator' }),
        });
        ok = r.ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        // Fallback: write an audit journal entry so the approval still lands somewhere.
        try {
          const r2 = await apiFetch('/finance/journal-entry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              description: `FCRA reclassify TX ${id}: ${t.donorName || 'Donor'} → ${category}`,
              amount: Number(t.amount) || 0,
              entry_type: 'Reclassification',
              fund: category,
            }),
          });
          ok = r2.ok;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        toast.error('Failed to approve classification.');
        return;
      }
      // Optimistically remove from both queues.
      setExTx(prev => prev.filter(row => String(row.id) !== id));
      setClassifiedStream(prev => prev.map(row => (
        String(row.id) === id ? { ...row, agent_category: category, agent_confidence: 1 } : row
      )));
      setExPending(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      toast.success(`Classified as ${category}.`);
    } finally {
      setExBusy(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }
  };

  const acceptAllExceptions = async () => {
    if (exTx.length === 0) return;
    setExBulkBusy(true);
    const snapshot = [...exTx];
    try {
      for (const row of snapshot) {
        // Sequential so each row's exPending / network state stays coherent.
        // eslint-disable-next-line no-await-in-loop
        await approveExceptionRow(row);
      }
      toast.success(`Accepted ${snapshot.length} classification${snapshot.length === 1 ? '' : 's'}.`);
    } finally {
      setExBulkBusy(false);
    }
  };

  // Send a low-confidence row to the bookkeeper instead of approving inline.
  // Posts a journal-entry-style memo so the action shows up in the audit log,
  // marks the row as "Sent" (greys it out) but leaves it in the queue so the
  // operator can still approve once the bookkeeper replies.
  const sendExceptionToBookkeeper = async (t: any) => {
    const id = String(t.id ?? '');
    if (!id) return;
    const proposed = exPending[id] || t.agent_category || 'Domestic';
    setExBusy(prev => ({ ...prev, [id]: true }));
    try {
      let ok = false;
      try {
        const r = await apiFetch('/finance/journal-entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: `Bookkeeper review requested — TX ${id}: ${t.donorName || 'Donor'} (proposed ${proposed})`,
            amount: Number(t.amount) || 0,
            entry_type: 'Bookkeeper Review',
            fund: proposed,
          }),
        });
        ok = r.ok;
      } catch {
        ok = false;
      }
      if (!ok) {
        toast.error('Could not notify bookkeeper. Try again.');
        return;
      }
      setExSentToBk(prev => ({ ...prev, [id]: true }));
      toast.success(`Sent to bookkeeper for review (proposed ${proposed}).`);
    } finally {
      setExBusy(prev => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
    }
  };

  const fcraGrants = grants.filter((g: any) => (g?.name || '').toString().toLowerCase().includes('fcra'));
  // Primary fcraTotal: sum of grant totals for FCRA-tagged grants.
  // Fallback: sum of Income journal entries tagged to the FCRA fund — this
  // keeps the guard accurate even when grants haven't been loaded or are stale.
  const fcraGrantTotal = fcraGrants.reduce((s: number, g: any) => s + (Number(g.total) || 0), 0);
  const fcraJournalTotal = journalEntries
    .filter(je => je.entryType === 'Income' && je.fund === 'FCRA')
    .reduce((s, je) => s + Math.abs(Number(je.amount) || 0), 0);
  const fcraTotal = fcraGrantTotal > 0 ? fcraGrantTotal : fcraJournalTotal;
  // fcraAdminSpent: computed from admin-flagged FCRA journal entries — the same
  // source the pre-save guard uses — so the monitor and guard always agree.
  const fcraAdminSpent = journalEntries
    .filter(je => je.entryType === 'Expense' && je.fund === 'FCRA' && je.isAdminOverhead)
    .reduce((s, je) => s + Math.abs(Number(je.amount) || 0), 0);
  const fcraAdminLimit = fcraTotal * 0.2;
  const fcraAdminPercent = fcraAdminLimit > 0 ? (fcraAdminSpent / fcraAdminLimit) * 100 : 0;
  const fcraRealPct = fcraTotal > 0 ? (fcraAdminSpent / fcraTotal) * 100 : 0;
  const fcraStatus = (() => {
    if (fcraRealPct >= 20) return { key: 'critical', label: 'CRITICAL — Cap Breached', color: '#DC2626', bg: '#fee2e2' };
    if (fcraRealPct >= 16) return { key: 'warning',  label: 'WARNING — Near Cap',      color: '#EA580C', bg: '#fff7ed' };
    if (fcraRealPct >= 12) return { key: 'caution',  label: 'CAUTION',                 color: '#D97706', bg: '#fef3c7' };
    return                        { key: 'safe',     label: 'SAFE',                    color: '#16A34A', bg: '#f0fdf4' };
  })();
  const isFcraWarning = fcraStatus.key === 'warning' || fcraStatus.key === 'critical';

  // Core save logic — called directly OR after user confirms the FCRA guard.
  const doSaveJournalEntry = async (entryToSave: typeof entry) => {
    // Receipt numbering: localStorage counter in mock mode; DB-sequence from
    // server response in production. clientReceiptNo is only set when mocked.
    const clientReceiptNo: string | undefined =
      entryToSave.type === 'Income' && isMockEnabled()
        ? nextReceiptNumber(ngoName)
        : undefined;

    let payload: unknown = null;
    try {
      const res = await apiFetch('/finance/journal-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: entryToSave.description,
          amount: Number(entryToSave.amount),
          entry_type: entryToSave.type,
          fund: entryToSave.fund,
          grant_id: entryToSave.grantId || null,
          budget_head_id: entryToSave.budgetHeadId || null,
          donor_id: entryToSave.donorId || null,
          programme_id: entryToSave.programmeId || null,
          receipt_donor_name: entryToSave.receiptDonorName || null,
          receipt_donor_pan:  entryToSave.receiptDonorPan  || null,
          // Send the client-side number so the server can record it in the DB.
          // A real backend may return its own authoritative DB-sequence number instead.
          receipt_number:     clientReceiptNo || null,
          is_admin_overhead:  entryToSave.isAdminOverhead || false,
          category:           entryToSave.category || null,
        }),
      });
      if (res.ok) {
        try { payload = await res.json(); } catch { /* empty body */ }
      }
    } catch { /* offline/no backend */ }

    // Resolve receipt number: prefer server-returned DB sequence; fall back to
    // clientReceiptNo (only set in mock mode). Warn in production if missing.
    const serverReceiptNo: string | undefined =
      typeof payload === 'object' && payload !== null && 'receipt_number' in payload
        ? (typeof (payload as Record<string, unknown>).receipt_number === 'string'
            ? (payload as Record<string, unknown>).receipt_number as string
            : undefined)
        : undefined;
    let receiptNo: string | undefined;
    if (entryToSave.type === 'Income') {
      if (serverReceiptNo) {
        receiptNo = serverReceiptNo;
      } else if (clientReceiptNo) {
        receiptNo = clientReceiptNo;
      } else {
        toast('Receipt number not issued — backend sequence endpoint not yet implemented.', { icon: '⚠️', duration: 5000 });
      }
    }

    const { source, id } = resolvePersistedJournalEntryId(payload);
    const tag = entryToSave.grantId && entryToSave.budgetHeadId
      ? { grantId: entryToSave.grantId, budgetHeadId: entryToSave.budgetHeadId }
      : undefined;
    upsertJournalEntry({
      id,
      date: new Date().toISOString().slice(0, 10),
      amount: Number(entryToSave.amount) || 0,
      description: entryToSave.description,
      fund: entryToSave.fund,
      entryType: entryToSave.type,
      grantTag: tag,
      grantId:       entryToSave.grantId       || undefined,
      donorId:       entryToSave.donorId       || undefined,
      programmeId:   entryToSave.programmeId   || undefined,
      receiptNo:     receiptNo                 || undefined,
      isAdminOverhead: entryToSave.isAdminOverhead || undefined,
      category:      entryToSave.category      || undefined,
    });

    // Feature 2: If income, auto-download the 80G receipt as PDF.
    if (entryToSave.type === 'Income' && receiptNo) {
      const doc = generate80GReceiptPdf({
        receiptNo,
        donorName:    entryToSave.receiptDonorName || entryToSave.donorId || 'Donor',
        donorPan:     entryToSave.receiptDonorPan  || '',
        amount:       Number(entryToSave.amount) || 0,
        date:         new Date().toLocaleDateString('en-IN'),
        description:  entryToSave.description,
        ngoName:      ngoName,
        ngoPan:       ngoDetails.pan || '',
        eighty_g_no:  eightyGRegNo,
      });
      doc.save(`${receiptNo.replace(/\//g, '_')}.pdf`);
    }

    const tagSuffix = tag ? ' · tagged' : '';
    const receiptSuffix = receiptNo ? ` · Receipt ${receiptNo}` : '';
    if (source === 'backend') {
      toast.success(`Journal entry recorded: ₹${Number(entryToSave.amount).toLocaleString()} (${entryToSave.type})${tagSuffix}${receiptSuffix}.`);
    } else {
      toast.success(`Saved locally: ₹${Number(entryToSave.amount).toLocaleString()} (${entryToSave.type})${tagSuffix}${receiptSuffix}. Will sync when the server is reachable.`);
    }
    setShowEntryModal(false);
    setEntry({ description: '', amount: 1000, type: 'Expense', fund: 'General', grantId: '', budgetHeadId: '', donorId: '', programmeId: '', receiptDonorName: '', receiptDonorPan: '', category: '', isAdminOverhead: false });
    setDonorSearch('');
    setClassification(null);
  };

  const handleJournalEntry = async (e: React.FormEvent) => {
    e.preventDefault();

    // FCRA admin 18% pre-save guard. Admin status is auto-derived from the
    // explicit checkbox OR matching keywords in the AI category / budget head
    // label. The resolved flag is written back into the entry before save so
    // the monitor and stored data stay consistent with the guard decision.
    const ADMIN_KEYWORDS = ['admin', 'overhead', 'management', 'salary', 'salaries', 'rent', 'utilities', 'payroll'];
    const selectedHead = entry.budgetHeadId
      ? grantBudgetHeads.find(h => h.id === entry.budgetHeadId)
      : undefined;
    const derivedIsAdmin =
      entry.isAdminOverhead ||
      (entry.category ? ADMIN_KEYWORDS.some(k => entry.category.toLowerCase().includes(k)) : false) ||
      (selectedHead   ? ADMIN_KEYWORDS.some(k => selectedHead.label.toLowerCase().includes(k)) : false);

    // Normalise: persist derived admin classification into the entry so
    // doSaveJournalEntry records the correct isAdminOverhead value regardless
    // of how admin status was determined.
    const normalisedEntry = { ...entry, isAdminOverhead: derivedIsAdmin };

    if (normalisedEntry.type === 'Expense' && normalisedEntry.fund === 'FCRA' && derivedIsAdmin && fcraTotal > 0) {
      const currentFcraAdminSpent = journalEntries
        .filter(je => je.entryType === 'Expense' && je.fund === 'FCRA' && je.isAdminOverhead)
        .reduce((s, je) => s + Math.abs(Number(je.amount) || 0), 0);
      const projected = currentFcraAdminSpent + Number(normalisedEntry.amount);
      const projectedPct = (projected / fcraTotal) * 100;
      const CAP = 18;
      if (projectedPct > CAP) {
        const currentPct = (currentFcraAdminSpent / fcraTotal) * 100;
        const remaining = fcraTotal * (CAP / 100) - currentFcraAdminSpent;
        setFcraGuardEntry({
          currentPct,
          projectedPct,
          remainingHeadroom: Math.max(0, remaining),
          onConfirm: () => {
            setFcraGuardEntry(null);
            doSaveJournalEntry(normalisedEntry);
          },
        });
        return;
      }
    }

    await doSaveJournalEntry(normalisedEntry);
  };

  // Bulk 80G receipt generation — current-month income entries with donor link
  // and no existing receipt. ZIP of individual HTML files (pure-JS STORE).
  const handleBulkReceiptGeneration = async () => {
    setBulkReceiptBusy(true);
    try {
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const pending = journalEntries.filter(je => {
        if (je.entryType !== 'Income') return false;
        if (!je.donorId) return false;
        if (je.receiptNo) return false; // already receipted — skip
        const d = (je.date || '').slice(0, 7);
        return d === monthStr;
      });

      if (pending.length === 0) {
        toast(
          journalEntries.some(je => je.entryType === 'Income' && je.receiptNo)
            ? 'All income entries for this month already have receipts.'
            : 'No income entries with a linked donor found for this month.',
          { icon: 'ℹ️' }
        );
        return;
      }

      const zip = new JSZip();
      let generatedCount = 0;
      for (const je of pending) {
        const donor = donors.find(d => d.id === je.donorId);
        // In mock / offline mode: generate number from the localStorage counter.
        // In production: POST to /finance/issue-receipt for a DB-sequence number.
        //   If the server fails or doesn't return receipt_number, skip this entry
        //   and warn — do NOT fall back to localStorage, which would create a
        //   client-side sequence that diverges from the authoritative DB series.
        let receiptNo: string | null = null;
        if (isMockEnabled()) {
          receiptNo = nextReceiptNumber(ngoName);
        } else {
          try {
            const res = await apiFetch('/finance/issue-receipt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ journal_entry_id: je.id, ngo_name: ngoName }),
            });
            if (res.ok) {
              const data: unknown = await res.json();
              const serverNo =
                typeof data === 'object' && data !== null && 'receipt_number' in data &&
                typeof (data as Record<string, unknown>).receipt_number === 'string'
                  ? (data as Record<string, unknown>).receipt_number as string
                  : null;
              receiptNo = serverNo;
            }
          } catch { /* network error — receiptNo stays null */ }
          if (!receiptNo) {
            toast.error(`Receipt skipped for entry "${je.description.slice(0, 40)}" — server did not return a receipt number.`, { duration: 5000 });
            continue;
          }
        }
        const doc = generate80GReceiptPdf({
          receiptNo,
          donorName:   donor?.name  || je.description || 'Donor',
          donorPan:    donor?.pan   || '',
          amount:      Math.abs(Number(je.amount) || 0),
          date:        je.date ? new Date(je.date).toLocaleDateString('en-IN') : now.toLocaleDateString('en-IN'),
          description: je.description,
          ngoName,
          ngoPan:      ngoDetails.pan || '',
          eighty_g_no: eightyGRegNo,
        });
        const safeName = receiptNo.replace(/\//g, '_');
        zip.file(`${safeName}.pdf`, doc.output('arraybuffer'));
        generatedCount++;
        // Mark the entry as receipted so future bulk runs skip it.
        upsertJournalEntry({ ...je, receiptNo });
      }

      if (generatedCount === 0) {
        toast.error('No receipts were generated — all pending entries were skipped (server did not return receipt numbers).', { duration: 7000 });
        return;
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url  = URL.createObjectURL(zipBlob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `80G_Receipts_${monthStr}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      const skippedCount = pending.length - generatedCount;
      toast.success(
        `Generated ${generatedCount} PDF receipt${generatedCount > 1 ? 's' : ''}${skippedCount > 0 ? ` (${skippedCount} skipped — see warnings above)` : ''} — extract the ZIP to open individual PDFs.`,
        { duration: 7000 }
      );
    } catch (err) {
      toast.error('Failed to generate receipts.');
    } finally {
      setBulkReceiptBusy(false);
    }
  };

  const handleTallySync = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch('/finance/tally/sync', { method: 'POST' });
      if (!res.ok) throw new Error('sync');
      const data = await res.json();
      setLastSyncedAt(data.synced_at || null);
      toast.success(`Tally Prime sync complete! ${data.exported_vouchers || 0} vouchers exported.`, { icon: 'T' });
    } catch {
      toast.error('Failed to sync with Tally (backend not reachable).');
    } finally {
      setSyncing(false);
    }
  };

  const handleTallyXMLExport = async () => {
    try {
      const txRes = await apiFetch('/finance/transactions');
      if (!txRes.ok) throw new Error('tx');
      const txData = await txRes.json();
      const txs = Array.isArray(txData.transactions) ? txData.transactions : [];

      // Use backend generator so the format stays consistent.
      const res = await apiFetch('/export/tally-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ngo_name: ngoName,
          transactions: txs.slice(0, 200).map((t: any) => ({
            id: t.id,
            date: (t.date || new Date().toISOString().slice(0, 10)),
            amount: Number(t.amount) || 0,
            donor_name: t.donorName || 'Donor',
            method: t.method || 'UPI',
            fund: 'General',
          })),
        }),
      });
      if (!res.ok) {
        toast.error('Failed to export Tally XML.');
        return;
      }
      const xml = await res.text();
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `goodjobs_tally_${new Date().toISOString().split('T')[0]}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Tally Prime XML exported from backend.', { duration: 5000, icon: '💾' });
    } catch {
      toast.error('Failed to export Tally XML (backend not reachable).');
    }
  };

  const handleExportReport = () => {
    const csv = ['Grant ID,Name,Total,Spent,Variance,Status',
      ...grants.map(g => `${g.id},${g.name},${g.total},${g.spent},${g.variance},${g.status}`)
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'grant_utilization.csv'; a.click();
    URL.revokeObjectURL(url);
    toast.success('Grant utilization report exported!');
  };

  // ── Session 4: per-grant + per-budget-head EXPENSE tagging ──────────────
  // The source of truth for utilisation is `journalEntries` — booked
  // outflows (entryType === 'Expense'). Donor receipts in `transactions`
  // are NOT counted toward grant utilisation.
  const cardLabel = (cid: string | number) => {
    const c = csrCards.find(x => String(x.id) === String(cid));
    return c ? `${c.company} — ${c.project}` : `Grant ${cid}`;
  };
  const headLabel = (hid: string) =>
    grantBudgetHeads.find(h => h.id === hid)?.label ?? hid;

  // Only Expense-type entries are taggable to a grant budget head.
  const expensesOnly = useMemo(
    () => journalEntries
      .filter(e => e.entryType === 'Expense')
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    [journalEntries],
  );

  // ≥ ₹1k untagged expenses — what the audit calls "no idea which grant
  // they belong to". Surface them so the user can clean them up.
  const untaggedSignificant = useMemo(
    () => expensesOnly.filter(e => Math.abs(e.amount) >= 1000 && !e.grantTag),
    [expensesOnly],
  );
  const untaggedTotal = untaggedSignificant.reduce((s, e) => s + Math.abs(e.amount), 0);

  // Per-row inline picker state.
  const [tagDraft, setTagDraft] = useState<Record<string, { grantId: string; budgetHeadId: string }>>({});
  const [showTagSection, setShowTagSection] = useState(true);

  const handleTagSave = (entryId: string) => {
    const draft = tagDraft[entryId];
    if (!draft || !draft.grantId || !draft.budgetHeadId) {
      toast.error('Pick a grant and a budget head first.');
      return;
    }
    setJournalEntryGrantTag(entryId, draft);
    setTagDraft(prev => {
      const n = { ...prev };
      delete n[entryId];
      return n;
    });
    toast.success('Expense tagged.');
  };

  const handleExportByGrant = () => {
    const rows = ['Entry ID,Date,Amount,Description,Fund,Grant,Budget Head'];
    for (const e of expensesOnly) {
      if (!e.grantTag) continue;
      const safe = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      rows.push([
        e.id,
        e.date,
        Math.abs(e.amount),
        safe(e.description),
        safe(e.fund ?? ''),
        safe(cardLabel(e.grantTag.grantId)),
        safe(headLabel(e.grantTag.budgetHeadId)),
      ].join(','));
    }
    if (rows.length === 1) {
      toast.error('No tagged expenses to export yet.');
      return;
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `expenses_by_grant_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length - 1} tagged expenses.`);
  };

  const handleGenerateUC = () => {
    const run = async () => {
      try {
        const res = await apiFetch('/finance/uc.pdf');
        if (!res.ok) throw new Error('uc');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'utilization_certificate_draft.pdf';
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        toast.error('Failed to generate UC (backend not reachable).');
      }
    };
    run();
  };

  const handleFunderPackPdf = (template: string, filename: string) => {
    const run = async () => {
      try {
        const q = new URLSearchParams({ template });
        const res = await apiFetch(`/reports/funder-export.pdf?${q.toString()}`);
        if (!res.ok) throw new Error('pdf');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Funder pack downloaded (draft).');
      } catch {
        toast.error('Could not download funder pack — check API connection.');
      }
    };
    run();
  };

  const openCreateGrant = () => {
    setEditingGrantId(null);
    setGrantForm({ name: '', total: 1000000, spent: 0, status: 'On Track' });
    setShowGrantModal(true);
  };

  const openEditGrant = (g: any) => {
    setEditingGrantId(g.id);
    setGrantForm({ name: g.name, total: Number(g.total) || 0, spent: Number(g.spent) || 0, status: g.status || 'On Track' });
    setShowGrantModal(true);
  };

  const saveGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: grantForm.name,
        total: Number(grantForm.total),
        spent: Number(grantForm.spent),
        variance: Number(grantForm.total) - Number(grantForm.spent),
        status: grantForm.status,
      };
      const res = await apiFetch(editingGrantId ? `/finance/grants/${encodeURIComponent(editingGrantId)}` : '/finance/grants', {
        method: editingGrantId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('save grant');
      toast.success(editingGrantId ? 'Grant updated.' : 'Grant created.');
      setShowGrantModal(false);
      await loadGrants();
    } catch {
      toast.error('Failed to save grant.');
    }
  };

  const deleteGrant = async (id: string) => {
    if (!confirm('Delete this grant?')) return;
    try {
      const res = await apiFetch(`/finance/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete');
      toast.success('Grant deleted.');
      await loadGrants();
    } catch {
      toast.error('Failed to delete grant.');
    }
  };

  return (
    <div className="finance-container">
      <div className="page-header">
        <div>
          <h1 className="page-title text-gradient">Finance & FCRA</h1>
          <p className="page-subtitle">Fund accounting, automated compliance, and Tally Prime sync.</p>
        </div>
        <div className="flex gap-4" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={handleTallyXMLExport}>
            <Download size={16} /> Tally XML Export
          </button>
          <button className="btn btn-secondary" onClick={handleGenerateUC}>
            <FileText size={16} /> Generate UC (CSR-1)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleFunderPackPdf('tata_trusts', 'funder_tata_trusts_draft.pdf')}
            title="Narrative-style draft aligned to common Tata Trusts report sections"
          >
            <FileText size={16} /> Funder: Tata Trusts
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleFunderPackPdf('csr2', 'funder_csr2_draft.pdf')}
            title="CSR-2 style expenditure / beneficiary summary draft"
          >
            <FileText size={16} /> Funder: CSR-2
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleFunderPackPdf('generic_uc', 'funder_uc_generic.pdf')}
            title="Generic utilisation certificate layout"
          >
            <FileText size={16} /> Funder: UC
          </button>
          <button className="btn btn-secondary" onClick={handleExportByGrant} title="Export every tagged expense with its grant + budget head">
            <Download size={16} /> Expenses by grant
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleBulkReceiptGeneration}
            disabled={bulkReceiptBusy}
            title="Generate 80G receipts for all income entries this month with a linked donor"
          >
            <PackageOpen size={16} /> {bulkReceiptBusy ? 'Generating…' : 'Generate All Pending Receipts'}
          </button>
          <PermissionGate module="finance" action="canEdit">
            <button className="btn btn-primary" onClick={() => setShowEntryModal(true)}>
              <Plus size={16} /> New Journal Entry
            </button>
          </PermissionGate>
        </div>
      </div>

      {/* 80G Registry Warning — shown when no Donor Deduction doc in the Compliance registry */}
      {eightyGMissing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 1rem', marginBottom: '1rem', background: '#fef9c3', border: '1px solid #fde047', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: '#713f12' }}>
          <AlertCircle size={15} color="#ca8a04" />
          <span>No 80G certificate found in the Compliance Registry — receipts will show a blank registration number. <strong>Upload your 80G certificate in Compliance HQ</strong> to populate this automatically.</span>
        </div>
      )}

      {/* Tally Sync Banner */}
      <div className="tally-sync-banner">
        <div className="tally-info">
          <div className="tally-logo">T</div>
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.25rem' }}>Tally Prime Sync Active</h3>
            <div className="sync-status">
              <div className="sync-dot"></div>
              {syncing ? 'Syncing...' : `Last synced: ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Not yet'} • Tap Force Sync`}
            </div>
          </div>
        </div>
        <button className="btn btn-secondary" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }} onClick={handleTallySync} disabled={syncing}>
          <RefreshCw size={16} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {syncing ? 'Syncing...' : 'Force Sync'}
        </button>
      </div>

      {/* Bank Auto-Ingestion (Account Aggregator) */}
      {!aaBannerDismissed && (
        <div className="card" style={{ marginBottom: '2rem', border: '1px solid #e2e8f0', background: 'linear-gradient(to right, #f8fafc, #ffffff)', position: 'relative' }}>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              try {
                localStorage.setItem('gj_finance_aa_banner_dismiss', '1');
              } catch {
                // ignore
              }
              setAaBannerDismissed(true);
            }}
            style={{ position: 'absolute', right: '0.75rem', top: '0.75rem', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 4 }}
          >
            <X size={18} />
          </button>
          <div style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="flex items-center gap-4">
              <div style={{ width: '40px', height: '40px', background: '#3b82f6', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                <Globe size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Bank Auto-Ingestion (AA Framework)</h3>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  One-time consent (~60s) removes manual statement entry. Connect your operating / FCRA account when ready.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div style={{ textAlign: 'right', marginRight: '1rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>Status</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Not configured</div>
              </div>
              <button className="btn btn-secondary" onClick={async () => {
                try {
                  const res = await apiFetch('/finance/aa/consents/refresh', { method: 'POST' });
                  if (!res.ok) throw new Error('aa');
                  toast.success('Consents refreshed.', { icon: '🔐' });
                } catch {
                  toast.error('Failed to refresh consents.');
                }
              }}>
                Manage Consents
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent classification exception queue */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h3 className="card-title">FCRA classification review</h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0.25rem 0 0' }}>
              Surface donations where the agent is unsure (below your confidence threshold).
            </p>
          </div>
          <label className="flex items-center gap-2" style={{ fontSize: '0.875rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={exceptionMode} onChange={e => setExceptionMode(e.target.checked)} />
            Exception queue
          </label>
        </div>
        {exceptionMode && (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div className="flex flex-wrap gap-3 items-center" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
                Min confidence (keep below)
                <select
                  className="input-field"
                  style={{ marginLeft: 8, display: 'inline-block', width: 'auto', minWidth: 88, padding: '0.25rem 0.5rem' }}
                  value={minConf}
                  onChange={e => setMinConf(Number(e.target.value))}
                >
                  <option value={0.8}>0.80</option>
                  <option value={0.85}>0.85</option>
                  <option value={0.9}>0.90</option>
                  <option value={0.95}>0.95</option>
                </select>
              </label>
              <button className="btn btn-secondary" type="button" style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }} onClick={() => loadExceptionTx()} disabled={exLoading}>
                {exLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem' }}
                disabled={exLoading || exBulkBusy || exTx.length === 0}
                onClick={() => void acceptAllExceptions()}
              >
                {exBulkBusy ? 'Working…' : `Accept all (${exTx.length})`}
              </button>
            </div>
            {exLoading && exTx.length === 0 ? (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>Loading…</div>
            ) : exTx.length === 0 ? (
              <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No exceptions for this threshold.</div>
            ) : (
              <div
                ref={exScrollRef}
                className="table-scroll-wrap"
                style={{
                  maxHeight: 'min(55vh, 480px)',
                  overflow: 'auto',
                  border: '1px solid var(--color-border-light)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(80px,0.9fr) minmax(64px,0.7fr) minmax(110px,1.1fr) minmax(70px,0.9fr) 52px minmax(110px,1fr) 88px 110px',
                    gap: '0.5rem',
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.03em',
                    color: 'var(--color-text-tertiary)',
                    borderBottom: '1px solid var(--color-border-light)',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--color-bg-card)',
                    zIndex: 1,
                  }}
                >
                  <span>Donor</span>
                  <span>Amount</span>
                  <span>Campaign</span>
                  <span>Agent</span>
                  <span>Conf.</span>
                  <span>Reclassify</span>
                  <span>Approve</span>
                  <span>Bookkeeper</span>
                </div>
                <div style={{ height: exVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {exVirtualizer.getVirtualItems().map(vr => {
                    const t = exTx[vr.index];
                    return (
                      <div
                        key={t.id}
                        data-index={vr.index}
                        ref={exVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vr.start}px)`,
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(80px,0.9fr) minmax(64px,0.7fr) minmax(110px,1.1fr) minmax(70px,0.9fr) 52px minmax(110px,1fr) 88px 110px',
                            gap: '0.5rem',
                            padding: '0.5rem 0.75rem',
                            alignItems: 'center',
                            fontSize: '0.82rem',
                            borderBottom: '1px solid var(--color-border-light)',
                            opacity: exSentToBk[String(t.id)] ? 0.65 : 1,
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.donorName || '—'}</span>
                          <span>₹{Number(t.amount || 0).toLocaleString()}</span>
                          <span style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.campaignTitle || '—'}</span>
                          <span style={{ fontSize: '0.78rem' }}>{t.agent_category || '—'}</span>
                          <span>{Math.round((Number(t.agent_confidence) || 0) * 100)}%</span>
                          <select
                            aria-label={`Reclassify transaction ${t.id}`}
                            className="input-field"
                            style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem', width: '100%' }}
                            value={exPending[String(t.id)] ?? (t.agent_category || 'Domestic')}
                            onChange={e => setExPending(prev => ({ ...prev, [String(t.id)]: e.target.value }))}
                            disabled={!!exBusy[String(t.id)]}
                          >
                            {FCRA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                            onClick={() => approveExceptionRow(t)}
                            disabled={!!exBusy[String(t.id)]}
                          >
                            {exBusy[String(t.id)] ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                            onClick={() => sendExceptionToBookkeeper(t)}
                            disabled={!!exBusy[String(t.id)] || !!exSentToBk[String(t.id)]}
                            title="Send this row to the bookkeeper for a second look"
                          >
                            {exSentToBk[String(t.id)] ? 'Sent ✓' : exBusy[String(t.id)] ? '…' : 'Send to BK'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pre-tagged donation stream — correct rows need no action */}
      {classifiedStream.length > 0 && (
        <div className="card" style={{ marginBottom: '2rem' }}>
          <div className="card-header flex justify-between items-center" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h3 className="card-title">Donation stream (Finance Agent tag)</h3>
              <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0.25rem 0 0' }}>
                Each row shows the agent's FCRA-style classification. Skim high-confidence rows; focus corrections below.
              </p>
            </div>
            <label className="flex items-center gap-2" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={streamExceptionOnly}
                onChange={e => setStreamExceptionOnly(e.target.checked)}
              />
              Only &lt;90% confidence
            </label>
          </div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div
              ref={classifiedScrollRef}
              className="table-scroll-wrap"
              style={{
                maxHeight: 'min(65vh, 560px)',
                overflow: 'auto',
                border: '1px solid var(--color-border-light)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(72px,0.95fr) minmax(96px,1.1fr) minmax(72px,0.85fr) minmax(88px,1fr) 52px',
                  gap: '0.5rem',
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  color: 'var(--color-text-tertiary)',
                  borderBottom: '1px solid var(--color-border-light)',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--color-bg-card)',
                  zIndex: 1,
                }}
              >
                <span>Date</span>
                <span>Donor</span>
                <span>Amount</span>
                <span>Tag</span>
                <span>Conf.</span>
              </div>
              {visibleClassifiedStream.length === 0 ? (
                <div style={{ padding: '1rem 0.75rem', fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                  No rows match this filter.
                </div>
              ) : (
                <div style={{ height: classifiedVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
                  {classifiedVirtualizer.getVirtualItems().map(vr => {
                    const t = visibleClassifiedStream[vr.index];
                    const conf = Number(t.agent_confidence) || 0;
                    const high = conf >= 0.9;
                    return (
                      <div
                        key={t.id}
                        data-index={vr.index}
                        ref={classifiedVirtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vr.start}px)`,
                        }}
                      >
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(72px,0.95fr) minmax(96px,1.1fr) minmax(72px,0.85fr) minmax(88px,1fr) 52px',
                            gap: '0.5rem',
                            padding: '0.45rem 0.75rem',
                            alignItems: 'center',
                            fontSize: '0.82rem',
                            opacity: high ? 0.92 : 1,
                            borderBottom: '1px solid var(--color-border-light)',
                          }}
                        >
                          <span style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>{t.date || '—'}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.donorName || '—'}</span>
                          <span>₹{Number(t.amount || 0).toLocaleString()}</span>
                          <span>
                            <span className="badge badge-outline" style={{ fontSize: '0.72rem' }}>
                              {t.agent_category || '—'}
                            </span>
                          </span>
                          <span style={{ color: high ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 600 }}>
                            {Math.round(conf * 100)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fund Balances */}
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Fund Balances</h2>
      <div className="finance-grid">
        <div className="finance-card" style={{ gridColumn: 'span 3' }}>
          <div className="fund-label"><span>Balances</span></div>
          <div className="fund-amount">—</div>
          <div className="fund-meta">
            <span style={{ color: 'var(--color-text-tertiary)' }}>Connect bank feeds (AA) to show real-time balances.</span>
          </div>
        </div>
        <div className="finance-card fcra-card fcra-gauge-card" style={{ gridColumn: 'span 3', borderColor: fcraStatus.color + '55', background: fcraStatus.bg }}>
          <div className="fcra-card-header">
            <div className="fund-label" style={{ color: '#7C3AED' }}><span>FCRA Admin Overhead Monitor</span></div>
            <span className="fcra-status-pill" style={{ background: fcraStatus.color }}>
              {fcraStatus.label}
            </span>
          </div>
          <div className="fcra-gauge-body">
            <div className="fcra-gauge-row">
              <div className="fcra-gauge-big-pct" style={{ color: fcraStatus.color }}>
                {fcraTotal > 0 ? `${fcraRealPct.toFixed(1)}%` : '—'}
              </div>
              <div className="fcra-gauge-meta">
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>of total FCRA funds used as admin overhead</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: 2 }}>
                  Statutory cap (FCRA 2010): <strong>20%</strong>
                  &nbsp;·&nbsp;
                  Internal pre-save guard: <strong style={{ color: '#D97706' }}>18%</strong>
                  &nbsp;(2% buffer to stay comfortably within the legal limit)
                </div>
              </div>
            </div>
            <div className="fcra-gauge-bar-wrap">
              <div className="fcra-gauge-track">
                <div
                  className="fcra-gauge-fill"
                  style={{
                    width: `${fcraTotal > 0 ? Math.min((fcraRealPct / 20) * 100, 100) : 0}%`,
                    background: fcraStatus.color,
                    transition: 'width 0.6s ease, background 0.4s ease',
                  }}
                />
                <div className="fcra-gauge-marker" style={{ left: '60%' }} title="Caution threshold: 12%" />
                <div className="fcra-gauge-marker" style={{ left: '80%' }} title="Warning threshold: 16%" />
              </div>
              <div className="fcra-gauge-legend">
                <span style={{ color: '#16A34A' }}>Safe &lt;12%</span>
                <span style={{ color: '#D97706' }}>Caution 12–16%</span>
                <span style={{ color: '#EA580C' }}>Warning 16–20%</span>
                <span style={{ color: '#DC2626' }}>Critical ≥20%</span>
              </div>
            </div>
            {fcraTotal > 0 ? (
              <div className="fcra-gauge-detail">
                <div className="fcra-detail-row">
                  <span>Admin spent</span>
                  <strong>₹{fcraAdminSpent.toLocaleString('en-IN')}</strong>
                </div>
                <div className="fcra-detail-row">
                  <span>Remaining headroom</span>
                  <strong style={{ color: fcraStatus.color }}>
                    ₹{Math.max(0, fcraAdminLimit - fcraAdminSpent).toLocaleString('en-IN')}
                  </strong>
                </div>
                <div className="fcra-detail-row">
                  <span>20% cap (of ₹{fcraTotal.toLocaleString('en-IN')} total FCRA)</span>
                  <strong>₹{fcraAdminLimit.toLocaleString('en-IN')}</strong>
                </div>
              </div>
            ) : (
              <div className="fcra-gauge-empty">Add FCRA-tagged grants above to compute admin overhead in real time.</div>
            )}
          </div>
        </div>
      </div>

      {/* Grant Utilization */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="card-title">Grant Budget & Utilization</h3>
          <div className="flex gap-2">
            <button className="btn btn-primary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={openCreateGrant}>
              <Plus size={14} /> Add Grant
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={loadGrants} disabled={grantsLoading}>
              <RefreshCw size={14} /> {grantsLoading ? 'Loading…' : 'Refresh'}
            </button>
            <button className="btn btn-secondary" style={{ padding: '0.25rem 0.75rem', fontSize: '0.75rem' }} onClick={handleExportReport}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>
        <div
          ref={grantsScrollRef}
          className="table-scroll-wrap"
          style={{
            maxHeight: 'min(55vh, 520px)',
            overflow: 'auto',
            border: '1px solid var(--color-border-light)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(120px,1.4fr) minmax(88px,0.9fr) minmax(140px,1.1fr) minmax(72px,0.75fr) minmax(72px,0.75fr) minmax(160px,1.2fr)',
              gap: '0.5rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.68rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              color: 'var(--color-text-tertiary)',
              borderBottom: '1px solid var(--color-border-light)',
              position: 'sticky',
              top: 0,
              background: 'var(--color-bg-card)',
              zIndex: 1,
            }}
          >
            <span>Grant</span>
            <span>Budget</span>
            <span>Utilization</span>
            <span>Variance</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {grants.length === 0 ? (
            <div style={{ padding: '1.25rem', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>No grants yet.</div>
          ) : (
            <div style={{ height: grantsVirtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
              {grantsVirtualizer.getVirtualItems().map(vr => {
                const grant = grants[vr.index];
                // Live spend: sum journal expense entries tagged to this grant
                // (via grantTag or direct grantId). Replaces the stored grant.spent
                // field so the progress bar always reflects booked transactions.
                const liveSpent = journalEntries
                  .filter(e =>
                    e.entryType === 'Expense' && (
                      (e.grantTag && String(e.grantTag.grantId) === String(grant.id)) ||
                      (!e.grantTag && e.grantId && String(e.grantId) === String(grant.id))
                    )
                  )
                  .reduce((sum, e) => sum + Math.abs(Number(e.amount) || 0), 0);
                const progress = grant.total > 0 ? (liveSpent / grant.total) * 100 : 0;
                return (
                  <div
                    key={grant.id}
                    data-index={vr.index}
                    ref={grantsVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vr.start}px)`,
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(120px,1.4fr) minmax(88px,0.9fr) minmax(140px,1.1fr) minmax(72px,0.75fr) minmax(72px,0.75fr) minmax(160px,1.2fr)',
                        gap: '0.5rem',
                        padding: '0.55rem 0.75rem',
                        alignItems: 'center',
                        fontSize: '0.82rem',
                        borderBottom: '1px solid var(--color-border-light)',
                        // Highlight grant targeted by ?filter=clawback&grantId= deep link
                        ...(highlightGrantId && String(grant.id) === String(highlightGrantId) ? {
                          background: '#fff7ed',
                          outline: '2px solid #f97316',
                          outlineOffset: '-2px',
                          borderRadius: '4px',
                        } : {}),
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{grant.name}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>{grant.id}</div>
                      </div>
                      <span style={{ fontWeight: 600 }}>₹{grant.total.toLocaleString()}</span>
                      <div className="progress-inline" style={{ minWidth: 0 }}>
                        <div className="progress-track">
                          <div
                            className="progress-val"
                            style={{
                              width: `${progress}%`,
                              background: progress > 90 ? 'var(--color-warning)' : 'var(--color-primary)',
                            }}
                          ></div>
                        </div>
                        <span style={{ fontSize: '0.72rem', width: '35px' }}>{Math.round(progress)}%</span>
                      </div>
                      {/* Variance and status are derived from liveSpent so all
                          grant-row numbers stay consistent with the live progress bar. */}
                      {(() => {
                        const variance = grant.total - liveSpent;
                        const liveStatus = liveSpent > grant.total ? 'Over Budget' : 'On Track';
                        return (
                          <span
                            className={variance > 0 ? 'variance-positive' : variance < 0 ? 'variance-negative' : ''}
                            style={{ fontSize: '0.78rem' }}
                          >
                            {variance === 0 ? '-' : variance > 0 ? `+₹${variance.toLocaleString()}` : `-₹${Math.abs(variance).toLocaleString()}`}
                          </span>
                        );
                      })()}
                      <span>
                        {(() => {
                          const liveStatus = liveSpent > grant.total ? 'Over Budget' : 'On Track';
                          return (
                            <span
                              className={`badge ${liveStatus === 'On Track' ? 'badge-success' : ''}`}
                              style={liveStatus === 'Over Budget' ? { borderColor: 'var(--color-danger)', color: 'var(--color-danger)', border: '1px solid' } : {}}
                            >
                              {liveStatus}
                            </span>
                          );
                        })()}
                      </span>
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                          disabled
                          title="Not available yet"
                        >
                          View P&L
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                          onClick={() => openEditGrant(grant)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.72rem',
                            color: 'var(--color-danger)',
                            borderColor: 'var(--color-danger)',
                          }}
                          onClick={() => deleteGrant(grant.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Tag expenses to grant budget heads */}
      <div className="card" style={{ marginTop: '1rem' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Tag size={18} color="var(--color-primary)" />
            <h3 className="card-title" style={{ margin: 0 }}>Tag expenses to grants</h3>
            {untaggedSignificant.length > 0 && (
              <span style={{
                background: '#FEE2E2', color: '#B91C1C', borderRadius: 99,
                padding: '2px 10px', fontSize: '0.72rem', fontWeight: 700,
              }}>
                {untaggedSignificant.length} need tagging
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}
            onClick={() => setShowTagSection(v => !v)}
          >
            {showTagSection ? 'Hide' : 'Show'}
          </button>
        </div>

        {showTagSection && (
          <div style={{ padding: '0.75rem 0' }}>
            {untaggedSignificant.length > 0 ? (
              <div style={{
                background: '#FEF3C7', border: '1px solid #FCD34D',
                borderRadius: 'var(--radius-md)', padding: '0.6rem 0.8rem',
                fontSize: '0.82rem', color: '#92400E', marginBottom: '0.75rem',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <AlertCircle size={14} />
                <span>
                  <strong>{untaggedSignificant.length}</strong> expenses ≥ ₹1,000
                  totalling <strong>₹{Math.round(untaggedTotal).toLocaleString('en-IN')}</strong>
                  {' '}aren't yet tagged to a grant — tag them so utilisation reports stay accurate.
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)', marginBottom: '0.75rem' }}>
                All significant expenses are tagged. Use this list to re-tag or correct any entry.
              </div>
            )}

            {csrCards.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)' }}>Add a grant first.</div>
            ) : grantBudgetHeads.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)' }}>
                No budget heads configured yet. Open a grant in <em>Grants → [grant] → Active</em> and add heads first.
              </div>
            ) : (
              <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--color-border-light)', borderRadius: 'var(--radius-md)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--color-bg-main)', position: 'sticky', top: 0 }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem' }}>Description</th>
                      <th style={{ textAlign: 'right', padding: '0.5rem 0.6rem' }}>Amount</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem' }}>Grant</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.6rem' }}>Budget head</th>
                      <th style={{ padding: '0.5rem 0.6rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(untaggedSignificant.length > 0 ? untaggedSignificant : expensesOnly.slice(0, 25)).map(e => {
                      const existing = e.grantTag;
                      const draft    = tagDraft[e.id] ?? { grantId: existing?.grantId ?? '', budgetHeadId: existing?.budgetHeadId ?? '' };
                      const headsForGrant = grantBudgetHeads.filter(h => String(h.grantId) === String(draft.grantId));
                      const desc = `${e.description}${e.fund ? ` · ${e.fund}` : ''}`;
                      return (
                        <tr key={e.id} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                          <td style={{ padding: '0.4rem 0.6rem', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={desc}>
                            {desc}
                            {existing && <span style={{ marginLeft: 6, color: '#16A34A', fontSize: '0.7rem' }}>· tagged</span>}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', fontWeight: 600 }}>
                            ₹{Math.round(Math.abs(e.amount)).toLocaleString('en-IN')}
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <select
                              className="input-field"
                              style={{ padding: '0.25rem 0.4rem', fontSize: '0.78rem' }}
                              value={draft.grantId}
                              onChange={ev => setTagDraft(prev => ({ ...prev, [e.id]: { grantId: ev.target.value, budgetHeadId: '' } }))}
                            >
                              <option value="">Select grant…</option>
                              {csrCards.map(c => (
                                <option key={c.id} value={String(c.id)}>{c.company} — {c.project}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem' }}>
                            <select
                              className="input-field"
                              style={{ padding: '0.25rem 0.4rem', fontSize: '0.78rem' }}
                              disabled={!draft.grantId}
                              value={draft.budgetHeadId}
                              onChange={ev => setTagDraft(prev => ({ ...prev, [e.id]: { ...(prev[e.id] ?? draft), budgetHeadId: ev.target.value } }))}
                            >
                              <option value="">{headsForGrant.length === 0 ? 'No heads on this grant' : 'Select head…'}</option>
                              {headsForGrant.map(h => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                              onClick={() => handleTagSave(e.id)}
                            >Save</button>
                            {existing && (
                              <button
                                type="button"
                                onClick={() => { setJournalEntryGrantTag(e.id, null); toast.success('Tag cleared.'); }}
                                title="Clear tag"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4, color: 'var(--color-text-tertiary)' }}
                              >
                                <X size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {showEntryModal && (
        <ModalOverlay onBackdropClick={() => setShowEntryModal(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fin-entry-title"
          >
            <button type="button" onClick={() => setShowEntryModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fin-entry-title" style={{ marginBottom: '1.5rem', paddingRight: '2.5rem' }}>New Journal Entry</h2>
            <form onSubmit={handleJournalEntry} className="flex-col gap-4 flex">
              {/* Cross-module joins: donor + programme selectors */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Donor (optional)</label>
                  <input
                    list="fin-donor-list"
                    className="input-field"
                    placeholder="Search donor…"
                    value={donorSearch}
                    onChange={ev => {
                      const val = ev.target.value;
                      setDonorSearch(val);
                      const match = donors.find(d => d.name.toLowerCase() === val.toLowerCase());
                      setEntry(prev => ({
                        ...prev,
                        donorId: match ? match.id : '',
                        // Auto-fill receipt fields from the linked CRM donor.
                        // When the donor link is cleared (match is undefined), reset
                        // both fields to empty so stale PAN data isn't retained.
                        receiptDonorName: match ? match.name : '',
                        receiptDonorPan:  match ? (match.pan || '') : '',
                      }));
                    }}
                  />
                  <datalist id="fin-donor-list">
                    {donors.map(d => <option key={d.id} value={d.name} />)}
                  </datalist>
                  {entry.donorId && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-success)', marginTop: 2 }}>
                      Linked to CRM donor
                    </div>
                  )}
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Programme (optional)</label>
                  <select
                    className="input-field"
                    value={entry.programmeId}
                    onChange={ev => setEntry(prev => ({ ...prev, programmeId: ev.target.value }))}
                  >
                    <option value="">— None —</option>
                    {allProgrammes.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Description</label>
                {/* Feature 4: AI pre-fill via explicit "Categorise" button.
                    Paste a bank statement line or type a description, then click
                    "Categorise" to have the AI populate fund type, entry type,
                    programme, and amount (if a ₹/Rs/INR amount is detected). */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      required
                      type="text"
                      className="input-field"
                      placeholder="Paste a bank line or type a description…"
                      value={entry.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        // Light programme name pre-fill from description text (no API call).
                        let nextProgramme = entry.programmeId;
                        if (!nextProgramme && val.length > 3) {
                          const match = allProgrammes.find(p =>
                            val.toLowerCase().includes(p.toLowerCase().slice(0, Math.max(6, p.length)))
                          );
                          if (match) nextProgramme = match;
                        }
                        setEntry(prev => ({ ...prev, description: val, programmeId: nextProgramme }));
                        // Clear stale classification chip when the description changes.
                        if (classification) setClassification(null);
                      }}
                    />
                    {(classification || isClassifying) && (
                      <div style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--color-bg-card)', padding: '0.2rem 0.45rem', borderRadius: '4px', border: '1px solid var(--color-border)', fontSize: '0.7rem', zIndex: 5, pointerEvents: 'none' }}>
                        {isClassifying ? (
                          <span style={{ color: 'var(--color-text-tertiary)' }}>Classifying…</span>
                        ) : (
                          <>
                            <Bot size={12} color="var(--color-primary)" />
                            <span style={{ fontWeight: 600 }}>{classification?.category}</span>
                            <span style={{ color: (classification?.confidence || 0) > 0.8 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                              {Math.round((classification?.confidence || 0) * 100)}%
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0.45rem 0.7rem', fontSize: '0.78rem', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    disabled={isClassifying || !entry.description.trim()}
                    title="Use AI to categorise and pre-fill all form fields"
                    onClick={async () => {
                      const val = entry.description.trim();
                      if (!val) return;
                      setIsClassifying(true);
                      try {
                        const res = await apiFetch(`/workflows/classify-transaction?description=${encodeURIComponent(val)}`, { method: 'POST' });
                        if (!res.ok) { toast.error('Categorisation failed.'); return; }
                        const data = await res.json();
                        setClassification(data);
                        if (data?.category) {
                          const cat = String(data.category).toLowerCase();
                          // Fund classification
                          let aiFund = entry.fund;
                          if (cat.includes('fcra') || cat.includes('foreign')) aiFund = 'FCRA';
                          else if (cat.includes('csr')) aiFund = 'CSR';
                          else if (cat.includes('restricted') || cat.includes('grant')) aiFund = 'Restricted Grant';
                          else if (cat.includes('general') || cat.includes('admin') || cat.includes('overhead')) aiFund = 'General';
                          // Entry type
                          let aiType = entry.type as 'Expense' | 'Income' | 'Transfer';
                          if (cat.includes('income') || cat.includes('donation') || cat.includes('receipt')) aiType = 'Income';
                          else if (cat.includes('transfer')) aiType = 'Transfer';
                          else if (cat.includes('expense') || cat.includes('salary') || cat.includes('beneficiary') || cat.includes('program')) aiType = 'Expense';
                          // Programme
                          let aiProg = entry.programmeId;
                          if (!aiProg) {
                            const mapped = allProgrammes.find(p =>
                              p.toLowerCase() === cat ||
                              p.toLowerCase().startsWith(cat.slice(0, Math.max(5, cat.length))) ||
                              cat.startsWith(p.toLowerCase().slice(0, Math.max(5, p.length)))
                            );
                            if (mapped) aiProg = mapped;
                          }
                          // Amount from bank statement paste (₹12,500 / Rs 12500 / INR 12500)
                          let aiAmount = entry.amount;
                          const amtMatch = val.match(/(?:₹|Rs\.?\s*|INR\s*)([\d,]+)/i);
                          if (amtMatch) {
                            const parsed = parseInt(amtMatch[1].replace(/,/g, ''), 10);
                            if (!isNaN(parsed) && parsed > 0) aiAmount = parsed;
                          }
                          // Set admin overhead flag based on the POST-CLASSIFICATION fund (aiFund),
                          // not the current entry.fund, so the FCRA guard fires correctly even
                          // when the user hadn't already selected FCRA before clicking Categorise.
                          const aiAdminOverhead = aiFund === 'FCRA'
                            ? (cat.includes('admin') || cat.includes('overhead') || cat.includes('management'))
                            : false;
                          setEntry(prev => ({ ...prev, fund: aiFund, type: aiType, programmeId: aiProg, amount: aiAmount, category: data.category, isAdminOverhead: aiAdminOverhead }));
                          toast.success('Fields pre-filled from AI categorisation.', { duration: 3000 });
                        }
                      } catch { toast.error('Categorisation failed.'); }
                      finally { setIsClassifying(false); }
                    }}
                  >
                    <Bot size={14} /> {isClassifying ? 'Classifying…' : 'Categorise'}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Amount (₹)</label>
                  <input required type="number" className="input-field" min="1" value={entry.amount} onChange={e => setEntry({ ...entry, amount: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Type</label>
                  <select className="input-field" value={entry.type} onChange={e => setEntry({ ...entry, type: e.target.value as 'Expense'|'Income'|'Transfer', grantId: e.target.value === 'Expense' ? entry.grantId : '', budgetHeadId: e.target.value === 'Expense' ? entry.budgetHeadId : '' })}>
                    <option>Expense</option>
                    <option>Income</option>
                    <option>Transfer</option>
                  </select>
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Fund Classification</label>
                <select className="input-field" value={entry.fund} onChange={e => setEntry({ ...entry, fund: e.target.value, isAdminOverhead: false })}>
                  <option>General</option>
                  <option>FCRA</option>
                  <option>CSR</option>
                  <option>Restricted Grant</option>
                </select>
              </div>
              {/* FCRA admin overhead flag — only shown for FCRA expenses.
                  Must be checked for the entry to count toward the 18% admin cap. */}
              {entry.type === 'Expense' && entry.fund === 'FCRA' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none', padding: '0.4rem 0.6rem', background: entry.isAdminOverhead ? '#FEF3C7' : 'var(--color-bg-card)', border: `1px solid ${entry.isAdminOverhead ? '#FCD34D' : 'var(--color-border)'}`, borderRadius: 6 }}>
                  <input
                    type="checkbox"
                    checked={entry.isAdminOverhead}
                    onChange={e => setEntry(prev => ({ ...prev, isAdminOverhead: e.target.checked }))}
                    style={{ accentColor: '#D97706', width: 16, height: 16 }}
                  />
                  <span>
                    <strong>Admin overhead?</strong>
                    <span style={{ color: 'var(--color-text-secondary)', marginLeft: '0.4rem' }}>
                      (counts toward the 18% FCRA admin cap — leave unchecked for programme delivery)
                    </span>
                  </span>
                </label>
              )}
              {/* AI category badge — shows the category returned by "Categorise".
                  Stored on the journal entry for audit trail + future re-classification. */}
              {entry.category && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', padding: '0.35rem 0.65rem', background: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                  <Bot size={13} color="var(--color-primary)" />
                  <span style={{ color: 'var(--color-text-secondary)' }}>AI Category:</span>
                  <strong>{entry.category}</strong>
                  <button type="button" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }} onClick={() => setEntry(prev => ({ ...prev, category: '' }))} aria-label="Clear category"><X size={12} /></button>
                </div>
              )}
              {/* Income receipt fields — auto-filled from the linked CRM donor.
                  Both fields are editable so the user can correct auto-fill.
                  These values are sent to the backend for 80G receipt generation. */}
              {entry.type === 'Income' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Donor name (receipt)</label>
                    <input className="input-field" placeholder="Auto-filled from donor"
                      value={entry.receiptDonorName}
                      onChange={e => setEntry(prev => ({ ...prev, receiptDonorName: e.target.value }))}
                    />
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Donor PAN (receipt)</label>
                    <input className="input-field" placeholder="Auto-filled from donor"
                      value={entry.receiptDonorPan}
                      onChange={e => setEntry(prev => ({ ...prev, receiptDonorPan: e.target.value }))}
                    />
                  </div>
                </div>
              )}
              {entry.type === 'Expense' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Tag to grant (optional)</label>
                    <select
                      className="input-field"
                      value={entry.grantId}
                      onChange={e => setEntry({ ...entry, grantId: e.target.value, budgetHeadId: '' })}
                    >
                      <option value="">— None —</option>
                      {/* Only live grants — pipeline cards still in prospecting/pitch/diligence/mou
                          don't have signed agreements and shouldn't receive expense tags. */}
                      {csrCards.filter(c => c.col === 'live').map(c => (
                        <option key={c.id} value={String(c.id)}>{c.company} — {c.project}</option>
                      ))}
                    </select>
                  </div>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">Budget head</label>
                    <select
                      className="input-field"
                      disabled={!entry.grantId}
                      value={entry.budgetHeadId}
                      onChange={e => setEntry({ ...entry, budgetHeadId: e.target.value })}
                    >
                      {(() => {
                        const heads = grantBudgetHeads.filter(h => String(h.grantId) === String(entry.grantId));
                        return (
                          <>
                            <option value="">{!entry.grantId ? 'Pick grant first' : heads.length === 0 ? 'No heads on this grant' : '— Select head —'}</option>
                            {heads.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
                          </>
                        );
                      })()}
                    </select>
                  </div>
                </div>
              )}
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }}>Record Entry</button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Feature 6: Live Programme Budget Bars ─────────────────────────────── */}
      {programBudgets.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <IndianRupee size={18} color="var(--color-primary)" />
            <h3 className="card-title" style={{ margin: 0 }}>Programme spend (live)</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
              Computed from journal entries tagged to each programme
            </span>
          </div>
          <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {programBudgets.map(pb => {
              const liveSpent = journalEntries
                .filter(je =>
                  je.entryType === 'Expense' &&
                  je.programmeId &&
                  programIdFromName(je.programmeId) === pb.programId
                )
                .reduce((s, je) => s + Math.abs(Number(je.amount) || 0), 0);
              const pct = pb.planned > 0 ? Math.min((liveSpent / pb.planned) * 100, 100) : 0;
              const overBudget = liveSpent > pb.planned;
              const barColor = overBudget ? 'var(--color-danger)' : pct > 80 ? 'var(--color-warning)' : 'var(--color-primary)';
              return (
                <div key={pb.programId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{pb.label}</span>
                    <span style={{ fontSize: '0.8rem', color: overBudget ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                      ₹{liveSpent.toLocaleString('en-IN')} / ₹{pb.planned.toLocaleString('en-IN')}
                      {overBudget && <span style={{ marginLeft: 6, fontWeight: 700 }}>OVER</span>}
                    </span>
                  </div>
                  <div style={{ height: 8, background: 'var(--color-border-light)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: barColor,
                      borderRadius: 4,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '0.2rem' }}>
                    <span>{Math.round(pct)}% utilised</span>
                    {pb.windowEnd && <span>Window ends {new Date(pb.windowEnd).toLocaleDateString('en-IN')}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showGrantModal && (
        <ModalOverlay onBackdropClick={() => setShowGrantModal(false)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="fin-grant-title"
          >
            <button type="button" onClick={() => setShowGrantModal(false)} style={{ position: 'absolute', right: '1rem', top: '1rem', zIndex: 1 }} className="action-btn" aria-label="Close"><X size={20} /></button>
            <h2 id="fin-grant-title" style={{ marginBottom: '1.25rem', paddingRight: '2.5rem' }}>{editingGrantId ? 'Edit Grant' : 'Add Grant'}</h2>
            <form onSubmit={saveGrant} className="flex-col gap-4 flex">
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Grant name</label>
                <input required className="input-field" value={grantForm.name} onChange={(e) => setGrantForm({ ...grantForm, name: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Total budget (₹)</label>
                  <input type="number" className="input-field" min={0} value={grantForm.total} onChange={(e) => setGrantForm({ ...grantForm, total: Number(e.target.value) })} />
                </div>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Spent (₹)</label>
                  <input type="number" className="input-field" min={0} value={grantForm.spent} onChange={(e) => setGrantForm({ ...grantForm, spent: Number(e.target.value) })} />
                </div>
              </div>
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Status</label>
                <select className="input-field" value={grantForm.status} onChange={(e) => setGrantForm({ ...grantForm, status: e.target.value })}>
                  <option value="On Track">On Track</option>
                  <option value="Over Budget">Over Budget</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary">
                {editingGrantId ? 'Save changes' : 'Create grant'}
              </button>
            </form>
          </div>
        </ModalOverlay>
      )}

      {/* Feature 3: FCRA admin 18% cap pre-save guard dialog ─────────────── */}
      {fcraGuardEntry && (
        <ModalOverlay onBackdropClick={() => setFcraGuardEntry(null)}>
          <div
            className="modal-card modal-card--narrow"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="fcra-guard-title"
            style={{ maxWidth: 440 }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              background: '#FEF3C7',
              borderRadius: 'var(--radius-md)',
              border: '1px solid #FCD34D',
            }}>
              <AlertCircle size={22} color="#D97706" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 700, color: '#92400E', fontSize: '0.95rem' }} id="fcra-guard-title">
                  FCRA Admin Cap Warning
                </div>
                <div style={{ fontSize: '0.8rem', color: '#92400E', marginTop: 2 }}>
                  This expense would push FCRA admin spend above 18%
                </div>
              </div>
            </div>
            <div style={{ fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ background: '#f8fafc', borderRadius: 6, padding: '0.5rem 0.75rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Current %</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#374151' }}>{fcraGuardEntry.currentPct.toFixed(1)}%</div>
                </div>
                <div style={{ background: '#FEE2E2', borderRadius: 6, padding: '0.5rem 0.75rem', border: '1px solid #FECACA' }}>
                  <div style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>After save</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#DC2626' }}>{fcraGuardEntry.projectedPct.toFixed(1)}%</div>
                </div>
              </div>
              <p style={{ margin: '0 0 0.4rem' }}>
                This expense would push FCRA admin overhead from{' '}
                <strong>{fcraGuardEntry.currentPct.toFixed(1)}%</strong> to{' '}
                <strong style={{ color: '#DC2626' }}>{fcraGuardEntry.projectedPct.toFixed(1)}%</strong>
                {' '}— exceeding the 18% pre-save threshold.
              </p>
              <p style={{ margin: 0, color: '#374151' }}>
                Rupee headroom before 18% cap:{' '}
                <strong>₹{Math.round(fcraGuardEntry.remainingHeadroom).toLocaleString('en-IN')}</strong>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setFcraGuardEntry(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, background: '#DC2626', borderColor: '#DC2626' }}
                onClick={fcraGuardEntry.onConfirm}
              >
                Save anyway
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default Finance;
