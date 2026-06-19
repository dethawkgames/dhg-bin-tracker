# DHG Bin Tracker 

Tracks which of your 42 storage bins hold which games, with live Shopify product search and open-order cross-referencing.

## Features

- **Find** — search by game title across all bins, see bin location + quantity
- **Bins** — browse all 42 bins, tap one to see contents, adjust quantities or remove items
- **Add** — type-ahead search of your actual Shopify catalog, select the real product, assign to a bin with a quantity
- **Not found handling** — if a search comes up empty, shows matching Shopify products and lets you check whether any open orders are waiting on that item

## Project structure

```
bin-tracker/
├── api/
│   ├── bins.js                  # Bin data storage (Vercel Blob)
│   ├── search-products.js       # Shopify product type-ahead search
│   └── orders-for-product.js    # Find open orders needing a specific product
├── src/
│   ├── App.jsx                  # Main app (all views + styles)
│   └── main.jsx                 # React entry point
├── index.html
├── vite.config.js
└── package.json
```

## Deployment

### 1. Push to GitHub

```bash
cd bin-tracker
git init
git add .
git commit -m "Initial bin tracker"
git remote add origin https://github.com/YOUR_USERNAME/dhg-bin-tracker.git
git push -u origin main
```

### 2. Import to Vercel

1. Vercel dashboard → **Add New Project** → **Import Git Repository**
2. Select `dhg-bin-tracker`
3. Before deploying, add environment variables (see below)
4. Deploy

### 3. Environment variables

| Variable | Value |
|---|---|
| `SHOPIFY_SHOP` | `detective-hawk-games.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | (same as dhg-automation project) |
| `SHOPIFY_CLIENT_SECRET` | (same as dhg-automation project) |
| `BLOB_READ_WRITE_TOKEN` | Generated automatically when you add Vercel Blob storage |

### 4. Add Vercel Blob storage

1. In your Vercel project → **Storage** tab
2. Click **Create Database** → **Blob**
3. Connect it to this project — this automatically sets `BLOB_READ_WRITE_TOKEN`

### 5. Deploy

```bash
vercel --prod
```

## How bin data is structured

```json
{
  "23": [
    { "productId": "gid://shopify/Product/123", "title": "Wingspan", "sku": "WSP-01", "image": "https://...", "quantity": 2 }
  ],
  "7": [
    { "productId": "gid://shopify/Product/456", "title": "Ticket to Ride", "sku": "TTR-01", "image": "https://...", "quantity": 1 }
  ]
}
```

Each bin can hold multiple different games. Matching to Shopify orders happens via `productId`, not title — so renames, editions, or typos never break the connection.

## Future integration points

This app is designed to plug into the rest of the DHG automation roadmap:

- **Monday supplier order aggregation** — cross-reference bin contents against items that need ordering
- **inventory-queued status** — once an order's items are all confirmed in bins, trigger the W3-replacement status update
- **Receive-to-fulfill routing** — items from a new shipment that are earmarked for open orders skip the bin entirely; only surplus goes in
