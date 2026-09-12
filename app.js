/* ---------------- IndexedDB layer ---------------- */
const DB_NAME = "PropertyRegisterDB";
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("properties")) {
        db.createObjectStore("properties", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("contacts")) {
        db.createObjectStore("contacts", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDelete(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- Helpers ---------------- */
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
}
function num(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
/* Accepts flexible Indian-style price entry: "3L", "3 lakhs", "3,00,000",
   "4c", "4cr", "4 crores", "25k", plain "3000000", etc. */
function parsePrice(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  let s = String(v).trim();
  if (!s) return fallback;
  s = s.replace(/,/g, "");
  const m = s.match(/^(-?\d*\.?\d+)\s*(crores?|cr|c|lakhs?|l|thousand|k)?$/i);
  if (!m) return num(s, fallback);
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return fallback;
  switch ((m[2] || "").toLowerCase()) {
    case "cr": case "c": case "crore": case "crores": n *= 1e7; break;
    case "l": case "lakh": case "lakhs": n *= 1e5; break;
    case "k": case "thousand": n *= 1e3; break;
  }
  return n;
}
function fmtINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const rounded = Math.round(n);
  return "₹" + rounded.toLocaleString("en-IN");
}
function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}
function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 }) + "%";
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 1800);
}

/* ---------------- Domain defaults ---------------- */
function defaultProperty() {
  const now = Date.now();
  return {
    id: uid(),
    title: "",
    location: "",
    type: "Apartment",
    status: "Interested",
    price: 0,
    areaSqft: 0,
    contactId: "",
    notes: "",
    cost: { registrationPct: 1, stampDutyPct: 7, brokeragePct: 1, gstPct: 0, otherCharges: 0 },
    emi: { loanAmount: 0, interestRatePct: 8.5, tenureYears: 20 },
    rental: { monthlyRent: 0, annualExpensesPct: 1, appreciationPct: 6, holdingYears: 5 },
    createdAt: now,
    updatedAt: now
  };
}
function defaultContact() {
  const now = Date.now();
  return { id: uid(), name: "", role: "Broker", phone: "", email: "", notes: "", createdAt: now };
}

/* ---------------- Calculators ---------------- */
function calcCostBreakdown(p) {
  const base = num(p.price);
  const c = p.cost || {};
  const reg = base * num(c.registrationPct) / 100;
  const stamp = base * num(c.stampDutyPct) / 100;
  const brokerage = base * num(c.brokeragePct) / 100;
  const gst = base * num(c.gstPct) / 100;
  const other = num(c.otherCharges);
  const total = base + reg + stamp + brokerage + gst + other;
  return { base, reg, stamp, brokerage, gst, other, total };
}
function calcEMI(loanAmount, annualRatePct, years) {
  const P = num(loanAmount);
  const n = Math.max(1, Math.round(num(years) * 12));
  const r = num(annualRatePct) / 100 / 12;
  let emi;
  if (r === 0) emi = P / n;
  else emi = (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  if (!Number.isFinite(emi)) emi = 0;
  const totalPayment = emi * n;
  const totalInterest = totalPayment - P;
  return { emi, totalPayment, totalInterest, n };
}
function calcRental(totalCost, r) {
  const monthlyRent = num(r.monthlyRent);
  const annualRent = monthlyRent * 12;
  const grossYieldPct = totalCost > 0 ? (annualRent / totalCost) * 100 : 0;
  const annualExpenses = totalCost * num(r.annualExpensesPct) / 100;
  const netAnnualIncome = annualRent - annualExpenses;
  const netYieldPct = totalCost > 0 ? (netAnnualIncome / totalCost) * 100 : 0;
  const years = Math.max(0, num(r.holdingYears));
  const projectedValue = totalCost * Math.pow(1 + num(r.appreciationPct) / 100, years);
  const capitalGain = projectedValue - totalCost;
  const cumulativeRentalIncome = netAnnualIncome * years;
  const totalReturn = capitalGain + cumulativeRentalIncome;
  const totalROIPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;
  const annualizedROIPct = (years > 0 && totalCost > 0)
    ? (Math.pow((projectedValue + cumulativeRentalIncome) / totalCost, 1 / years) - 1) * 100
    : 0;
  return { annualRent, grossYieldPct, annualExpenses, netAnnualIncome, netYieldPct, projectedValue, capitalGain, cumulativeRentalIncome, totalReturn, totalROIPct, annualizedROIPct, years };
}
function pricePerSqft(price, areaSqft) {
  const a = num(areaSqft);
  return a > 0 ? num(price) / a : null;
}

/* ---------------- Land unit conversions (cent / acre) ---------------- */
const CENTS_PER_ACRE = 100;
const SQFT_PER_CENT = 435.6;
function fmtLakhCrore(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " Cr";
  if (abs >= 1e5) return (n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " L";
  return fmtINR(n);
}

/* ---------------- State ---------------- */
const state = {
  properties: [],
  contacts: [],
  view: "register",
  statusFilter: "All",
  compareSelected: new Set(),
  openPropertyId: null,
  openPropertyIsNew: false,
  propertyDraft: null,
  propertyTab: "info",
  openContactId: null,
  openContactIsNew: false,
  contactDraft: null,
  quickCalc: { unit: "cent", mode: "rate", area: 0, ratePerUnit: 0, totalPrice: 0 }
};

const STATUS_LIST = ["All", "Interested", "Viewing", "Negotiating", "Purchased", "Dropped"];
const TYPE_LIST = ["Apartment", "Villa", "Land", "Commercial", "Other"];
const ROLE_LIST = ["Broker", "Owner", "Agent", "Builder", "Other"];

/* ---------------- Data load ---------------- */
async function loadAll() {
  state.properties = await idbGetAll("properties");
  state.contacts = await idbGetAll("contacts");
  state.properties.sort((a, b) => b.updatedAt - a.updatedAt);
  state.contacts.sort((a, b) => a.name.localeCompare(b.name));
}

function contactName(id) {
  const c = state.contacts.find((x) => x.id === id);
  return c ? c.name : "";
}

/* ---------------- View switching ---------------- */
function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  document.getElementById("view-" + view).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "register") renderRegister();
  if (view === "contacts") renderContacts();
  if (view === "compare") renderCompare();
  if (view === "quickcalc") renderQuickCalc();
}

/* ---------------- Register view ---------------- */
function renderFilterChips() {
  const wrap = document.getElementById("filter-chips");
  wrap.innerHTML = STATUS_LIST.map(
    (s) => `<button class="chip ${s === state.statusFilter ? "active" : ""}" data-status="${s}">${s}</button>`
  ).join("");
  wrap.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.statusFilter = chip.dataset.status;
      renderRegister();
      renderFilterChips();
    });
  });
}

function renderRegister() {
  const list = document.getElementById("register-list");
  const empty = document.getElementById("register-empty");
  let items = state.properties;
  if (state.statusFilter !== "All") items = items.filter((p) => p.status === state.statusFilter);

  if (items.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = items.map((p) => {
    const pps = pricePerSqft(p.price, p.areaSqft);
    return `
      <div class="ledger-row" data-id="${p.id}">
        <div class="ledger-main">
          <p class="ledger-title">${escapeHtml(p.title || "Untitled property")}</p>
          <p class="ledger-sub">${escapeHtml(p.location || "—")} · ${escapeHtml(p.type)}</p>
          <span class="status-tag status-${p.status}">${p.status}</span>
        </div>
        <div class="ledger-figures">
          <div class="ledger-price">${fmtINR(p.price)}</div>
          <div class="ledger-per-sqft">${pps ? fmtINR(pps) + "/sqft" : "—"}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".ledger-row").forEach((row) => {
    row.addEventListener("click", () => openPropertyOverlay(row.dataset.id));
  });
}

/* ---------------- Property overlay ---------------- */
function openPropertyOverlay(id) {
  if (id) {
    state.openPropertyId = id;
    state.openPropertyIsNew = false;
    const p = state.properties.find((x) => x.id === id);
    state.propertyDraft = JSON.parse(JSON.stringify(p));
  } else {
    const fresh = defaultProperty();
    state.openPropertyId = fresh.id;
    state.openPropertyIsNew = true;
    state.propertyDraft = fresh;
  }
  state.propertyTab = "info";
  document.getElementById("prop-delete").classList.toggle("hidden", state.openPropertyIsNew);
  document.getElementById("overlay-property").classList.remove("hidden");
  renderPropertyTabs();
  renderPropertyBody();
}
function closePropertyOverlay() {
  document.getElementById("overlay-property").classList.add("hidden");
  state.openPropertyId = null;
  state.propertyDraft = null;
}
function renderPropertyTabs() {
  document.getElementById("prop-heading").textContent = state.openPropertyIsNew ? "New property" : "Edit property";
  document.querySelectorAll("#prop-tabs .sheet-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.propertyTab);
  });
}

async function savePropertyDraft(showToast = true) {
  const d = state.propertyDraft;
  d.updatedAt = Date.now();
  await idbPut("properties", d);
  await loadAll();
  state.openPropertyIsNew = false;
  document.getElementById("prop-delete").classList.remove("hidden");
  if (showToast) toast("Saved");
}

function renderPropertyBody() {
  const body = document.getElementById("prop-body");
  const d = state.propertyDraft;

  if (state.propertyTab === "info") {
    body.innerHTML = `
      <div class="field">
        <label>Title</label>
        <input type="text" id="f-title" value="${escapeHtml(d.title)}" placeholder="e.g. Green Valley Plot, Saravanampatti" />
      </div>
      <div class="field">
        <label>Location</label>
        <input type="text" id="f-location" value="${escapeHtml(d.location)}" placeholder="Area, city" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Type</label>
          <select id="f-type">${TYPE_LIST.map((t) => `<option ${t === d.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        </div>
        <div class="field">
          <label>Status</label>
          <select id="f-status">${STATUS_LIST.filter((s) => s !== "All").map((s) => `<option ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Price (₹)</label>
          <input type="text" inputmode="decimal" id="f-price" value="${d.price || ""}" placeholder="e.g. 45L, 1.2Cr, 4500000" />
        </div>
        <div class="field">
          <label>Area (sqft)</label>
          <input type="number" id="f-area" value="${d.areaSqft || ""}" placeholder="0" />
        </div>
      </div>
      <div class="field">
        <label>Contact (broker / owner)</label>
        <select id="f-contact">
          <option value="">— None —</option>
          ${state.contacts.map((c) => `<option value="${c.id}" ${c.id === d.contactId ? "selected" : ""}>${escapeHtml(c.name)} (${c.role})</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Anything worth remembering">${escapeHtml(d.notes)}</textarea>
      </div>
      <button class="btn-primary" id="f-save">Save property</button>
    `;
    body.querySelector("#f-title").addEventListener("input", (e) => (d.title = e.target.value));
    body.querySelector("#f-location").addEventListener("input", (e) => (d.location = e.target.value));
    body.querySelector("#f-type").addEventListener("change", (e) => (d.type = e.target.value));
    body.querySelector("#f-status").addEventListener("change", (e) => (d.status = e.target.value));
    body.querySelector("#f-price").addEventListener("input", (e) => (d.price = parsePrice(e.target.value)));
    body.querySelector("#f-area").addEventListener("input", (e) => (d.areaSqft = num(e.target.value)));
    body.querySelector("#f-contact").addEventListener("change", (e) => (d.contactId = e.target.value));
    body.querySelector("#f-notes").addEventListener("input", (e) => (d.notes = e.target.value));
    body.querySelector("#f-save").addEventListener("click", async () => {
      if (!d.title.trim()) { toast("Give it a title first"); return; }
      await savePropertyDraft();
      renderRegister();
    });
  }

  if (state.propertyTab === "cost") {
    const c = d.cost;
    body.innerHTML = `
      <p class="hint">Base price plus the usual acquisition costs — adjust the percentages for your state and deal.</p>
      <div class="field-row">
        <div class="field"><label>Registration %</label><input type="number" step="0.1" id="c-reg" value="${c.registrationPct}" /></div>
        <div class="field"><label>Stamp duty %</label><input type="number" step="0.1" id="c-stamp" value="${c.stampDutyPct}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Brokerage %</label><input type="number" step="0.1" id="c-brokerage" value="${c.brokeragePct}" /></div>
        <div class="field"><label>GST %</label><input type="number" step="0.1" id="c-gst" value="${c.gstPct}" /></div>
      </div>
      <div class="field"><label>Other charges (₹, flat)</label><input type="text" inputmode="decimal" id="c-other" value="${c.otherCharges}" placeholder="e.g. 50000, 1L" /></div>
      <div id="cost-results"></div>
      <button class="btn-primary" id="f-save-cost">Save</button>
    `;
    const recompute = () => renderCostResults(d);
    body.querySelector("#c-reg").addEventListener("input", (e) => { c.registrationPct = num(e.target.value); recompute(); });
    body.querySelector("#c-stamp").addEventListener("input", (e) => { c.stampDutyPct = num(e.target.value); recompute(); });
    body.querySelector("#c-brokerage").addEventListener("input", (e) => { c.brokeragePct = num(e.target.value); recompute(); });
    body.querySelector("#c-gst").addEventListener("input", (e) => { c.gstPct = num(e.target.value); recompute(); });
    body.querySelector("#c-other").addEventListener("input", (e) => { c.otherCharges = parsePrice(e.target.value); recompute(); });
    body.querySelector("#f-save-cost").addEventListener("click", async () => { await savePropertyDraft(); });
    recompute();
  }

  if (state.propertyTab === "emi") {
    const e_ = d.emi;
    if (state.openPropertyIsNew && !e_._touched && d.price) e_.loanAmount = Math.round(d.price * 0.8);
    body.innerHTML = `
      <p class="hint">Standard reducing-balance EMI on the loan amount you plan to borrow.</p>
      <div class="field"><label>Loan amount (₹)</label><input type="text" inputmode="decimal" id="e-loan" value="${e_.loanAmount || ""}" placeholder="e.g. 36L, 0.4Cr" /></div>
      <div class="field-row">
        <div class="field"><label>Interest rate % p.a.</label><input type="number" step="0.05" id="e-rate" value="${e_.interestRatePct}" /></div>
        <div class="field"><label>Tenure (years)</label><input type="number" id="e-years" value="${e_.tenureYears}" /></div>
      </div>
      <div id="emi-results"></div>
      <button class="btn-primary" id="f-save-emi">Save</button>
    `;
    const recompute = () => renderEmiResults(d);
    body.querySelector("#e-loan").addEventListener("input", (ev) => { e_.loanAmount = parsePrice(ev.target.value); e_._touched = true; recompute(); });
    body.querySelector("#e-rate").addEventListener("input", (ev) => { e_.interestRatePct = num(ev.target.value); recompute(); });
    body.querySelector("#e-years").addEventListener("input", (ev) => { e_.tenureYears = num(ev.target.value); recompute(); });
    body.querySelector("#f-save-emi").addEventListener("click", async () => { await savePropertyDraft(); });
    recompute();
  }

  if (state.propertyTab === "roi") {
    const r = d.rental;
    body.innerHTML = `
      <p class="hint">Estimate rental yield and total return if you hold the property for a number of years.</p>
      <div class="field"><label>Expected monthly rent (₹)</label><input type="text" inputmode="decimal" id="r-rent" value="${r.monthlyRent || ""}" placeholder="e.g. 25000, 25k" /></div>
      <div class="field-row">
        <div class="field"><label>Annual expenses % of cost</label><input type="number" step="0.1" id="r-exp" value="${r.annualExpensesPct}" /></div>
        <div class="field"><label>Appreciation % p.a.</label><input type="number" step="0.1" id="r-appr" value="${r.appreciationPct}" /></div>
      </div>
      <div class="field"><label>Holding period (years)</label><input type="number" id="r-years" value="${r.holdingYears}" /></div>
      <div id="roi-results"></div>
      <button class="btn-primary" id="f-save-roi">Save</button>
    `;
    const recompute = () => renderRoiResults(d);
    body.querySelector("#r-rent").addEventListener("input", (ev) => { r.monthlyRent = parsePrice(ev.target.value); recompute(); });
    body.querySelector("#r-exp").addEventListener("input", (ev) => { r.annualExpensesPct = num(ev.target.value); recompute(); });
    body.querySelector("#r-appr").addEventListener("input", (ev) => { r.appreciationPct = num(ev.target.value); recompute(); });
    body.querySelector("#r-years").addEventListener("input", (ev) => { r.holdingYears = num(ev.target.value); recompute(); });
    body.querySelector("#f-save-roi").addEventListener("click", async () => { await savePropertyDraft(); });
    recompute();
  }
}

function renderCostResults(d) {
  const r = calcCostBreakdown(d);
  document.getElementById("cost-results").innerHTML = `
    <div class="result-block">
      <div class="result-row"><span>Base price</span><span class="val">${fmtINR(r.base)}</span></div>
      <div class="result-row"><span>Registration</span><span class="val">${fmtINR(r.reg)}</span></div>
      <div class="result-row"><span>Stamp duty</span><span class="val">${fmtINR(r.stamp)}</span></div>
      <div class="result-row"><span>Brokerage</span><span class="val">${fmtINR(r.brokerage)}</span></div>
      <div class="result-row"><span>GST</span><span class="val">${fmtINR(r.gst)}</span></div>
      <div class="result-row"><span>Other charges</span><span class="val">${fmtINR(r.other)}</span></div>
      <div class="result-row total"><span>Total cost</span><span class="val">${fmtINR(r.total)}</span></div>
      <div class="result-row"><span>Cost per sqft</span><span class="val">${d.areaSqft ? fmtINR(r.total / d.areaSqft) : "—"}</span></div>
    </div>
  `;
}
function renderEmiResults(d) {
  const r = calcEMI(d.emi.loanAmount, d.emi.interestRatePct, d.emi.tenureYears);
  document.getElementById("emi-results").innerHTML = `
    <div class="result-block">
      <div class="result-row total"><span>Monthly EMI</span><span class="val">${fmtINR(r.emi)}</span></div>
      <div class="result-row"><span>Total interest</span><span class="val">${fmtINR(r.totalInterest)}</span></div>
      <div class="result-row"><span>Total repayment</span><span class="val">${fmtINR(r.totalPayment)}</span></div>
      <div class="result-row"><span>Number of EMIs</span><span class="val">${r.n}</span></div>
    </div>
  `;
}
function renderRoiResults(d) {
  const cost = calcCostBreakdown(d).total;
  const r = calcRental(cost, d.rental);
  document.getElementById("roi-results").innerHTML = `
    <div class="result-block">
      <div class="result-row"><span>Total cost basis</span><span class="val">${fmtINR(cost)}</span></div>
      <div class="result-row"><span>Annual rent</span><span class="val">${fmtINR(r.annualRent)}</span></div>
      <div class="result-row positive"><span>Gross rental yield</span><span class="val">${fmtPct(r.grossYieldPct)}</span></div>
      <div class="result-row positive"><span>Net rental yield</span><span class="val">${fmtPct(r.netYieldPct)}</span></div>
      <div class="result-row"><span>Projected value (${r.years}y)</span><span class="val">${fmtINR(r.projectedValue)}</span></div>
      <div class="result-row"><span>Capital gain</span><span class="val">${fmtINR(r.capitalGain)}</span></div>
      <div class="result-row total"><span>Total return, ${r.years}y</span><span class="val">${fmtINR(r.totalReturn)}</span></div>
      <div class="result-row positive"><span>Annualised ROI</span><span class="val">${fmtPct(r.annualizedROIPct)}</span></div>
    </div>
  `;
}

/* ---------------- Contacts view ---------------- */
function renderContacts() {
  const list = document.getElementById("contacts-list");
  const empty = document.getElementById("contacts-empty");
  if (state.contacts.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.innerHTML = state.contacts.map((c) => {
    const linked = state.properties.filter((p) => p.contactId === c.id).length;
    return `
      <div class="ledger-row" data-id="${c.id}">
        <div class="ledger-main">
          <p class="ledger-title">${escapeHtml(c.name || "Unnamed")}</p>
          <p class="ledger-sub">${escapeHtml(c.role)}${c.phone ? " · " + escapeHtml(c.phone) : ""}</p>
          ${linked ? `<span class="status-tag status-Viewing">${linked} propert${linked === 1 ? "y" : "ies"}</span>` : ""}
        </div>
      </div>`;
  }).join("");
  list.querySelectorAll(".ledger-row").forEach((row) => {
    row.addEventListener("click", () => openContactOverlay(row.dataset.id));
  });
}

function openContactOverlay(id) {
  if (id) {
    state.openContactId = id;
    state.openContactIsNew = false;
    state.contactDraft = JSON.parse(JSON.stringify(state.contacts.find((x) => x.id === id)));
  } else {
    const fresh = defaultContact();
    state.openContactId = fresh.id;
    state.openContactIsNew = true;
    state.contactDraft = fresh;
  }
  document.getElementById("contact-heading").textContent = state.openContactIsNew ? "New contact" : "Edit contact";
  document.getElementById("contact-delete").classList.toggle("hidden", state.openContactIsNew);
  document.getElementById("overlay-contact").classList.remove("hidden");
  renderContactBody();
}
function closeContactOverlay() {
  document.getElementById("overlay-contact").classList.add("hidden");
  state.openContactId = null;
  state.contactDraft = null;
}
function renderContactBody() {
  const d = state.contactDraft;
  const body = document.getElementById("contact-body");
  body.innerHTML = `
    <div class="field"><label>Name</label><input type="text" id="k-name" value="${escapeHtml(d.name)}" /></div>
    <div class="field">
      <label>Role</label>
      <select id="k-role">${ROLE_LIST.map((r) => `<option ${r === d.role ? "selected" : ""}>${r}</option>`).join("")}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>Phone</label><input type="text" id="k-phone" value="${escapeHtml(d.phone)}" /></div>
      <div class="field"><label>Email</label><input type="text" id="k-email" value="${escapeHtml(d.email)}" /></div>
    </div>
    <div class="field"><label>Notes</label><textarea id="k-notes">${escapeHtml(d.notes)}</textarea></div>
    <button class="btn-primary" id="k-save">Save contact</button>
  `;
  body.querySelector("#k-name").addEventListener("input", (e) => (d.name = e.target.value));
  body.querySelector("#k-role").addEventListener("change", (e) => (d.role = e.target.value));
  body.querySelector("#k-phone").addEventListener("input", (e) => (d.phone = e.target.value));
  body.querySelector("#k-email").addEventListener("input", (e) => (d.email = e.target.value));
  body.querySelector("#k-notes").addEventListener("input", (e) => (d.notes = e.target.value));
  body.querySelector("#k-save").addEventListener("click", async () => {
    if (!d.name.trim()) { toast("Give them a name first"); return; }
    await idbPut("contacts", d);
    await loadAll();
    state.openContactIsNew = false;
    document.getElementById("contact-delete").classList.remove("hidden");
    toast("Saved");
    renderContacts();
  });
}

/* ---------------- Compare view ---------------- */
function renderCompare() {
  const picker = document.getElementById("compare-picker");
  picker.innerHTML = state.properties.map((p) => `
    <button class="compare-chip ${state.compareSelected.has(p.id) ? "active" : ""}" data-id="${p.id}">
      ${escapeHtml(p.title || "Untitled")}
    </button>
  `).join("");
  picker.querySelectorAll(".compare-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.id;
      if (state.compareSelected.has(id)) state.compareSelected.delete(id);
      else {
        if (state.compareSelected.size >= 4) { toast("Pick up to 4 at a time"); return; }
        state.compareSelected.add(id);
      }
      renderCompare();
    });
  });

  const wrap = document.getElementById("compare-table-wrap");
  const selected = state.properties.filter((p) => state.compareSelected.has(p.id));
  if (selected.length === 0) {
    wrap.innerHTML = `<p class="empty-state">Select properties above to compare price, cost, and returns side by side.</p>`;
    return;
  }

  const rows = [
    ["Location", (p) => escapeHtml(p.location || "—")],
    ["Type", (p) => escapeHtml(p.type)],
    ["Status", (p) => escapeHtml(p.status)],
    ["Price", (p) => fmtINR(p.price)],
    ["Price / sqft", (p) => { const v = pricePerSqft(p.price, p.areaSqft); return v ? fmtINR(v) : "—"; }],
    ["Total cost", (p) => fmtINR(calcCostBreakdown(p).total)],
    ["Total cost / sqft", (p) => { const t = calcCostBreakdown(p).total; return p.areaSqft ? fmtINR(t / p.areaSqft) : "—"; }],
    ["Monthly EMI", (p) => { const t = calcCostBreakdown(p).total; const loan = p.emi.loanAmount || Math.round(t * 0.8); return fmtINR(calcEMI(loan, p.emi.interestRatePct, p.emi.tenureYears).emi); }],
    ["Net rental yield", (p) => fmtPct(calcRental(calcCostBreakdown(p).total, p.rental).netYieldPct)],
    ["Annualised ROI", (p) => fmtPct(calcRental(calcCostBreakdown(p).total, p.rental).annualizedROIPct)]
  ];

  wrap.innerHTML = `
    <table class="compare-table">
      <thead><tr><th></th>${selected.map((p) => `<td class="name-cell">${escapeHtml(p.title || "Untitled")}</td>`).join("")}</tr></thead>
      <tbody>
        ${rows.map(([label, fn]) => `<tr><th>${label}</th>${selected.map((p) => `<td>${fn(p)}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

/* ---------------- Quick Calc view ---------------- */
function renderQuickCalc() {
  const q = state.quickCalc;
  const body = document.getElementById("quickcalc-body");
  const unitLabel = q.unit === "cent" ? "Cent" : "Acre";

  body.innerHTML = `
    <div class="toggle-group">
      <button data-unit="cent" class="${q.unit === "cent" ? "active" : ""}">Per Cent</button>
      <button data-unit="acre" class="${q.unit === "acre" ? "active" : ""}">Per Acre</button>
    </div>
    <div class="toggle-group">
      <button data-mode="rate" class="${q.mode === "rate" ? "active" : ""}">Rate → Total</button>
      <button data-mode="total" class="${q.mode === "total" ? "active" : ""}">Total → Rate</button>
    </div>

    <div class="field">
      <label>Area (${unitLabel}s)</label>
      <input type="number" id="qc-area" value="${q.area || ""}" placeholder="0" />
    </div>

    ${q.mode === "rate" ? `
      <div class="field">
        <label>Rate per ${unitLabel} (₹)</label>
        <input type="text" inputmode="decimal" id="qc-rate" value="${q.ratePerUnit || ""}" placeholder="e.g. 50000, 1L" />
      </div>
    ` : `
      <div class="field">
        <label>Total price (₹)</label>
        <input type="text" inputmode="decimal" id="qc-total" value="${q.totalPrice || ""}" placeholder="e.g. 45L, 1.2Cr, 4500000" />
      </div>
    `}

    <div id="qc-results"></div>
  `;

  body.querySelector("#qc-area").addEventListener("input", (e) => { q.area = num(e.target.value); recomputeQuickCalc(); });
  body.querySelectorAll("[data-unit]").forEach((btn) => btn.addEventListener("click", () => { q.unit = btn.dataset.unit; renderQuickCalc(); }));
  body.querySelectorAll("[data-mode]").forEach((btn) => btn.addEventListener("click", () => { q.mode = btn.dataset.mode; renderQuickCalc(); }));
  if (q.mode === "rate") {
    body.querySelector("#qc-rate").addEventListener("input", (e) => { q.ratePerUnit = parsePrice(e.target.value); recomputeQuickCalc(); });
  } else {
    body.querySelector("#qc-total").addEventListener("input", (e) => { q.totalPrice = parsePrice(e.target.value); recomputeQuickCalc(); });
  }
  recomputeQuickCalc();
}

function recomputeQuickCalc() {
  const q = state.quickCalc;
  const results = document.getElementById("qc-results");
  if (!results) return;

  const areaInEnteredUnit = num(q.area);
  const areaCents = q.unit === "cent" ? areaInEnteredUnit : areaInEnteredUnit * CENTS_PER_ACRE;
  const areaAcres = areaCents / CENTS_PER_ACRE;
  const areaSqft = areaCents * SQFT_PER_CENT;

  let ratePerCent, ratePerAcre, total;
  if (q.mode === "rate") {
    const rate = num(q.ratePerUnit);
    ratePerCent = q.unit === "cent" ? rate : rate / CENTS_PER_ACRE;
    ratePerAcre = ratePerCent * CENTS_PER_ACRE;
    total = ratePerCent * areaCents;
  } else {
    total = num(q.totalPrice);
    ratePerCent = areaCents > 0 ? total / areaCents : null;
    ratePerAcre = ratePerCent !== null ? ratePerCent * CENTS_PER_ACRE : null;
  }

  results.innerHTML = `
    <div class="result-block">
      <div class="result-row">
        <span>Area entered</span>
        <span class="val">${fmtNum(areaAcres, 3)} Acres<span class="sub">= ${fmtNum(areaCents, 2)} Cents · ${fmtNum(areaSqft, 0)} sqft</span></span>
      </div>
      <div class="result-row">
        <span>Rate per Cent</span>
        <span class="val">${ratePerCent === null ? "—" : fmtINR(ratePerCent)}</span>
      </div>
      <div class="result-row">
        <span>Rate per Acre</span>
        <span class="val">${ratePerAcre === null ? "—" : fmtINR(ratePerAcre)}</span>
      </div>
      <div class="result-row total">
        <span>Total price</span>
        <span class="val">${fmtINR(total)}<span class="sub">${fmtLakhCrore(total)}</span></span>
      </div>
    </div>
  `;
}

/* ---------------- Wiring ---------------- */
function wireStatic() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  document.getElementById("btn-add-property").addEventListener("click", () => openPropertyOverlay(null));
  document.getElementById("prop-close").addEventListener("click", () => { closePropertyOverlay(); renderRegister(); });
  document.getElementById("prop-delete").addEventListener("click", async () => {
    if (!confirm("Delete this property?")) return;
    await idbDelete("properties", state.openPropertyId);
    await loadAll();
    closePropertyOverlay();
    renderRegister();
    toast("Deleted");
  });
  document.querySelectorAll("#prop-tabs .sheet-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.propertyTab = btn.dataset.tab;
      renderPropertyTabs();
      renderPropertyBody();
    });
  });

  document.getElementById("btn-add-contact").addEventListener("click", () => openContactOverlay(null));
  document.getElementById("contact-close").addEventListener("click", () => { closeContactOverlay(); renderContacts(); });
  document.getElementById("contact-delete").addEventListener("click", async () => {
    if (!confirm("Delete this contact?")) return;
    await idbDelete("contacts", state.openContactId);
    await loadAll();
    closeContactOverlay();
    renderContacts();
    toast("Deleted");
  });
}

/* ---------------- Init ---------------- */
async function init() {
  wireStatic();
  await loadAll();
  renderFilterChips();
  renderRegister();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
