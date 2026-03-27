// ═══════════════════════════════════════════════════════════
//  BRACE — Global Trade OS
//  app.js — Frontend Brain
// ═══════════════════════════════════════════════════════════

'use strict';

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const State = {
  merchant:      null,
  currentPage:   'dashboard',
  dashboardStats: null
};

// ─────────────────────────────────────────────
//  API HELPER
// ─────────────────────────────────────────────
async function api(method, endpoint, body = null) {
  const opts = {
    method,
    headers:     { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (body) opts.body = JSON.stringify(body);

  const response = await fetch(endpoint, opts);
  const data     = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

// ─────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────
function switchAuth(mode) {
  document.getElementById('login-form').classList.toggle('active',    mode === 'login');
  document.getElementById('register-form').classList.toggle('active', mode === 'register');
}

async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');

  errEl.classList.add('hidden');
  try {
    const data = await api('POST', '/api/auth/login', { email, password });
    State.merchant = data.merchant;
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function handleRegister() {
  const name     = document.getElementById('reg-name').value.trim();
  const company  = document.getElementById('reg-company').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const country  = document.getElementById('reg-country').value;
  const password = document.getElementById('reg-password').value;
  const agreed   = document.getElementById('reg-agree').checked;
  const errEl    = document.getElementById('reg-error');

  errEl.classList.add('hidden');

  if (!agreed) {
    errEl.textContent = 'You must agree to the Terms of Service to continue.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const data = await api('POST', '/api/auth/register', { name, company, email, country, password });
    State.merchant = data.merchant;
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function handleLogout() {
  await api('POST', '/api/auth/logout');
  State.merchant = null;
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('auth-gate').classList.remove('hidden');
}

function enterApp() {
  document.getElementById('auth-gate').classList.add('hidden');
  document.getElementById('main-app').classList.remove('hidden');

  const name = State.merchant?.name || 'Merchant';
  document.getElementById('sidebar-merchant').textContent = name;
  document.getElementById('topbar-merchant').textContent  = name;

  navigate('dashboard');
}

// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────
const PAGE_TITLES = {
  'dashboard':   'Dashboard',
  'new-deal':    'New Deal',
  'my-deals':    'My Deals',
  'trust-score': 'Trust Score',
  'tax-calc':    'Tax Calculator',
  'fx-rates':    'FX Rates',
  'markets':     'AI Markets',
  'disputes':    'Disputes',
  'audit':       'Audit Log'
};

function navigate(page) {
  State.currentPage = page;

  // Toggle pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  // Toggle nav items
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  document.getElementById('topbar-title').textContent = PAGE_TITLES[page] || page;

  // Load data per page
  if (page === 'dashboard')   loadDashboard();
  if (page === 'my-deals')    loadMyDeals();
  if (page === 'trust-score') loadTrustScore();
  if (page === 'fx-rates')    loadFX();
  if (page === 'disputes')    loadDisputes();
  if (page === 'audit')       loadAuditLog();
}

// ─────────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────────
async function loadDashboard() {
  try {
    const { stats, recent_deals } = await api('GET', '/api/dashboard/stats');
    State.dashboardStats = stats;

    // Stat cards
    setStatCard('stat-volume',    `$${formatNumber(stats.trade_volume_usd)}`, 'USD equivalent');
    setStatCard('stat-credit',    `${stats.credit_score.toFixed(1)}`,         stats.verification_tier + ' tier');
    setStatCard('stat-deals',     stats.active_deals,                         'In progress');
    setStatCard('stat-completed', stats.completed_deals,                      'All time');

    // Recent deals
    const container = document.getElementById('recent-deals-list');
    if (!recent_deals.length) {
      container.innerHTML = emptyState('◎', 'No deals yet. Create your first trade deal.');
      return;
    }
    container.innerHTML = recent_deals.map(dealCard).join('');
  } catch (err) {
    showToast('Failed to load dashboard: ' + err.message, 'error');
  }
}

function setStatCard(id, value, sub) {
  const card = document.getElementById(id);
  if (!card) return;
  card.querySelector('.stat-value').textContent = value;
  card.querySelector('.stat-sub').textContent   = sub;
}

// ─────────────────────────────────────────────
//  MY DEALS
// ─────────────────────────────────────────────
async function loadMyDeals() {
  const container = document.getElementById('my-deals-list');
  try {
    const { deals } = await api('GET', '/api/deals/my-deals');
    if (!deals.length) {
      container.innerHTML = emptyState('◎', 'No deals yet. Start by creating a new deal.');
      return;
    }
    container.innerHTML = deals.map(d => dealCard(d, true)).join('');
  } catch (err) {
    container.innerHTML = emptyState('!', err.message);
  }
}

function dealCard(deal, showActions = false) {
  return `
    <div class="deal-card status-${deal.status}" onclick="openDealModal('${deal.id}')">
      <div style="flex:1">
        <div class="deal-product">${escHtml(deal.product_name)}</div>
        <div class="deal-route">${deal.origin_country} → ${deal.dest_country} · ${deal.quantity} ${deal.unit || 'MT'}</div>
      </div>
      <div style="text-align:right">
        <div class="deal-price">$${formatNumber(deal.final_price || deal.base_price)}</div>
        <div class="deal-status status-${deal.status}">${deal.status.replace('_', ' ')}</div>
      </div>
    </div>
  `;
}

async function openDealModal(dealId) {
  try {
    const { deal } = await api('GET', `/api/deals/${dealId}`);
    const content  = `
      <div class="modal-doc-title">${escHtml(deal.product_name)}</div>
      ${docField('Deal ID', deal.id)}
      ${docField('Route', `${deal.origin_country} → ${deal.dest_country}`)}
      ${docField('Quantity', `${deal.quantity} ${deal.unit || 'MT'}`)}
      ${docField('Declared Grade', `${deal.declared_grade}/100`)}
      ${docField('Base Price', `$${formatNumber(deal.base_price)}`)}
      ${docField('Grade Factor', deal.grade_factor?.toFixed(3))}
      ${docField('Trust Factor', deal.trust_factor?.toFixed(3))}
      ${docField('Risk Discount', deal.risk_discount?.toFixed(3))}
      ${docField('Final Price', `$${formatNumber(deal.final_price)}`)}
      ${docField('Status', deal.status)}
      ${docField('Created', formatDate(deal.created_at))}
      <div style="margin-top:1.25rem;display:flex;gap:0.6rem;flex-wrap:wrap">
        <button class="btn-primary" style="width:auto;margin-top:0" onclick="generateDocs('${deal.id}')">Generate Documents</button>
        <button class="btn-secondary" onclick="updateDealStatus('${deal.id}', 'completed')">Mark Completed</button>
        <button class="btn-secondary" onclick="navigate('disputes');document.getElementById('dispute-deal-id').value='${deal.id}';closeModal()">Raise Dispute</button>
      </div>
    `;
    document.getElementById('modal-content').innerHTML = content;
    document.getElementById('deal-modal').classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load deal: ' + err.message, 'error');
  }
}

async function generateDocs(dealId) {
  try {
    const { documents } = await api('POST', '/api/documents/generate', { deal_id: dealId });
    showDocumentsModal(documents);
  } catch (err) {
    showToast('Document generation failed: ' + err.message, 'error');
  }
}

function showDocumentsModal(docs) {
  const inv = docs.invoice;
  const poa = docs.poa;

  const content = `
    <div class="modal-doc-title">Generated Documents</div>
    <div class="form-section-label">Commercial Invoice</div>
    ${docField('Doc ID', inv.doc_id)}
    ${docField('Issued By', inv.issued_by)}
    ${docField('Product', inv.product)}
    ${docField('HS Code', inv.hs_code)}
    ${docField('Quantity', inv.quantity)}
    ${docField('Base Price', `${inv.currency} ${formatNumber(inv.unit_price)}`)}
    ${docField('Total', `${inv.currency} ${formatNumber(inv.total)}`)}
    ${docField('Grade', `${inv.grade}/100`)}

    <div class="form-section-label" style="margin-top:1rem">Proof of Agreement (POA)</div>
    ${docField('Doc ID', poa.doc_id)}
    ${docField('Inspection Clause', poa.inspection_clause)}
    ${docField('Liability Clause', poa.liability_clause.slice(0, 80) + '...')}
    ${docField('Escrow Clause', poa.escrow_clause.slice(0, 80) + '...')}

    <div class="form-section-label" style="margin-top:1rem">Packing List</div>
    ${docField('Doc ID', docs.packing_list.doc_id)}
    ${docField('Quantity', `${docs.packing_list.quantity} ${docs.packing_list.unit}`)}
    ${docField('Grade', `${docs.packing_list.grade}/100`)}

    <p style="font-size:0.72rem;color:var(--text-dim);margin-top:1rem">
      ⚠ Documents are generated by Brace Trade OS for reference purposes. They do not constitute legally binding instruments unless reviewed and approved by qualified legal counsel. Brace is not liable for reliance on these documents.
    </p>
  `;

  document.getElementById('modal-content').innerHTML = content;
}

async function updateDealStatus(dealId, status) {
  try {
    await api('PATCH', `/api/deals/${dealId}/status`, { status });
    showToast(`Deal marked as ${status}`);
    closeModal();
    loadDashboard();
  } catch (err) {
    showToast('Update failed: ' + err.message, 'error');
  }
}

function closeModal() {
  document.getElementById('deal-modal').classList.add('hidden');
}

// ─────────────────────────────────────────────
//  NEW DEAL
// ─────────────────────────────────────────────
async function previewDealPricing() {
  const basePrice    = Number(document.getElementById('deal-price').value) || 0;
  const declaredGrade = Number(document.getElementById('deal-grade').value) || 75;

  if (!basePrice) { showToast('Enter a base price first', 'error'); return; }

  let creditScore = 77.5;
  try {
    const { score } = await api('GET', '/api/trust/my-score');
    creditScore = score.composite_score;
  } catch (_) {}

  const gradeF  = Math.pow(declaredGrade / 100, 0.5);
  const trustF  = 0.7 + (creditScore / 100) * 0.3;
  const riskD   = 0.95;
  const finalP  = basePrice * gradeF * trustF * riskD;

  document.getElementById('prev-base').textContent  = `$${formatNumber(basePrice)}`;
  document.getElementById('prev-grade').textContent = `×${gradeF.toFixed(3)}`;
  document.getElementById('prev-trust').textContent = `×${trustF.toFixed(3)}`;
  document.getElementById('prev-risk').textContent  = `×${riskD.toFixed(3)}`;
  document.getElementById('prev-final').textContent = `$${formatNumber(finalP)}`;
  document.getElementById('deal-pricing-preview').classList.remove('hidden');
}

async function createDeal() {
  const body = {
    product_name:   document.getElementById('deal-product').value.trim(),
    hs_code:        document.getElementById('deal-hs').value.trim(),
    origin_country: document.getElementById('deal-origin').value,
    dest_country:   document.getElementById('deal-dest').value,
    quantity:       Number(document.getElementById('deal-qty').value),
    unit:           document.getElementById('deal-unit').value,
    declared_grade: Number(document.getElementById('deal-grade').value),
    base_price:     Number(document.getElementById('deal-price').value),
    currency:       'USD'
  };

  const errEl = document.getElementById('deal-error');
  errEl.classList.add('hidden');

  if (!body.product_name || !body.origin_country || !body.dest_country || !body.quantity || !body.base_price) {
    errEl.textContent = 'Please fill in all required fields.';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const data = await api('POST', '/api/deals/create', body);
    showToast(`Deal created! Final price: $${formatNumber(data.deal.final_price)}`);
    if (data.verification_required) {
      showToast('⚠ Grade verification required due to trust score level.', 'error');
    }
    navigate('my-deals');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

// ─────────────────────────────────────────────
//  TRUST SCORE
// ─────────────────────────────────────────────
async function loadTrustScore() {
  try {
    const { score } = await api('GET', '/api/trust/my-score');
    const s = score.composite_score;

    // Animate gauge
    document.getElementById('gauge-number').textContent = s.toFixed(1);
    document.getElementById('gauge-tier').textContent   = score.verification_tier.toUpperCase() + ' TIER';

    // Arc: 251.2 = full circumference of our gauge arc
    const offset = 251.2 - (s / 100) * 251.2;
    document.getElementById('gauge-arc').style.strokeDashoffset = offset;

    // Color by tier
    const arcEl = document.getElementById('gauge-arc');
    if (score.verification_tier === 'high')   arcEl.style.stroke = 'var(--teal)';
    if (score.verification_tier === 'medium') arcEl.style.stroke = 'var(--amber)';
    if (score.verification_tier === 'low')    arcEl.style.stroke = '#e09080';

    // Metric bars
    updateMetricBar('bar-tsr', score.transaction_success_rate);
    updateMetricBar('bar-gas', score.grade_accuracy_score);
    updateMetricBar('bar-dri', score.dispute_ratio_inverse);
    updateMetricBar('bar-dt',  score.delivery_timeliness);
    updateMetricBar('bar-bfs', score.buyer_feedback_score);
  } catch (err) {
    showToast('Failed to load trust score: ' + err.message, 'error');
  }
}

function updateMetricBar(barId, value) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.querySelector('.bar-fill').style.width    = `${(value * 100).toFixed(0)}%`;
  bar.querySelector('.metric-score').textContent = value.toFixed(2);
}

// ─────────────────────────────────────────────
//  TAX CALCULATOR
// ─────────────────────────────────────────────
async function calculateTax() {
  const body = {
    origin_country: document.getElementById('tax-origin').value,
    dest_country:   document.getElementById('tax-dest').value,
    trade_value:    Number(document.getElementById('tax-value').value),
    hs_code:        document.getElementById('tax-hs').value.trim()
  };

  if (!body.trade_value) { showToast('Enter a trade value', 'error'); return; }

  try {
    const { tax_breakdown: t, disclaimer } = await api('POST', '/api/tax/calculate', body);
    const result = document.getElementById('tax-result');
    result.classList.remove('hidden');
    result.innerHTML = `
      <div class="result-title">Tax Breakdown — ${body.origin_country} → ${body.dest_country}</div>
      <div class="tax-row"><span>Trade Value</span><span>$${formatNumber(t.trade_value)}</span></div>
      <div class="tax-row"><span>Tariff Rate</span><span>${t.base_tariff_rate}%</span></div>
      <div class="tax-row"><span>Customs Duty</span><span>$${formatNumber(t.customs_duty)}</span></div>
      <div class="tax-row"><span>Other Duties</span><span>$${formatNumber(t.other_duties)}</span></div>
      <div class="tax-row"><span>VAT Rate</span><span>${t.vat_rate}%</span></div>
      <div class="tax-row"><span>VAT Amount</span><span>$${formatNumber(t.vat_amount)}</span></div>
      <div class="tax-row total-row"><span>Total Tax Burden</span><span>$${formatNumber(t.total_tax_burden)}</span></div>
      <div class="tax-row total-row"><span>Landed Cost</span><span>$${formatNumber(t.landed_cost)}</span></div>
      <div class="tax-row"><span>Effective Tax %</span><span>${t.effective_tax_pct}%</span></div>
    `;
  } catch (err) {
    showToast('Calculation failed: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────
//  FX RATES
// ─────────────────────────────────────────────
async function loadFX() {
  const base      = document.getElementById('fx-base')?.value || 'USD';
  const container = document.getElementById('fx-grid');
  container.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem">Loading rates...</div>';

  try {
    const { rates, updated, source } = await api('GET', `/api/fx/rates?base=${base}`);
    const SHOW = ['USD','EUR','GBP','INR','JPY','AED','CNY','SGD','AUD','CAD','CHF','BRL'];

    container.innerHTML = SHOW
      .filter(c => c !== base && rates[c])
      .map(c => `
        <div class="fx-card">
          <div class="fx-currency">${c}</div>
          <div class="fx-rate">${rates[c].toFixed(4)}</div>
        </div>
      `).join('');

    if (updated) {
      container.innerHTML += `<div style="grid-column:1/-1;font-size:0.68rem;color:var(--text-dim);margin-top:0.5rem">Updated: ${updated}${source === 'fallback' ? ' (fallback data)' : ''}</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div style="color:var(--amber);font-size:0.8rem">Failed to load rates: ${err.message}</div>`;
  }
}

// ─────────────────────────────────────────────
//  AI MARKET INTELLIGENCE
// ─────────────────────────────────────────────
async function getMarketIntel() {
  const product     = document.getElementById('mkt-product').value.trim();
  const origin      = document.getElementById('mkt-origin').value;
  const description = document.getElementById('mkt-desc').value.trim();

  if (!product) { showToast('Enter a product name', 'error'); return; }

  const result = document.getElementById('mkt-result');
  result.classList.remove('hidden');
  result.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem">Analysing markets...</div>';

  try {
    const data = await api('POST', '/api/ai/recommend-markets', {
      product_name:        product,
      origin_country:      origin,
      product_description: description
    });

    const { intel, ai_insight } = data;

    const marketsHtml = (intel.top_markets || []).map(m =>
      `<span class="mkt-market-tag">${m}</span>`
    ).join('');

    const aiHtml = ai_insight ? `
      <div style="margin-top:0.75rem;padding:0.6rem;background:var(--surface);border-radius:var(--radius-sm);border:1px solid var(--border)">
        <div style="font-size:0.7rem;color:var(--text-dim);margin-bottom:0.2rem">AI Sentiment Analysis</div>
        <div style="font-size:0.8rem;color:var(--teal)">
          ${ai_insight.label} (confidence: ${(ai_insight.score * 100).toFixed(1)}%)
        </div>
        <div style="font-size:0.68rem;color:var(--text-dim)">Model: ${ai_insight.model}</div>
      </div>
    ` : '<div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.5rem">Add your Hugging Face API key in .env to enable live AI sentiment analysis.</div>';

    result.innerHTML = `
      <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.75rem">
        Recommended markets for <strong style="color:var(--sand)">${escHtml(product)}</strong> from <strong>${origin}</strong>:
      </div>
      <div class="mkt-markets">${marketsHtml}</div>
      <div style="margin-top:0.75rem;font-size:0.82rem;color:var(--text-secondary)">
        Market Demand: <span style="color:var(--teal);font-weight:600">${intel.demand?.toUpperCase() || 'MEDIUM'}</span>
        ${intel.avg_price_usd_mt ? `&nbsp;&nbsp;Avg Price: <span style="color:var(--teal)">$${formatNumber(intel.avg_price_usd_mt)} / MT</span>` : ''}
      </div>
      ${aiHtml}
      <div style="font-size:0.68rem;color:var(--amber);margin-top:0.75rem">⚠ ${data.disclaimer}</div>
    `;
  } catch (err) {
    result.innerHTML = `<div style="color:var(--amber)">Failed: ${err.message}</div>`;
  }
}

// ─────────────────────────────────────────────
//  DISPUTES
// ─────────────────────────────────────────────
async function raiseDispute() {
  const dealId = document.getElementById('dispute-deal-id').value.trim();
  const reason = document.getElementById('dispute-reason').value.trim();

  if (!dealId || !reason) { showToast('Fill in Deal ID and reason', 'error'); return; }

  try {
    await api('POST', '/api/disputes/raise', { deal_id: dealId, reason });
    showToast('Dispute submitted. Platform will mediate.');
    document.getElementById('dispute-deal-id').value = '';
    document.getElementById('dispute-reason').value  = '';
    loadDisputes();
  } catch (err) {
    showToast('Failed to raise dispute: ' + err.message, 'error');
  }
}

async function loadDisputes() {
  const container = document.getElementById('disputes-list');
  try {
    const { disputes } = await api('GET', '/api/disputes/my-disputes');
    if (!disputes.length) {
      container.innerHTML = emptyState('◐', 'No disputes raised.');
      return;
    }
    container.innerHTML = disputes.map(d => `
      <div class="deal-card status-${d.status}">
        <div style="flex:1">
          <div class="deal-product">${escHtml(d.product_name || 'Unknown Deal')}</div>
          <div class="deal-route">${escHtml(d.reason?.slice(0, 80) || '—')}</div>
        </div>
        <div class="deal-status status-${d.status}">${d.status}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = emptyState('!', err.message);
  }
}

// ─────────────────────────────────────────────
//  AUDIT LOG
// ─────────────────────────────────────────────
async function loadAuditLog() {
  const container = document.getElementById('audit-list');
  try {
    const { logs } = await api('GET', '/api/audit/my-logs');
    if (!logs.length) {
      container.innerHTML = emptyState('▣', 'No audit entries yet.');
      return;
    }
    container.innerHTML = logs.map(l => `
      <div class="audit-row">
        <span class="audit-action">${l.action}</span>
        <span style="color:var(--text-dim)">${l.entity_type || '—'}</span>
        <span style="font-size:0.7rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${l.entity_id || ''}</span>
        <span class="audit-time">${formatDate(l.created_at)}</span>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = emptyState('!', err.message);
  }
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function formatNumber(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function emptyState(icon, text) {
  return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><p>${escHtml(text)}</p></div>`;
}

function docField(label, value) {
  return `<div class="doc-field"><span>${escHtml(label)}</span><span>${escHtml(String(value || '—'))}</span></div>`;
}

// ─────────────────────────────────────────────
//  ENTER KEY SUPPORT
// ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter') {
    const loginForm = document.getElementById('login-form');
    const regForm   = document.getElementById('register-form');
    if (loginForm?.classList.contains('active')) handleLogin();
    if (regForm?.classList.contains('active'))   handleRegister();
  }
});

// Click outside modal to close
document.getElementById('deal-modal')?.addEventListener('click', e => {
  if (e.target.id === 'deal-modal') closeModal();
});

// ─────────────────────────────────────────────
//  BOOT — Check session on load
// ─────────────────────────────────────────────
(async function boot() {
  try {
    const { merchant } = await api('GET', '/api/auth/me');
    State.merchant = merchant;
    enterApp();
  } catch (_) {
    // Not logged in — show auth gate
    document.getElementById('auth-gate').classList.remove('hidden');
  }
})();
