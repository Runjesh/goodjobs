import { jsPDF } from 'jspdf';

const RECEIPT_SEQ_KEY = 'goodjobs.receipt_seq.v1';

/** Next formatted 80G receipt number; advances local counter (mock / offline). */
export function nextReceiptNumber(ngoName: string): string {
  let seq = 1;
  try {
    const raw = localStorage.getItem(RECEIPT_SEQ_KEY);
    seq = raw ? parseInt(raw, 10) + 1 : 1;
    localStorage.setItem(RECEIPT_SEQ_KEY, String(seq));
  } catch { /* ignore */ }
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const fy = m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
  const prefix = ngoName.replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'NGO';
  return `${prefix}/80G/${fy}/${String(seq).padStart(5, '0')}`;
}

export function generate80GReceiptPdf(opts: {
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
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const cvt = (x: number): string => {
      if (x < 20) return ones[x];
      if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? ` ${ones[x % 10]}` : '');
      if (x < 1000) return `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ` ${cvt(x % 100)}` : ''}`;
      if (x < 100000) return `${cvt(Math.floor(x / 1000))} Thousand${x % 1000 ? ` ${cvt(x % 1000)}` : ''}`;
      return `${cvt(Math.floor(x / 100000))} Lakh${x % 100000 ? ` ${cvt(x % 100000)}` : ''}`;
    };
    return `${cvt(Math.round(n))} Only`;
  };

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18;
  let y = 16;

  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.6);
  doc.rect(10, 10, W - 20, 277);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 118, 110);
  doc.text(opts.ngoName, W / 2, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 60, 60);
  doc.text('80G Donation Receipt — Section 80G, Income Tax Act 1961', W / 2, y, { align: 'center' });
  y += 5;
  doc.text(
    `80G Cert No: ${opts.eighty_g_no || 'N/A'}   |   NGO PAN: ${opts.ngoPan || 'N/A'}`,
    W / 2,
    y,
    { align: 'center' },
  );
  y += 4;
  doc.setDrawColor(180, 180, 180);
  doc.line(M, y, W - M, y);
  y += 7;

  const labelW = 38;
  const col2 = W / 2 + 3;
  const lh = 7;
  const field = (label: string, value: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(`${label}:`, x, yy);
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
  y += noteLines.length * 5 + 14;

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
