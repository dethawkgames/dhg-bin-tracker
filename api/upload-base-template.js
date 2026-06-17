// Upload a fresh base template (Id, SKU, Name columns) for iPacky export
// POST raw CSV text as the body

import { put } from '@vercel/blob';

const BASE_TEMPLATE_PATH = 'ipacky-base-template.csv';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const csvText = await readRawBody(req);

    if (!csvText || csvText.length < 10) {
      return res.status(400).json({ error: 'CSV content is required in the request body' });
    }

    await put(BASE_TEMPLATE_PATH, csvText, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'text/csv',
    });

    return res.status(200).json({ success: true, message: 'Base template updated', bytes: csvText.length });

  } catch (err) {
    console.error('Base template upload error:', err);
    return res.status(500).json({ error: err.message });
  }
}
