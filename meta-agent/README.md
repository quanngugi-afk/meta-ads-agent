# Meta Ads Agent — 24/7 WhatsApp Alert System

Scans your Meta Ads account every hour. Sends WhatsApp alerts for:
- 🔴 Underperforming ads to cut (CTR < 0.5%, CPC > $1.50, Cost/ATC > $15)
- 🟢 Winners to scale (20% budget increase opportunities)
- ⚠️ Creative fatigue signals (CPMr > $35)
- 📊 Daily summary at 8am Nairobi time

---

## Deploy to Railway (5 minutes)

### Step 1 — Push to GitHub
1. Create a new repo at github.com (name it `meta-ads-agent`)
2. Upload all these files to the repo
3. Do NOT upload the `.env` file — keep that private

### Step 2 — Deploy on Railway
1. Go to [railway.app](https://railway.app) and sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `meta-ads-agent` repo
4. Railway will detect it's a Node.js app and deploy automatically

### Step 3 — Add Environment Variables
In Railway dashboard → your project → **Variables** tab, add:

```
META_ACCESS_TOKEN=EAAdrfX9VWx...
META_AD_ACCOUNT_ID=act_2091379461674287
TWILIO_ACCOUNT_SID=AC22335d968f2687dfa1b8bf1bbdb396d0
TWILIO_AUTH_TOKEN=a8a5d7129ab1a8fd47720a3c17515f65
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_TO=whatsapp:+254724485173
PORT=3000
```

### Step 4 — Done
Railway gives you a public URL like `https://meta-ads-agent-xxxx.railway.app`
Open that URL to see your dashboard.
The agent starts immediately and sends you a WhatsApp confirmation.

---

## What runs automatically
- **Every hour**: Full account scan, WhatsApp alert if red alerts or scale opportunities found
- **8am Nairobi daily**: Summary report sent to WhatsApp

## Dashboard
Open your Railway URL in any browser — works on mobile too.
- See all red/yellow/green alerts
- Pause underperforming ads with one click
- Manual scan + WhatsApp alert button

---

## Traffic Light Thresholds (from the Matrix)
| Metric | Green | Yellow | Red |
|--------|-------|--------|-----|
| CTR | ≥ 1% | 0.5–1% | < 0.5% |
| CPC | < $0.80 | $0.80–$1.50 | > $1.50 |
| Cost/ATC | < $8 | $8–$15 | > $15 |
| CPMr | < $20 | $20–$35 | > $35 |
