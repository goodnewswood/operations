# GNWS Ops

The shop-floor app for Good News Wood Salvation (reclaimed redwood, Nevada City, CA):
work orders, sorting and milling logs, inventory, shipping. Its sister app, GNWS Office
(repo `goodnewswood/office`), handles quotes, sales orders and money. Both apps share
one database, so a change in either shows up in both.

## Who you're working for

- Ero runs the business and isn't a developer. Explain every change in plain language:
  what changed, what he'll see, and anything he has to do.
- Never use em dashes in anything you write: replies, UI text, comments, commit messages.
- Several people and Claude sessions push to this repo (Ero, Leo, others). Expect
  `origin/main` to move under you.

## Stack

- React 19, Vite, Tailwind v4. Nearly everything is in `src/App.jsx`. Match the code
  around you, especially its comment style: short plain-language "why" comments.
- Data: Supabase (Postgres), a single table `kv` with columns `key`, `value`,
  `updated_at`. Each collection is one row whose `value` is the whole array as JSON
  text. `src/storage.js` exposes `window.storage` (`get`, `set`, `delete`, `list`).
  Rows: `gnws-shared-{customers,products,workorders,salesorders,quotes,sortlog,team,
  timelog,pos,units,goals,invlog,wohistory}-v1`.
- The app merges edits three-way (`mergeCollections`) before it saves. Scripts save
  only if `updated_at` hasn't changed since they read it (see
  `scripts/order-intake/enter-order.mjs`).
- API routes (Vercel functions in `api/`):
  - `POST /api/parse-invoice`: reads a PDF or pasted order with Claude. Requires the
    header `x-gnws-access-code` to match the `PARSE_INVOICE_ACCESS_CODE` env var.
  - `POST /api/shopify-order`: Shopify `orders/create` webhook, verified by HMAC with
    `SHOPIFY_WEBHOOK_SECRET`, entered through `enterOrder()`. `GET` is a health check.

## Working on it

- Local: `npm install`, then `npm run dev` (http://localhost:5173). Needs a `.env`
  (never committed) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Ask Ero.
- Before committing: `git fetch origin && git merge --ff-only origin/main`, and
  `npm run build` must pass. Then commit and push straight to `main` (no pull requests).
- Pushing to `main` deploys to production: https://gnws.vercel.app
  (Vercel project `operations`, team `gnws`).
- Check changes in a browser before calling them done, not just the build.

## Live data rules

- There is no staging. Local dev reads and writes the real production data.
- Don't change live records (customers, orders, inventory, prices) unless the person
  you're working with asked for that change. Read first, change only what was asked,
  keep other people's edits, and put back anything you change while testing.
- Customers, SKUs and order numbers are shared by both apps. Search before adding, so
  nothing gets entered twice.
- New Shopify and Etsy orders come in through `scripts/order-intake` (see its
  `RUNBOOK.md`) and the Shopify webhook, not by hand.

## Conventions

- A quote, its sales order and its work order share one number:
  `Q/SO/WO-YYYY-<day of year><sequence>`, e.g. `WO-2026-2592`.
- Line quantities are stored in square feet in `qtySF` (a plain count for "ea" items);
  `displayUnit` is how they're shown. A sales order's `unitPrice` is per `displayUnit`.
- Products with category `service` (like `INSTALL`) are sold, not stocked: they stay
  off counts, floor pickers and square-foot totals.
- This app never shows money. Prices live in GNWS Office.
- Assume $20/hour for labor unless Ero says otherwise.
