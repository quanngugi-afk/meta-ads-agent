const { getActiveMarkets, getMarketBook, getSingleMidpoint, getBestAsk, getBestBid } = require('./client');

// Polymarket charges ~2% fees on profits; set threshold conservatively
const FEE_RATE = 0.02;
const ARB_THRESHOLD = 1.0 - FEE_RATE; // Sum of all outcome costs must be below this to profit

// Minimum liquidity (in shares) required on each side to consider an opportunity actionable
const MIN_LIQUIDITY = 5;

// Rate-limit: ms to wait between API calls when fetching individual books
const RATE_LIMIT_MS = 150;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse market tokens from Gamma API response.
 * Each market can have multiple clob_token_ids (one per outcome).
 */
function parseMarketTokens(market) {
  try {
    const tokens = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds;
    return Array.isArray(tokens) ? tokens : [];
  } catch {
    return [];
  }
}

/**
 * Binary arbitrage: For a YES/NO market, buy both YES and NO.
 * If ask(YES) + ask(NO) < 1.0, you pay less than $1 but always collect $1.
 * Profit = 1.0 - ask(YES) - ask(NO) - fees
 */
async function checkBinaryArbitrage(market) {
  const tokens = parseMarketTokens(market);
  if (tokens.length !== 2) return null;

  const [yesTokenId, noTokenId] = tokens;

  let yesBook, noBook;
  try {
    [yesBook, noBook] = await Promise.all([
      getMarketBook(yesTokenId),
      getMarketBook(noTokenId),
    ]);
  } catch (err) {
    return null;
  }

  const yesAsk = getBestAsk(yesBook);
  const noAsk = getBestAsk(noBook);

  if (yesAsk === null || noAsk === null) return null;

  const totalCost = yesAsk + noAsk;
  const grossProfit = 1.0 - totalCost;
  const fee = Math.max(grossProfit, 0) * FEE_RATE;
  const netProfit = grossProfit - fee;

  if (totalCost >= ARB_THRESHOLD) return null;

  // Check available liquidity on ask side
  const yesLiquidity = getAskLiquidity(yesBook);
  const noLiquidity = getAskLiquidity(noBook);
  const maxShares = Math.min(yesLiquidity, noLiquidity);

  if (maxShares < MIN_LIQUIDITY) return null;

  return {
    type: 'BINARY',
    marketId: market.id,
    question: market.question,
    slug: market.slug,
    url: `https://polymarket.com/event/${market.slug}`,
    yesTokenId,
    noTokenId,
    yesAsk,
    noAsk,
    totalCost,
    grossProfitPct: (grossProfit * 100).toFixed(2),
    netProfitPct: (netProfit * 100).toFixed(2),
    maxShares: Math.floor(maxShares),
    maxNetProfit: (netProfit * Math.floor(maxShares)).toFixed(4),
    liquidity: market.liquidity || null,
    volume24h: market.volume24hr || null,
    severity: netProfit >= 0.03 ? 'HIGH' : netProfit >= 0.01 ? 'MEDIUM' : 'LOW',
  };
}

/**
 * For multi-outcome markets (e.g. election with A/B/C options).
 * All outcome prices should sum to ~1.0. If sum < 1.0, buy all and profit.
 * This uses midpoint prices as an approximation.
 */
async function checkMultiOutcomeArbitrage(market) {
  const tokens = parseMarketTokens(market);
  if (tokens.length < 3) return null;

  const midpoints = [];
  for (const tokenId of tokens) {
    try {
      const data = await getSingleMidpoint(tokenId);
      const mid = parseFloat(data?.mid);
      if (isNaN(mid) || mid <= 0) return null;
      midpoints.push({ tokenId, mid });
      await sleep(RATE_LIMIT_MS);
    } catch {
      return null;
    }
  }

  const totalMid = midpoints.reduce((sum, m) => sum + m.mid, 0);
  const gap = 1.0 - totalMid;

  if (gap <= FEE_RATE) return null; // Not profitable after fees

  return {
    type: 'MULTI_OUTCOME',
    marketId: market.id,
    question: market.question,
    slug: market.slug,
    url: `https://polymarket.com/event/${market.slug}`,
    outcomes: midpoints,
    totalMidSum: totalMid.toFixed(4),
    gap: gap.toFixed(4),
    grossProfitPct: (gap * 100).toFixed(2),
    netProfitPct: ((gap - FEE_RATE) * 100).toFixed(2),
    severity: gap >= 0.05 ? 'HIGH' : gap >= 0.02 ? 'MEDIUM' : 'LOW',
  };
}

function getAskLiquidity(book) {
  if (!Array.isArray(book?.asks)) return 0;
  return book.asks.reduce((sum, a) => sum + parseFloat(a.size || 0), 0);
}

/**
 * Main scan function. Fetches active markets and checks for arbitrage.
 * Returns array of detected opportunities sorted by net profit.
 */
async function scanArbitrageOpportunities({ maxMarkets = 200, onProgress } = {}) {
  const opportunities = [];
  const errors = [];
  let scanned = 0;

  let markets = [];
  try {
    const page1 = await getActiveMarkets({ limit: 100, offset: 0 });
    markets = Array.isArray(page1) ? page1 : (page1?.data || []);

    if (markets.length === 100 && maxMarkets > 100) {
      const page2 = await getActiveMarkets({ limit: 100, offset: 100 });
      const page2Markets = Array.isArray(page2) ? page2 : (page2?.data || []);
      markets = [...markets, ...page2Markets];
    }
  } catch (err) {
    errors.push(`Failed to fetch markets: ${err.message}`);
    return { opportunities, errors, scanned: 0, timestamp: new Date().toISOString() };
  }

  // Filter to markets with valid token IDs and liquidity
  const eligibleMarkets = markets
    .filter(m => m.clobTokenIds && m.active !== false && !m.closed)
    .slice(0, maxMarkets);

  for (const market of eligibleMarkets) {
    try {
      const tokens = parseMarketTokens(market);

      let opp = null;
      if (tokens.length === 2) {
        opp = await checkBinaryArbitrage(market);
        await sleep(RATE_LIMIT_MS);
      } else if (tokens.length >= 3) {
        opp = await checkMultiOutcomeArbitrage(market);
      }

      if (opp) opportunities.push(opp);
    } catch (err) {
      errors.push(`Market ${market.id}: ${err.message}`);
    }

    scanned++;
    if (onProgress) onProgress(scanned, eligibleMarkets.length);
  }

  opportunities.sort((a, b) => parseFloat(b.netProfitPct) - parseFloat(a.netProfitPct));

  return {
    opportunities,
    errors,
    scanned,
    totalMarketsChecked: eligibleMarkets.length,
    highCount: opportunities.filter(o => o.severity === 'HIGH').length,
    mediumCount: opportunities.filter(o => o.severity === 'MEDIUM').length,
    lowCount: opportunities.filter(o => o.severity === 'LOW').length,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { scanArbitrageOpportunities };
