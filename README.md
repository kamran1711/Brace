# ⬡ Brace — Global Trade OS

> **Trust. Verify. Trade.**  
> A programmable trust + credit + verification system for physical goods trade.

---

## 🚀 Quick Start (Run Locally in 4 Steps)

```bash
# 1. Install dependencies
cd brace
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env and set SESSION_SECRET (and optional API keys — see below)

# 3. Start the server
npm start
# or for development with auto-reload:
npm run dev

# 4. Open in browser
# http://localhost:3000
```

That's it. The SQLite database is created automatically on first run.

---

## 🗂️ Project Structure

```
brace/
├── server.js           ← Express backend: auth, APIs, DB
├── brace.db            ← SQLite database (auto-created)
├── .env.example        ← Copy to .env and fill in keys
├── package.json
├── public/
│   ├── index.html      ← Single-page app shell
│   ├── style.css       ← Full design system
│   ├── app.js          ← Frontend logic
│   └── policy.html     ← Legal & policy page
└── README.md
```

---

## 🔑 API Keys — What You Need

### Free APIs (No key needed)
| Service | URL | Used For |
|---------|-----|----------|
| Open ER-API | open.er-api.com | Live exchange rates |
| REST Countries | restcountries.com | Country data |
| World Bank | api.worldbank.org | Economic indicators |

### Free APIs (Key required)
| Service | Get Key | Used For |
|---------|---------|----------|
| **Hugging Face** | huggingface.co/settings/tokens | AI sentiment + market analysis |
| Exchange Rate API | exchangerate-api.com/signup/free | Higher FX rate limits |

### AI/ML Models (All free on Hugging Face)
```
Sentiment Analysis:     distilbert-base-uncased-finetuned-sst-2-english
Text Generation:        mistralai/Mistral-7B-Instruct-v0.2
Financial Risk Scoring: ProsusAI/finbert
Grade Engine:           Custom rule-based (no API needed)
```

To activate AI features, add your HF key to `.env`:
```
HUGGING_FACE_API_KEY=hf_your_token_here
```
If no key is set, the platform falls back gracefully to rule-based recommendations.

---

## 🏗️ System Architecture

### Trust Scoring Formula
```
Seller Credit Score =
  (0.35 × Transaction Success Rate) +
  (0.20 × Grade Accuracy Score) +
  (0.15 × Dispute Ratio Inverse) +
  (0.15 × Delivery Timeliness) +
  (0.15 × Buyer Feedback Score)
```

### Grade Accuracy Formula
```
Grade Accuracy Score = 1 - (|Declared Grade - Verified Grade| / 100)
```

### Risk-Adjusted Pricing
```
Final Trade Price = Base Price × Grade Factor × Trust Factor × Risk Discount
```

### Verification Tiers
| Trust Score | Action |
|-------------|--------|
| > 80        | No verification required |
| 55–80       | Random sampling |
| < 55        | Mandatory grade test |

---

## 📦 Features

- ✅ **Login / Register** — Session-based auth with bcrypt password hashing
- ✅ **Trade Deals** — Create, track, and manage trade deals
- ✅ **Trust Score** — Animated gauge, breakdown, tier classification
- ✅ **Risk-Adjusted Pricing** — Live grade + trust + risk calculation
- ✅ **Document Generation** — Commercial Invoice, POA, Packing List
- ✅ **Tax Calculator** — Customs duty + VAT + landed cost estimate
- ✅ **FX Rates** — Live via Open ER-API (free, no key)
- ✅ **AI Market Intelligence** — HF inference + rule-based fallback
- ✅ **Disputes** — Raise and track trade disputes
- ✅ **Audit Log** — Immutable activity trail
- ✅ **Legal Policy Page** — Full liability protection document

---

## 🌐 Free API Summary

All APIs used are free tier. No paid subscriptions required to run.

```
Exchange Rates:  open.er-api.com           ← 1500 req/month free
Country Data:    restcountries.com          ← No limits
HF Inference:    api-inference.huggingface.co ← Free, rate-limited
```

---

## 🗄️ Database Schema (SQLite)

Tables:
- `merchants` — user accounts
- `trade_deals` — all deals with pricing factors
- `seller_credit_scores` — 5-metric trust scores per merchant
- `grade_verifications` — conditional grade checks
- `disputes` — trade dispute records
- `audit_logs` — immutable activity log

---

## ⚖️ Legal

All use is subject to the Brace Terms of Service and Legal Disclaimer available at `/policy`.
Brace is a digital infrastructure layer — not a financial institution, legal advisor, or certified inspector.

---

## 🎨 Design System

Colors: `#96BBBB` · `#618985` · `#414535` · `#F2E3BC` · `#C19875`  
Fonts: Cormorant Garamond (display) · Syne (UI) · DM Mono (data)

---

*Built for Hackathon — Phase 1 MVP. Trust. Verify. Trade.*
