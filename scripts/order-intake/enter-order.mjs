/* Order intake: enters one Ethica Wood online order (Shopify or Etsy) into
   GNWS as a sales order (GNWS Office) and a linked work order (GNWS Ops),
   the same pair Office's "Create Work Order" button makes.

     node scripts/order-intake/enter-order.mjs <order.json> [--dry-run]

   What goes in the order file, and the steps around this script, are in
   RUNBOOK.md next to it.

   It writes to the same Supabase kv rows the apps use, and it only adds.
   A list is read, the new record goes in, and the list is written back
   only if nobody saved it in between (checked on updated_at). If someone
   did, it reads again and retries, so a crew member's edit is never
   overwritten. Both apps merge rows they haven't seen into their own
   saves, so a new order also survives any tab that was already open.

   Exit codes: 0 entered, 2 already in the app, 3 held for Ero to look at,
   1 error. Nothing is written on 2, 3, or a dry run. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Dates and order numbers run on the shop's clock, same as the apps.
process.env.TZ = "America/Los_Angeles";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

// Orders placed before this were entered by hand. Never backfill them.
const START_DATE = "2026-09-15";

const CHANNELS = {
  shopify: { label: "Shopify", store: "Ethica Wood website", customer: "Shopify Customer", paidVia: "Shopify Payments" },
  etsy: { label: "Etsy", store: "Ethica Wood on Etsy", customer: "Etsy Customer", paidVia: "Etsy Payments" },
};

const KEY = {
  customers: "gnws-shared-customers-v1",
  products: "gnws-shared-products-v1",
  workOrders: "gnws-shared-workorders-v1",
  salesOrders: "gnws-shared-salesorders-v1",
  quotes: "gnws-shared-quotes-v1",
  woHistory: "gnws-shared-wohistory-v1",
};

// Step ids, same as PROCESS_STEPS in GNWS Ops's src/App.jsx.
const STEP_IDS = ["sorting", "chop", "metal", "rip", "resaw", "plane", "mold", "brush", "paint", "distress", "trim", "pack", "ship"];
const defaultSteps = () => STEP_IDS.reduce((acc, s) => ({ ...acc, [s]: false }), {});

const uid = () => Math.random().toString(36).slice(2, 9);
const round = (n, d = 4) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const UNIT_WORD = { sf: ["SF", "SF"], box: ["box", "boxes"], board: ["board", "boards"], plank: ["plank", "planks"], pallet: ["pallet", "pallets"], ea: ["ea", "ea"] };
const unitWord = (u, n) => (UNIT_WORD[u] ? UNIT_WORD[u][round(n, 2) === 1 ? 0 : 1] : u);

/* ---------------- Units ---------------- */

// Kept identical to buildUnitGraph in GNWS Ops's src/App.jsx, so a box
// here is exactly the box the work order screen shows.
function buildUnitGraph(product) {
  const graph = {};
  const addEdge = (uA, uB, factor) => {
    if (!uA || !uB || !(factor > 0)) return;
    graph[uA] = graph[uA] || {};
    graph[uB] = graph[uB] || {};
    graph[uA][uB] = factor;
    graph[uB][uA] = 1 / factor;
  };
  if (Number(product?.planksPerBoard) > 0) addEdge("board", "plank", Number(product.planksPerBoard));
  const sfb = Number(product?.sfPerBoard) || (Number(product?.sfPerPlank) || 0) * (Number(product?.planksPerBoard) || 0);
  if (sfb > 0) addEdge("board", "sf", sfb);
  if (Number(product?.boardsPerUnit) > 0) addEdge("pallet", "board", Number(product.boardsPerUnit));
  if (Number(product?.boardsPerBox) > 0) addEdge("box", "board", Number(product.boardsPerBox));
  (product?.conversions || []).forEach((c) => {
    const qtyA = Number(c.qtyA), qtyB = Number(c.qtyB);
    if (c.unitA && c.unitB && qtyA > 0 && qtyB > 0) addEdge(c.unitA, c.unitB, qtyB / qtyA);
  });
  return graph;
}

// Ops's convertViaGraph as a factor, except that it says when two units
// aren't connected instead of handing the quantity back unconverted: a
// made-up figure on a work order is worse than none.
function unitFactor(product, fromUnit, toUnit) {
  if (fromUnit === toUnit) return 1;
  const graph = buildUnitGraph(product);
  const visited = new Set([fromUnit]);
  const queue = [[fromUnit, 1]];
  while (queue.length) {
    const [node, mult] = queue.shift();
    if (node === toUnit) return mult;
    const neighbors = graph[node] || {};
    for (const next in neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, mult * neighbors[next]]);
      }
    }
  }
  return null;
}

/* ---------------- Storage ---------------- */

function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    const file = path.join(REPO, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const SB_URL = env.VITE_SUPABASE_URL;
const SB_KEY = env.VITE_SUPABASE_ANON_KEY;
const HEADERS = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

async function readRow(key) {
  const res = await fetch(`${SB_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}&select=value,updated_at`, { headers: HEADERS });
  if (!res.ok) throw new Error(`reading ${key}: HTTP ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`${key} isn't in storage`);
  let value = rows[0].value;
  if (typeof value === "string") value = JSON.parse(value);
  if (!Array.isArray(value)) throw new Error(`${key} isn't a list`);
  return { value, updatedAt: rows[0].updated_at };
}

// Saves only if the row still has the updated_at it was read with.
async function writeIfUnchanged(key, list, updatedAt) {
  const res = await fetch(
    `${SB_URL}/rest/v1/kv?key=eq.${encodeURIComponent(key)}&updated_at=eq.${encodeURIComponent(updatedAt)}&select=key`,
    {
      method: "PATCH",
      headers: { ...HEADERS, Prefer: "return=representation" },
      // Same shape the apps write: the list as JSON text, plus the time.
      body: JSON.stringify({ value: JSON.stringify(list), updated_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) throw new Error(`saving ${key}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).length === 1;
}

class NumberTaken extends Error {}

// Puts one new record into a list, retrying if someone saves the same list
// at the same moment. Never touches any other row in it.
async function addRecord(key, record, { atEnd = false, isTaken } = {}) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { value, updatedAt } = await readRow(key);
    if (value.some((r) => r?.id === record.id)) return;
    if (isTaken && value.some(isTaken)) throw new NumberTaken(key);
    const next = atEnd ? [...value, record] : [record, ...value];
    if (await writeIfUnchanged(key, next, updatedAt)) return;
    await sleep(250 * attempt);
  }
  throw new Error(`${key}: someone kept saving at the same moment, gave up after 6 tries`);
}

// Changes fields on a record this script made itself (only ever used to
// link or renumber its own order).
async function patchOwnRecord(key, id, patch) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { value, updatedAt } = await readRow(key);
    if (!value.some((r) => r?.id === id)) throw new Error(`${key}: record ${id} to update isn't there`);
    const next = value.map((r) => (r?.id === id ? { ...r, ...patch } : r));
    if (await writeIfUnchanged(key, next, updatedAt)) return;
    await sleep(250 * attempt);
  }
  throw new Error(`${key}: someone kept saving at the same moment, gave up after 6 tries`);
}

/* ---------------- Numbers ---------------- */

// nextNumber from the apps ("WO-2026-2583" is the 3rd number on day 258),
// counted across quotes, sales orders and work orders together, since one
// order's quote, sales order and work order share a number.
function freeBase(lists) {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1;
  const dayStr = String(dayOfYear).padStart(3, "0");
  const re = new RegExp(`^(?:SO|WO|Q)-${year}-${dayStr}(\\d+)(?:-.*)?$`);
  let max = 0;
  for (const list of lists) for (const r of list) {
    const m = re.exec(String(r?.number || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${year}-${dayStr}${max + 1}`;
}
async function freshBase() {
  const rows = await Promise.all([KEY.salesOrders, KEY.workOrders, KEY.quotes].map(readRow));
  return freeBase(rows.map((r) => r.value));
}
const baseOf = (number) => /^[A-Z]+-(.+)$/.exec(String(number || "").trim())?.[1] || null;
const takenFor = (base, ownIds) => (r) =>
  r && !ownIds.includes(r.id) && new RegExp(`^[A-Z]+-${escapeRe(base)}(?:-.*)?$`).test(String(r.number || "").trim());

/* ---------------- Text ---------------- */

function surname(name) {
  const words = String(name || "").split("/")[0].trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const last = words[words.length - 1];
  return last === last.toUpperCase() || last === last.toLowerCase() ? last.charAt(0).toUpperCase() + last.slice(1).toLowerCase() : last;
}

// The address the way a label reads it. Country only when it isn't the US.
function shipToText(s) {
  if (!s) return "";
  const cityLine = [s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter((x) => String(x || "").trim()).join(", ");
  const country = s.country && !/^(us|usa|united states)$/i.test(String(s.country).trim()) ? s.country : "";
  return [s.name, s.company, s.address, s.address2, cityLine, country].filter((x) => String(x || "").trim()).join(", ");
}

function finish(code, status, lines, extra = {}) {
  for (const line of lines) console.log(line);
  console.log(`RESULT ${JSON.stringify({ status, ...extra })}`);
  process.exitCode = code;
}

/* ---------------- Main ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("usage: node scripts/order-intake/enter-order.mjs <order.json> [--dry-run]");
  if (!SB_URL || !SB_KEY) throw new Error(`no Supabase settings in ${path.join(REPO, ".env")}`);

  const order = JSON.parse(fs.readFileSync(file, "utf8"));
  const channel = norm(order.channel);
  const ch = CHANNELS[channel];
  if (!ch) throw new Error(`channel must be "shopify" or "etsy", got ${JSON.stringify(order.channel)}`);
  const orderNumber = String(order.orderNumber ?? "").replace(/^#/, "").trim();
  if (!orderNumber) throw new Error("orderNumber is missing");
  const placed = new Date(order.placedAt);
  if (Number.isNaN(placed.getTime())) throw new Error("placedAt is missing or isn't a date");
  const items = Array.isArray(order.lines) ? order.lines : [];
  if (!items.length) throw new Error("the order has no lines");
  for (const l of items) {
    if (!(Number(l.quantity) > 0)) throw new Error(`a line has no quantity: ${JSON.stringify(l)}`);
    if (!String(l.title || l.sku || "").trim()) throw new Error(`a line has no title or SKU: ${JSON.stringify(l)}`);
  }
  const shipBy = String(order.shipBy || "").trim();
  if (shipBy && !/^\d{4}-\d{2}-\d{2}$/.test(shipBy)) throw new Error(`shipBy must be YYYY-MM-DD, got ${shipBy}`);

  const ref = `${channel}:${orderNumber}`;
  const orderLabel = `${ch.label} #${orderNumber}`;
  const buyerName = String(order.buyer?.name || order.shipTo?.name || "").trim();
  const placedDate = placed.toLocaleDateString("en-CA");
  const placedText = `${placed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${placed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

  if (placedDate < START_DATE) {
    return finish(3, "held", [`HELD: ${orderLabel} was placed ${placedDate}, before order intake started (${START_DATE}). Orders from before then were entered by hand.`]);
  }
  if (/\btest\b/i.test(`${buyerName} ${order.shipTo?.name || ""}`)) {
    return finish(3, "held", [`HELD: ${orderLabel} looks like a test order (${buyerName}).`]);
  }

  const [soRow, woRow, qRow, custRow, prodRow] = await Promise.all(
    [KEY.salesOrders, KEY.workOrders, KEY.quotes, KEY.customers, KEY.products].map(readRow),
  );
  const salesOrders = soRow.value, workOrders = woRow.value, quotes = qRow.value;
  const customers = custRow.value, products = prodRow.value;

  // Already in? First anything this script entered, then anything typed in by hand.
  const soMine = salesOrders.find((s) => s?.sourceRef === ref) || null;
  const woMine = workOrders.find((w) => w?.sourceRef === ref) || null;
  if (soMine && woMine) {
    return finish(2, "already-entered", [`ALREADY IN THE APP: ${orderLabel} is ${soMine.number} / ${woMine.number}. Nothing written.`],
      { order: orderLabel, salesOrder: soMine.number, workOrder: woMine.number });
  }
  if (!soMine && !woMine) {
    const numRe = new RegExp(`(?:shopify|etsy|order|#)\\s*#?\\s*${escapeRe(orderNumber)}(?!\\d)`, "i");
    const text = (r) => [r.number, r.title, r.notes, r.customerPO].map((x) => String(x ?? "")).join("\n");
    const byNumber = [...salesOrders, ...workOrders].filter((r) => r && (numRe.test(text(r)) || String(r.customerPO ?? "").includes(orderNumber)));
    if (byNumber.length) {
      return finish(2, "already-entered", [`ALREADY IN THE APP (entered by hand): ${orderLabel} is mentioned on ${byNumber.map((r) => r.number).join(", ")}. Nothing written.`],
        { order: orderLabel, matches: byNumber.map((r) => r.number) });
    }
    const nameKey = norm(String(buyerName).split("/")[0]);
    if (nameKey.split(" ").length >= 2) {
      const cutoff = new Date(placed.getTime() - 14 * 86400000).toLocaleDateString("en-CA");
      const custName = (id) => customers.find((c) => c?.id === id)?.company || "";
      const byName = [...salesOrders, ...workOrders].filter((r) => r && !r.sourceRef && String(r.date || "") >= cutoff
        && norm([r.customerName, custName(r.customerId), r.title, r.notes, r.shipTo?.name].join(" ")).includes(nameKey));
      if (byName.length) {
        return finish(3, "held", [`HELD: ${orderLabel} is from ${buyerName}, and ${byName.map((r) => r.number).join(", ")} (entered by hand in the last two weeks) already has that name on it. Not adding a second one: check whether it's the same order.`],
          { order: orderLabel, matches: byName.map((r) => r.number) });
      }
    }
  }

  // Online buyers go under one customer per store, the way Etsy orders
  // already do; each order's buyer and address are in its notes.
  let customer = customers.find((c) => c && !c.archived && norm(c.company) === norm(ch.customer)) || null;
  const newCustomer = customer ? null : {
    id: uid(), company: ch.customer, contact: "", address: "", city: "", state: "", zip: "", country: "USA", phone: "", email: "",
    flags: `Ethica Wood ${ch.label} orders. Each order's buyer and ship-to address are in its notes.`,
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  };
  if (newCustomer) customer = newCustomer;

  // Which catalog item each line is, and how many square feet.
  const listings = JSON.parse(fs.readFileSync(path.join(HERE, "listings.json"), "utf8"));
  const liveProducts = products.filter((p) => p && !p.archived);
  const productBySku = (sku) => (sku ? liveProducts.find((p) => norm(p.sku) === norm(sku)) || null : null);
  const listingFor = (l) => (listings[channel] || []).find((e) =>
    (e.listingSku && l.sku && norm(e.listingSku) === norm(l.sku))
    || (e.title && norm(e.title) === norm(l.title) && (!e.variant || norm(e.variant) === norm(l.variant))));

  const warnings = [];
  const resolved = items.map((l) => {
    const qty = Number(l.quantity);
    const unitPrice = Math.max(0, Number(l.unitPrice) || 0);
    const perSqFt = Number(l.pricePerSqFt) > 0 ? Number(l.pricePerSqFt) : null;
    const name = `${String(l.title || l.sku).trim()}${l.variant ? ` (${String(l.variant).trim()})` : ""}`;
    const entry = listingFor(l);
    const product = entry ? productBySku(entry.sku) : productBySku(l.sku);
    if (entry && !product) warnings.push(`listings.json says "${name}" is ${entry.sku}, which isn't a live catalog item.`);
    // What one item on the order is, in a unit the SKU knows.
    let unit = null, perItem = null;
    if (product && entry) { unit = entry.unit; perItem = Number(entry.perItem) || 1; }
    else if (product && perSqFt) { unit = "sf"; perItem = unitPrice / perSqFt; }
    const toSF = product && unit ? unitFactor(product, unit, "sf") : null;
    if (product && toSF) {
      const sfEach = perItem * toSF;
      const qtySF = round(qty * sfEach);
      const boxSF = unitFactor(product, "box", "sf");
      const displayUnit = unit !== "sf" ? unit : boxSF && Math.abs(boxSF - sfEach) / boxSF < 0.02 ? "box" : "sf";
      const shown = round(qtySF / unitFactor(product, displayUnit, "sf"));
      if (perSqFt && entry && Math.abs(unitPrice / perSqFt - sfEach) / sfEach > 0.02) {
        warnings.push(`${name}: the store prices one item as ${fmtNum(unitPrice / perSqFt)} SF, but the catalog says ${fmtNum(sfEach)} SF. Check the quantity.`);
      }
      return { l, name, qty, unitPrice, product, qtySF, displayUnit, shown, lineTotal: qty * unitPrice };
    }
    warnings.push(product
      ? `${name} is catalog item ${product.sku}, but how much one item is isn't known yet, so it's on the order as a description. Pick the product and quantity on the work order.`
      : `${name}${l.sku ? ` (SKU ${l.sku})` : ""} didn't match a catalog item, so it's on the order as a description. Pick the product on the work order.`);
    const qtySF = perSqFt ? round(qty * (unitPrice / perSqFt)) : qty;
    return { l, name, qty, unitPrice, product: null, qtySF, displayUnit: perSqFt ? "sf" : "ea", shown: qtySF, lineTotal: qty * unitPrice };
  });

  const itemsTotal = round(resolved.reduce((s, r) => s + r.lineTotal, 0), 2);
  const discount = Math.max(0, Number(order.discount) || 0);
  const codes = (Array.isArray(order.discountCodes) ? order.discountCodes : []).filter(Boolean).join(", ");
  // Line prices carry the discount, so the sales order totals what was charged before tax.
  const keep = itemsTotal > 0 ? Math.max(0, itemsTotal - discount) / itemsTotal : 1;
  const shippingCost = Math.max(0, Number(order.shippingCost) || 0);
  const tax = Math.max(0, Number(order.tax) || 0);
  const total = order.total !== undefined && order.total !== "" ? Number(order.total) || 0 : itemsTotal - discount + shippingCost + tax;
  const paidVia = String(order.paidVia || ch.paidVia);
  const shipVia = String(order.shippingMethod || "").trim();
  const shipToLine = shipToText(order.shipTo);
  const phone = order.buyer?.phone || order.shipTo?.phone || "";
  const contact = [phone ? `Phone ${phone}` : "", order.buyer?.email ? `Email ${order.buyer.email}` : ""].filter(Boolean).join(". ");
  const shipByText = shipBy ? new Date(`${shipBy}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const describe = (r) => `${fmtNum(r.qty)} × ${r.name}${r.l.sku ? ` (SKU ${r.l.sku})` : ""}`;

  const soLines = resolved.map((r) => ({
    id: uid(), productId: r.product?.id || "", desc: r.product ? "" : describe(r),
    qtySF: r.qtySF, displayUnit: r.displayUnit,
    unitPrice: String(round((r.lineTotal * keep) / (r.shown || 1), 2)),
    note: `${fmtNum(r.qty)} × ${r.name} at ${money(r.unitPrice)} each${discount ? " before the discount" : ""} (${ch.label} listing)`,
  }));
  // The floor app shows no money, so nothing here carries a price.
  const woLines = resolved.map((r) => ({
    id: uid(), productId: r.product?.id || "", desc: r.product ? "" : describe(r),
    qtySF: r.qtySF, displayUnit: r.displayUnit, done: false,
    note: r.product ? `${fmtNum(r.qty)} × ${r.name} (${ch.label} listing)` : "Didn't match a catalog item. Pick the product.",
    steps: r.product?.steps ? { ...r.product.steps } : defaultSteps(),
  }));

  const one = resolved.length === 1 ? resolved[0] : null;
  const what = !one ? `${resolved.length} items`
    : one.product && one.displayUnit === "box" ? `${fmtNum(one.shown)} ${unitWord("box", one.shown)}`
    : `${fmtNum(one.qty)} × ${short(one.name, 28)}`;
  const title = `${surname(buyerName) || "Online order"} · ${what} · ${orderLabel}`;

  const header = `${orderLabel} (${ch.store}), placed ${placedText}${buyerName ? ` by ${buyerName}` : ""}.`;
  const tail = [
    shipBy ? `${ch.label} says ship by ${shipByText}.` : "",
    shipToLine ? `Ship to: ${shipToLine}` : "",
    contact,
    shipVia ? `Delivery: ${shipVia}` : "",
    order.buyerNote ? `Buyer note: ${order.buyerNote}` : "",
    ...warnings.map((w) => `⚠ ${w}`),
    `Entered automatically by Claude from the ${ch.label} order.`,
  ];
  const paidLine = order.paid
    ? `Paid ${money(total)} via ${paidVia}: items ${money(itemsTotal)}${discount ? `, discount${codes ? ` ${codes}` : ""} -${money(discount)}` : ""}, shipping ${money(shippingCost)}, sales tax ${money(tax)}.`
    : `Not marked paid on ${ch.label} yet. Order total ${money(total)}.`;
  const soNotes = [header, paidLine, discount ? "Line prices here are after the discount." : "", ...tail].filter(Boolean).join("\n");
  const woNotes = [header, ...tail].filter(Boolean).join("\n");

  let base = soMine ? baseOf(soMine.number) : woMine ? baseOf(woMine.number) : freeBase([salesOrders, workOrders, quotes]);
  const so = soMine || {
    id: uid(), number: `SO-${base}`, customerId: customer.id, status: "converted", brand: "ethica",
    date: placedDate, lines: soLines, readyByDate: shipBy, shipDate: shipBy, shipVia, terms: "",
    notes: soNotes, shippingCost: shippingCost ? String(shippingCost) : "", depositRequired: "",
    paymentStatus: order.paid ? "Paid" : "Unpaid", paidVia: order.paid ? paidVia : "",
    quoteId: "", workOrderId: "", customerPO: orderLabel, sourceRef: ref,
  };
  const wo = woMine || {
    id: uid(), number: `WO-${base}`, customerId: customer.id, customerName: customer.company,
    status: "not_started", date: placedDate, createdAt: new Date().toISOString(), brand: "ethica",
    title, lines: woLines, readyByDate: shipBy, shipDate: shipBy, shipVia, notes: woNotes,
    salesOrderId: "", customerPO: orderLabel, sourceRef: ref,
  };
  if (!soMine) so.workOrderId = wo.id;
  if (!woMine) wo.salesOrderId = so.id;

  const soTotal = (so.lines || []).reduce((s, l, i) => s + (Number(l.unitPrice) || 0) * (resolved[i]?.shown ?? 0), 0) + shippingCost;
  const lineSummary = resolved.map((r) => (r.product
    ? `  - ${fmtNum(r.shown)} ${unitWord(r.displayUnit, r.shown)} ${r.product.sku} (${fmtNum(r.qtySF)} SF)`
    : `  - ${describe(r)} (no catalog item yet)`));

  if (dryRun) {
    return finish(0, "dry-run", [
      `DRY RUN, nothing written. ${orderLabel}${buyerName ? ` from ${buyerName}` : ""} would go in as:`,
      newCustomer ? `  New customer "${newCustomer.company}"` : `  Customer "${customer.company}"`,
      soMine ? `  Sales order ${so.number} (already there)` : `  Sales order ${so.number}: ${so.paymentStatus}, ${money(soTotal)}`,
      woMine ? `  Work order ${wo.number} (already there)` : `  Work order ${wo.number}: "${wo.title}"`,
      ...lineSummary,
      ...warnings.map((w) => `  ⚠ ${w}`),
      "", "SALES ORDER:", JSON.stringify(so, null, 2), "", "WORK ORDER:", JSON.stringify(wo, null, 2),
    ], { order: orderLabel, salesOrder: so.number, workOrder: wo.number, warnings });
  }

  const ownIds = [so.id, wo.id];
  // Two checks can overlap (a scheduled run and a manual one). Whichever
  // saves second sees the first one's order here and stops, rather than
  // adding the same order again under the next number.
  const sameOrder = (r) => r && r.sourceRef === ref && !ownIds.includes(r.id);
  const clash = (b) => (r) => takenFor(b, ownIds)(r) || sameOrder(r);
  const enteredMeanwhile = async () => {
    const rows = await Promise.all([KEY.salesOrders, KEY.workOrders].map(readRow));
    return rows.some((row) => row.value.some(sameOrder));
  };
  const alreadyNow = () => finish(2, "already-entered",
    [`ALREADY IN THE APP: ${orderLabel} was entered by another check a moment ago. Nothing written.`], { order: orderLabel });

  if (newCustomer) {
    const sameCustomer = (c) => c && c.id !== newCustomer.id && !c.archived && norm(c.company) === norm(ch.customer);
    try { await addRecord(KEY.customers, newCustomer, { atEnd: true, isTaken: sameCustomer }); } catch (e) {
      if (!(e instanceof NumberTaken)) throw e;
      // Another check made it in the meantime: use that one.
      const existing = (await readRow(KEY.customers)).value.find(sameCustomer);
      so.customerId = existing.id; wo.customerId = existing.id; wo.customerName = existing.company;
    }
  }

  if (!soMine && !woMine) {
    for (let attempt = 1; ; attempt++) {
      try { await addRecord(KEY.salesOrders, so, { isTaken: clash(base) }); break; } catch (e) {
        if (!(e instanceof NumberTaken)) throw e;
        if (await enteredMeanwhile()) return alreadyNow();
        if (attempt >= 3) throw e;
        base = await freshBase(); so.number = `SO-${base}`; wo.number = `WO-${base}`;
      }
    }
    for (let attempt = 1; ; attempt++) {
      try { await addRecord(KEY.workOrders, wo, { isTaken: clash(base) }); break; } catch (e) {
        if (!(e instanceof NumberTaken)) throw e;
        if (await enteredMeanwhile()) throw new Error(`another check entered ${orderLabel} at the same moment. Sales order ${so.number} from this run is a duplicate: delete it in GNWS Office.`);
        if (attempt >= 3) throw e;
        base = await freshBase(); wo.number = `WO-${base}`; so.number = `SO-${base}`;
        await patchOwnRecord(KEY.salesOrders, so.id, { number: so.number });
      }
    }
  } else if (soMine) {
    // An earlier run saved the sales order but not the work order.
    try { await addRecord(KEY.workOrders, wo, { isTaken: clash(base) }); } catch (e) {
      if (!(e instanceof NumberTaken)) throw e;
      if (await enteredMeanwhile()) return alreadyNow();
      wo.number = `WO-${await freshBase()}`;
      await addRecord(KEY.workOrders, wo, { isTaken: sameOrder });
    }
    if (soMine.workOrderId !== wo.id) await patchOwnRecord(KEY.salesOrders, so.id, { workOrderId: wo.id });
  } else {
    // An earlier run saved the work order but not the sales order.
    try { await addRecord(KEY.salesOrders, so, { isTaken: clash(base) }); } catch (e) {
      if (!(e instanceof NumberTaken)) throw e;
      if (await enteredMeanwhile()) return alreadyNow();
      so.number = `SO-${await freshBase()}`;
      await addRecord(KEY.salesOrders, so, { isTaken: sameOrder });
    }
    if (woMine.salesOrderId !== so.id) await patchOwnRecord(KEY.workOrders, wo.id, { salesOrderId: so.id });
  }
  if (!woMine) {
    await addRecord(KEY.woHistory, {
      id: uid(), woId: wo.id, woNumber: wo.number, at: new Date().toISOString(), by: "Claude", field: "created",
      label: `Created the work order automatically from ${orderLabel} (sales order ${so.number})`,
    }, { atEnd: true });
  }

  const [soAfter, woAfter] = await Promise.all([readRow(KEY.salesOrders), readRow(KEY.workOrders)]);
  if (!soAfter.value.some((s) => s?.id === so.id) || !woAfter.value.some((w) => w?.id === wo.id)) {
    throw new Error(`saved ${orderLabel} but couldn't find it again on re-reading. Check the app before re-running.`);
  }

  return finish(0, "entered", [
    `ENTERED ${orderLabel}${buyerName ? ` from ${buyerName}` : ""}`,
    `  Sales order ${so.number} (GNWS Office): ${so.paymentStatus}, ${money(soTotal)}`,
    `  Work order ${wo.number} (GNWS Ops): "${wo.title}"`,
    ...lineSummary,
    ...warnings.map((w) => `  ⚠ ${w}`),
  ], { order: orderLabel, salesOrder: so.number, workOrder: wo.number, title: wo.title, warnings, newCustomer: newCustomer?.company || null });
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  console.log(`RESULT ${JSON.stringify({ status: "error", message: e.message })}`);
  process.exitCode = 1;
});
