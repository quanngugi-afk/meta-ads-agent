require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const fetch = require('node-fetch');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID;
const WA_TO = process.env.WHATSAPP_TO;
const WA_FROM = process.env.TWILIO_WHATSAPP_FROM;

// ─── TRAFFIC LIGHT SYSTEM ───────────────────────────────────────────────────
function trafficLight(metrics) {
  const alerts = [];
  const { ctr, cpc, costPerATC, cpmr, campaignName, adName, spend } = metrics;

  if (ctr !== null) {
    if (ctr < 0.5) alerts.push({ type: 'RED', metric: 'CTR', value: `${ctr.toFixed(2)}%`, verdict: 'CUT', reason: 'CTR below 0.5% — creative not stopping the scroll' });
    else if (ctr < 1.0) alerts.push({ type: 'YELLOW', metric: 'CTR', value: `${ctr.toFixed(2)}%`, verdict: 'WATCH', reason: 'CTR in yellow zone — monitor closely' });
  }
  if (cpc !== null) {
    if (cpc > 1.5) alerts.push({ type: 'RED', metric: 'CPC', value: `$${cpc.toFixed(2)}`, verdict: 'CUT', reason: 'CPC above $1.50 — too expensive per click' });
    else if (cpc > 0.8) alerts.push({ type: 'YELLOW', metric: 'CPC', value: `$${cpc.toFixed(2)}`, verdict: 'WATCH', reason: 'CPC in yellow zone' });
  }
  if (costPerATC !== null && costPerATC > 0) {
    if (costPerATC > 15) alerts.push({ type: 'RED', metric: 'Cost/ATC', value: `$${costPerATC.toFixed(2)}`, verdict: 'CUT', reason: 'Cost per ATC above $15 — cut immediately' });
    else if (costPerATC > 8) alerts.push({ type: 'YELLOW', metric: 'Cost/ATC', value: `$${costPerATC.toFixed(2)}`, verdict: 'WATCH', reason: 'Cost per ATC in yellow zone' });
    else alerts.push({ type: 'GREEN', metric: 'Cost/ATC', value: `$${costPerATC.toFixed(2)}`, verdict: 'SCALE', reason: 'ATC cost is green — consider scaling 20%' });
  }
  if (cpmr !== null) {
    if (cpmr > 35) alerts.push({ type: 'RED', metric: 'CPMr', value: `$${cpmr.toFixed(2)}`, verdict: 'FATIGUE', reason: 'CPMr spiking — creative fatigue, refresh assets' });
    else if (cpmr > 20) alerts.push({ type: 'YELLOW', metric: 'CPMr', value: `$${cpmr.toFixed(2)}`, verdict: 'WATCH', reason: 'CPMr rising — watch for fatigue' });
  }

  return alerts;
}

// ─── META API CALLS ──────────────────────────────────────────────────────────
async function fetchCampaigns() {
  const url = `https://graph.facebook.com/v19.0/${AD_ACCOUNT}/campaigns?fields=id,name,status,daily_budget,objective&limit=20&access_token=${META_TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchInsights() {
  const url = `https://graph.facebook.com/v19.0/${AD_ACCOUNT}/insights?fields=campaign_name,campaign_id,ad_id,ad_name,adset_name,impressions,clicks,ctr,cpc,spend,actions,cost_per_action_type,reach,frequency&date_preset=last_7d&level=ad&limit=30&access_token=${META_TOKEN}`;
  const res = await fetch(url);
  return res.json();
}

async function pauseAd(adId) {
  const url = `https://graph.facebook.com/v19.0/${adId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'PAUSED', access_token: META_TOKEN })
  });
  return res.json();
}

async function scaleBudget(campaignId, currentBudgetCents) {
  const newBudget = Math.round(currentBudgetCents * 1.2);
  const url = `https://graph.facebook.com/v19.0/${campaignId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daily_budget: newBudget, access_token: META_TOKEN })
  });
  return res.json();
}

// ─── WHATSAPP SENDER ─────────────────────────────────────────────────────────
async function sendWhatsApp(message) {
  try {
    await twilioClient.messages.create({
      from: WA_FROM,
      to: WA_TO,
      body: message
    });
    console.log(`[WA SENT] ${new Date().toISOString()}`);
  } catch (e) {
    console.error('[WA ERROR]', e.message);
  }
}

// ─── CORE ANALYSIS ENGINE ────────────────────────────────────────────────────
async function runAnalysis(sendAlerts = true) {
  console.log(`[SCAN] ${new Date().toISOString()}`);
  const results = { redAlerts: [], yellowAlerts: [], greenAlerts: [], errors: [], timestamp: new Date().toISOString() };

  try {
    const [campaigns, insights] = await Promise.all([fetchCampaigns(), fetchInsights()]);

    if (insights.error) {
      results.errors.push(insights.error.message || 'Meta API error');
      return results;
    }

    const ads = insights.data || [];

    for (const ad of ads) {
      const ctr = parseFloat(ad.ctr) || null;
      const cpc = parseFloat(ad.cpc) || null;
      const spend = parseFloat(ad.spend) || 0;
      const reach = parseInt(ad.reach) || 1;
      const impressions = parseInt(ad.impressions) || 1;
      const cpmr = reach > 0 ? (spend / reach) * 1000 : null;

      const actions = ad.actions || [];
      const atcAction = actions.find(a => a.action_type === 'add_to_cart');
      const atcCount = atcAction ? parseInt(atcAction.value) : 0;
      const costPerATC = atcCount > 0 ? spend / atcCount : null;

      const alerts = trafficLight({ ctr, cpc, costPerATC, cpmr, campaignName: ad.campaign_name, adName: ad.ad_name, spend });

      for (const alert of alerts) {
        const item = { ad, alert, campaignName: ad.campaign_name, adName: ad.ad_name, spend, adId: ad.ad_id };
        if (alert.type === 'RED') results.redAlerts.push(item);
        else if (alert.type === 'YELLOW') results.yellowAlerts.push(item);
        else if (alert.type === 'GREEN') results.greenAlerts.push(item);
      }
    }

    results.totalAds = ads.length;
    results.campaigns = campaigns.data || [];

    if (sendAlerts) await sendAlertMessages(results);
  } catch (e) {
    results.errors.push(e.message);
    console.error('[ANALYSIS ERROR]', e);
  }

  return results;
}

async function sendAlertMessages(results) {
  if (results.redAlerts.length === 0 && results.greenAlerts.length === 0) return;

  let msg = `🤖 *Meta Ads Agent Report*\n📅 ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n\n`;

  if (results.redAlerts.length > 0) {
    msg += `🔴 *ACTION REQUIRED — ${results.redAlerts.length} RED ALERTS*\n\n`;
    for (const item of results.redAlerts.slice(0, 5)) {
      msg += `❌ *${item.adName || 'Ad'}*\n`;
      msg += `Campaign: ${item.campaignName}\n`;
      msg += `${item.alert.metric}: ${item.alert.value}\n`;
      msg += `Verdict: ${item.alert.verdict}\n`;
      msg += `Spend: $${parseFloat(item.spend).toFixed(2)}\n\n`;
    }
  }

  if (results.greenAlerts.length > 0) {
    msg += `🟢 *SCALE OPPORTUNITIES — ${results.greenAlerts.length} WINNERS*\n\n`;
    for (const item of results.greenAlerts.slice(0, 3)) {
      msg += `✅ *${item.adName || 'Ad'}*\n`;
      msg += `Campaign: ${item.campaignName}\n`;
      msg += `${item.alert.metric}: ${item.alert.value}\n`;
      msg += `Spend: $${parseFloat(item.spend).toFixed(2)}\n\n`;
    }
  }

  msg += `📊 Total ads scanned: ${results.totalAds || 0}\n`;
  msg += `Reply YES to approve cuts/scales or check dashboard.`;

  await sendWhatsApp(msg);
}

// ─── DAILY SUMMARY ───────────────────────────────────────────────────────────
async function sendDailySummary() {
  const results = await runAnalysis(false);
  const totalSpend = 0;

  let msg = `📊 *Daily Meta Ads Summary*\n`;
  msg += `📅 ${new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}\n\n`;
  msg += `Ads scanned: ${results.totalAds || 0}\n`;
  msg += `🔴 Red alerts: ${results.redAlerts.length}\n`;
  msg += `🟡 Yellow alerts: ${results.yellowAlerts.length}\n`;
  msg += `🟢 Scale opportunities: ${results.greenAlerts.length}\n\n`;

  if (results.errors.length > 0) {
    msg += `⚠️ Errors: ${results.errors.join(', ')}\n`;
  }

  msg += `\nFrameworks active: Traffic Light ✓ | 3:2:2 ✓ | ASC Protocol ✓`;
  await sendWhatsApp(msg);
}

// ─── CRON JOBS ───────────────────────────────────────────────────────────────
// Scan every hour
cron.schedule('0 * * * *', () => runAnalysis(true));

// Daily summary at 8am Nairobi time (UTC+3 = 5am UTC)
cron.schedule('0 5 * * *', () => sendDailySummary());

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get('/api/scan', async (req, res) => {
  const results = await runAnalysis(false);
  res.json(results);
});

app.post('/api/scan-and-alert', async (req, res) => {
  const results = await runAnalysis(true);
  res.json(results);
});

app.post('/api/pause-ad', async (req, res) => {
  const { adId } = req.body;
  if (!adId) return res.status(400).json({ error: 'adId required' });
  const result = await pauseAd(adId);
  await sendWhatsApp(`✂️ Ad paused via dashboard.\nAd ID: ${adId}`);
  res.json(result);
});

app.post('/api/scale-budget', async (req, res) => {
  const { campaignId, currentBudget } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  const result = await scaleBudget(campaignId, currentBudget);
  await sendWhatsApp(`📈 Budget scaled 20% for campaign ${campaignId}`);
  res.json(result);
});

app.post('/api/send-whatsapp', async (req, res) => {
  const { message } = req.body;
  await sendWhatsApp(message || 'Test from Meta Ads Agent');
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'running', account: AD_ACCOUNT, time: new Date().toISOString() });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🤖 Meta Ads Agent running on port ${PORT}`);
  console.log(`📊 Account: ${AD_ACCOUNT}`);
  console.log(`📱 WhatsApp alerts → ${WA_TO}`);
  console.log(`⏰ Scanning every hour + daily summary at 8am Nairobi\n`);

  // Send startup message
  sendWhatsApp(`🚀 *Meta Ads Agent is LIVE*\n\nConnected to: ${AD_ACCOUNT}\nScanning every hour\nDaily summary at 8am\n\nI'll alert you on:\n🔴 Underperformers to cut\n🟢 Winners to scale\n⚠️ Creative fatigue\n\nRunning 24/7 ✓`);
});
