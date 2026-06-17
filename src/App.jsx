import React, { useState, useEffect, useCallback } from 'react';
import { Search, Package, Plus, X, AlertTriangle, MapPin, Loader2 } from 'lucide-react';

// (bin data persisted via /api/bins, backed by Vercel Blob)

// ── Helpers ──────────────────────────────────────────────────────────────────
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState('search'); // 'search' | 'browse' | 'add'
  const [bins, setBins] = useState({}); // { binNumber: [{productId, title, sku, image, quantity}] }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/bins');
        const data = await res.json();
        setBins(data.bins || {});
      } catch {
        setBins({});
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const saveBins = useCallback(async (newBins) => {
    setBins(newBins);
    try {
      const res = await fetch('/api/bins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bins: newBins }),
      });
      if (!res.ok) throw new Error('Save failed');
    } catch (err) {
      setError('Failed to save. Your changes may not persist.');
      console.error(err);
    }
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <Loader2 className="spin" size={28} />
        <p>Loading bins...</p>
        <GlobalStyles />
      </div>
    );
  }

  return (
    <div className="app">
      <Header view={view} setView={setView} />
      {error && <div className="error-banner">{error}<button onClick={() => setError(null)}>×</button></div>}
      <main className="main">
        {view === 'search' && <SearchView bins={bins} />}
        {view === 'browse' && <BrowseView bins={bins} saveBins={saveBins} />}
        {view === 'add' && <AddView bins={bins} saveBins={saveBins} onDone={() => setView('search')} />}
      </main>
      <GlobalStyles />
    </div>
  );
}

// ── Header / Nav ─────────────────────────────────────────────────────────────
function Header({ view, setView }) {
  return (
    <header className="header">
      <div className="header-brand">
        <div className="badge-icon"><MapPin size={18} /></div>
        <div>
          <h1>Bin Tracker</h1>
          <p className="header-sub">Detective Hawk Games</p>
        </div>
      </div>
      <nav className="nav">
        <button className={view === 'search' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('search')}>
          <Search size={16} /> Find
        </button>
        <button className={view === 'browse' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('browse')}>
          <Package size={16} /> Bins
        </button>
        <button className={view === 'add' ? 'nav-btn active' : 'nav-btn'} onClick={() => setView('add')}>
          <Plus size={16} /> Add
        </button>
      </nav>
    </header>
  );
}

// ── Search View — find which bin a game is in ──────────────────────────────
function SearchView({ bins }) {
  const [query, setQuery] = useState('');
  const [orderCheck, setOrderCheck] = useState(null);
  const [checkingOrders, setCheckingOrders] = useState(false);

  const debouncedQuery = useDebounce(query, 200);

  const grouped = {}; // productId -> { title, image, locations: [{binNumber, quantity}], totalQty }
  if (debouncedQuery.trim().length >= 2) {
    const q = debouncedQuery.trim().toLowerCase();
    for (const [binNumber, items] of Object.entries(bins)) {
      for (const item of items) {
        if (item.title.toLowerCase().includes(q)) {
          const key = item.productId;
          if (!grouped[key]) {
            grouped[key] = { title: item.title, image: item.image, sku: item.sku, locations: [], totalQty: 0 };
          }
          grouped[key].locations.push({ binNumber, quantity: item.quantity });
          grouped[key].totalQty += item.quantity;
        }
      }
    }
  }
  const results = Object.values(grouped);

  async function checkOpenOrders(productId, title) {
    setCheckingOrders(true);
    setOrderCheck(null);
    try {
      const res = await fetch(`/api/orders-for-product?productId=${encodeURIComponent(productId)}`);
      const data = await res.json();
      setOrderCheck({ title, ...data });
    } catch {
      setOrderCheck({ title, error: true });
    } finally {
      setCheckingOrders(false);
    }
  }

  return (
    <div className="view">
      <div className="search-box">
        <Search size={18} className="search-icon" />
        <input
          autoFocus
          type="text"
          placeholder="Search for a game..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOrderCheck(null); }}
        />
      </div>

      {debouncedQuery.trim().length >= 2 && results.length === 0 && (
        <NotFoundPanel query={debouncedQuery} onCheckOrders={checkOpenOrders} checking={checkingOrders} />
      )}

      {orderCheck && <OrderCheckResult result={orderCheck} />}

      {results.length > 0 && (
        <div className="result-list">
          {results.map((r, i) => (
            <div className="result-card multi" key={i}>
              {r.image && <img src={r.image} alt="" className="result-thumb" />}
              <div className="result-info">
                <div className="result-title">{r.title}</div>
                <div className="result-meta">
                  {r.locations
                    .sort((a, b) => {
                      if (a.binNumber === 'shelf') return 1;
                      if (b.binNumber === 'shelf') return -1;
                      return parseInt(a.binNumber) - parseInt(b.binNumber);
                    })
                    .map((loc, j) => (
                      <span className="bin-loc-pill" key={j}>
                        <span className="bin-pill">{loc.binNumber === 'shelf' ? 'Shelf' : `Bin ${loc.binNumber}`}</span>
                        <span className="qty-pill">×{loc.quantity}</span>
                      </span>
                    ))}
                </div>
                {r.locations.length > 1 && (
                  <div className="result-total">Total: {r.totalQty} across {r.locations.length} locations</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotFoundPanel({ query, onCheckOrders, checking }) {
  const [productMatches, setProductMatches] = useState([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    let active = true;
    async function search() {
      try {
        const res = await fetch(`/api/search-products?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (active) {
          setProductMatches(data.products || []);
          setSearched(true);
        }
      } catch {
        if (active) setSearched(true);
      }
    }
    search();
    return () => { active = false; };
  }, [query]);

  return (
    <div className="not-found-panel">
      <div className="not-found-header">
        <AlertTriangle size={16} />
        <span>Not found in any bin</span>
      </div>
      {searched && productMatches.length > 0 && (
        <div className="not-found-suggestions">
          <p>Did you mean:</p>
          {productMatches.slice(0, 4).map(p => (
            <button
              key={p.id}
              className="suggestion-btn"
              onClick={() => onCheckOrders(p.id, p.title)}
              disabled={checking}
            >
              {p.title}
              <span className="suggestion-action">Check open orders →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCheckResult({ result }) {
  if (result.error) {
    return <div className="order-check-result error">Couldn't check orders for "{result.title}".</div>;
  }
  if (!result.orders || result.orders.length === 0) {
    return (
      <div className="order-check-result">
        <strong>{result.title}</strong> — no open orders are waiting on this item.
      </div>
    );
  }
  return (
    <div className="order-check-result has-orders">
      <strong>{result.title}</strong> — {result.totalQuantityNeeded} needed across {result.orders.length} open order{result.orders.length > 1 ? 's' : ''}:
      <ul>
        {result.orders.map((o, i) => (
          <li key={i}>{o.orderName} <span className="qty-pill">×{o.quantity}</span></li>
        ))}
      </ul>
    </div>
  );
}

// ── Browse View — see everything in a specific bin ──────────────────────────
function BrowseView({ bins, saveBins }) {
  const [selectedBin, setSelectedBin] = useState(null);
  const binNumbers = Array.from({ length: 42 }, (_, i) => String(i + 1));
  const usedBins = new Set(Object.keys(bins).filter(b => bins[b]?.length > 0));

  async function removeItem(binNumber, index) {
    const newBins = { ...bins };
    newBins[binNumber] = [...newBins[binNumber]];
    newBins[binNumber].splice(index, 1);
    await saveBins(newBins);
  }

  async function updateQuantity(binNumber, index, delta) {
    const newBins = { ...bins };
    newBins[binNumber] = [...newBins[binNumber]];
    const item = { ...newBins[binNumber][index] };
    item.quantity = Math.max(1, item.quantity + delta);
    newBins[binNumber][index] = item;
    await saveBins(newBins);
  }

  if (selectedBin) {
    const items = bins[selectedBin] || [];
    const displayName = selectedBin === 'shelf' ? 'Shelf' : `Bin ${selectedBin}`;
    return (
      <div className="view">
        <button className="back-btn" onClick={() => setSelectedBin(null)}>← All bins</button>
        <h2 className="bin-detail-title">{displayName}</h2>
        {items.length === 0 ? (
          <p className="empty-state">{selectedBin === 'shelf' ? 'The shelf is empty.' : 'This bin is empty.'}</p>
        ) : (
          <div className="bin-items-list">
            {items.map((item, i) => (
              <div className="bin-item-row" key={i}>
                {item.image && <img src={item.image} alt="" className="bin-item-thumb" />}
                <div className="bin-item-info">
                  <div className="bin-item-title">{item.title}</div>
                  <div className="qty-controls">
                    <button onClick={() => updateQuantity(selectedBin, i, -1)}>−</button>
                    <span>{item.quantity}</span>
                    <button onClick={() => updateQuantity(selectedBin, i, 1)}>+</button>
                  </div>
                </div>
                <button className="remove-btn" onClick={() => removeItem(selectedBin, i)}>
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const shelfItems = bins['shelf'] || [];

  return (
    <div className="view">
      <p className="view-subtitle">{usedBins.size} of 42 bins in use</p>

      <button className="shelf-tile" onClick={() => setSelectedBin('shelf')}>
        <span className="shelf-tile-label">Shelf</span>
        <span className="shelf-tile-count">{shelfItems.length} item{shelfItems.length === 1 ? '' : 's'}</span>
      </button>

      <div className="bin-grid">
        {binNumbers.map(num => {
          const items = bins[num] || [];
          const isUsed = items.length > 0;
          return (
            <button
              key={num}
              className={isUsed ? 'bin-tile used' : 'bin-tile'}
              onClick={() => setSelectedBin(num)}
            >
              <span className="bin-tile-num">{num}</span>
              {isUsed && <span className="bin-tile-count">{items.length}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Add View — search Shopify product, assign to bin ────────────────────────
function AddView({ bins, saveBins, onDone }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [binNumber, setBinNumber] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [saved, setSaved] = useState(false);

  const debouncedQuery = useDebounce(query, 250);

  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    setSearching(true);
    fetch(`/api/search-products?q=${encodeURIComponent(debouncedQuery)}`)
      .then(r => r.json())
      .then(data => { if (active) setResults(data.products || []); })
      .catch(() => { if (active) setResults([]); })
      .finally(() => { if (active) setSearching(false); });
    return () => { active = false; };
  }, [debouncedQuery]);

  async function handleSave() {
    if (!selectedProduct || !binNumber) return;
    const binKey = binNumber.trim();
    const newBins = { ...bins };
    const existing = newBins[binKey] ? [...newBins[binKey]] : [];

    const existingIdx = existing.findIndex(i => i.productId === selectedProduct.id);
    if (existingIdx >= 0) {
      existing[existingIdx] = { ...existing[existingIdx], quantity: existing[existingIdx].quantity + quantity };
    } else {
      existing.push({
        productId: selectedProduct.id,
        title: selectedProduct.title,
        sku: selectedProduct.sku,
        image: selectedProduct.image,
        quantity,
      });
    }
    newBins[binKey] = existing;
    await saveBins(newBins);
    setSaved(true);
    setTimeout(() => {
      setSelectedProduct(null);
      setQuery('');
      setBinNumber('');
      setQuantity(1);
      setSaved(false);
      onDone();
    }, 900);
  }

  return (
    <div className="view">
      {!selectedProduct ? (
        <>
          <div className="search-box">
            <Search size={18} className="search-icon" />
            <input
              autoFocus
              type="text"
              placeholder="Search Shopify products..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            {searching && <Loader2 size={16} className="spin search-spinner" />}
          </div>
          {results.length > 0 && (
            <div className="result-list">
              {results.map(p => (
                <button key={p.id} className="product-pick-card" onClick={() => setSelectedProduct(p)}>
                  {p.image && <img src={p.image} alt="" className="result-thumb" />}
                  <div className="result-info">
                    <div className="result-title">{p.title}</div>
                    {p.sku && <div className="result-sku">SKU: {p.sku}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="add-form">
          <div className="selected-product">
            {selectedProduct.image && <img src={selectedProduct.image} alt="" className="result-thumb" />}
            <div className="result-info">
              <div className="result-title">{selectedProduct.title}</div>
            </div>
            <button className="remove-btn" onClick={() => setSelectedProduct(null)}><X size={16} /></button>
          </div>

          <label className="form-label">Bin number (or "shelf")</label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. 23 or shelf"
            value={binNumber}
            onChange={e => {
              const v = e.target.value;
              const cleaned = v.replace(/[^0-9a-zA-Z]/g, '');
              if (/^[0-9]*$/.test(cleaned)) {
                setBinNumber(cleaned);
              } else if ('shelf'.startsWith(cleaned.toLowerCase())) {
                setBinNumber(cleaned.toLowerCase());
              }
            }}
            autoFocus
          />
          <p className="form-hint">Type a bin number, or type "shelf" for overstock storage.</p>

          <label className="form-label">Quantity</label>
          <div className="qty-controls qty-controls-large">
            <button onClick={() => setQuantity(q => Math.max(1, q - 1))}>−</button>
            <span>{quantity}</span>
            <button onClick={() => setQuantity(q => q + 1)}>+</button>
          </div>

          <button
            className="save-btn"
            onClick={handleSave}
            disabled={!binNumber || saved}
          >
            {saved ? 'Saved ✓' : 'Add to Bin'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@700&family=Inter:wght@400;500;600;700&display=swap');

      * { box-sizing: border-box; }

      :root {
        --ink: #1a0a2e;
        --ink-light: #2d1a4e;
        --paper: #faf8f5;
        --card: #ffffff;
        --rule: #e5e0d8;
        --gold: #c9a227;
        --red: #c0392b;
        --green: #2a7a4b;
        --text: #2b2b2b;
        --text-muted: #6b6b6b;
      }

      body, .app {
        font-family: 'Inter', sans-serif;
        background: var(--paper);
        color: var(--text);
      }

      .app { min-height: 100vh; display: flex; flex-direction: column; }

      .app-loading {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        height: 100vh; gap: 12px; color: var(--text-muted);
      }

      .spin { animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .header {
        background: var(--ink);
        color: white;
        padding: 16px 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        position: sticky;
        top: 0;
        z-index: 10;
      }

      .header-brand { display: flex; align-items: center; gap: 10px; }

      .badge-icon {
        background: var(--gold);
        color: var(--ink);
        width: 34px; height: 34px;
        border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }

      .header h1 {
        font-family: 'Libre Baskerville', serif;
        font-size: 18px;
        margin: 0;
        line-height: 1.2;
      }

      .header-sub {
        font-size: 11px;
        color: rgba(255,255,255,0.6);
        margin: 0;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .nav { display: flex; gap: 6px; }

      .nav-btn {
        flex: 1;
        display: flex; align-items: center; justify-content: center; gap: 6px;
        background: rgba(255,255,255,0.08);
        border: none;
        color: rgba(255,255,255,0.7);
        padding: 10px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }

      .nav-btn.active {
        background: var(--gold);
        color: var(--ink);
      }

      .nav-btn:not(.active):hover { background: rgba(255,255,255,0.15); }

      .error-banner {
        background: #fde8e8;
        color: var(--red);
        padding: 10px 20px;
        font-size: 13px;
        display: flex;
        justify-content: space-between;
      }
      .error-banner button { background: none; border: none; color: var(--red); font-size: 16px; cursor: pointer; }

      .main { flex: 1; padding: 20px; max-width: 600px; margin: 0 auto; width: 100%; }

      .view { display: flex; flex-direction: column; gap: 14px; }
      .view-subtitle { font-size: 13px; color: var(--text-muted); margin: 0; }

      .search-box {
        position: relative;
        display: flex;
        align-items: center;
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 12px 14px;
      }

      .search-icon { color: var(--text-muted); margin-right: 10px; flex-shrink: 0; }
      .search-spinner { position: absolute; right: 14px; color: var(--text-muted); }

      .search-box input {
        border: none;
        outline: none;
        font-size: 15px;
        width: 100%;
        background: transparent;
        font-family: 'Inter', sans-serif;
      }

      .result-list { display: flex; flex-direction: column; gap: 8px; }

      .result-card, .product-pick-card {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 10px 12px;
        text-align: left;
        cursor: default;
        font-family: 'Inter', sans-serif;
      }

      .product-pick-card { cursor: pointer; border: none; width: 100%; transition: background 0.15s; }
      .product-pick-card:hover { background: #f3f0ea; }

      .result-thumb {
        width: 44px; height: 44px;
        object-fit: cover;
        border-radius: 6px;
        background: #f0ede6;
        flex-shrink: 0;
      }

      .result-info { flex: 1; min-width: 0; }
      .result-title { font-weight: 600; font-size: 14px; line-height: 1.3; }
      .result-sku { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

      .result-meta { display: flex; gap: 8px; margin-top: 4px; }

      .bin-pill {
        background: var(--ink);
        color: white;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 9px;
        border-radius: 20px;
      }

      .qty-pill {
        background: #f0ede6;
        color: var(--text);
        font-size: 11px;
        font-weight: 600;
        padding: 2px 9px;
        border-radius: 20px;
      }

      .not-found-panel {
        background: #fff8ec;
        border: 1px solid #f0dca0;
        border-radius: 10px;
        padding: 14px;
      }

      .not-found-header {
        display: flex; align-items: center; gap: 8px;
        color: #946b00;
        font-weight: 600;
        font-size: 13px;
      }

      .not-found-suggestions { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
      .not-found-suggestions p { font-size: 12px; color: var(--text-muted); margin: 0 0 4px; }

      .suggestion-btn {
        display: flex; justify-content: space-between; align-items: center;
        background: white;
        border: 1px solid var(--rule);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;
      }
      .suggestion-btn:hover { background: #f9f7f2; }
      .suggestion-action { font-size: 11px; color: var(--text-muted); }

      .order-check-result {
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 14px;
        font-size: 13px;
        line-height: 1.6;
      }

      .order-check-result.has-orders { border-color: #f0dca0; background: #fffbf0; }
      .order-check-result.error { color: var(--red); }
      .order-check-result ul { margin: 8px 0 0; padding-left: 18px; }
      .order-check-result li { margin-bottom: 4px; }

      .result-card.multi { align-items: flex-start; }

      .bin-loc-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .result-total {
        font-size: 11.5px;
        color: var(--text-muted);
        margin-top: 6px;
        font-weight: 500;
      }

      .shelf-tile {
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--card);
        border: 1px dashed var(--gold);
        border-radius: 10px;
        padding: 14px 16px;
        cursor: pointer;
        font-family: 'Inter', sans-serif;
        margin-bottom: 4px;
      }

      .shelf-tile:hover { background: #fdf9ed; }

      .shelf-tile-label {
        font-weight: 700;
        font-size: 14px;
        color: var(--ink);
      }

      .shelf-tile-count {
        font-size: 12px;
        color: var(--text-muted);
        font-weight: 500;
      }

      .form-hint {
        font-size: 12px;
        color: var(--text-muted);
        margin-top: 4px;
      }

      .bin-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 8px;
      }

      .bin-tile {
        aspect-ratio: 1;
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        position: relative;
        font-family: 'Inter', sans-serif;
      }

      .bin-tile.used {
        background: var(--ink);
        border-color: var(--ink);
      }

      .bin-tile-num {
        font-size: 15px;
        font-weight: 700;
        color: var(--text);
      }

      .bin-tile.used .bin-tile-num { color: white; }

      .bin-tile-count {
        position: absolute;
        top: 4px;
        right: 4px;
        background: var(--gold);
        color: var(--ink);
        font-size: 10px;
        font-weight: 700;
        padding: 1px 5px;
        border-radius: 10px;
      }

      .back-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        padding: 0;
        text-align: left;
        align-self: flex-start;
      }

      .bin-detail-title {
        font-family: 'Libre Baskerville', serif;
        font-size: 22px;
        margin: 0;
      }

      .empty-state { color: var(--text-muted); font-size: 14px; }

      .bin-items-list { display: flex; flex-direction: column; gap: 8px; }

      .bin-item-row {
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 10px 12px;
      }

      .bin-item-thumb { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; flex-shrink: 0; background: #f0ede6; }
      .bin-item-info { flex: 1; min-width: 0; }
      .bin-item-title { font-weight: 600; font-size: 14px; margin-bottom: 6px; }

      .qty-controls { display: flex; align-items: center; gap: 10px; }
      .qty-controls button {
        width: 26px; height: 26px;
        border-radius: 6px;
        border: 1px solid var(--rule);
        background: white;
        font-size: 15px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
      }
      .qty-controls span { font-weight: 600; min-width: 20px; text-align: center; font-size: 14px; }

      .qty-controls-large button { width: 36px; height: 36px; font-size: 18px; }
      .qty-controls-large span { font-size: 18px; min-width: 30px; }

      .remove-btn {
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        padding: 6px;
        flex-shrink: 0;
      }
      .remove-btn:hover { color: var(--red); }

      .add-form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: var(--card);
        border: 1px solid var(--rule);
        border-radius: 10px;
        padding: 16px;
      }

      .selected-product {
        display: flex;
        align-items: center;
        gap: 12px;
        padding-bottom: 14px;
        margin-bottom: 8px;
        border-bottom: 1px solid var(--rule);
      }

      .form-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-top: 10px;
      }

      .form-input {
        border: 1px solid var(--rule);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 16px;
        font-family: 'Inter', sans-serif;
        outline: none;
      }
      .form-input:focus { border-color: var(--gold); }

      .save-btn {
        margin-top: 18px;
        background: var(--ink);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 13px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s;
      }
      .save-btn:hover:not(:disabled) { background: var(--ink-light); }
      .save-btn:disabled { background: #c9c4b8; cursor: not-allowed; }

      @media (max-width: 420px) {
        .bin-grid { grid-template-columns: repeat(5, 1fr); }
      }
    `}</style>
  );
}
