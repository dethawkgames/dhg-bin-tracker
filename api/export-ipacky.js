// Generates a fresh iPacky-format CSV from current bin tracker data
// Uses a stored base template (Id, SKU, Name) and overwrites Bin location

import { put, list } from '@vercel/blob';

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = '2025-01';
const BASE_TEMPLATE_PATH = 'ipacky-base-template.csv';
const EXPORT_OUTPUT_PREFIX = 'ipacky-export';

let _token = null;
let _tokenExpiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt - 60_000) return _token;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const { access_token, expires_in } = await res.json();
  _token = access_token;
  _tokenExpiresAt = Date.now() + expires_in * 1000;
  return _token;
}

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

// Minimal CSV parser that handles quoted fields with embedded commas/quotes
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const baseTemplateText = await getBaseTemplate();
    if (!baseTemplateText) {
      return res.status(400).json({
        error: 'No base template found. Upload one first via /api/upload-base-template.',
      });
    }

    const bins = await getCurrentBins();

    // Build SKU -> [bin numbers] map from current bin data
    const skuToBins = {};
    for (const [binKey, items] of Object.entries(bins.bins || bins)) {
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

    if (skuIdx === -1 || binIdx === -1) {
      return res.status(400).json({ error: 'Base template missing SKU or Bin location column' });
    }

    let updated = 0;
    const outputRows = [header];
    for (let r = 1; r < parsed.length; r++) {
      const row = [...parsed[r]];
      if (row.length < header.length) continue; // skip malformed rows
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

    return res.status(200).json({
      success: true,
      url: blob.url,
      filename,
      rowsUpdated: updated,
      totalRows: outputRows.length - 1,
    });

  } catch (err) {
    console.error('iPacky export error:', err);
    return res.status(500).json({ error: err.message });
  }
}
