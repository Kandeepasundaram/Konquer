# Property Register

A mobile-first PWA for tracking properties you're interested in, the brokers/owners behind them, and the numbers that matter — total cost, EMI, and rental ROI.

## What's inside

- **Register** — every property you're tracking, with status (Interested / Viewing / Negotiating / Purchased / Dropped), price, and price-per-sqft at a glance.
- **Cost breakdown** — base price + registration + stamp duty + brokerage + GST + other charges → total cost.
- **EMI calculator** — standard reducing-balance EMI from loan amount, rate, and tenure.
- **Rental & ROI** — gross/net rental yield, projected appreciation, and annualised ROI over a holding period.
- **Compare** — pick up to 4 properties and see price, cost, EMI, and ROI side by side.
- **Contacts** — brokers, owners, agents linked to properties.

All data is stored locally on your device (IndexedDB) — nothing is sent anywhere.

## Running it

**Quickest — just open it:**
Double-click `index.html`. Everything works except installing it as an app (browsers require HTTPS or localhost for that).

**To install it on your phone home screen:**
You need to serve the folder over HTTPS (or localhost). Easiest free options:

1. **GitHub Pages** — push this folder to a GitHub repo, enable Pages in repo settings, open the given URL on your phone, then use "Add to Home Screen" (Chrome/Android) or the Share → "Add to Home Screen" (Safari/iOS).
2. **Netlify Drop** — go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag this folder in. You'll get a live HTTPS URL instantly.
3. **Local network testing** — run `npx serve .` from inside this folder, then open the printed `http://<your-ip>:PORT` address from your phone (same Wi-Fi network).

Once opened over HTTPS, your browser will offer "Add to Home Screen" / "Install app" — it'll then behave like a native app icon, open full-screen, and cache itself for offline use.

## Notes on the numbers

- Stamp duty defaults to 7% and registration to 1% as a starting point (typical Tamil Nadu ballpark) — edit per-property to match your actual state/deal.
- EMI auto-suggests 80% of price as the loan amount when you first open a new property's EMI tab; change it any time.
- "Total cost" (used in EMI-adjacent comparisons and ROI) always means price + all cost-breakdown line items, not just the base price.

## Extending it

Everything lives in three files: `index.html` (structure), `style.css` (the ledger-book visual style), `app.js` (data + calculators, using plain IndexedDB — no build step, no dependencies). Add fields by extending `defaultProperty()` / `defaultContact()` in `app.js` and the matching form in `renderPropertyBody()` / `renderContactBody()`.
