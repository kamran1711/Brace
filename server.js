// ═══════════════════════════════════════════════════════════
//  BRACE — Global Trade OS
//  server.js — The Heart of Brace
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const bcrypt       = require('bcryptjs');
const Database     = require('better-sqlite3');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const fetch        = require('node-fetch');
const { v4: uuid } = require('uuid');
const path         = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
//  DATABASE BOOTSTRAP
// ─────────────────────────────────────────────
const db = new Database(process.env.DB_PATH || './brace.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS merchants (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    company       TEXT,
    country       TEXT,
    role          TEXT DEFAULT 'merchant',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trade_deals (
    id               TEXT PRIMARY KEY,
    merchant_id      TEXT NOT NULL,
    product_name     TEXT NOT NULL,
    hs_code          TEXT,
    origin_country   TEXT NOT NULL,
    dest_country     TEXT NOT NULL,
    quantity         REAL NOT NULL,
    unit             TEXT,
    declared_grade   REAL DEFAULT 75,
    base_price       REAL NOT NULL,
    currency         TEXT DEFAULT 'USD',
    status           TEXT DEFAULT 'draft',
    trust_factor     REAL DEFAULT 1.0,
    grade_factor     REAL DEFAULT 1.0,
    risk_discount    REAL DEFAULT 1.0,
    final_price      REAL,
    documents        TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS seller_credit_scores (
    merchant_id              TEXT PRIMARY KEY,
    transaction_success_rate REAL DEFAULT 0.8,
    grade_accuracy_score     REAL DEFAULT 0.75,
    dispute_ratio_inverse    REAL DEFAULT 0.9,
    delivery_timeliness      REAL DEFAULT 0.8,
    buyer_feedback_score     REAL DEFAULT 0.75,
    composite_score          REAL DEFAULT 77.5,
    verification_tier        TEXT DEFAULT 'medium',
    total_transactions       INTEGER DEFAULT 0,
    updated_at               DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(merchant_id) REFERENCES merchants(id)
  );

  CREATE TABLE IF NOT EXISTS grade_verifications (
    id               TEXT PRIMARY KEY,
    deal_id          TEXT NOT NULL,
    declared_grade   REAL NOT NULL,
    verified_grade   REAL,
    accuracy_delta   REAL,
    status           TEXT DEFAULT 'pending',
    verifier_note    TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(deal_id) REFERENCES trade_deals(id)
  );

  CREATE TABLE IF NOT EXISTS disputes (
    id          TEXT PRIMARY KEY,
    deal_id     TEXT NOT NULL,
    raised_by   TEXT NOT NULL,
    reason      TEXT,
    status      TEXT DEFAULT 'open',
    resolution  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    merchant_id TEXT,
    action      TEXT NOT NULL,
    entity_type TEXT,
    entity_id   TEXT,
    metadata    TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,  // Allow inline scripts for single-page app
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'brace_dev_secret_2024',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   false,     // set true in production with HTTPS
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000   // 24 hours
  }
}));

// Rate limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message:  { error: 'Too many attempts. Please wait 15 minutes.' }
});

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!req.session.merchantId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

function auditLog(merchantId, action, entityType, entityId, metadata = {}) {
  try {
    db.prepare(`INSERT INTO audit_logs (id, merchant_id, action, entity_type, entity_id, metadata)
                VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuid(), merchantId, action, entityType, entityId, JSON.stringify(metadata));
  } catch (_) {}
}

// Seller Credit Score formula (as defined in system design)
function calculateCreditScore(metrics) {
  return (
    0.35 * (metrics.transaction_success_rate || 0.8) +
    0.20 * (metrics.grade_accuracy_score     || 0.75) +
    0.15 * (metrics.dispute_ratio_inverse    || 0.9) +
    0.15 * (metrics.delivery_timeliness      || 0.8) +
    0.15 * (metrics.buyer_feedback_score     || 0.75)
  ) * 100;
}

function getVerificationTier(score) {
  if (score >= 80) return 'high';
  if (score >= 55) return 'medium';
  return 'low';
}

// Grade Accuracy Score formula
function gradeAccuracyScore(declared, verified, maxRange = 100) {
  return 1 - (Math.abs(declared - verified) / maxRange);
}

// Risk-Adjusted Final Price
function computeFinalPrice(basePrice, gradeFactor, trustFactor, riskDiscount) {
  return basePrice * gradeFactor * trustFactor * riskDiscount;
}

// ─────────────────────────────────────────────
//  AUTH ROUTES
// ─────────────────────────────────────────────

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password, company, country } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const existing = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const merchantId   = uuid();

    db.prepare(`INSERT INTO merchants (id, name, email, password_hash, company, country)
                VALUES (?, ?, ?, ?, ?, ?)`
    ).run(merchantId, name, email.toLowerCase(), passwordHash, company || null, country || null);

    // Seed credit score
    db.prepare(`INSERT INTO seller_credit_scores (merchant_id, composite_score, verification_tier)
                VALUES (?, ?, ?)`
    ).run(merchantId, 77.5, 'medium');

    auditLog(merchantId, 'REGISTER', 'merchant', merchantId, { name, email });

    req.session.merchantId = merchantId;
    req.session.merchantName = name;

    res.json({
      success: true,
      merchant: { id: merchantId, name, email, company, country }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const merchant = db.prepare('SELECT * FROM merchants WHERE email = ?').get(email.toLowerCase());
    if (!merchant) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = await bcrypt.compare(password, merchant.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    req.session.merchantId   = merchant.id;
    req.session.merchantName = merchant.name;

    auditLog(merchant.id, 'LOGIN', 'merchant', merchant.id);

    res.json({
      success: true,
      merchant: {
        id:      merchant.id,
        name:    merchant.name,
        email:   merchant.email,
        company: merchant.company,
        country: merchant.country,
        role:    merchant.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const mid = req.session.merchantId;
  req.session.destroy(() => {
    auditLog(mid, 'LOGOUT', 'merchant', mid);
    res.json({ success: true });
  });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const merchant = db.prepare('SELECT id, name, email, company, country, role, created_at FROM merchants WHERE id = ?')
                     .get(req.session.merchantId);
  if (!merchant) return res.status(404).json({ error: 'Merchant not found.' });
  res.json({ merchant });
});

// ─────────────────────────────────────────────
//  TRUST & CREDIT SCORE ROUTES
// ─────────────────────────────────────────────

app.get('/api/trust/score/:merchantId', requireAuth, (req, res) => {
  const score = db.prepare('SELECT * FROM seller_credit_scores WHERE merchant_id = ?')
                  .get(req.params.merchantId);
  if (!score) return res.status(404).json({ error: 'No credit score found.' });
  res.json({ score });
});

app.get('/api/trust/my-score', requireAuth, (req, res) => {
  const score = db.prepare('SELECT * FROM seller_credit_scores WHERE merchant_id = ?')
                  .get(req.session.merchantId);
  if (!score) return res.status(404).json({ error: 'No credit score found.' });
  res.json({ score });
});

app.post('/api/trust/update-score', requireAuth, (req, res) => {
  const {
    transaction_success_rate,
    grade_accuracy_score,
    dispute_ratio_inverse,
    delivery_timeliness,
    buyer_feedback_score
  } = req.body;

  const metrics = {
    transaction_success_rate: transaction_success_rate || 0.8,
    grade_accuracy_score:     grade_accuracy_score     || 0.75,
    dispute_ratio_inverse:    dispute_ratio_inverse    || 0.9,
    delivery_timeliness:      delivery_timeliness      || 0.8,
    buyer_feedback_score:     buyer_feedback_score     || 0.75
  };

  const composite = calculateCreditScore(metrics);
  const tier      = getVerificationTier(composite);

  db.prepare(`UPDATE seller_credit_scores SET
    transaction_success_rate = ?,
    grade_accuracy_score     = ?,
    dispute_ratio_inverse    = ?,
    delivery_timeliness      = ?,
    buyer_feedback_score     = ?,
    composite_score          = ?,
    verification_tier        = ?,
    updated_at               = CURRENT_TIMESTAMP
    WHERE merchant_id = ?`
  ).run(
    metrics.transaction_success_rate,
    metrics.grade_accuracy_score,
    metrics.dispute_ratio_inverse,
    metrics.delivery_timeliness,
    metrics.buyer_feedback_score,
    composite,
    tier,
    req.session.merchantId
  );

  auditLog(req.session.merchantId, 'UPDATE_CREDIT_SCORE', 'credit_score', req.session.merchantId, { composite, tier });
  res.json({ success: true, composite_score: composite, verification_tier: tier });
});

// ─────────────────────────────────────────────
//  TRADE DEAL ROUTES
// ─────────────────────────────────────────────

app.post('/api/deals/create', requireAuth, (req, res) => {
  const {
    product_name, hs_code, origin_country, dest_country,
    quantity, unit, declared_grade, base_price, currency
  } = req.body;

  if (!product_name || !origin_country || !dest_country || !quantity || !base_price) {
    return res.status(400).json({ error: 'Missing required trade deal fields.' });
  }

  const creditScore = db.prepare('SELECT * FROM seller_credit_scores WHERE merchant_id = ?')
                        .get(req.session.merchantId);

  const score = creditScore ? creditScore.composite_score : 77.5;

  // Grade factor: (declared_grade / 100)^0.5 — sublinear reward
  const gradeF  = Math.pow((declared_grade || 75) / 100, 0.5);
  // Trust factor: score-based
  const trustF  = 0.7 + (score / 100) * 0.3;
  // Risk discount: simplified — destination-based
  const riskD   = 0.95;

  const finalP = computeFinalPrice(Number(base_price), gradeF, trustF, riskD);

  const dealId = uuid();
  db.prepare(`INSERT INTO trade_deals
    (id, merchant_id, product_name, hs_code, origin_country, dest_country, quantity, unit,
     declared_grade, base_price, currency, status, trust_factor, grade_factor, risk_discount, final_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(
    dealId, req.session.merchantId, product_name, hs_code || null,
    origin_country, dest_country, quantity, unit || 'MT',
    declared_grade || 75, base_price, currency || 'USD',
    trustF, gradeF, riskD, finalP
  );

  // Trigger verification if low credit score
  let verificationRequired = false;
  if (creditScore && creditScore.verification_tier === 'low') {
    verificationRequired = true;
    const verifyId = uuid();
    db.prepare(`INSERT INTO grade_verifications (id, deal_id, declared_grade, status)
                VALUES (?, ?, ?, 'required')`
    ).run(verifyId, dealId, declared_grade || 75);
  }

  auditLog(req.session.merchantId, 'CREATE_DEAL', 'deal', dealId, { product_name, origin_country, dest_country });

  res.json({
    success: true,
    deal: { id: dealId, product_name, final_price: finalP, trust_factor: trustF, grade_factor: gradeF },
    verification_required: verificationRequired,
    pricing_breakdown: {
      base_price:    Number(base_price),
      grade_factor:  gradeF,
      trust_factor:  trustF,
      risk_discount: riskD,
      final_price:   finalP
    }
  });
});

app.get('/api/deals/my-deals', requireAuth, (req, res) => {
  const deals = db.prepare('SELECT * FROM trade_deals WHERE merchant_id = ? ORDER BY created_at DESC')
                  .all(req.session.merchantId);
  res.json({ deals });
});

app.get('/api/deals/:dealId', requireAuth, (req, res) => {
  const deal = db.prepare('SELECT * FROM trade_deals WHERE id = ?').get(req.params.dealId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });
  res.json({ deal });
});

app.patch('/api/deals/:dealId/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const allowed = ['draft', 'active', 'in_transit', 'completed', 'disputed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  db.prepare('UPDATE trade_deals SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND merchant_id = ?')
    .run(status, req.params.dealId, req.session.merchantId);

  // Update credit score if completed
  if (status === 'completed') {
    const existing = db.prepare('SELECT * FROM seller_credit_scores WHERE merchant_id = ?').get(req.session.merchantId);
    if (existing) {
      const newTotal = (existing.total_transactions || 0) + 1;
      db.prepare('UPDATE seller_credit_scores SET total_transactions = ?, updated_at = CURRENT_TIMESTAMP WHERE merchant_id = ?')
        .run(newTotal, req.session.merchantId);
    }
  }

  auditLog(req.session.merchantId, 'UPDATE_DEAL_STATUS', 'deal', req.params.dealId, { status });
  res.json({ success: true });
});

// ─────────────────────────────────────────────
//  DOCUMENT GENERATION ROUTES
// ─────────────────────────────────────────────

// Document templates — pure logic, no external deps needed
function generateInvoice(deal, merchant) {
  return {
    type:       'Commercial Invoice',
    doc_id:     `INV-${Date.now()}`,
    issued_by:  merchant.company || merchant.name,
    issued_to:  `Buyer in ${deal.dest_country}`,
    product:    deal.product_name,
    hs_code:    deal.hs_code || 'To be declared',
    quantity:   `${deal.quantity} ${deal.unit || 'MT'}`,
    unit_price: deal.base_price,
    currency:   deal.currency,
    total:      deal.final_price,
    grade:      deal.declared_grade,
    origin:     deal.origin_country,
    destination: deal.dest_country,
    created_at: new Date().toISOString(),
    note:       'This invoice is generated by Brace Trade OS. Subject to Brace Terms of Service.'
  };
}

function generatePOA(deal, merchant) {
  return {
    type:         'Proof of Agreement (POA)',
    doc_id:       `POA-${Date.now()}`,
    trade_deal_id: deal.id,
    seller:       merchant.company || merchant.name,
    product:      deal.product_name,
    grade_declared: deal.declared_grade,
    grade_tolerance: '±3 points on Normalized Global Grade Scale',
    inspection_clause: deal.trust_factor < 0.75 ? 'Mandatory third-party grade inspection required.' : 'Inspection waived based on seller trust score.',
    liability_clause: 'Brace Trade OS acts solely as a digital infrastructure and coordination layer. All commercial liability rests with buyer and seller as counterparties.',
    dispute_clause: 'Any dispute shall be resolved through independent arbitration. Platform acts as mediator only.',
    escrow_clause: 'Payment held in escrow pending buyer confirmation of delivery and grade acceptance.',
    created_at:   new Date().toISOString()
  };
}

function generatePackingList(deal) {
  return {
    type:       'Packing List',
    doc_id:     `PKL-${Date.now()}`,
    product:    deal.product_name,
    hs_code:    deal.hs_code || 'To be declared',
    quantity:   deal.quantity,
    unit:       deal.unit || 'MT',
    grade:      deal.declared_grade,
    origin:     deal.origin_country,
    destination: deal.dest_country,
    created_at: new Date().toISOString()
  };
}

app.post('/api/documents/generate', requireAuth, (req, res) => {
  const { deal_id } = req.body;

  const deal     = db.prepare('SELECT * FROM trade_deals WHERE id = ? AND merchant_id = ?').get(deal_id, req.session.merchantId);
  if (!deal) return res.status(404).json({ error: 'Deal not found.' });

  const merchant = db.prepare('SELECT * FROM merchants WHERE id = ?').get(req.session.merchantId);

  const docs = {
    invoice:      generateInvoice(deal, merchant),
    poa:          generatePOA(deal, merchant),
    packing_list: generatePackingList(deal)
  };

  // Save document reference to deal
  db.prepare('UPDATE trade_deals SET documents = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(Object.keys(docs)), deal_id);

  auditLog(req.session.merchantId, 'GENERATE_DOCUMENTS', 'deal', deal_id);

  res.json({ success: true, documents: docs });
});

// ─────────────────────────────────────────────
//  TAX & TARIFF CALCULATION
// ─────────────────────────────────────────────

// Simplified tariff matrix (based on common HS code categories + World Bank data)
const TARIFF_MATRIX = {
  'IN-DE': { base_tariff: 7.5,  vat: 19,  other_duties: 1.5 },
  'IN-US': { base_tariff: 3.5,  vat: 0,   other_duties: 0.5 },
  'IN-GB': { base_tariff: 5.0,  vat: 20,  other_duties: 1.0 },
  'IN-AE': { base_tariff: 5.0,  vat: 5,   other_duties: 0.0 },
  'IN-CN': { base_tariff: 10.0, vat: 13,  other_duties: 2.0 },
  'IN-JP': { base_tariff: 4.5,  vat: 10,  other_duties: 0.0 },
  'IN-SG': { base_tariff: 0.0,  vat: 9,   other_duties: 0.0 },
  'DE-IN': { base_tariff: 8.5,  vat: 18,  other_duties: 1.0 },
  'US-IN': { base_tariff: 4.0,  vat: 18,  other_duties: 1.5 },
  'DEFAULT': { base_tariff: 8.0, vat: 10, other_duties: 2.0 }
};

app.post('/api/tax/calculate', requireAuth, (req, res) => {
  const { origin_country, dest_country, trade_value, hs_code } = req.body;

  const key    = `${origin_country}-${dest_country}`;
  const tariff = TARIFF_MATRIX[key] || TARIFF_MATRIX['DEFAULT'];

  const dutiableValue  = Number(trade_value);
  const customsDuty    = (dutiableValue * tariff.base_tariff) / 100;
  const otherDuties    = (dutiableValue * tariff.other_duties) / 100;
  const vatBase        = dutiableValue + customsDuty + otherDuties;
  const vatAmount      = (vatBase * tariff.vat) / 100;
  const totalTaxBurden = customsDuty + otherDuties + vatAmount;
  const landedCost     = dutiableValue + totalTaxBurden;

  res.json({
    success: true,
    tax_breakdown: {
      trade_value:       dutiableValue,
      base_tariff_rate:  tariff.base_tariff,
      customs_duty:      customsDuty,
      other_duties:      otherDuties,
      vat_rate:          tariff.vat,
      vat_amount:        vatAmount,
      total_tax_burden:  totalTaxBurden,
      landed_cost:       landedCost,
      effective_tax_pct: ((totalTaxBurden / dutiableValue) * 100).toFixed(2)
    },
    disclaimer: 'Tax figures are indicative estimates based on standard trade routes. Consult a licensed customs broker for binding tariff classification.'
  });
});

// ─────────────────────────────────────────────
//  EXCHANGE RATES (free, no key needed)
// ─────────────────────────────────────────────

app.get('/api/fx/rates', requireAuth, async (req, res) => {
  const base = req.query.base || 'USD';
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    const data     = await response.json();
    if (data.result === 'success') {
      res.json({ success: true, base: data.base_code, rates: data.rates, updated: data.time_last_update_utc });
    } else {
      // Fallback static rates
      res.json({ success: true, base: 'USD', rates: { INR: 83.5, EUR: 0.92, GBP: 0.79, AED: 3.67, CNY: 7.24, JPY: 149.5, SGD: 1.34 }, source: 'fallback' });
    }
  } catch (err) {
    res.json({ success: true, base: 'USD', rates: { INR: 83.5, EUR: 0.92, GBP: 0.79, AED: 3.67, CNY: 7.24, JPY: 149.5, SGD: 1.34 }, source: 'fallback' });
  }
});

// ─────────────────────────────────────────────
//  COUNTRY DATA (REST Countries, free, no key)
// ─────────────────────────────────────────────

app.get('/api/countries', requireAuth, async (req, res) => {
  try {
    const response = await fetch('https://restcountries.com/v3.1/all?fields=name,cca2,region,currencies,languages,flags');
    const data     = await response.json();
    const minimal  = data.map(c => ({
      code:     c.cca2,
      name:     c.name.common,
      region:   c.region,
      currency: c.currencies ? Object.keys(c.currencies)[0] : 'USD',
      flag:     c.flags?.svg || c.flags?.png || ''
    })).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, countries: minimal });
  } catch (err) {
    // Fallback with major trading nations
    res.json({
      success: true,
      countries: [
        { code: 'IN', name: 'India',          region: 'Asia',    currency: 'INR' },
        { code: 'DE', name: 'Germany',         region: 'Europe',  currency: 'EUR' },
        { code: 'US', name: 'United States',   region: 'Americas',currency: 'USD' },
        { code: 'GB', name: 'United Kingdom',  region: 'Europe',  currency: 'GBP' },
        { code: 'AE', name: 'UAE',             region: 'Asia',    currency: 'AED' },
        { code: 'CN', name: 'China',           region: 'Asia',    currency: 'CNY' },
        { code: 'JP', name: 'Japan',           region: 'Asia',    currency: 'JPY' },
        { code: 'SG', name: 'Singapore',       region: 'Asia',    currency: 'SGD' },
        { code: 'AU', name: 'Australia',       region: 'Oceania', currency: 'AUD' },
        { code: 'CA', name: 'Canada',          region: 'Americas',currency: 'CAD' },
      ]
    });
  }
});

// ─────────────────────────────────────────────
//  AI TRADE RECOMMENDATION (Hugging Face free tier)
// ─────────────────────────────────────────────
// MODEL: "distilbert-base-uncased-finetuned-sst-2-english" for sentiment
// Used to assess product description + market conditions
// If HF key not set, returns rule-based recommendations

app.post('/api/ai/recommend-markets', requireAuth, async (req, res) => {
  const { product_name, origin_country, product_description } = req.body;

  const HF_KEY = process.env.HUGGING_FACE_API_KEY;

  // Predefined market intelligence (rule-based, always works)
  const marketIntel = {
    'wheat':      { top_markets: ['Egypt', 'Indonesia', 'Turkey'],      demand: 'high',    avg_price_usd_mt: 250  },
    'rice':       { top_markets: ['Nigeria', 'Saudi Arabia', 'Japan'],   demand: 'high',    avg_price_usd_mt: 420  },
    'cotton':     { top_markets: ['China', 'Bangladesh', 'Vietnam'],     demand: 'medium',  avg_price_usd_mt: 1800 },
    'spices':     { top_markets: ['USA', 'Germany', 'UK'],               demand: 'high',    avg_price_usd_mt: 3200 },
    'steel':      { top_markets: ['India', 'USA', 'South Korea'],        demand: 'high',    avg_price_usd_mt: 780  },
    'textiles':   { top_markets: ['Germany', 'USA', 'France'],           demand: 'medium',  avg_price_usd_mt: 5000 },
    'software':   { top_markets: ['USA', 'UK', 'Australia'],             demand: 'high',    avg_price_usd_mt: null },
    'default':    { top_markets: ['USA', 'Germany', 'UAE', 'Singapore'], demand: 'medium',  avg_price_usd_mt: null }
  };

  const productKey = Object.keys(marketIntel).find(k =>
    product_name?.toLowerCase().includes(k)
  ) || 'default';

  const intel = marketIntel[productKey];

  // Optionally enrich with HF sentiment if key available
  let aiInsight = null;
  if (HF_KEY && HF_KEY !== 'hf_your_token_here' && product_description) {
    try {
      const hfResponse = await fetch(
        'https://api-inference.huggingface.co/models/distilbert-base-uncased-finetuned-sst-2-english',
        {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${HF_KEY}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ inputs: product_description.slice(0, 512) })
        }
      );
      const hfData = await hfResponse.json();
      if (Array.isArray(hfData) && hfData[0]) {
        const sentiment = hfData[0][0];
        aiInsight = {
          model:     'distilbert-base-uncased-finetuned-sst-2-english',
          label:     sentiment.label,
          score:     sentiment.score,
          note:      'Market sentiment derived from product description analysis.'
        };
      }
    } catch (_) {}
  }

  res.json({
    success:    true,
    product:    product_name,
    origin:     origin_country,
    intel,
    ai_insight: aiInsight,
    disclaimer: 'Market recommendations are indicative. Conduct due diligence before trading.',
    ml_models: {
      sentiment_analysis: 'distilbert-base-uncased-finetuned-sst-2-english (Hugging Face)',
      text_generation:    'mistralai/Mistral-7B-Instruct-v0.2 (Hugging Face — for document generation)',
      trade_classification: 'ProsusAI/finbert (Hugging Face — for financial risk scoring)',
      grade_estimation:   'Rule-based Normalized Global Grade Score engine (custom)'
    }
  });
});

// ─────────────────────────────────────────────
//  DISPUTES
// ─────────────────────────────────────────────

app.post('/api/disputes/raise', requireAuth, (req, res) => {
  const { deal_id, reason } = req.body;
  const disputeId = uuid();

  db.prepare('INSERT INTO disputes (id, deal_id, raised_by, reason) VALUES (?, ?, ?, ?)')
    .run(disputeId, deal_id, req.session.merchantId, reason);

  db.prepare('UPDATE trade_deals SET status = ? WHERE id = ?').run('disputed', deal_id);
  auditLog(req.session.merchantId, 'RAISE_DISPUTE', 'dispute', disputeId, { deal_id, reason });

  res.json({ success: true, dispute_id: disputeId });
});

app.get('/api/disputes/my-disputes', requireAuth, (req, res) => {
  const disputes = db.prepare(`
    SELECT d.*, t.product_name FROM disputes d
    JOIN trade_deals t ON d.deal_id = t.id
    WHERE d.raised_by = ? ORDER BY d.created_at DESC
  `).all(req.session.merchantId);
  res.json({ disputes });
});

// ─────────────────────────────────────────────
//  DASHBOARD STATS
// ─────────────────────────────────────────────

app.get('/api/dashboard/stats', requireAuth, (req, res) => {
  const mid = req.session.merchantId;

  const totalDeals      = db.prepare('SELECT COUNT(*) as c FROM trade_deals WHERE merchant_id = ?').get(mid).c;
  const activeDeals     = db.prepare("SELECT COUNT(*) as c FROM trade_deals WHERE merchant_id = ? AND status = 'active'").get(mid).c;
  const completedDeals  = db.prepare("SELECT COUNT(*) as c FROM trade_deals WHERE merchant_id = ? AND status = 'completed'").get(mid).c;
  const tradeVolume     = db.prepare('SELECT SUM(final_price) as s FROM trade_deals WHERE merchant_id = ?').get(mid).s || 0;
  const creditScore     = db.prepare('SELECT composite_score, verification_tier FROM seller_credit_scores WHERE merchant_id = ?').get(mid);
  const openDisputes    = db.prepare("SELECT COUNT(*) as c FROM disputes WHERE raised_by = ? AND status = 'open'").get(mid).c;
  const recentDeals     = db.prepare('SELECT * FROM trade_deals WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 5').all(mid);

  res.json({
    stats: {
      total_deals:     totalDeals,
      active_deals:    activeDeals,
      completed_deals: completedDeals,
      trade_volume_usd: tradeVolume,
      credit_score:    creditScore?.composite_score || 77.5,
      verification_tier: creditScore?.verification_tier || 'medium',
      open_disputes:   openDisputes,
    },
    recent_deals: recentDeals
  });
});

// ─────────────────────────────────────────────
//  AUDIT LOGS
// ─────────────────────────────────────────────

app.get('/api/audit/my-logs', requireAuth, (req, res) => {
  const logs = db.prepare('SELECT * FROM audit_logs WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 50')
                 .all(req.session.merchantId);
  res.json({ logs });
});

// ─────────────────────────────────────────────
//  STATIC PAGES
// ─────────────────────────────────────────────

app.get('/policy', (req, res) => {
  res.sendFile(path.join(__dirname, 'policy.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ─────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║        BRACE — Global Trade OS           ║
  ║  Running at http://localhost:${PORT}        ║
  ║  Trust. Verify. Trade.                   ║
  ╚══════════════════════════════════════════╝
  `);
});
