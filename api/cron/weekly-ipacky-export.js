// Weekly cron (Wednesday) - generates fresh iPacky CSV export and emails the download link

import { put, list } from '@vercel/blob';

const BASE_TEMPLATE_PATH = 'ipacky-base-template.csv';
const EXPORT_OUTPUT_PREFIX = 'ipacky-export';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = 'hello@detectivehawkgames.com';
const FROM_NAME = 'Detective Hawk Games — Bin Tracker';
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'iain@detectivehawkgames.com';

async function getCurrentBins() {
  const { blobs } = await list({ prefix: 'dhg-bins.json' });
  const existing = blobs.find(b => b.pathname === 'dhg-bins.json');
  if (!existing) return {};
  const res = await fetch(existing.url);
  return await res.json();
}

async function getBaseTemplate() {
  const { blobs } = await list({ prefix: BASE_TEMPLATE_PATH });
  const existing = blobs.find(b => b.pathname === BASE_TEMPLATE_PATH);
  if (!existing) return null;
  const res = await fetch(existing.url);
  return await res.text();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += char; i++; continue;
    } else {
      if (char === '"') { inQuotes = true; i++; continue; }
      if (char === ',') { row.push(field); field = ''; i++; continue; }
      if (char === '\r') { i++; continue; }
      if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += char; i++; continue;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function toCSVField(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

async function sendExportEmail(downloadUrl, stats) {
  const html = `<!DOCTYPE html>
  <html><body style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #2b2b2b;">
    <h2 style="color: #1a0a2e;">Weekly Bin Export Ready</h2>
    <p>Your iPacky bin location export is ready to download and import.</p>
    <p style="background: #f5f2ea; padding: 14px 18px; border-radius: 8px; font-size: 14px;">
      <strong>${stats.rowsUpdated}</strong> SKUs with bin assignments out of <strong>${stats.totalRows}</strong> total products.
    </p>
    <div style="text-align: center; margin: 28px 0;">
      <a href="${downloadUrl}" style="background: #1a0a2e; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; display: inline-block;">
        Download CSV
      </a>
    </div>
    <p style="font-size: 13px; color: #888;">Import this into iPacky before Friday picking begins.</p>
  </body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [NOTIFY_EMAIL],
      subject: `Bin Export Ready — ${stats.rowsUpdated} SKUs assigned`,
      html,
    }),
  });

  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export default async function handler(req, res) {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const baseTemplateText = await getBaseTemplate();
    if (!baseTemplateText) {
      console.error('No base template found — skipping export');
      return res.status(400).json({ error: 'No base template uploaded yet' });
    }

    const binsData = await getCurrentBins();
    const bins = binsData.bins || binsData;

    const skuToBins = {};
    for (const [binKey, items] of Object.entries(bins)) {
      for (const item of items) {
        const sku = item.sku;
        if (!sku) continue;
        if (!skuToBins[sku]) skuToBins[sku] = [];
        skuToBins[sku].push(binKey);
      }
    }

    const parsed = parseCSV(baseTemplateText);
    const header = parsed[0];
    const skuIdx = header.indexOf('SKU');
    const binIdx = header.indexOf('Bin location');

    let updated = 0;
    const outputRows = [header];
    for (let r = 1; r < parsed.length; r++) {
      const row = [...parsed[r]];
      if (row.length < header.length) continue;
      const sku = row[skuIdx];
      const binList = skuToBins[sku];
      row[binIdx] = binList ? binList.join(';') : '';
      if (binList) updated++;
      outputRows.push(row);
    }

    const csvText = outputRows.map(row => row.map(toCSVField).join(',')).join('\r\n');
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${EXPORT_OUTPUT_PREFIX}-${timestamp}.csv`;

    const blob = await put(filename, csvText, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'text/csv',
    });

    const stats = { rowsUpdated: updated, totalRows: outputRows.length - 1 };
    await sendExportEmail(blob.url, stats);

    console.log(`iPacky export generated: ${filename}, ${updated} SKUs updated`);

    return res.status(200).json({ success: true, url: blob.url, ...stats });

  } catch (err) {
    console.error('Weekly export cron failed:', err);
    return res.status(500).json({ error: err.message });
  }
}
