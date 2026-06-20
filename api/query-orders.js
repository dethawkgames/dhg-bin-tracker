// General-purpose, read-only Shopify orders+customers query endpoint.
// Built for external callers (e.g. Cowork scheduled tasks) that need flexible
// access to order/customer data without us building a narrow one-off endpoint
// every time a new use case comes up.
//
// Auth: requires header "Authorization: Bearer <DATA_API_SECRET>"
//
// Query params (all optional):
//   tag            - exact tag to filter by, e.g. "dhg-status-inventory-queued"
//   fulfillment    - "fulfilled" | "unfulfilled" | "partial" (maps to Shopify's fulfillment_status query)
//   createdAfter   - ISO date, e.g. "2026-06-15"
//   createdBefore  - ISO date
//   limit          - max orders to return (default 50, max 250)

const SHOP = process.env.SHOPIFY_SHOP;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = '2025-01';
const DATA_API_SECRET = process.env.DATA_API_SECRET;

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

async function shopifyGraphql(query, variables = {}) {
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

function buildSearchQuery({ tag, fulfillment, createdAfter, createdBefore }) {
  const parts = [];
  if (tag) parts.push(`tag:${tag}`);
  if (fulfillment) parts.push(`fulfillment_status:${fulfillment}`);
  if (createdAfter) parts.push(`created_at:>=${createdAfter}`);
  if (createdBefore) parts.push(`created_at:<=${createdBefore}`);
  return parts.join(' ');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${DATA_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { tag, fulfillment, createdAfter, createdBefore } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 250);

    const searchQuery = buildSearchQuery({ tag, fulfillment, createdAfter, createdBefore });

    const data = await shopifyGraphql(`
      query getOrders($first: Int!, $query: String) {
        orders(first: $first, query: $query, sortKey: CREATED_AT) {
          edges {
            node {
              id
              name
              createdAt
              displayFulfillmentStatus
              tags
              email
              customer {
                id
                firstName
                lastName
                email
                numberOfOrders
                orders(first: 10) {
                  edges {
                    node {
                      id
                      displayFulfillmentStatus
                    }
                  }
                }
              }
              lineItems(first: 50) {
                edges {
                  node {
                    title
                    quantity
                    sku
                    product { id }
                  }
                }
              }
            }
          }
        }
      }
    `, { first: limit, query: searchQuery || null });

    const orders = data.orders.edges.map(e => {
      const o = e.node;
      const otherFulfilledOrders = (o.customer?.orders?.edges || [])
        .filter(oe => oe.node.id !== o.id && oe.node.displayFulfillmentStatus === 'FULFILLED');

      return {
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        fulfillmentStatus: o.displayFulfillmentStatus,
        tags: o.tags,
        email: o.email,
        customer: o.customer ? {
          firstName: o.customer.firstName,
          lastName: o.customer.lastName,
          email: o.customer.email,
          numberOfOrders: o.customer.numberOfOrders,
          hasAnyPreviouslyFulfilledOrder: otherFulfilledOrders.length > 0,
        } : null,
        lineItems: o.lineItems.edges.map(le => ({
          title: le.node.title,
          quantity: le.node.quantity,
          sku: le.node.sku,
          productId: le.node.product?.id || null,
        })),
      };
    });

    return res.status(200).json({
      count: orders.length,
      filtersApplied: { tag, fulfillment, createdAfter, createdBefore, limit },
      orders,
    });

  } catch (err) {
    console.error('Orders query error:', err);
    return res.status(500).json({ error: err.message });
  }
}
