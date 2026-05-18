const fetch = require('node-fetch');

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

const DEFAULT_TIMEOUT = 10000;

async function apiFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getActiveMarkets({ limit = 100, offset = 0 } = {}) {
  const url = `${GAMMA_API}/markets?closed=false&archived=false&limit=${limit}&offset=${offset}`;
  return apiFetch(url);
}

async function getMarketBook(tokenId) {
  const url = `${CLOB_API}/book?token_id=${tokenId}`;
  return apiFetch(url);
}

async function getMidpoints(tokenIds) {
  // Batch midpoint fetch: POST /midpoints
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const res = await fetch(`${CLOB_API}/midpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: tokenIds.map(id => ({ token_id: id })) }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for midpoints`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getSingleMidpoint(tokenId) {
  const url = `${CLOB_API}/midpoint?token_id=${tokenId}`;
  return apiFetch(url);
}

async function getSpread(tokenId) {
  const url = `${CLOB_API}/spread?token_id=${tokenId}`;
  return apiFetch(url);
}

// Returns best ask price from an order book (lowest sell offer)
function getBestAsk(book) {
  if (!book || !Array.isArray(book.asks) || book.asks.length === 0) return null;
  const sorted = [...book.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  return parseFloat(sorted[0].price);
}

// Returns best bid price from an order book (highest buy offer)
function getBestBid(book) {
  if (!book || !Array.isArray(book.bids) || book.bids.length === 0) return null;
  const sorted = [...book.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  return parseFloat(sorted[0].price);
}

module.exports = { getActiveMarkets, getMarketBook, getMidpoints, getSingleMidpoint, getSpread, getBestAsk, getBestBid };
