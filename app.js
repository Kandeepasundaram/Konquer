/* ---------------- IndexedDB layer ---------------- */
const DB_NAME = "PropertyRegisterDB";
const DB_VERSION = 2;
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
      if (!db.objectStoreNames.contains("sharedImports")) {
        db.createObjectStore("sharedImports", { keyPath: "id" });
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
async function idbGet(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
function loadSettings() {
  try {
    return Object.assign({ currencyMode: "inr", budgetMonthly: 0 }, JSON.parse(localStorage.getItem("prSettings") || "{}"));
  } catch (e) {
    return { currencyMode: "inr", budgetMonthly: 0 };
  }
}
function saveSettings() {
  localStorage.setItem("prSettings", JSON.stringify(settings));
}
const settings = loadSettings();

function fmtINR(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const rounded = Math.round(n);
  if (settings.currencyMode === "plain") return rounded.toLocaleString("en-IN");
  return "₹" + rounded.toLocaleString("en-IN");
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

/* ---------------- Share helpers ---------------- */
async function shareText(text, title) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { return; }
  }
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  catch (e) { toast("Could not share"); }
}
function buildPropertyShareText(d) {
  const cost = calcCostBreakdown(d);
  const loan = d.emi.loanAmount || Math.round(cost.total * 0.8);
  const emi = calcEMI(loan, d.emi.interestRatePct, d.emi.tenureYears);
  const roi = calcRental(cost.total, d.rental);
  return [
    d.title || "Untitled property",
    d.location || "",
    `Price: ${fmtINR(d.price)}`,
    `Total cost: ${fmtINR(cost.total)}`,
    `EMI: ${fmtINR(emi.emi)}/mo`,
    `Net rental yield: ${fmtPct(roi.netYieldPct)}`,
    `Annualised ROI: ${fmtPct(roi.annualizedROIPct)}`
  ].join("\n");
}
function buildCompareShareText(selected) {
  const lines = ["Property comparison:"];
  selected.forEach((p) => {
    const cost = calcCostBreakdown(p);
    const loan = p.emi.loanAmount || Math.round(cost.total * 0.8);
    const emi = calcEMI(loan, p.emi.interestRatePct, p.emi.tenureYears);
    lines.push(`\n${p.title || "Untitled"} — ${fmtINR(p.price)}, total ${fmtINR(cost.total)}, EMI ${fmtINR(emi.emi)}/mo`);
  });
  return lines.join("\n");
}

/* ---------------- Domain defaults ---------------- */
const AMENITY_LIST = ["Parking", "Lift", "Power backup", "Water supply", "Security", "Gym", "Clubhouse", "Park"];
const DEFAULT_CHECKLIST_LABELS = [
  "Title deed verified",
  "Encumbrance certificate (EC) checked",
  "Property tax paid up to date",
  "Building approval / patta verified",
  "Loan pre-approval done",
  "Site visit completed"
];

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
    tags: [],
    pinned: false,
    archived: false,
    detail: { bhk: "", floor: "", facing: "", ageYears: "" },
    amenities: [],
    mapLink: "",
    followUp: { date: "", note: "" },
    cost: { registrationPct: 1, stampDutyPct: 7, brokeragePct: 1, gstPct: 0, otherCharges: 0 },
    emi: { loanAmount: 0, interestRatePct: 8.5, tenureYears: 20, extraMonthly: 0, extraOneTime: 0 },
    loanScenarios: [],
    rental: { monthlyRent: 0, annualExpensesPct: 1, appreciationPct: 6, holdingYears: 5 },
    visits: [],
    checklist: DEFAULT_CHECKLIST_LABELS.map((label) => ({ id: uid(), label, checked: false })),
    priceHistory: [],
    createdAt: now,
    updatedAt: now
  };
}
function defaultContact() {
  const now = Date.now();
  return { id: uid(), name: "", role: "Broker", phone: "", email: "", notes: "", createdAt: now };
}
/* Fills in fields missing on properties saved before a schema addition. */
function ensurePropertyShape(p) {
  const d = defaultProperty();
  p.tags = Array.isArray(p.tags) ? p.tags : [];
  p.pinned = !!p.pinned;
  p.archived = !!p.archived;
  p.detail = Object.assign({}, d.detail, p.detail || {});
  p.amenities = Array.isArray(p.amenities) ? p.amenities : [];
  p.mapLink = p.mapLink || "";
  p.followUp = Object.assign({}, d.followUp, p.followUp || {});
  p.cost = Object.assign({}, d.cost, p.cost || {});
  p.emi = Object.assign({}, d.emi, p.emi || {});
  p.loanScenarios = Array.isArray(p.loanScenarios) ? p.loanScenarios : [];
  p.rental = Object.assign({}, d.rental, p.rental || {});
  p.visits = Array.isArray(p.visits) ? p.visits : [];
  p.checklist = Array.isArray(p.checklist) ? p.checklist : d.checklist;
  p.priceHistory = Array.isArray(p.priceHistory) ? p.priceHistory : [];
  return p;
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
/* Simulates fixed-EMI amortisation with extra monthly/one-time payments applied. */
function calcPrepayment(loanAmount, annualRatePct, years, extraMonthly, extraOneTime) {
  const P0 = num(loanAmount);
  const r = num(annualRatePct) / 100 / 12;
  const nOriginal = Math.max(1, Math.round(num(years) * 12));
  const base = calcEMI(P0, annualRatePct, years);
  const emi = base.emi;
  let balance = P0 - num(extraOneTime);
  if (balance <= 0) return { valid: true, months: 0, totalInterest: 0, interestSaved: base.totalInterest, baselineMonths: nOriginal };
  let totalPaid = num(extraOneTime);
  let months = 0;
  const cap = Math.max(nOriginal * 2, 1200);
  while (balance > 0.5 && months < cap) {
    const interest = balance * r;
    const principalPortion = emi - interest;
    if (principalPortion <= 0) return { valid: false };
    let payment = emi + num(extraMonthly);
    if (payment > balance + interest) payment = balance + interest;
    balance -= (payment - interest);
    totalPaid += payment;
    months++;
  }
  if (months >= cap) return { valid: false };
  const totalInterest = totalPaid - P0;
  return { valid: true, months, totalInterest, interestSaved: base.totalInterest - totalInterest, baselineMonths: nOriginal };
}
/* Rough rent-vs-buy comparison over a holding horizon; a scratch-pad estimate, not financial advice. */
function calcRentVsBuy(r) {
  const price = num(r.price);
  const downPayment = price * num(r.downPct) / 100;
  const loanAmount = price - downPayment;
  const emiRes = calcEMI(loanAmount, r.ratePct, r.years);
  const horizon = Math.max(0, num(r.horizonYears));
  const buyMonths = Math.min(horizon * 12, Math.round(num(r.years) * 12));
  const emiOutlay = emiRes.emi * buyMonths;
  const maintenanceOutlay = price * num(r.maintPct) / 100 * horizon;
  const totalBuyOutlay = downPayment + emiOutlay + maintenanceOutlay;

  let rentOutlay = 0;
  let rent = num(r.rent) * 12;
  for (let y = 0; y < horizon; y++) {
    rentOutlay += rent;
    rent *= 1 + num(r.rentApprPct) / 100;
  }

  const projectedValue = price * Math.pow(1 + num(r.apprPct) / 100, horizon);
  const diff = totalBuyOutlay - rentOutlay;
  return { downPayment, loanAmount, emi: emiRes.emi, totalBuyOutlay, rentOutlay, projectedValue, diff, horizon };
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
  quickCalc: { unit: "cent", mode: "rate", area: 0, ratePerUnit: 0, totalPrice: 0 },
  qcTool: "land",
  rentVsBuy: { price: 0, downPct: 20, ratePct: 8.5, years: 20, rent: 0, rentApprPct: 5, maintPct: 1, apprPct: 6, horizonYears: 10 },
  registerSearch: "",
  registerSort: "updated",
  showArchived: false,
  selectMode: false,
  selectedIds: new Set(),
  importActive: false,
  importPreviewUrl: null,
  importStatus: ""
};

const STATUS_LIST = ["All", "Interested", "Viewing", "Negotiating", "Purchased", "Dropped"];
const TYPE_LIST = ["Apartment", "Villa", "Land", "Commercial", "Other"];
const ROLE_LIST = ["Broker", "Owner", "Agent", "Builder", "Other"];

/* ---------------- Data load ---------------- */
async function loadAll() {
  state.properties = (await idbGetAll("properties")).map(ensurePropertyShape);
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
  if (view === "quickcalc") { renderQuickCalc(); renderRentVsBuy(); }
  if (view === "settings") renderSettings();
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

function getFilteredSortedProperties() {
  let items = state.properties;
  if (!state.showArchived) items = items.filter((p) => !p.archived);
  if (state.statusFilter !== "All") items = items.filter((p) => p.status === state.statusFilter);
  const q = state.registerSearch.trim().toLowerCase();
  if (q) {
    items = items.filter((p) => {
      const hay = [p.title, p.location, p.notes, ...(p.tags || [])].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }
  const cmp = {
    "updated": (a, b) => b.updatedAt - a.updatedAt,
    "price-desc": (a, b) => num(b.price) - num(a.price),
    "price-asc": (a, b) => num(a.price) - num(b.price),
    "pps-desc": (a, b) => (pricePerSqft(b.price, b.areaSqft) || 0) - (pricePerSqft(a.price, a.areaSqft) || 0),
    "pps-asc": (a, b) => (pricePerSqft(a.price, a.areaSqft) || 0) - (pricePerSqft(b.price, b.areaSqft) || 0),
    "status": (a, b) => a.status.localeCompare(b.status)
  }[state.registerSort] || (() => 0);
  items = items.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || cmp(a, b));
  return items;
}

function renderFollowUps() {
  const wrap = document.getElementById("reg-followups");
  const today = todayISO();
  const due = state.properties
    .filter((p) => !p.archived && p.followUp && p.followUp.date && p.followUp.date <= today)
    .sort((a, b) => a.followUp.date.localeCompare(b.followUp.date));
  if (due.length === 0) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = `
    <div class="followup-banner">
      <p class="followup-banner-title">Follow-ups due (${due.length})</p>
      ${due.map((p) => `
        <div class="followup-item" data-id="${p.id}">
          <span>${escapeHtml(p.title || "Untitled property")}${p.followUp.note ? " — " + escapeHtml(p.followUp.note) : ""}</span>
          <span class="date">${p.followUp.date}</span>
        </div>`).join("")}
    </div>`;
  wrap.querySelectorAll(".followup-item").forEach((row) => {
    row.addEventListener("click", () => openPropertyOverlay(row.dataset.id));
  });
}

function renderBulkBar() {
  const bar = document.getElementById("reg-bulkbar");
  if (!state.selectMode || state.selectedIds.size === 0) { bar.classList.add("hidden"); bar.innerHTML = ""; return; }
  bar.classList.remove("hidden");
  bar.innerHTML = `
    <span class="count">${state.selectedIds.size} selected</span>
    <select id="bulk-status">
      <option value="">Set status…</option>
      ${STATUS_LIST.filter((s) => s !== "All").map((s) => `<option value="${s}">${s}</option>`).join("")}
    </select>
    <button id="bulk-archive">Archive</button>
    <button id="bulk-delete" class="danger">Delete</button>
  `;
  bar.querySelector("#bulk-status").addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await doBulkAction("status", e.target.value);
  });
  bar.querySelector("#bulk-archive").addEventListener("click", () => doBulkAction("archive"));
  bar.querySelector("#bulk-delete").addEventListener("click", () => doBulkAction("delete"));
}

async function doBulkAction(type, value) {
  const ids = Array.from(state.selectedIds);
  if (type === "delete" && !confirm(`Delete ${ids.length} propert${ids.length === 1 ? "y" : "ies"}?`)) return;
  for (const id of ids) {
    if (type === "delete") { await idbDelete("properties", id); continue; }
    const p = state.properties.find((x) => x.id === id);
    if (!p) continue;
    if (type === "status") p.status = value;
    if (type === "archive") p.archived = true;
    p.updatedAt = Date.now();
    await idbPut("properties", p);
  }
  state.selectedIds.clear();
  state.selectMode = false;
  await loadAll();
  renderRegister();
  toast("Done");
}

function renderRegister() {
  const list = document.getElementById("register-list");
  const empty = document.getElementById("register-empty");
  renderFollowUps();
  renderBulkBar();
  document.getElementById("reg-select-btn").textContent = state.selectMode ? "Cancel" : "Select";

  const items = getFilteredSortedProperties();

  if (items.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = items.map((p, i) => {
    const pps = pricePerSqft(p.price, p.areaSqft);
    return `
      <div class="ledger-row ${state.selectMode ? "selectable" : ""}" data-id="${p.id}" style="--i:${i}">
        ${state.selectMode ? `<input type="checkbox" class="ledger-checkbox" ${state.selectedIds.has(p.id) ? "checked" : ""} />` : ""}
        <div class="ledger-main">
          <p class="ledger-title">${p.pinned ? '<span class="pin-mark">★</span>' : ""}${escapeHtml(p.title || "Untitled property")}${p.archived ? '<span class="archived-mark">Archived</span>' : ""}</p>
          <p class="ledger-sub">${escapeHtml(p.location || "—")} · ${escapeHtml(p.type)}</p>
          <span class="status-tag status-${p.status}">${p.status}</span>
          ${p.tags && p.tags.length ? `<div class="tag-row">${p.tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        </div>
        <div class="ledger-figures">
          <div class="ledger-price">${fmtINR(p.price)}</div>
          <div class="ledger-per-sqft">${pps ? fmtINR(pps) + "/sqft" : "—"}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".ledger-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      const id = row.dataset.id;
      if (state.selectMode) {
        if (state.selectedIds.has(id)) state.selectedIds.delete(id);
        else state.selectedIds.add(id);
        renderRegister();
        return;
      }
      openPropertyOverlay(id);
    });
  });
}

function wireRegisterControls() {
  document.getElementById("reg-search").addEventListener("input", (e) => {
    state.registerSearch = e.target.value;
    renderRegister();
  });
  document.getElementById("reg-sort").addEventListener("change", (e) => {
    state.registerSort = e.target.value;
    renderRegister();
  });
  document.getElementById("reg-archived").addEventListener("change", (e) => {
    state.showArchived = e.target.checked;
    renderRegister();
  });
  document.getElementById("reg-select-btn").addEventListener("click", () => {
    state.selectMode = !state.selectMode;
    if (!state.selectMode) state.selectedIds.clear();
    renderRegister();
  });
}

/* ---------------- Property overlay ---------------- */
function openPropertyOverlay(id) {
  resetImportState();
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
  resetImportState();
}
function resetImportState() {
  if (state.importPreviewUrl) URL.revokeObjectURL(state.importPreviewUrl);
  state.importActive = false;
  state.importPreviewUrl = null;
  state.importStatus = "";
}
function renderPropertyTabs() {
  document.getElementById("prop-heading").textContent = state.importActive ? "Import from video" : (state.openPropertyIsNew ? "New property" : "Edit property");
  document.querySelectorAll("#prop-tabs .sheet-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.propertyTab);
  });
}

async function savePropertyDraft(showToast = true) {
  const d = state.propertyDraft;
  d.updatedAt = Date.now();
  const lastPrice = d.priceHistory.length ? d.priceHistory[d.priceHistory.length - 1].price : null;
  if (lastPrice !== d.price) d.priceHistory.push({ date: todayISO(), price: d.price });
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
      ${state.importActive ? `
        <div class="import-banner">
          <video src="${state.importPreviewUrl}" controls playsinline muted style="width:100%;border-radius:8px;max-height:220px;object-fit:cover;"></video>
          <p class="import-banner-status">${escapeHtml(state.importStatus)}</p>
          <p class="import-banner-note">Imported from a shared video — extraction is best-effort. Check every field before saving.</p>
        </div>
      ` : ""}
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
      <div class="field-row">
        <div class="field"><label>BHK</label><input type="text" id="f-bhk" value="${escapeHtml(d.detail.bhk)}" placeholder="e.g. 3" /></div>
        <div class="field"><label>Floor</label><input type="text" id="f-floor" value="${escapeHtml(d.detail.floor)}" placeholder="e.g. 4 of 8" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Facing</label><input type="text" id="f-facing" value="${escapeHtml(d.detail.facing)}" placeholder="e.g. East" /></div>
        <div class="field"><label>Age (years)</label><input type="text" id="f-age" value="${escapeHtml(d.detail.ageYears)}" placeholder="e.g. 5" /></div>
      </div>
      <div class="field">
        <label>Amenities</label>
        <div class="chip-row" id="f-amenities" style="overflow-x:visible;flex-wrap:wrap;">
          ${AMENITY_LIST.map((a) => `<button type="button" class="chip ${d.amenities.includes(a) ? "active" : ""}" data-amenity="${escapeHtml(a)}">${a}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>Tags (comma separated)</label>
        <input type="text" id="f-tags" value="${escapeHtml((d.tags || []).join(", "))}" placeholder="e.g. corner plot, near school" />
      </div>
      <div class="field">
        <label>Map link</label>
        <input type="text" id="f-maplink" value="${escapeHtml(d.mapLink)}" placeholder="Paste a Google Maps URL" />
        ${d.mapLink ? `<div class="action-links"><a href="${escapeHtml(d.mapLink)}" target="_blank" rel="noopener">Open in Maps</a></div>` : ""}
      </div>
      <div class="field-row">
        <div class="field"><label>Follow-up date</label><input type="date" id="f-followup-date" value="${d.followUp.date || ""}" /></div>
        <div class="field"><label>Follow-up note</label><input type="text" id="f-followup-note" value="${escapeHtml(d.followUp.note)}" placeholder="e.g. Call broker" /></div>
      </div>
      <div class="field-row">
        <label class="checkbox-inline"><input type="checkbox" id="f-pinned" ${d.pinned ? "checked" : ""} /> Pinned</label>
        <label class="checkbox-inline"><input type="checkbox" id="f-archived" ${d.archived ? "checked" : ""} /> Archived</label>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="f-notes" placeholder="Anything worth remembering">${escapeHtml(d.notes)}</textarea>
      </div>
      <button class="btn-primary" id="f-save">Save property</button>
      ${!state.openPropertyIsNew ? `
        <button class="btn-secondary" id="f-share">Share property</button>
        <button class="btn-secondary" id="f-duplicate">Duplicate property</button>
      ` : ""}
    `;
    body.querySelector("#f-title").addEventListener("input", (e) => (d.title = e.target.value));
    body.querySelector("#f-location").addEventListener("input", (e) => (d.location = e.target.value));
    body.querySelector("#f-type").addEventListener("change", (e) => (d.type = e.target.value));
    body.querySelector("#f-status").addEventListener("change", (e) => (d.status = e.target.value));
    body.querySelector("#f-price").addEventListener("input", (e) => (d.price = parsePrice(e.target.value)));
    body.querySelector("#f-area").addEventListener("input", (e) => (d.areaSqft = num(e.target.value)));
    body.querySelector("#f-contact").addEventListener("change", (e) => (d.contactId = e.target.value));
    body.querySelector("#f-bhk").addEventListener("input", (e) => (d.detail.bhk = e.target.value));
    body.querySelector("#f-floor").addEventListener("input", (e) => (d.detail.floor = e.target.value));
    body.querySelector("#f-facing").addEventListener("input", (e) => (d.detail.facing = e.target.value));
    body.querySelector("#f-age").addEventListener("input", (e) => (d.detail.ageYears = e.target.value));
    body.querySelectorAll("#f-amenities .chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const a = chip.dataset.amenity;
        const idx = d.amenities.indexOf(a);
        if (idx >= 0) d.amenities.splice(idx, 1); else d.amenities.push(a);
        chip.classList.toggle("active");
      });
    });
    body.querySelector("#f-tags").addEventListener("input", (e) => {
      d.tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
    });
    body.querySelector("#f-maplink").addEventListener("input", (e) => (d.mapLink = e.target.value));
    body.querySelector("#f-followup-date").addEventListener("input", (e) => (d.followUp.date = e.target.value));
    body.querySelector("#f-followup-note").addEventListener("input", (e) => (d.followUp.note = e.target.value));
    body.querySelector("#f-pinned").addEventListener("change", (e) => (d.pinned = e.target.checked));
    body.querySelector("#f-archived").addEventListener("change", (e) => (d.archived = e.target.checked));
    body.querySelector("#f-notes").addEventListener("input", (e) => (d.notes = e.target.value));
    body.querySelector("#f-save").addEventListener("click", async () => {
      if (!d.title.trim()) { toast("Give it a title first"); return; }
      await savePropertyDraft();
      renderRegister();
    });
    const shareBtn = body.querySelector("#f-share");
    if (shareBtn) shareBtn.addEventListener("click", () => shareText(buildPropertyShareText(d), d.title || "Property"));
    const dupBtn = body.querySelector("#f-duplicate");
    if (dupBtn) dupBtn.addEventListener("click", async () => {
      const clone = JSON.parse(JSON.stringify(d));
      clone.id = uid();
      clone.title = (d.title || "Untitled") + " (copy)";
      clone.createdAt = clone.updatedAt = Date.now();
      clone.priceHistory = [];
      await idbPut("properties", clone);
      await loadAll();
      toast("Duplicated");
      openPropertyOverlay(clone.id);
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
      ${d.priceHistory.length > 1 ? `
        <div class="section-head" style="padding-top:14px;"><h2 style="font-size:14px;">Price history</h2></div>
        <div class="result-block">
          ${d.priceHistory.slice().reverse().map((h) => `<div class="result-row"><span>${h.date}</span><span class="val">${fmtINR(h.price)}</span></div>`).join("")}
        </div>
      ` : ""}
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

      <div class="section-head" style="padding-top:18px;"><h2 style="font-size:14px;">Prepayment impact</h2></div>
      <p class="hint">See how paying extra shortens the loan.</p>
      <div class="field-row">
        <div class="field"><label>Extra monthly (₹)</label><input type="text" inputmode="decimal" id="e-extra-monthly" value="${e_.extraMonthly || ""}" placeholder="e.g. 5000" /></div>
        <div class="field"><label>Extra one-time now (₹)</label><input type="text" inputmode="decimal" id="e-extra-lump" value="${e_.extraOneTime || ""}" placeholder="e.g. 1L" /></div>
      </div>
      <div id="prepay-results"></div>

      <div class="section-head" style="padding-top:18px;"><h2 style="font-size:14px;">Compare loan scenarios</h2></div>
      <p class="hint">Line up different lenders/offers for this property.</p>
      <div id="scenario-list"></div>
      <div class="field-row">
        <div class="field"><label>Name</label><input type="text" id="ls-name" placeholder="e.g. SBI" /></div>
        <div class="field"><label>Loan (₹)</label><input type="text" inputmode="decimal" id="ls-loan" placeholder="e.g. 36L" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Rate %</label><input type="number" step="0.05" id="ls-rate" placeholder="8.5" /></div>
        <div class="field"><label>Years</label><input type="number" id="ls-years" placeholder="20" /></div>
      </div>
      <button class="btn-secondary" id="ls-add">Add scenario</button>
    `;
    const recompute = () => { renderEmiResults(d); renderPrepayResults(d); renderScenarioList(d); };
    body.querySelector("#e-loan").addEventListener("input", (ev) => { e_.loanAmount = parsePrice(ev.target.value); e_._touched = true; recompute(); });
    body.querySelector("#e-rate").addEventListener("input", (ev) => { e_.interestRatePct = num(ev.target.value); recompute(); });
    body.querySelector("#e-years").addEventListener("input", (ev) => { e_.tenureYears = num(ev.target.value); recompute(); });
    body.querySelector("#e-extra-monthly").addEventListener("input", (ev) => { e_.extraMonthly = parsePrice(ev.target.value); renderPrepayResults(d); });
    body.querySelector("#e-extra-lump").addEventListener("input", (ev) => { e_.extraOneTime = parsePrice(ev.target.value); renderPrepayResults(d); });
    body.querySelector("#f-save-emi").addEventListener("click", async () => { await savePropertyDraft(); });
    body.querySelector("#ls-add").addEventListener("click", async () => {
      const name = body.querySelector("#ls-name").value.trim();
      if (!name) { toast("Give the scenario a name"); return; }
      d.loanScenarios.push({
        id: uid(),
        name,
        loanAmount: parsePrice(body.querySelector("#ls-loan").value),
        interestRatePct: num(body.querySelector("#ls-rate").value, 8.5),
        tenureYears: num(body.querySelector("#ls-years").value, 20)
      });
      await savePropertyDraft(false);
      renderPropertyBody();
    });
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

  if (state.propertyTab === "checklist") {
    body.innerHTML = `
      <div id="checklist-items"></div>
      <div class="field-row">
        <div class="field"><input type="text" id="cl-new" placeholder="Add a checklist item" /></div>
      </div>
      <button class="btn-secondary" id="cl-add">Add item</button>
    `;
    const renderItems = () => {
      const wrap = body.querySelector("#checklist-items");
      wrap.innerHTML = d.checklist.map((item) => `
        <div class="checklist-item ${item.checked ? "checked" : ""}" data-id="${item.id}">
          <input type="checkbox" ${item.checked ? "checked" : ""} />
          <label>${escapeHtml(item.label)}</label>
          <button class="row-remove" data-remove="${item.id}">&times;</button>
        </div>`).join("") || `<p class="hint">No checklist items yet.</p>`;
      wrap.querySelectorAll(".checklist-item input[type=checkbox]").forEach((cb) => {
        cb.addEventListener("change", async () => {
          const id = cb.closest(".checklist-item").dataset.id;
          d.checklist.find((i) => i.id === id).checked = cb.checked;
          await savePropertyDraft(false);
          renderItems();
        });
      });
      wrap.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          d.checklist = d.checklist.filter((i) => i.id !== btn.dataset.remove);
          await savePropertyDraft(false);
          renderItems();
        });
      });
    };
    body.querySelector("#cl-add").addEventListener("click", async () => {
      const input = body.querySelector("#cl-new");
      const label = input.value.trim();
      if (!label) return;
      d.checklist.push({ id: uid(), label, checked: false });
      input.value = "";
      await savePropertyDraft(false);
      renderItems();
    });
    renderItems();
  }

  if (state.propertyTab === "visits") {
    body.innerHTML = `
      <div id="visit-list"></div>
      <div class="field"><label>Date</label><input type="date" id="v-date" value="${todayISO()}" /></div>
      <div class="field"><label>Note</label><textarea id="v-note" placeholder="What did you notice?"></textarea></div>
      <button class="btn-secondary" id="v-add">Log visit</button>
    `;
    const renderVisits = () => {
      const wrap = body.querySelector("#visit-list");
      const sorted = d.visits.slice().sort((a, b) => b.date.localeCompare(a.date));
      wrap.innerHTML = sorted.map((v) => `
        <div class="visit-entry" data-id="${v.id}">
          <div class="visit-entry-head"><span>${v.date}</span><button class="row-remove" data-remove="${v.id}">&times;</button></div>
          <p>${escapeHtml(v.note || "—")}</p>
        </div>`).join("") || `<p class="hint">No visits logged yet.</p>`;
      wrap.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          d.visits = d.visits.filter((v) => v.id !== btn.dataset.remove);
          await savePropertyDraft(false);
          renderVisits();
        });
      });
    };
    body.querySelector("#v-add").addEventListener("click", async () => {
      const date = body.querySelector("#v-date").value || todayISO();
      const note = body.querySelector("#v-note").value.trim();
      d.visits.push({ id: uid(), date, note });
      await savePropertyDraft(false);
      renderPropertyBody();
    });
    renderVisits();
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
  const budgetRow = settings.budgetMonthly > 0
    ? `<div class="result-row ${r.emi <= settings.budgetMonthly ? "positive" : ""}"><span>Within budget (${fmtINR(settings.budgetMonthly)}/mo)?</span><span class="val">${r.emi <= settings.budgetMonthly ? "Yes" : "No"}</span></div>`
    : "";
  document.getElementById("emi-results").innerHTML = `
    <div class="result-block">
      <div class="result-row total"><span>Monthly EMI</span><span class="val">${fmtINR(r.emi)}</span></div>
      <div class="result-row"><span>Total interest</span><span class="val">${fmtINR(r.totalInterest)}</span></div>
      <div class="result-row"><span>Total repayment</span><span class="val">${fmtINR(r.totalPayment)}</span></div>
      <div class="result-row"><span>Number of EMIs</span><span class="val">${r.n}</span></div>
      ${budgetRow}
    </div>
  `;
}
function renderPrepayResults(d) {
  const el = document.getElementById("prepay-results");
  if (!el) return;
  const e_ = d.emi;
  if (!num(e_.extraMonthly) && !num(e_.extraOneTime)) {
    el.innerHTML = `<p class="hint">Add an extra payment above to see the impact.</p>`;
    return;
  }
  const res = calcPrepayment(e_.loanAmount, e_.interestRatePct, e_.tenureYears, e_.extraMonthly, e_.extraOneTime);
  if (!res.valid) {
    el.innerHTML = `<p class="hint">Extra payment too small relative to interest — can't project a payoff.</p>`;
    return;
  }
  const years = Math.floor(res.months / 12);
  const months = res.months % 12;
  el.innerHTML = `
    <div class="result-block">
      <div class="result-row total"><span>New payoff time</span><span class="val">${years}y ${months}m</span></div>
      <div class="result-row positive"><span>Interest saved</span><span class="val">${fmtINR(res.interestSaved)}</span></div>
      <div class="result-row"><span>Original tenure</span><span class="val">${Math.floor(res.baselineMonths / 12)}y ${res.baselineMonths % 12}m</span></div>
    </div>
  `;
}
function renderScenarioList(d) {
  const el = document.getElementById("scenario-list");
  if (!el) return;
  if (d.loanScenarios.length === 0) { el.innerHTML = `<p class="hint">No scenarios added yet.</p>`; return; }
  el.innerHTML = d.loanScenarios.map((s) => {
    const r = calcEMI(s.loanAmount, s.interestRatePct, s.tenureYears);
    return `
      <div class="scenario-row" data-id="${s.id}">
        <span>${escapeHtml(s.name)} <span class="hint" style="margin:0;">${fmtINR(s.loanAmount)} · ${s.interestRatePct}% · ${s.tenureYears}y</span></span>
        <span class="val">${fmtINR(r.emi)}/mo <button class="row-remove" data-remove="${s.id}">&times;</button></span>
      </div>`;
  }).join("");
  el.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      d.loanScenarios = d.loanScenarios.filter((s) => s.id !== btn.dataset.remove);
      await savePropertyDraft(false);
      renderPropertyBody();
    });
  });
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
  list.innerHTML = state.contacts.map((c, i) => {
    const linked = state.properties.filter((p) => p.contactId === c.id).length;
    return `
      <div class="ledger-row" data-id="${c.id}" style="--i:${i}">
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
    ${(d.phone || d.email) ? `
      <div class="action-links">
        ${d.phone ? `<a href="tel:${escapeHtml(d.phone)}">Call</a>` : ""}
        ${d.phone ? `<a href="https://wa.me/${escapeHtml(d.phone.replace(/[^\d]/g, ""))}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
        ${d.email ? `<a href="mailto:${escapeHtml(d.email)}">Email</a>` : ""}
      </div>
    ` : ""}
    <div class="field"><label>Notes</label><textarea id="k-notes">${escapeHtml(d.notes)}</textarea></div>
    <button class="btn-primary" id="k-save">Save contact</button>
    ${!state.openContactIsNew ? renderLinkedPropertiesBlock(d.id) : ""}
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
  body.querySelectorAll(".linked-prop-row").forEach((row) => {
    row.addEventListener("click", () => {
      closeContactOverlay();
      openPropertyOverlay(row.dataset.id);
    });
  });
}
function renderLinkedPropertiesBlock(contactId) {
  const linked = state.properties.filter((p) => p.contactId === contactId);
  if (linked.length === 0) return "";
  return `
    <div class="section-head" style="padding-top:18px;"><h2 style="font-size:14px;">Linked properties</h2></div>
    ${linked.map((p) => `<div class="linked-prop-row" data-id="${p.id}">${escapeHtml(p.title || "Untitled property")} — ${fmtINR(p.price)}</div>`).join("")}
  `;
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
  const shareBtn = document.getElementById("btn-share-compare");
  const selected = state.properties.filter((p) => state.compareSelected.has(p.id));
  if (selected.length === 0) {
    wrap.innerHTML = `<p class="empty-state">Select properties above to compare price, cost, and returns side by side.</p>`;
    shareBtn.classList.add("hidden");
    return;
  }
  shareBtn.classList.remove("hidden");
  shareBtn.onclick = () => shareText(buildCompareShareText(selected), "Property comparison");

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
  if (settings.budgetMonthly > 0) {
    rows.push(["Within budget?", (p) => {
      const t = calcCostBreakdown(p).total;
      const loan = p.emi.loanAmount || Math.round(t * 0.8);
      const emi = calcEMI(loan, p.emi.interestRatePct, p.emi.tenureYears).emi;
      return emi <= settings.budgetMonthly ? "Yes" : "No";
    }]);
  }

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

function renderRentVsBuy() {
  const rvb = state.rentVsBuy;
  const body = document.getElementById("rentvsbuy-body");
  body.innerHTML = `
    <div class="field-row">
      <div class="field"><label>Property price (₹)</label><input type="text" inputmode="decimal" id="rvb-price" value="${rvb.price || ""}" placeholder="e.g. 60L" /></div>
      <div class="field"><label>Down payment %</label><input type="number" id="rvb-down" value="${rvb.downPct}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Loan rate % p.a.</label><input type="number" step="0.05" id="rvb-rate" value="${rvb.ratePct}" /></div>
      <div class="field"><label>Loan tenure (years)</label><input type="number" id="rvb-years" value="${rvb.years}" /></div>
    </div>
    <div class="field"><label>Equivalent monthly rent (₹)</label><input type="text" inputmode="decimal" id="rvb-rent" value="${rvb.rent || ""}" placeholder="e.g. 20000" /></div>
    <div class="field-row">
      <div class="field"><label>Rent increase % p.a.</label><input type="number" step="0.1" id="rvb-rentappr" value="${rvb.rentApprPct}" /></div>
      <div class="field"><label>Maintenance % of price p.a.</label><input type="number" step="0.1" id="rvb-maint" value="${rvb.maintPct}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Property appreciation % p.a.</label><input type="number" step="0.1" id="rvb-apprpct" value="${rvb.apprPct}" /></div>
      <div class="field"><label>Horizon (years)</label><input type="number" id="rvb-horizon" value="${rvb.horizonYears}" /></div>
    </div>
    <div id="rvb-results"></div>
  `;
  const ids = {
    "rvb-price": (v) => (rvb.price = parsePrice(v)),
    "rvb-down": (v) => (rvb.downPct = num(v)),
    "rvb-rate": (v) => (rvb.ratePct = num(v)),
    "rvb-years": (v) => (rvb.years = num(v)),
    "rvb-rent": (v) => (rvb.rent = parsePrice(v)),
    "rvb-rentappr": (v) => (rvb.rentApprPct = num(v)),
    "rvb-maint": (v) => (rvb.maintPct = num(v)),
    "rvb-apprpct": (v) => (rvb.apprPct = num(v)),
    "rvb-horizon": (v) => (rvb.horizonYears = num(v))
  };
  Object.keys(ids).forEach((id) => {
    body.querySelector("#" + id).addEventListener("input", (e) => { ids[id](e.target.value); recomputeRentVsBuy(); });
  });
  recomputeRentVsBuy();
}
function recomputeRentVsBuy() {
  const results = document.getElementById("rvb-results");
  if (!results) return;
  const r = calcRentVsBuy(state.rentVsBuy);
  const cheaper = r.diff <= 0 ? "Buying" : "Renting";
  results.innerHTML = `
    <div class="result-block">
      <div class="result-row"><span>Down payment</span><span class="val">${fmtINR(r.downPayment)}</span></div>
      <div class="result-row"><span>Monthly EMI</span><span class="val">${fmtINR(r.emi)}</span></div>
      <div class="result-row"><span>Total buying outlay, ${r.horizon}y</span><span class="val">${fmtINR(r.totalBuyOutlay)}</span></div>
      <div class="result-row"><span>Total renting outlay, ${r.horizon}y</span><span class="val">${fmtINR(r.rentOutlay)}</span></div>
      <div class="result-row total"><span>${cheaper} looks cheaper by</span><span class="val">${fmtINR(Math.abs(r.diff))}</span></div>
      <div class="result-row"><span>Property value at end (excluded above)</span><span class="val">${fmtINR(r.projectedValue)}</span></div>
    </div>
    <p class="hint">Rough estimate — excludes tax benefits, investing the rent-saved difference, and resale costs.</p>
  `;
}

/* ---------------- Settings view ---------------- */
function renderSettings() {
  document.querySelectorAll("#set-currency-toggle button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === settings.currencyMode);
  });
  document.getElementById("set-budget").value = settings.budgetMonthly || "";
}
function wireSettings() {
  document.querySelectorAll("#set-currency-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      settings.currencyMode = btn.dataset.mode;
      saveSettings();
      renderSettings();
    });
  });
  document.getElementById("set-budget").addEventListener("input", (e) => {
    settings.budgetMonthly = parsePrice(e.target.value);
    saveSettings();
  });
  document.getElementById("btn-export").addEventListener("click", exportData);
  document.getElementById("btn-import").addEventListener("click", () => document.getElementById("file-import").click());
  document.getElementById("file-import").addEventListener("change", (e) => {
    if (e.target.files[0]) importDataFile(e.target.files[0]);
    e.target.value = "";
  });
}
function exportData() {
  const data = { version: 1, exportedAt: Date.now(), properties: state.properties, contacts: state.contacts, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "property-register-backup-" + todayISO() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Exported");
}
async function importDataFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || (!Array.isArray(data.properties) && !Array.isArray(data.contacts))) throw new Error("bad file");
    if (!confirm("Import will add or overwrite entries with matching IDs. Continue?")) return;
    for (const p of (data.properties || [])) await idbPut("properties", ensurePropertyShape(p));
    for (const c of (data.contacts || [])) await idbPut("contacts", c);
    if (data.settings) { Object.assign(settings, data.settings); saveSettings(); }
    await loadAll();
    renderRegister();
    renderSettings();
    toast("Imported");
  } catch (e) {
    toast("Import failed — invalid file");
  }
}

/* ---------------- Wiring ---------------- */
const QC_TOOL_SUB = {
  land: "Convert between cent / acre rates and total price. Not saved with any property — just a scratch pad.",
  rentvsbuy: "Rough rent-vs-buy comparison over a holding period. Not saved with any property — just a scratch pad."
};
function wireStatic() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  wireRegisterControls();
  wireSettings();
  document.querySelectorAll("#qc-tool-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.qcTool = btn.dataset.tool;
      document.querySelectorAll("#qc-tool-toggle button").forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("qc-tool-sub").textContent = QC_TOOL_SUB[state.qcTool];
      document.getElementById("quickcalc-body").classList.toggle("hidden", state.qcTool !== "land");
      document.getElementById("rentvsbuy-body").classList.toggle("hidden", state.qcTool !== "rentvsbuy");
    });
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

  await checkPendingSharedImport();
}

async function checkPendingSharedImport() {
  const params = new URLSearchParams(location.search);
  if (params.get("import") !== "pending") return;
  history.replaceState(null, "", location.pathname);
  try {
    const record = await idbGet("sharedImports", "pending");
    if (record && record.blob) {
      await idbDelete("sharedImports", "pending");
      startVideoImport(record.blob);
    }
  } catch (e) {
    toast("Couldn't read the shared video");
  }
}
init();
