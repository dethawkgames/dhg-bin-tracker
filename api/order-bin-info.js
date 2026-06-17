// Returns bin locations + DHG status for all line items in a given order
// Called by the admin block extension, passing the order GID

import { list } from '@vercel/blob';

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = '2025-01';

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

async function graphql(query, variables = {}) {
  const token = await getToken();
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL failed: ${res.status}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(errors)}`);
  return data;
}

async function getCurrentBins() {
  const { blobs } = await list({ prefix: 'dhg-bins.json' });
  const existing = blobs.find(b => b.pathname === 'dhg-bins.json');
  if (!existing) return {};
  const res = await fetch(existing.url);
  const data = await res.json();
  return data.bins || data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orderId } = req.query;
  if (!orderId) {
    return res.status(400).json({ error: 'orderId is required' });
  }

  try {
    // Normalize to full GID if just a numeric ID was passed
    const orderGid = orderId.startsWith('gid://') ? orderId : `gid://shopify/Order/${orderId}`;

    const data = await graphql(`
      query getOrder($id: ID!) {
        order(id: $id) {
          id
          name
          tags
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                product { id }
              }
            }
          }
        }
      }
    `, { id: orderGid });

    if (!data.order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = data.order;

    // Build productId -> [{binNumber, quantity}] map from current bin data
    const bins = await getCurrentBins();
    const productToBins = {};
    for (const [binKey, items] of Object.entries(bins)) {
      for (const item of items) {
        if (!productToBins[item.productId]) productToBins[item.productId] = [];
        productToBins[item.productId].push({ binNumber: binKey, quantity: item.quantity });
      }
    }

    // Match each line item to its bin locations
    const lineItemResults = order.lineItems.edges.map(e => {
      const item = e.node;
      const productId = item.product?.id;
      const locations = productId ? (productToBins[productId] || []) : [];
      return {
        title: item.title,
        quantity: item.quantity,
        productId,
        locations,
        foundInBins: locations.length > 0,
      };
    });

    const allItemsInBins = lineItemResults.every(i => i.foundInBins);
    const statusTag = order.tags.find(t => t.startsWith('dhg-status-'));
    const dhgStatus = statusTag ? statusTag.replace('dhg-status-', '') : null;

    return res.status(200).json({
      orderName: order.name,
      dhgStatus,
      lineItems: lineItemResults,
      allItemsInBins,
    });

  } catch (err) {
    console.error('Order bin info error:', err);
    return res.status(500).json({ error: err.message });
  }
}
