// Bin data storage using Vercel Blob
import { put, list } from '@vercel/blob';

const BLOB_PATH = 'dhg-bins.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      // Find the blob if it exists
      const { blobs } = await list({ prefix: BLOB_PATH });
      const existing = blobs.find(b => b.pathname === BLOB_PATH);

      if (!existing) {
        return res.status(200).json({ bins: {} });
      }

      const dataRes = await fetch(existing.url);
      const bins = await dataRes.json();
      return res.status(200).json({ bins });
    }

    if (req.method === 'POST') {
      const { bins } = req.body || {};
      if (!bins) return res.status(400).json({ error: 'bins is required' });

      await put(BLOB_PATH, JSON.stringify(bins), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('Bins storage error:', err);
    return res.status(500).json({ error: err.message });
  }
}
