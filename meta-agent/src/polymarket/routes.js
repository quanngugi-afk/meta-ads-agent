const express = require('express');
const { scanArbitrageOpportunities } = require('./scanner');
const { buildScanReport, buildHighAlertMessage } = require('./alerts');

const router = express.Router();

// Cache to avoid hammering the API with concurrent requests
let scanCache = null;
let scanInProgress = false;

async function runScan({ maxMarkets = 200, sendAlert, alertFn } = {}) {
  if (scanInProgress) {
    return scanCache || { error: 'Scan already in progress', timestamp: new Date().toISOString() };
  }

  scanInProgress = true;
  try {
    console.log(`[POLYMARKET SCAN] ${new Date().toISOString()}`);
    const results = await scanArbitrageOpportunities({ maxMarkets });
    scanCache = { ...results, cachedAt: new Date().toISOString() };

    if (sendAlert && alertFn) {
      const highOpps = results.opportunities.filter(o => o.severity === 'HIGH');
      if (highOpps.length > 0) {
        const msg = buildHighAlertMessage(highOpps);
        await alertFn(msg);
      }
    }

    return results;
  } finally {
    scanInProgress = false;
  }
}

function createRouter(sendWhatsApp) {
  // GET /api/polymarket/scan — run a full scan and return JSON
  router.get('/scan', async (req, res) => {
    try {
      const maxMarkets = Math.min(parseInt(req.query.limit) || 200, 500);
      const results = await runScan({ maxMarkets });
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/polymarket/scan-and-alert — scan and send WhatsApp alert for high opportunities
  router.post('/scan-and-alert', async (req, res) => {
    try {
      const maxMarkets = Math.min(parseInt(req.body?.limit) || 200, 500);
      const results = await runScan({ maxMarkets, sendAlert: true, alertFn: sendWhatsApp });
      await sendWhatsApp(buildScanReport(results));
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/polymarket/cache — return cached results without re-scanning
  router.get('/cache', (req, res) => {
    if (!scanCache) return res.status(404).json({ error: 'No scan results cached yet. Run /api/polymarket/scan first.' });
    res.json(scanCache);
  });

  // GET /api/polymarket/opportunities — return only the opportunities list from cache
  router.get('/opportunities', (req, res) => {
    if (!scanCache) return res.status(404).json({ error: 'No scan results cached yet.' });
    const { severity, type } = req.query;
    let opps = scanCache.opportunities || [];
    if (severity) opps = opps.filter(o => o.severity === severity.toUpperCase());
    if (type) opps = opps.filter(o => o.type === type.toUpperCase());
    res.json({ opportunities: opps, total: opps.length, cachedAt: scanCache.cachedAt });
  });

  // GET /api/polymarket/status — health check
  router.get('/status', (req, res) => {
    res.json({
      status: 'running',
      scanInProgress,
      lastScan: scanCache?.timestamp || null,
      opportunitiesFound: scanCache?.opportunities?.length || 0,
    });
  });

  return router;
}

module.exports = { createRouter, runScan };
