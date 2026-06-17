// Find open orders that need a specific product
// Self-contained - inlines Shopify auth

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { productId } = req.query;
  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  try {
    // Get all open (unfulfilled) orders and filter for this product
    const data = await graphql(`
      query findOrdersForProduct($cursor: String) {
        orders(first: 50, after: $cursor, query: "fulfillment_status:unfulfilled") {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              name
              createdAt
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
        }
      }
    `, {});

    const matchingOrders = [];
    let totalQuantityNeeded = 0;

    for (const edge of data.orders.edges) {
      const order = edge.node;
      for (const itemEdge of order.lineItems.edges) {
        const item = itemEdge.node;
        if (item.product?.id === productId) {
          matchingOrders.push({
            orderName: order.name,
            createdAt: order.createdAt,
            quantity: item.quantity,
          });
          totalQuantityNeeded += item.quantity;
        }
      }
    }

    return res.status(200).json({
      orders: matchingOrders,
      totalQuantityNeeded,
    });

  } catch (err) {
    console.error('Order lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
}
