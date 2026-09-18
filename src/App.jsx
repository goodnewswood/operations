import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import { jsPDF } from "jspdf";
import {
  Plus, Trash2, ChevronLeft, Users, Package, LayoutGrid, Scissors,
  Boxes, MapPin, AlertTriangle, Check, Clock, CircleDot, User, Copy,
  Ruler, Palette, StickyNote, ClipboardList, Truck, RefreshCw,
  Play, Pause, Square, Timer, CalendarDays, Tag, QrCode, Printer,
  FileText, X, Search, Pencil, Star, Settings, Menu, ExternalLink,
  Archive, RotateCcw, GripVertical, Mail, Camera
} from "lucide-react";

/* ============================================================
   GNWS OPS — SHARED TEAM OPERATIONS SYSTEM
   Employee-facing. No dollar amounts anywhere.
   Shares data (customers, catalog, inventory, work orders, sorting,
   time log) with the Quote & Pricing Studio via shared persistent storage.

   UNIT MODEL:
   - A "board" is the raw incoming unit (e.g. a 1x8x5 board).
   - A "plank" is what a board becomes after milling — the finished-goods
     unit (e.g. TH-545-NAT). Boards don't have one universal plank ratio;
     the ratio lives on the OUTPUT sku (planksPerBoard), since a single
     1x8x5 board might yield 2 TH-545-NAT planks, while a different raw
     size might yield only 1 plank of some other profile.
   - SF is derived FROM planks (sfPerPlank on the finished sku), not the
     other way around — invoices/quotes think in SF, the floor thinks in
     boards or planks, and this file converts between all three wherever
     a quantity appears.
   ============================================================ */

const C = {
  ink: "#221D19",
  paper: "#F6F3EC",
  panel: "#FFFFFF",
  redwood: "#7E2F21",
  redwoodDark: "#5E2317",
  kraft: "#E4DCCB",
  kraftDark: "#C9BDA3",
  moss: "#4A5D3A",
  mossLight: "#A9C48F",
  faint: "#8A8172",
  warn: "#A65D21",
  gold: "#B8862B",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// Sales-side sister app — same Supabase data, adds quotes and converts
// them to/from work orders here. See KEY.quotes-less note: Ops itself
// only ever reads wo.quoteId (set by GNWS Office), never writes it.
const OFFICE_URL = "https://gnws-office.vercel.app";

// Where a "Reorder" purchase request from the dashboard gets sent. It opens
// a pre-filled email in whatever mail app the device has, so nothing here
// needs an account or an API key to keep working.
const REORDER_EMAIL = "erogorski@gmail.com";

/* ---------------- Shared storage keys ---------------- */
const KEY = {
  customers: "gnws-shared-customers-v1",
  products: "gnws-shared-products-v1",
  workOrders: "gnws-shared-workorders-v1",
  sortLog: "gnws-shared-sortlog-v1",
  team: "gnws-shared-team-v1",
  timeLog: "gnws-shared-timelog-v1",
  suppliers: "gnws-shared-suppliers-v1",
  purchaseOrders: "gnws-shared-pos-v1",
  units: "gnws-shared-units-v1",
  goals: "gnws-shared-goals-v1",
  invLog: "gnws-shared-invlog-v1",
  woHistory: "gnws-shared-wohistory-v1",
  schedule: "gnws-shared-schedule-v1",
  // GNWS Office owns these. Ops loads them only so a work order edit can
  // carry its dates and customer up to them (see carryWorkOrderUp).
  quotes: "gnws-shared-quotes-v1",
  salesOrders: "gnws-shared-salesorders-v1",
};

/* The details a work order has to agree with its sales order and quote on.
   GNWS Office carries edits to these down from a quote or sales order; a
   work order edit here carries them back up, so the office never invoices
   or reprints a quote off a date the floor already moved. Money, lines and
   notes never travel: this app holds no prices, and each record's notes
   are written for a different reader. Same list as in Office. */
const SHARED_ORDER_FIELDS = ["customerId", "brand", "readyByDate", "shipDate", "shipVia", "dropShip", "shipTo", "customerPO"];

// The shared details one work order edit changed, or null if none did.
function upstreamPatch(before, after) {
  const patch = {};
  for (const k of SHARED_ORDER_FIELDS) {
    if (after && k in after && JSON.stringify(before?.[k] ?? "") !== JSON.stringify(after[k] ?? "")) patch[k] = after[k];
  }
  return Object.keys(patch).length ? patch : null;
}

// Carries a work order edit up to its sales order and quote, but only when
// it's that sales order's one work order. Where a sales order feeds several
// (one per drop ship destination), each shipment can have its own date and
// address, and changing one mustn't rewrite the sales order they share.
function carryWorkOrderUp(before, after, { workOrders, salesOrders, setSalesOrders, setQuotes }) {
  const patch = upstreamPatch(before, after);
  if (!patch) return;
  const so = after.salesOrderId ? salesOrders.find((s) => s.id === after.salesOrderId) : null;
  if (so && workOrders.filter((w) => w.id === so.workOrderId || w.salesOrderId === so.id).length > 1) return;
  if (so) setSalesOrders((list) => list.map((s) => (s.id === so.id ? { ...s, ...patch } : s)));
  const quoteId = after.quoteId || so?.quoteId;
  if (quoteId) setQuotes((list) => list.map((q) => (q.id === quoteId ? { ...q, ...patch } : q)));
}

/* ---------------- Seed data ---------------- */

const SEED_TEAM = ["Ero", "Leo", "Matt", "Will", "Yoshi", "Daniel H"];

const SEED_CUSTOMERS = [
  {
    id: "c1", company: "InStone Distribution", contact: "Dustin Wilson",
    address: "15006 135 Ave", city: "Edmonton", state: "AB", zip: "T5V 1R9", country: "Canada",
    phone: "(780) 265-2096", email: "dustin@instoneproducts.ca",
    flags: "ISPM-15 certified pallets required",
    spec: { minSize: "", maxSize: "", paintTolerance: "No paint on either side", knotTolerance: "", notes: "" },
  },
  {
    id: "c2", company: "Huasna Wood", contact: "Jethro Brigham",
    address: "791 Price St., #244", city: "Pismo Beach", state: "CA", zip: "93449", country: "USA",
    phone: "(805) 709-5140", email: "huasnabrand@gmail.com",
    flags: "Monthly buyer · painted stock preferred · price-sensitive",
    spec: { minSize: "", maxSize: "", paintTolerance: "One side painted OK", knotTolerance: "", notes: "" },
  },
  {
    id: "c3", company: "True American Grain", contact: "",
    address: "27324 Camino Capistrano #160", city: "Laguna Niguel", state: "CA", zip: "92677", country: "USA",
    phone: "", email: "sheryl@trueamericangrain.com",
    flags: "Abbreviate TAG",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c4", company: "Yuki-San (Import)", contact: "Yuki",
    address: "", city: "", state: "", zip: "", country: "Japan",
    phone: "", email: "",
    flags: "Sequoia T&G line · metric spec sheets",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "Confirm metric conversion on spec sheets" },
  },
  {
    id: "c5", company: "Dillon — Restaurant Design", contact: "Dillon",
    address: "930 Roseberry Dr.", city: "Las Vegas", state: "NV", zip: "89138", country: "USA",
    phone: "(702) 423-3635", email: "dillonbtennis@gmail.com",
    flags: "Specialty / custom projects",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  // Everything below was imported from the QuickBooks Online customer
  // export (July 2026). No dollar amounts (open balances) were carried
  // over — this is contact/address info only.
  {
    id: "c6", company: "Advanced Facility Solutions", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(408) 490-0914", email: "armando@advancedrestor.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c7", company: "Alibi Interiors", contact: "",
    address: "802 Estates Drive, #102", city: "Aptos", state: "CA", zip: "95003", country: "USA",
    phone: "(831) 331-1203", email: "thealibi@live.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c8", company: "All American Reclaim", contact: "",
    address: "990 W Northwest Hwy", city: "Lake Barrington", state: "IL", zip: "60010", country: "USA",
    phone: "(224) 209-8283", email: "allamericanreclaim@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c9", company: "All Wood Salvage", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(530) 386-2926", email: "bob@allwoodsalvage.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c10", company: "Anthology Woods", contact: "",
    address: "4611 Table Rock Rd.", city: "Central Point", state: "OR", zip: "97502", country: "USA",
    phone: "(541) 890-4848", email: "rob@anthologywoods.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c11", company: "Anthony BBD West", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(408) 430-6801", email: "anthony@bbdwest.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c12", company: "Axis Planning, Inc.", contact: "",
    address: "1112 W Pender St. Ste. 415", city: "Vancouver", state: "BC", zip: "V6E 2S1", country: "Canada",
    phone: "(778) 558-9271", email: "office@axisplan.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c13", company: "Blumer & Stanton, Inc", contact: "",
    address: "5112 Georgia Avenue", city: "West Palm Beach", state: "Florida", zip: "33405", country: "USA",
    phone: "(561) 585-2525", email: "marcille@blumerandstanton.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c14", company: "Cabmat Design Build", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(310) 845-5867", email: "pedroc@cabmatdesignbuild.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c15", company: "California Lumber Company", contact: "",
    address: "2945 LINCOLN RD", city: "LAS VEGAS", state: "NV", zip: "89115", country: "USA",
    phone: "(925) 849-2353", email: "darren@onboard.green",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c16", company: "Carlson Construction", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "408-219-6377", email: "alicia.westonmiles@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c17", company: "The Reclaimed Lumber Co.", contact: "Chad Jackson",
    address: "19 Trianna St", city: "Belmont", state: "NY", zip: "14813", country: "USA",
    phone: "(716) 378-4297", email: "cjackson8436@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c18", company: "Ciarra Construction", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(408) 640-1675", email: "aj@ciarra.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c19", company: "Classic Millwork & Products, Inc.", contact: "",
    address: "275 Rio West Drive", city: "El Paso", state: "TX", zip: "79932", country: "USA",
    phone: "(915) 833-9922", email: "purchasing@cmpelpaso.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c20", company: "Mom's Garage", contact: "Cody Springer",
    address: "21544 Newland St", city: "Huntington Beach", state: "CA", zip: "92646", country: "USA",
    phone: "(714) 470-0067", email: "momsgaragewoodworking@yahoo.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c21", company: "Darrel Varni Electric, Inc.", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(831) 761-2288", email: "info@dve-inc.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c22", company: "Delta Millworks", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(512) 385-1812", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c23", company: "Spiral Process", contact: "Dmitry Vulfovich",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(408) 472-2994", email: "dmitry@spiralprocess.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c24", company: "Duenas", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "jduenas625@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c25", company: "E&K Vintage Wood", contact: "",
    address: "1308 W El Segundo Blvd", city: "Gardena", state: "CA", zip: "90247", country: "USA",
    phone: "(310) 306-6900", email: "eric@eandkwood.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c26", company: "EARTHCARE GROUP, LLC", contact: "EARTHCARE GROUP LLC",
    address: "27091 State Highway 49", city: "Nevada City", state: "CA", zip: "95959-8994", country: "USA",
    phone: "+16304843242", email: "theearthcaregroup@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c27", company: "Etsy Inc. (Sales/Refunds)", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c28", company: "Evergreen Supply -", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "sven@evergreensupplyonline.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c29", company: "Far West Forest Products", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c30", company: "FUNCTIONAL LIFESTYLES, LLC", contact: "Functional Lifestyles LLC",
    address: "707 High St", city: "Palo Alto", state: "CA", zip: "94301", country: "USA",
    phone: "+14088436822", email: "corey@functional-lifestyles.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c31", company: "Garage Doors, Inc.", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(800) 223-9795", email: "don@garagedoorsinc.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c32", company: "Gordon Prill", contact: "",
    address: "310 E Caribbean Dr", city: "Sunnyvale", state: "CA", zip: "94089", country: "USA",
    phone: "(949) 244-6147", email: "alyon@gordonprill.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c33", company: "Guy Bennallack", contact: "",
    address: "4515 Copper Sage St #100", city: "Las Vegas", state: "NV", zip: "89115", country: "USA",
    phone: "(702) 234-9233", email: "guy@trclv.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c34", company: "Hannah Huntley", contact: "",
    address: "13688 Magnolia Rd.", city: "Grass Valley", state: "CA", zip: "95949", country: "USA",
    phone: "(530) 798-1070", email: "Blissfulacres3@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c35", company: "Heritage Salvage", contact: "",
    address: "1473 Petaluma Blvd. South", city: "Petaluma", state: "CA", zip: "94952", country: "USA",
    phone: "(707) 762-6277", email: "bug@heritagesalvage.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c36", company: "Hidden Villa", contact: "",
    address: "26870 Moody Rd", city: "Los Altos Hills", state: "CA", zip: "94022", country: "USA",
    phone: "(650) 949-8650", email: "hjensen@hiddenvilla.org",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c37", company: "Hock Furniture", contact: "",
    address: "5940 Park Hill Rd", city: "Santa Margarita", state: "CA", zip: "93453", country: "USA",
    phone: "(805) 709-0729", email: "hockfurniture@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c38", company: "In Person Sale", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "gorski.e@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c39", company: "Jackel Enterprises", contact: "",
    address: "801 Ohlone Pkwy", city: "Watsonville", state: "CA", zip: "95076", country: "USA",
    phone: "(831) 768-3881", email: "steve@jackelenterprises.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c40", company: "Jacob Gorski", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c41", company: "Jacob Kornbluth", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(510) 390-6476", email: "jacob@jacobkornbluth.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c42", company: "Jake Gorski", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "+1 847-668-1468", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c43", company: "James Riley", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c44", company: "Javier Contreras", contact: "",
    address: "6301 63rd St", city: "Sacramento", state: "CA", zip: "95824", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c45", company: "Jed Linsley", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "Linsleyjed@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c46", company: "Jim", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c47", company: "My Southern Vintage", contact: "John Allgeier II",
    address: "925 Hobbs Lane", city: "Fisherville", state: "Kentucky", zip: "40023", country: "USA",
    phone: "", email: "john@mysouthernvintage.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c48", company: "John Avilla", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c49", company: "John Muir Charter Schools", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(858) 451-4008", email: "mayfield.dana@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c50", company: "Johnny Smith", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "smith@johnnyaceii.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c51", company: "Jon Welch", contact: "",
    address: "", city: "Concord", state: "CA", zip: "", country: "USA",
    phone: "", email: "johng63@me.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c52", company: "Growing Healthy Kids", contact: "Jorge Espenosa",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "jorge@ghkids.org",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c53", company: "Joshua Daniel", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c54", company: "JP Digital", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "amanda@jpdigital.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c55", company: "Kaena at The Ranch", contact: "",
    address: "800 E Hwy 246", city: "Buellton", state: "CA", zip: "93463", country: "USA",
    phone: "(805) 245-9137", email: "aaron@coastsb.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c56", company: "Terra Nova", contact: "Ken Foster",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "jillian@terranovalandscaping.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c57", company: "Kerry Hughes", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c58", company: "Kita Glass", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(831) 239-1531", email: "kglass2080@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c59", company: "Kitchen Gallery, Inc", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "+1 310-866-3936", email: "goodnewswood@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c60", company: "L Brackley", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c61", company: "Lisa Runde", contact: "",
    address: "940 Plaza Cr", city: "San Jose", state: "CA", zip: "95125", country: "USA",
    phone: "(408) 832-4494", email: "lrunde@mac.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c62", company: "Martin Reed", contact: "",
    address: "", city: "SEbastopol", state: "CA", zip: "95472", country: "USA",
    phone: "(415) 797-7704", email: "martinlreed@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c63", company: "Martin Webb", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "martinwebbart@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c64", company: "Bradshaw Construction", contact: "Mat Bradshaw",
    address: "30 Malavear Ct., Pacifica CA", city: "", state: "", zip: "", country: "USA",
    phone: "(650) 438-7339", email: "mat@bradshaw-gc.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c65", company: "Melissa Kreisa", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c66", company: "Messer Construction Co.", contact: "",
    address: "11001 Plantside Drive", city: "Louisville", state: "KY", zip: "40299", country: "USA",
    phone: "(502) 261-9775", email: "LRebholz@messer.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c67", company: "Meza Fence", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c68", company: "Midland Cabinet Company", contact: "",
    address: "719 Industrial Rd", city: "San Carlos", state: "CA", zip: "94070", country: "USA",
    phone: "(650) 594-0890", email: "jeb@midlandcabinet.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c69", company: "Mike Comba", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(775) 741-5942", email: "retired067@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c70", company: "ProPatio", contact: "Mike Weber",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "Mweber@propatio.net",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c71", company: "Millwork Brothers", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(562) 287-8369", email: "kevin.c@millworkbrothers.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c72", company: "Nancy Kusner", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "nakusner@icloud.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c73", company: "Native Trails", contact: "",
    address: "5940 Park Hill Rd", city: "Santa Margarita", state: "CA", zip: "93453", country: "USA",
    phone: "(805) 709-0729", email: "hockfurniture@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c74", company: "Nevada City School of the Arts", contact: "",
    address: "13032 Bitney Springs Rd.", city: "Nevada City", state: "CA", zip: "95959", country: "USA",
    phone: "(818) 497-7261", email: "dre.maher@ncsota.org",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c75", company: "1301 Santa Ynez LLC", contact: "Noah Snyder",
    address: "1301 Santa Ynez Ave", city: "Los Osos", state: "CA", zip: "93402", country: "USA",
    phone: "", email: "noah@allenandcompany.llc",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c76", company: "O Industries", contact: "",
    address: "PO Box 779", city: "Dana Point", state: "CA", zip: "93677", country: "USA",
    phone: "(949) 292-7175", email: "billo@oindcorp.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c77", company: "Old Sol Lumber Co", contact: "",
    address: "441 S Robson Ave.", city: "Mesa", state: "AZ", zip: "85210", country: "USA",
    phone: "", email: "preston@oldsollumber.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c78", company: "Originate Natural Building Materials", contact: "",
    address: "948 N Main Ave", city: "Tucson", state: "AZ", zip: "95705", country: "USA",
    phone: "", email: "natasha@originatenbm.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c79", company: "Oxford Designs", contact: "",
    address: "2533C Mission Street", city: "Santa Cruz", state: "CA", zip: "95060", country: "USA",
    phone: "(310) 403-7270", email: "oxforddesignco@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c80", company: "PayPal", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c81", company: "Peterman Lumber", contact: "",
    address: "5625 Arville St. #C-D", city: "Las Vegas", state: "NV", zip: "89118", country: "USA",
    phone: "702-430-3433", email: "edg@petermanlumber.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c82", company: "Pioneer Millworks", contact: "",
    address: "2675 NE Orchard Ave", city: "McMinnville", state: "OR", zip: "97128", country: "USA",
    phone: "", email: "michele@pioneermillworks.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c83", company: "Plank And Mill", contact: "",
    address: "2737 E Latimer St.", city: "Tulsa", state: "OK", zip: "74110", country: "USA",
    phone: "888-502-8212", email: "cassie@plankandmill.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c84", company: "Point North Builders", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(831) 706-6116", email: "brance@pointnorthbuilders.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c85", company: "Primal Steakhouse", contact: "",
    address: "5625 S Hwy 121, Ste 100", city: "The Colony", state: "TX", zip: "75056", country: "USA",
    phone: "(360) 540-0160", email: "darrell@primalsteakhouse.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c86", company: "Purpose Millworks and Design", contact: "",
    address: "11125 Bondshire Dr", city: "Reno", state: "NV", zip: "89511", country: "USA",
    phone: "(714) 597-5497", email: "tim@purposemillworks.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c87", company: "3B Investors, Inc.", contact: "Rafael Bernal",
    address: "9659 Knollwood Ct", city: "Salinas", state: "CA", zip: "93907", country: "USA",
    phone: "(831) 444-5348", email: "rafael50bernal@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c88", company: "Reclaimed Beam and Board", contact: "",
    address: "1125 North Military Avenue, Green Bay, WI, 54303", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "Rebecca@beamandboard.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c89", company: "Reclaimed Lumber & Beams", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c90", company: "Reclaimed Lumber And Beams", contact: "",
    address: "1548 Morganton Blvd SW", city: "Lenoir", state: "NC", zip: "28645", country: "USA",
    phone: "(828) 460-0111", email: "daleballew@charter.net",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c91", company: "Reclaimed Lumber Products", contact: "",
    address: "3424 North Can Ada Road", city: "Nampa", state: "ID", zip: "83687", country: "USA",
    phone: "", email: "titus@reclaimedlumberproducts.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c92", company: "Reclaimed Redwood Fence Boards", contact: "",
    address: "3130 Camino Diablo", city: "Byron", state: "CA", zip: "94514", country: "USA",
    phone: "(925) 849-2353", email: "darren@californialumbercompany.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c93", company: "Reclaimed Secrets", contact: "",
    address: "2912 South Highland Drive, Unit G", city: "Las Vegas", state: "NV", zip: "89109", country: "USA",
    phone: "(702) 439-8592", email: "andrew@reclaimedsecrets.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c94", company: "Reclaimed Wood San Diego", contact: "",
    address: "3584 Hancock St", city: "San Diego", state: "CA", zip: "92110", country: "USA",
    phone: "(619) 618-0865", email: "cs@reclaimedwoodsandiego.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c95", company: "Reclaimed Wood Source", contact: "",
    address: "2745 E Slauson Ave.", city: "Huntington Park", state: "CA", zip: "90255", country: "USA",
    phone: "(310) 736-8982", email: "juan@reclaimedwoodsource.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c96", company: "Retail Sale", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c97", company: "Robin Caminiti", contact: "",
    address: "3425 Witt Rd", city: "Auburn", state: "CA", zip: "", country: "USA",
    phone: "(530) 613-5390", email: "robincaminiti@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c98", company: "Rogue Pacific", contact: "",
    address: "1187 W McAndrews Rd", city: "Medford", state: "OR", zip: "97501", country: "USA",
    phone: "(541) 773-3744", email: "derrick@roguepacific.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c99", company: "Ross Alan Reclaimed Lumber", contact: "Ross Alan",
    address: "5348 Vineland Avenue", city: "North Hollywood", state: "CA", zip: "91602", country: "USA",
    phone: "(818) 331-5166", email: "rossalanreclaimed@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c100", company: "Ross Alan Reclaimed", contact: "",
    address: "5348 Vineland Ave", city: "North Hollywood", state: "CA", zip: "91601", country: "USA",
    phone: "", email: "rossalanreclaimed@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c101", company: "Sandy", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "sandyrintoul@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c102", company: "Santa Cruz Permaculture", contact: "Santa  Cruz Permaculture",
    address: "343 Soquel Avenue Suite #185", city: "Santa Cruz", state: "CA", zip: "95062-2305", country: "USA",
    phone: "", email: "santacruzpermaculture@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c103", company: "Saratoga Springs", contact: "",
    address: "22801 Big Basin Way", city: "Saratoga", state: "CA", zip: "95070", country: "USA",
    phone: "(408) 502-8316", email: "eric@saratoga-springs.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c104", company: "Service Estimate", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c105", company: "Seth Kostek", contact: "",
    address: "2060 N Loop Rd", city: "Alameda", state: "CA", zip: "94502", country: "USA",
    phone: "", email: "seth@santaclarasystems.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c106", company: "SGH Construction", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c107", company: "Sigona's", contact: "",
    address: "2345 Middlefield Rd.", city: "Redwood City", state: "CA", zip: "94063", country: "USA",
    phone: "", email: "nava@sigonas.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c108", company: "State of California", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c109", company: "Stikwood", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(866) 266-8354", email: "katrina@stikwood.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c110", company: "Studio 2020", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(917) 239-6304", email: "ny2020ny@yahoo.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c111", company: "Telluride Natural Stone And Wood", contact: "",
    address: "1639 Deer Valley Rd", city: "Phoenix", state: "AZ", zip: "85024", country: "USA",
    phone: "", email: "accounting@telluridenaturalstone.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c112", company: "Test", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c113", company: "The Lumber Baron", contact: "",
    address: "500 Cleveland Ave", city: "Albany", state: "CA", zip: "94710", country: "USA",
    phone: "5105267224", email: "info@thelumberbaron.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c114", company: "The Vintage Wood Flooring Co.", contact: "",
    address: "2770 E Coronado St.", city: "Anaheim", state: "CA", zip: "92806", country: "USA",
    phone: "714-557-9655", email: "joe@vintagewoodfloors.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c115", company: "TQL Shippping", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c116", company: "Trestlewood", contact: "",
    address: "PO BOX 1050", city: "Pleasant Grove", state: "UT", zip: "84062", country: "USA",
    phone: "", email: "fred@trestlewood.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c117", company: "Trillium Lumber", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(503) 285-6947", email: "kent@trilliumlumber.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c118", company: "Triple Bar Stables", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "(831) 818-0073", email: "kenaverillconcrete@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c119", company: "Troy Svensson", contact: "",
    address: "1236 Clough Pike", city: "Batavia", state: "Ohio", zip: "45103", country: "USA",
    phone: "", email: "troysvensson@yahoo.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c120", company: "Unknown Customer", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c121", company: "Varun", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "varun/pemmaraju@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c122", company: "Viridian Reclaimed Wood", contact: "",
    address: "9111 SE McBrod Ave.", city: "Milwaukie", state: "OR", zip: "97222", country: "USA",
    phone: "(503) 468-3539", email: "ben@viridianwood.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c123", company: "Wabash Lumber Co.", contact: "",
    address: "1611 Schuyler Ave", city: "Lafayette", state: "IN", zip: "47904", country: "USA",
    phone: "(765) 314-3255", email: "aaron@wabashlumber.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c124", company: "Walk In Sale", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "z3stoli@yahoo.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c125", company: "WD Walls", contact: "",
    address: "PO Box 2222", city: "Lake Oswego", state: "OR", zip: "97035", country: "USA",
    phone: "(503) 522-8378", email: "pierce@wdwalls.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c126", company: "Wendy E Squire", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c127", company: "Western Reclaimed Timber Corp.", contact: "",
    address: "26324 River Road", city: "Maple Ridge", state: "British Colombia", zip: "V2W 1T9", country: "Canada",
    phone: "(604) 220-9249", email: "bruce@westernreclaimed.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c128", company: "Woodstock A.P.", contact: "",
    address: "5070 West Patrick Lane", city: "Las Vegas", state: "NV", zip: "89118", country: "USA",
    phone: "", email: "kevin@woodstockap.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
  {
    id: "c129", company: "Zeb", contact: "",
    address: "", city: "", state: "", zip: "", country: "USA",
    phone: "", email: "dearzeb@gmail.com",
    flags: "",
    spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" },
  },
];

const SEED_PRODUCTS = [
  { id: "p1", sku: "TH-545-NAT", name: "Natural Patina", kind: "sf", category: "wood", face: '4.75"', width: '5.09"', length: '45"', sfPerPlank: 1.59, planksPerBoard: 2, sourceBoardSku: "185-RAW", sfPerBox: 20, boxesPerPallet: 64, onHand: 0 },
  { id: "p6", sku: "5S3S-THIN", name: '5" S3S (Thin)', kind: "sf", category: "wood", face: '5.00"', width: '5.00"', length: '45"', sfPerPlank: 1.74, sfPerBox: 20, onHand: 0 },
  { id: "p7", sku: "7S3S", name: '7" S3S', kind: "sf", category: "wood", face: '7.00"', width: '7.00"', length: '45"', sfPerPlank: 2.19, sfPerBox: 40, onHand: 0 },
  { id: "p8", sku: "5SHIPLAP", name: '5" Shiplap', kind: "sf", category: "wood", face: '4.75"', width: '5.00"', length: '48"', sfPerPlank: 1.67, sfPerBox: 20, onHand: 0 },
  { id: "p9", sku: "7SHIPLAP", name: '7" Shiplap', kind: "sf", category: "wood", face: '6.75"', width: '7.00"', length: '48"', sfPerPlank: 2.25, sfPerBox: 40, onHand: 0 },
  { id: "p10", sku: "5SEQ-TG", name: '5" Sequoia T&G', kind: "sf", category: "wood", face: '4.75"', width: '5.00" (w/ T&G)', length: '48"', sfPerPlank: 1.67, sfPerBox: 20, onHand: 0 },
  { id: "p11", sku: "7SEQ-TG", name: '7" Sequoia T&G', kind: "sf", category: "wood", face: '6.75"', width: '7.00" (w/ T&G)', length: '48"', sfPerPlank: 2.25, sfPerBox: 40, onHand: 0 },
  { id: "p12", sku: "RAW-1x8x5-NP", name: "Raw Plank 1x8x5, Non-Painted", kind: "sf", category: "wood", face: '~7.5"', width: '~7.5"', length: '60"', onHand: 0 },
  { id: "p13", sku: "RAW-1x8x5-OSP", name: "Raw Plank 1x8x5, One-Side Painted", kind: "sf", category: "wood", face: '~7.5"', width: '~7.5"', length: '60"', onHand: 0 },
  // Raw + sorted board stock, generated per size code. A size code's middle
  // digit is the board width in inches — that's what sets boards-per-unit
  // (8" wide = 300/pallet, 6" wide = 400/pallet), per how these are stacked.
  // Raw stock is sized only (paint isn't known until it's sorted); sorted
  // stock splits into N (no paint) and P (one side painted).
  ...["165", "166", "185", "186"].flatMap((size) => {
    const width = size[1];
    const perUnit = width === "8" ? 300 : width === "6" ? 400 : undefined;
    const groupId = `grp-${size}`;
    return [
      { id: `raw-${size}`, sku: `${size}-RAW`, name: `${size} Raw Incoming (Unsorted)`, kind: "board", category: "wood", groupId, role: "raw", onHand: 0 },
      { id: `n-${size}`, sku: `${size}N`, name: `${size}, No Paint (Sorted, unmilled)`, kind: "board", category: "wood", groupId, role: "sortedN", boardsPerUnit: perUnit, onHand: 0 },
      { id: `p-${size}`, sku: `${size}P`, name: `${size}, One Side Painted (Sorted, unmilled)`, kind: "board", category: "wood", groupId, role: "sortedP", boardsPerUnit: perUnit, onHand: 0 },
    ];
  }),
  { id: "p5", sku: "MILL-STOCK", name: "Mill Stock (Slush Inventory)", kind: "board", category: "wood", role: "millStock", unitLabel: "board", onHand: 0 },
  // Paint — tracked in gallons, not bucket counts. Converted from the old
  // bucket-count records assuming 5-gallon pails (double check against
  // actual container size and correct if that assumption is off).
  // sfPerGallon follows the ~250 sf/gallon coverage rate already in use.
  { id: "gs1", sku: "GS-TABUNOKI", name: "Graphene Stone — Tabunoki", kind: "each", category: "paint", sfPerGallon: 250, onHand: 15 },
  { id: "gs2", sku: "GS-CARAMEL", name: "Graphene Stone — Caramel Corn", kind: "each", category: "paint", sfPerGallon: 250, onHand: 15 },
  { id: "gs3", sku: "GS-GRIZZLE", name: "Graphene Stone — Grizzle Gray", kind: "each", category: "paint", sfPerGallon: 250, onHand: 10 },
  { id: "gs4", sku: "GS-FIRED", name: "Graphene Stone — Fired Brick", kind: "each", category: "paint", sfPerGallon: 250, onHand: 5 },
  { id: "gs5", sku: "GS-BLACK", name: "Graphene Stone — Black", kind: "each", category: "paint", sfPerGallon: 250, onHand: 10 },
  { id: "gs6", sku: "GS-WHITE", name: "Graphene Stone — White", kind: "each", category: "paint", sfPerGallon: 250, onHand: 5 },
  { id: "gs7", sku: "GS-SILKEN", name: "Graphene Stone — Silken Peacock White", kind: "each", category: "paint", sfPerGallon: 250, onHand: 5 },
];

// Vendor records, transcribed from the Wood Vendor Master List spreadsheet
// (July 2026). Per-size pricing is $/board and reflects rates noted at
// transcription time — check against the vendor before relying on it for
// a new PO. priceNotes carries anything that didn't cleanly split into the
// four size columns (delivery fees, bundle pricing, etc).
const SEED_VENDORS = [
  { id: "v01", name: "Agustin Decena-Rivera", altName: "Agustin Decena-Rivera", code: "AGUS", contact: "Agustin Decena", phone: "C: 408 561 0426", email: "", address: "", city: "", hidden: false, accountOwner: "Other", crews: "", has1099: true, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v02", name: "Alliance Fence Co", altName: "Gonzalo Rendon", code: "ALLF", contact: "Gonzalo Rendon", phone: "C: 408 835 7910", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: true, payMethod: "", notes: "", pricing: { "165": 0.5, "185": 0.5, "186": 0.5, fourFt: 0.5 }, priceNotes: "$.50/bd" },
  { id: "v03", name: "AMM", altName: "", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "Reg = $1.40, Paint = $.72. Delivery = $100/load" },
  { id: "v04", name: "Pedro/Bay Area", altName: "Pedro", code: "BARE", contact: "Pedro", phone: "4086306488", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "Cash", notes: "", pricing: { "165": 0.5, "185": 0.5, "186": 1.0 }, priceNotes: "4', paint 1 side = $125/unit, 185/165 = $150/unit, 186 = $300/unit" },
  { id: "v05", name: "Bay Side Fence", altName: "", code: "", contact: "Luis", phone: "925 759 7261", email: "", address: "", city: "", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v06", name: "Borg", altName: "", code: "", contact: "Ruben", phone: "", email: "", address: "7699 Marathon Dr. Livermore CA", city: "Livermore", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "", pricing: { "165": 0.75, "185": 0.75, "186": 0.75 }, priceNotes: "" },
  { id: "v07", name: "California Fence", altName: "", code: "", contact: "Antonio", phone: "925 337 5117", email: "", address: "2110 Rheem Dr Suite A, Pleasanton CA 94566", city: "Pleasanton", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "", pricing: { "185": 0.95, "186": 1.25 }, priceNotes: "" },
  { id: "v08", name: "C&J Fence", altName: "Chris French", code: "CJFE", contact: "Cameron", phone: "925 382 2648", email: "cameron@candjfencing.com", address: "", city: "", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "Ops manager, worked with Borg. Can stack. Cameron cell 925 915 3786. Wants PO sent over. Plastic banding 300 boards. Indoor storage — maybe stock up before winter. Timeline ~2 weeks as of 5/12/26.", pricing: { "165": 0.5, "186": 0.75, "185": 0.75 }, priceNotes: "Paint all sizes = $.50" },
  { id: "v09", name: "Coastal Lumber/Companies", altName: "David Morosoli", code: "", contact: "David Morosoli", phone: "C: 805 668 7121", email: "davem@coastal-lumber.com", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v10", name: "Cuevas Fence", altName: "Cuevas Fence", code: "CUEV", contact: "Fidel", phone: "408 334 6152", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "Mail Check", notes: "", pricing: {}, priceNotes: "0.55" },
  { id: "v11", name: "Danny Nguyen", altName: "Danny Nguyen", code: "DANN", contact: "Danny", phone: "C: 408 476 9215", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v12", name: "FCR Fence and Deck", altName: "", code: "", contact: "Zaid", phone: "", email: "", address: "111 Aurthur Rd, Martinez", city: "Martinez", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "5/12/26: Zaid — 2x 186, 3x 185, 1x 166, 1x 165", pricing: {}, priceNotes: "185/186 = $1.50, 166/165 = $1.25" },
  { id: "v13", name: "Finesse", altName: "", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: { "165": 1.0, "166": 1.0, "185": 1.0 }, priceNotes: "" },
  { id: "v14", name: "Fremont Fence", altName: "", code: "", contact: "Matthew", phone: "", email: "", address: "8040 Wells Ave., Ste B, Newark, CA 94560", city: "Newark", hidden: false, accountOwner: "Leo", crews: "Dad/Owner = Henry", has1099: false, payMethod: "", notes: "Inventory: (13) 185", pricing: { "165": 0.5, "185": 1.0, "186": 1.0 }, priceNotes: "" },
  { id: "v15", name: "Galvan's Fence", altName: "Josh Galvan", code: "GALV", contact: "Josh", phone: "C: 408 568 0483", email: "", address: "Newark, CA 94560", city: "Newark", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v16", name: "Geronimo Cobian", altName: "Geronimo Cobian", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "?" },
  { id: "v17", name: "Gustavo Fence", altName: "Gustavo", code: "", contact: "Gustavo", phone: "408 605 0874", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "TBD" },
  { id: "v18", name: "Hennessey Fencing", altName: "Hennessey Fencing", code: "HENN", contact: "Ricardo", phone: "408 910 7558", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "", notes: "1x 185, 186, 2x 166", pricing: { "165": 1.0, "166": 1.0, "185": 1.25, "186": 1.75, paint: 0.75 }, priceNotes: "" },
  { id: "v19", name: "Jaime Fence", altName: "Jaime", code: "", contact: "Jaime", phone: "408 313 8276", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v20", name: "Javier Fence", altName: "Javier", code: "", contact: "Javier", phone: "408 420 3042", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v21", name: "Los Gatos Fence and Deck", altName: "Leo", code: "LGFD", contact: "Leo", phone: "C: 408 460 4909", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v22", name: "Meza's Fence", altName: "Juan Meza", code: "MEZA", contact: "Juan, Jesse, John", phone: "408 806 1932", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "Yes", has1099: false, payMethod: "Mail Check", notes: "", pricing: { "185": 0.75 }, priceNotes: "0.75" },
  { id: "v23", name: "Marquez Fence", altName: "", code: "", contact: "David", phone: "", email: "", address: "37888 Von Euw Common, Fremont, CA 94536", city: "Fremont", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "", notes: "", pricing: { "165": 1.0, "166": 1.0, "185": 1.0, "186": 1.0 }, priceNotes: "" },
  { id: "v24", name: "Newark Fence", altName: "", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v25", name: "Octavio", altName: "", code: "", contact: "", phone: "4082778345", email: "", address: "", city: "", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v26", name: "Obeth Fence", altName: "Obeth", code: "", contact: "Obeth", phone: "956 413 4785", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "0.5" },
  { id: "v27", name: "P & L Fence", altName: "P & L Fence", code: "PL", contact: "Alexis", phone: "408 794 9608", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v28", name: "Jesus", altName: "", code: "", contact: "Jesus", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "Jesus — will call back", pricing: {}, priceNotes: "" },
  { id: "v29", name: "Roberto Fence", altName: "Roberto", code: "", contact: "Roberto", phone: "408 250 3426", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v30", name: "San Jose Fence", altName: "Juan", code: "SJFE", contact: "Juan", phone: "C: 408 529 3167", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v31", name: "Silicon Valley Builder's Group", altName: "Willy", code: "WILL", contact: "Willy", phone: "650 996 1928", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v32", name: "SMJ Fence", altName: "SMJ Fence", code: "SMJ", contact: "", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v33", name: "South Bay 5 Star Fence", altName: "Mike Ortiz", code: "SBAY", contact: "Mike Ortiz", phone: "408 771 5017", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v34", name: "Superbuilders", altName: "Superbuilders", code: "SB", contact: "Brian", phone: "408 784 5454", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "Mail Check", notes: "", pricing: { "186": 1.35 }, priceNotes: "" },
  { id: "v35", name: "Skyline", altName: "", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v36", name: "Straight Line Fence", altName: "", code: "", contact: "Oscar", phone: "", email: "", address: "", city: "", hidden: false, accountOwner: "Leo", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v37", name: "Sylvestre and Sons", altName: "Marina Meza", code: "SYLV", contact: "Karina", phone: "408 674 7207", email: "", address: "", city: "", hidden: false, accountOwner: "Michael", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" },
  { id: "v38", name: "The Fence Man", altName: "Don", code: "TFM", contact: "Mario", phone: "408 348 1995", email: "", address: "", city: "", hidden: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "5/12/26: Mario doesn't have space, will ask his guy if he wants to save em.", pricing: {}, priceNotes: "0" },
];

/* ---------------- Helpers ---------------- */

const uid = () => Math.random().toString(36).slice(2, 9);
// WO/PO/Quote numbers: "{prefix}-{year}-{dayOfYear}{seqInDay}" — e.g. the
// first work order on day 206 of 2026 is "WO-2026-2061", the second is
// "WO-2026-2062". Editable afterward — this only picks a starting value.
function nextNumber(records, prefix) {
  const now = new Date();
  const year = now.getFullYear();
  const dayOfYear = Math.floor((now - new Date(year, 0, 1)) / 86400000) + 1;
  const dayStr = String(dayOfYear).padStart(3, "0");
  // A number can carry text after it ("WO-2026-2571-550 Bds 186N"), and
  // those still use up their sequence digit. Matching only bare numbers
  // skipped them and handed the same number out twice.
  const re = new RegExp(`^${prefix}-${year}-${dayStr}(\\d+)(?:-.*)?$`);
  const maxSeq = records.reduce((max, r) => {
    const m = re.exec((r.number || "").trim());
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `${prefix}-${year}-${dayStr}${maxSeq + 1}`;
}
// Splits a WO number into its nextNumber() base and whatever's been
// appended after it, if anything.
const WO_NUMBER_BASE_RE = /^([A-Z]+-\d{4}-\d+)(-.*)?$/;
// The shorthand the crew already types into WO numbers by hand — "400SF-
// 187N" for one product, a summed total for several. Empty until at
// least one line has both a product and a quantity.
function productSuffix(lines, products) {
  // Square feet of product only: an installation line isn't SF of anything.
  const valid = (lines || []).filter((l) => (Number(l.qtySF) || 0) > 0 && !isService(products.find((p) => p.id === l.productId)));
  if (!valid.length) return "";
  const skuOf = (l) => (products.find((p) => p.id === l.productId)?.sku || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  if (valid.length === 1) {
    const qty = Math.round(Number(valid[0].qtySF) || 0);
    const sku = skuOf(valid[0]);
    return sku ? `${qty}SF-${sku}` : `${qty}SF`;
  }
  const totalSF = Math.round(valid.reduce((sum, l) => sum + (Number(l.qtySF) || 0), 0));
  const skus = [...new Set(valid.map(skuOf).filter(Boolean))];
  return skus.length === 1 ? `${totalSF}SF-${skus[0]}` : `${totalSF}SF`;
}
// Resolves which raw product a sort-log entry refers to. Prefers the
// stable rawProductId (immune to renaming the SKU later); falls back to
// the legacy rawSku text match only for entries logged before this field
// existed, so old history doesn't just vanish.
/* ---------------- Inventory history ----------------
   Every change to a SKU's on-hand gets a row here: who, when, from what
   to what, and why. Counts, work, receiving and hand edits all land in
   the same place, so an item's history reads as one story rather than
   being scattered across the sort log, the PO units and nothing at all.

   Reasons are deliberately coarse — the detail lives on the record that
   caused the change, and this is the thread that ties them together. */
/* Stock floors at zero, and remembers how far past zero it was pushed.

   shortBy accumulates across batches so a SKU that keeps getting sorted
   after it has "run out" keeps growing its shortfall instead of resetting,
   and shortAt records when it last happened. Clearing it is what a real
   physical count does. */
function clampProducts(next, beforeMap) {
  return next.map((p) => {
    const prev = beforeMap.get(p.id);
    if (!prev) return p;
    let q = p;
    let short = 0;
    for (const key of ["onHand", "reworkQty", "wasteQty"]) {
      const v = Number(q[key]) || 0;
      if (v < 0) { short += -v; q = { ...q, [key]: 0 }; }
    }
    if (!short) return q;
    return { ...q, shortBy: (Number(prev.shortBy) || 0) + short, shortAt: today() };
  });
}

const ADJ_REASON = {
  count: "Physical count",
  work: "Production",
  receive: "Received",
  edit: "Hand edit",
};

function makeAdjustment({ productId, from, to, reason, note, by, sessionId }) {
  return {
    id: uid(),
    productId,
    at: new Date().toISOString(),
    from: Number(from) || 0,
    to: Number(to) || 0,
    delta: (Number(to) || 0) - (Number(from) || 0),
    reason: reason || "edit",
    note: note || "",
    by: by || "",
    sessionId: sessionId || "",
  };
}

/* ---------------- Work-log shape helpers ----------------
   The log holds two record shapes: the original Sort entries
   (rawBoards -> toN/toP/toMill/toWaste) and the generalised per-step ones
   (inboundBoards -> outboundBoards/wasteBoards). Reports and rate targets
   read through these so neither has to care which it's looking at. */
const logStep = (e) => e.step || "sorting";

/* Newest first, by when the work actually happened.

   The log list used to render the array in storage order, which is NOT
   chronological: mergeCollections appends records it has never seen to the
   END of the array, so every batch saved on another phone landed at the
   bottom. Combined with a 15-row cap that made six days of production look
   deleted — the rows were there the whole time, just past the cutoff. */
const byNewest = (a, b) =>
  String(b.startedAt || b.date || "").localeCompare(String(a.startedAt || a.date || ""));
const logBoardsIn = (e) => Number(e.inboundBoards ?? e.rawBoards) || 0;
const logBoardsOut = (e) =>
  e.outboundBoards != null
    ? Number(e.outboundBoards) || 0
    : (Number(e.toN) || 0) + (Number(e.toP) || 0) + (Number(e.toMill) || 0);
const logWaste = (e) => Number(e.wasteBoards ?? e.toWaste) || 0;

// Historical boards/hour for a step, and the goal we hold the crew to:
// 10% above whatever the current average is, so the bar moves as the
// floor gets faster. Only entries with a real timer count — logging a
// batch with no time would otherwise read as infinitely fast.
const TARGET_MULTIPLIER = 1.1;
function stepRate(sortLog, step) {
  const rows = (sortLog || []).filter((e) => (!step || logStep(e) === step) && Number(e.seconds) > 0);
  const boards = rows.reduce((sum, e) => sum + logBoardsIn(e), 0);
  const seconds = rows.reduce((sum, e) => sum + (Number(e.seconds) || 0), 0);
  const rate = seconds > 0 ? boards / (seconds / 3600) : 0;
  return { boards, seconds, rate, target: rate * TARGET_MULTIPLIER, samples: rows.length };
}

// Services (installation, delivery) are sold, not stocked: no count, no
// square feet, no place on the floor. Like packaging they sell in their
// own unit: "ea" for a flat charge, or "sf" to price by the square foot.
const isService = (p) => p?.category === "service";
const canonicalUnitFor = (p) =>
  p.category === "paint" ? "gal" : (p.category === "packing" || isService(p)) ? (p.unitLabel || "ea") : (p.kind === "sf" ? "sf" : "board");
const hasSF = (p) => canonicalUnitFor(p) === "sf" || Object.keys(buildUnitGraph(p)).includes("sf");
// A product names its raw source one of two ways: a finished SF good
// points at it directly (sourceBoardSku), while a sorted-but-unmilled
// board (185N/185P — sold as-is to customers who want unmilled stock)
// shares a groupId with its raw sibling instead — same pattern SortingTab
// uses to find where boards land.
const findRawSource = (p, products) => {
  if (!p) return null;
  if (p.sourceBoardSku) return products.find((r) => r.sku === p.sourceBoardSku) || null;
  if (p.groupId) return products.find((r) => r.groupId === p.groupId && r.role === "raw") || null;
  return null;
};

const resolveRawProduct = (entry, products) => {
  if (entry?.rawProductId) return products.find((p) => p.id === entry.rawProductId) || null;
  if (entry?.rawSku) return products.find((p) => p.sku === entry.rawSku) || null;
  return null;
};
const today = () => new Date().toISOString().slice(0, 10);
const num = (n, d = 0) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Wood conversions all route through "board" as the hub unit — that's
// what makes box and pallet relate correctly to SF and planks without
// Builds a unit graph for one SKU: each node is a unit name, each edge a
// multiplier (1 of nodeA = factor of nodeB). Both the built-in fields
// (planksPerBoard, sfPerBoard, boardsPerUnit) and the open-ended
// "qtyA unitA = qtyB unitB" conversions list feed the same graph, so
// board/plank/sf/pallet/box/anything-custom all interconvert correctly
// as long as SOME chain of edges connects them.
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
function convertViaGraph(product, qty, fromUnit, toUnit) {
  const q = Number(qty) || 0;
  if (fromUnit === toUnit) return q;
  const graph = buildUnitGraph(product);
  const visited = new Set([fromUnit]);
  const queue = [[fromUnit, 1]];
  while (queue.length) {
    const [node, mult] = queue.shift();
    if (node === toUnit) return q * mult;
    const neighbors = graph[node] || {};
    for (const next in neighbors) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, mult * neighbors[next]]);
      }
    }
  }
  return q; // no path between these two units yet — return unconverted rather than crash
}
function toGallons(product, qty, fromUnit) {
  const q = Number(qty) || 0;
  if (fromUnit === "gal") return q;
  if (fromUnit === "qt") return q / 4;
  if (fromUnit === "sf") {
    const sfg = Number(product?.sfPerGallon) || 0;
    return sfg > 0 ? q / sfg : q;
  }
  return q;
}
function toQuarts(product, qty, fromUnit) {
  return toGallons(product, qty, fromUnit) * 4;
}
function convertQty(product, qty, fromUnit, toUnit) {
  if (fromUnit === toUnit) return Number(qty) || 0;
  if (product?.category === "paint") {
    if (toUnit === "gal") return toGallons(product, qty, fromUnit);
    if (toUnit === "qt") return toQuarts(product, qty, fromUnit);
    if (toUnit === "sf") {
      const gal = toGallons(product, qty, fromUnit);
      const sfg = Number(product?.sfPerGallon) || 0;
      return sfg > 0 ? gal * sfg : gal;
    }
    return Number(qty) || 0;
  }
  return convertViaGraph(product, qty, fromUnit, toUnit);
}
function unitsFor(product) {
  if (!product) return ["sf", "board", "plank"];
  if (product.category === "paint") return ["gal", "qt", "sf"];
  if (product.category === "packing" || isService(product)) return [product.unitLabel || "ea"];
  const units = new Set(["board", "plank", "sf"]);
  const graph = buildUnitGraph(product);
  Object.keys(graph).forEach((u) => units.add(u));
  return Array.from(units);
}
const unitLabel = (u) => (u === "sf" ? "SF" : u === "board" ? "boards" : u === "plank" ? "planks" : u === "gal" ? "gal" : u === "qt" ? "qt" : u === "box" ? "boxes" : u === "pallet" ? "pallets" : u);

const inputStyle = {
  border: `1px solid ${C.kraftDark}`,
  background: "#fff",
  color: C.ink,
  borderRadius: 3,
  padding: "8px 10px",
  fontSize: 15,
  width: "100%",
  outline: "none",
};

const Field = ({ label, children, w, required }) => (
  <label className="block" style={{ width: w }}>
    <span className="block text-xs uppercase tracking-wider mb-1" style={{ color: C.faint, fontFamily: MONO }}>
      {label}{required && <span style={{ color: C.redwood }}> *</span>}
    </span>
    {children}
  </label>
);

const Btn = ({ children, onClick, kind = "ghost", title, disabled, big }) => {
  const styles = {
    primary: { background: C.redwood, color: "#fff", border: `1px solid ${C.redwoodDark}` },
    // Solid, not transparent. These sit on dark ink panels as often as on the
    // light page, and dark-on-transparent made them invisible on the dark ones.
    ghost: { background: "#fff", color: C.ink, border: `1px solid ${C.kraftDark}` },
    dark: { background: C.ink, color: "#fff", border: `1px solid ${C.ink}` },
    moss: { background: C.moss, color: "#fff", border: `1px solid ${C.moss}` },
  }[kind];
  return (
    <button
      onClick={onClick} title={title} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-sm transition-opacity hover:opacity-85 disabled:opacity-40"
      style={{
        ...styles, fontFamily: MONO, letterSpacing: "0.03em",
        fontSize: big ? 15 : 12, padding: big ? "12px 18px" : "7px 12px",
      }}
    >
      {children}
    </button>
  );
};

function UnitSwitchInput({ product, value, canonicalUnit, onChange, displayUnit, onDisplayUnitChange, width = 90 }) {
  const units = unitsFor(product);
  const shown = convertQty(product, value, canonicalUnit, displayUnit);
  const shownRounded = Number.isFinite(shown) ? Math.round(shown * 100) / 100 : "";
  return (
    <div className="flex items-center gap-1">
      <input
        type="number" style={{ ...inputStyle, width, textAlign: "right", fontFamily: MONO }}
        value={shownRounded}
        onChange={(e) => {
          const entered = e.target.value;
          const canon = convertQty(product, entered, displayUnit, canonicalUnit);
          onChange(Number.isFinite(canon) ? canon : 0);
        }}
      />
      {units.length > 1 ? (
        <select
          style={{ ...inputStyle, width: 78, padding: "8px 4px", fontFamily: MONO, fontSize: 12 }}
          value={displayUnit} onChange={(e) => onDisplayUnitChange(e.target.value)}
        >
          {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
        </select>
      ) : (
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint, width: 60 }}>{unitLabel(units[0])}</span>
      )}
    </div>
  );
}

// Simplified to two real states — the old 5-stage pipeline (sorting →
// milling → packed) assumed every order gets milled, which isn't true;
// the per-line Process Steps checklist above tracks the real detail now.
// This is just open vs. done, with a direct one-click way to push an
// order through rather than clicking through stages that don't apply.
// The stages a job moves through on the floor. Labels and colors for the
// middle stages have always existed here; the flow itself used to be
// collapsed to just open/shipped, which made the board useless. Older work
// orders carrying only "not_started"/"shipped" still land correctly on the
// first and last columns, so no data migration is needed.
const STATUS_FLOW = ["not_started", "sorting", "milling", "packed", "shipped"];
const STATUS_LABEL = {
  not_started: "Open", sorting: "Sorting", milling: "Milling", packed: "Packed", shipped: "Shipped",
};
// What "still on the floor" means for work-order pickers on the log
// forms — packed and shipped orders are done, so logging against them
// would just be a mistake waiting to happen.
const ACTIVE_WO_STATUSES = ["not_started", "sorting", "milling"];
const STATUS_COLOR = {
  not_started: C.faint, sorting: C.gold, milling: C.redwood, packed: C.moss, shipped: C.ink,
};

// The granular steps that actually happen to a given line item — set as
// defaults on the product itself (what this SKU usually needs), then
// copied onto each work order line when that product is picked, and
// editable per-order from there since not every order needs every step
// (e.g. a sorted-only order skips milling entirely).
const PROCESS_STEPS = [
  { id: "sorting", label: "Sort" },
  { id: "chop", label: "Chop" },
  { id: "metal", label: "Metal" },
  { id: "rip", label: "Rip" },
  { id: "resaw", label: "Resaw" },
  { id: "plane", label: "Plane" },
  { id: "mold", label: "Mould" },
  { id: "brush", label: "Brush 1" },
  { id: "paint", label: "Paint" },
  { id: "distress", label: "Brush 2" },
  { id: "trim", label: "Trim" },
  { id: "pack", label: "Pack" },
  { id: "ship", label: "Ship" },
];
const defaultSteps = () => PROCESS_STEPS.reduce((acc, s) => ({ ...acc, [s.id]: false }), {});

const fmtDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const hoursDecimal = (seconds) => (Number(seconds) || 0) / 3600;

// `onDark` is for the app header, where this sits on the dark ink bar and
// needs light text. On a normal light panel it must use the standard input
// colors — white-on-white is otherwise invisible.
/* Shows a quantity in every unit the SKU knows about at once — boards,
   pallets, square feet, boxes — and lets you type into any of them, with
   the rest following. Everything still stores in the canonical unit; the
   other boxes are just views onto it.

   The focused box keeps whatever you literally typed rather than being
   re-derived, otherwise typing "12" pallets would convert after the "1"
   and rewrite the box out from under you. */
const Badge = ({ children, color }) => (
  <span className="px-2 py-0.5 rounded-sm text-xs font-bold" style={{ background: color, color: "#fff", fontFamily: MONO }}>{children}</span>
);

/* ---------------- DataTable: the one list layout every tab uses ----------
   Every browsable collection in this app (customers, vendors, inventory,
   quotes, sales orders, work orders, purchase orders) renders through
   this, so they all sort, search, and archive the same way.

   - Click a column header to sort by it; click again to flip direction.
   - Drag a row by its grip to hand-order it; dragging always switches the
     view back to "manual" order (same array-splice mechanic as GNWS Ops's
     nav-tab reordering).
   - `pinnedId` floats a just-created row to the very top regardless of
     sort, so a new record never gets buried alphabetically mid-list.
   - Archiving is opt-in per tab (`onToggleArchive`): archived rows drop
     out of the list until "Show archived" is ticked, instead of being
     deleted outright. -------------------------------------------------- */

function DataTable({
  items, setItems, columns, onRowClick, keyFor = (x) => x.id,
  searchable, searchText, pinnedId,
  isArchived, onToggleArchive, archiveLabel = "archived",
  emptyText = "Nothing here yet.",
}) {
  const [sortBy, setSortBy] = useState("manual");
  const [sortDir, setSortDir] = useState("asc");
  const [draggedId, setDraggedId] = useState(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = isArchived ? items.filter(isArchived).length : 0;

  let working = items;
  if (isArchived && !showArchived) working = working.filter((x) => !isArchived(x) || keyFor(x) === pinnedId);
  if (searchable && query.trim()) {
    const q = query.trim().toLowerCase();
    working = working.filter((x) => (searchText ? searchText(x) : "").toLowerCase().includes(q));
  }

  const sortCol = columns.find((c) => c.id === sortBy);
  let shown = sortCol
    ? working.slice().sort((a, b) => {
        const av = sortCol.sortValue(a);
        const bv = sortCol.sortValue(b);
        const cmp = typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : working;

  if (pinnedId) {
    const pinned = shown.find((x) => keyFor(x) === pinnedId);
    if (pinned) shown = [pinned, ...shown.filter((x) => keyFor(x) !== pinnedId)];
  }

  const reorder = (targetId) => {
    if (!draggedId || draggedId === targetId || !setItems) return;
    const dragged = items.find((x) => keyFor(x) === draggedId);
    const without = items.filter((x) => keyFor(x) !== draggedId);
    const targetIndex = without.findIndex((x) => keyFor(x) === targetId);
    without.splice(targetIndex === -1 ? without.length : targetIndex, 0, dragged);
    setItems(without);
    setSortBy("manual");
  };

  const toggleSort = (colId) => {
    if (sortBy === colId) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(colId); setSortDir("asc"); }
  };

  const showToolbar = searchable || archivedCount > 0;

  return (
    <div>
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-3 mb-2">
          {searchable && (
            <div className="relative" style={{ flex: "1 1 240px", maxWidth: 360 }}>
              <Search size={13} style={{ position: "absolute", left: 9, top: 10, color: C.faint }} />
              <input
                style={{ ...inputStyle, paddingLeft: 28, fontSize: 13 }}
                placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {archivedCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs" style={{ color: C.faint, fontFamily: MONO }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show {archiveLabel} ({archivedCount})
            </label>
          )}
        </div>
      )}

      <div className="rounded-sm overflow-hidden overflow-x-auto" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.kraft }}>
              {setItems && <th style={{ width: 28 }}></th>}
              {columns.map((c) => (
                <th
                  key={c.id} onClick={() => c.sortValue && toggleSort(c.id)}
                  className="text-left px-3 py-2"
                  style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.05em", color: C.faint, cursor: c.sortValue ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
                >
                  {c.label}{sortBy === c.id ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              {onToggleArchive && <th style={{ width: 34 }}></th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={columns.length + 2} className="px-4 py-8 text-center text-sm" style={{ color: C.faint }}>
                {query.trim() ? `No matches for "${query.trim()}".` : emptyText}
              </td></tr>
            )}
            {shown.map((item) => {
              const id = keyFor(item);
              const archived = isArchived ? isArchived(item) : false;
              return (
                <tr
                  key={id}
                  draggable={!!setItems}
                  onDragStart={() => setDraggedId(id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); reorder(id); setDraggedId(null); }}
                  onDragEnd={() => setDraggedId(null)}
                  onClick={() => onRowClick(item)}
                  style={{
                    borderBottom: `1px solid ${C.kraft}`, cursor: "pointer",
                    opacity: draggedId === id ? 0.4 : archived ? 0.5 : 1,
                    background: id === pinnedId ? "#fffaf0" : undefined,
                  }}
                >
                  {setItems && (
                    <td className="px-2 text-center" style={{ color: C.kraftDark, cursor: "grab" }} onClick={(e) => e.stopPropagation()}>
                      <GripVertical size={14} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.id} className="px-3 py-2">{c.render(item)}</td>
                  ))}
                  {onToggleArchive && (
                    <td className="px-2 text-center" onClick={(e) => { e.stopPropagation(); onToggleArchive(item); }}>
                      <button
                        title={archived ? `Restore from ${archiveLabel}` : `Move to ${archiveLabel}`}
                        className="opacity-40 hover:opacity-100"
                      >
                        {archived ? <RotateCcw size={13} /> : <Archive size={13} />}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MultiUnitQty({ product, value, onChange, disabled }) {
  const [editing, setEditing] = useState(null); // { unit, raw }
  const canonical = canonicalUnitFor(product);
  // Only units this SKU actually defines a conversion for. unitsFor() always
  // seeds board/plank/sf, which would show "3,498 planks" for a product with
  // no plank conversion at all — implying 1:1 when nothing of the sort is set.
  const graph = buildUnitGraph(product);
  const shown = [canonical, ...Object.keys(graph).filter((u) => u !== canonical)];

  const display = (u) => {
    if (editing && editing.unit === u) return editing.raw;
    const q = convertQty(product, value, canonical, u);
    if (!Number.isFinite(q)) return "";
    // Boards and boxes come in whole numbers; SF and pallets don't.
    const dp = u === "board" || u === "plank" ? 0 : 2;
    return String(Math.round(q * 10 ** dp) / 10 ** dp);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {shown.map((u) => (
        <Field key={u} label={unitLabel(u)} w={104}>
          <input
            type="number" style={{ ...inputStyle, fontFamily: MONO, textAlign: "right" }}
            value={display(u)} disabled={disabled}
            onFocus={() => setEditing({ unit: u, raw: display(u) })}
            onBlur={() => setEditing(null)}
            onChange={(e) => {
              const raw = e.target.value;
              setEditing({ unit: u, raw });
              const asCanonical = convertQty(product, raw, u, canonical);
              onChange(Number.isFinite(asCanonical) ? asCanonical : 0);
            }}
          />
        </Field>
      ))}
    </div>
  );
}


/* Who's on this batch. Sorting is regularly a two-person job, and the log
   only ever had room for one name, so the second person's work went
   unrecorded. Tap a name to add or drop them.

   The first name picked also becomes the app-wide "who's working", so the
   header and the time clock keep pointing at a real person. */
function CrewSelect({ team, crew, onChange, onAddMember, label = "Who's working on this" }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const toggle = (name) => onChange(crew.includes(name) ? crew.filter((n) => n !== name) : [...crew, name]);
  const commit = () => {
    const n = newName.trim();
    if (n) { onAddMember(n); onChange([...crew.filter((x) => x !== n), n]); }
    setAdding(false); setNewName("");
  };
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5" style={{ fontSize: 11, fontWeight: 700, color: C.faint, fontFamily: MONO, letterSpacing: 0.4 }}>
        <User size={13} /> {label.toUpperCase()}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {team.map((t) => {
          const on = crew.includes(t);
          return (
            <button
              key={t} onClick={() => toggle(t)}
              className="px-3 py-2 rounded-sm"
              style={{
                fontFamily: MONO, fontSize: 13, fontWeight: on ? 700 : 400,
                background: on ? C.ink : "transparent",
                color: on ? "#fff" : C.ink,
                border: `1px solid ${on ? C.ink : C.kraftDark}`,
              }}
            >
              {on ? "\u2713 " : ""}{t}
            </button>
          );
        })}
        {adding ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus style={{ ...inputStyle, width: 120, padding: "6px 8px", fontSize: 13 }}
              value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name"
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") { setAdding(false); setNewName(""); }
              }}
            />
            <button onClick={commit} style={{ color: C.kraftDark }}><Check size={15} /></button>
          </span>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-2 rounded-sm"
            style={{ fontFamily: MONO, fontSize: 13, color: C.faint, border: `1px dashed ${C.kraftDark}` }}
          >
            + Add name
          </button>
        )}
      </div>
      {crew.length === 0 && (
        <div className="mt-1.5 text-xs" style={{ color: C.warn }}>Tap your name — more than one if two of you are on it.</div>
      )}
    </div>
  );
}

/* ---------------- Phone Back button ----------------
   Android and iOS both treat Back as "up one level". This is a single
   page, so nothing here ever created a history entry — which meant the
   very first Back press left the site entirely. On a phone, with the app
   pinned to the home screen, that reads as the whole app disappearing.

   Instead of threading a router through everything, any screen that can
   be "backed out of" — a detail view, a modal, a print sheet — registers
   itself here while it is open. One spare history entry is kept armed at
   all times; a Back press pops that entry, we close the innermost layer
   ourselves, and re-arm. Only when there is nothing left to close does
   Back actually leave. */
const backLayers = [];

/* One spare history entry is kept in front of us so a Back press always
   has something to pop. It gets consumed on every press, so anything that
   moves around inside the app re-arms it — otherwise letting one press
   through to leave would leave Back permanently dead. */
let backArmed = false;
function armBack() {
  if (backArmed) return;
  try { window.history.pushState({ gnws: 1 }, ""); backArmed = true; } catch { /* history unavailable */ }
}

function useBackLayer(active, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    // Registered by identity, so unmounting removes the right one even
    // when several layers are stacked.
    const entry = { close: () => closeRef.current() };
    backLayers.push(entry);
    armBack();
    return () => {
      const i = backLayers.indexOf(entry);
      if (i >= 0) backLayers.splice(i, 1);
    };
  }, [active]);
}

function WhoSelect({ team, current, onChange, onAddMember, onDark = false, big = false }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  return (
    <div className="flex items-center gap-2">
      <User size={14} style={{ color: C.kraftDark }} />
      {adding ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus style={{ ...inputStyle, width: 120, padding: "4px 8px", fontSize: 13 }}
            value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) { onAddMember(newName.trim()); onChange(newName.trim()); setAdding(false); setNewName(""); }
              if (e.key === "Escape") { setAdding(false); setNewName(""); }
            }}
          />
          <button onClick={() => { if (newName.trim()) { onAddMember(newName.trim()); onChange(newName.trim()); } setAdding(false); setNewName(""); }} style={{ color: C.kraftDark }}><Check size={14} /></button>
        </div>
      ) : (
        <select
          style={{
            ...inputStyle,
            width: big ? "100%" : 140,
            padding: big ? "10px 12px" : "4px 8px",
            fontSize: big ? 16 : 13,
            ...(onDark ? { background: "transparent", color: "#fff", borderColor: "#4a423a" } : null),
          }}
          value={current || ""}
          onChange={(e) => (e.target.value === "__add" ? setAdding(true) : onChange(e.target.value))}
        >
          <option value="">Who's working?</option>
          {team.map((t) => <option key={t} value={t}>{t}</option>)}
          <option value="__add">+ Add name…</option>
        </select>
      )}
    </div>
  );
}

function Dashboard({ workOrders, products, sortLog, onOpenWO, goTab, whoWorking, customerUpdates, customers, sender, onCustomerUpdate }) {
  const byStatus = STATUS_FLOW.reduce((acc, s) => ({ ...acc, [s]: workOrders.filter((w) => w.status === s).length }), {});
  const todaysSorts = sortLog.filter((s) => s.date === today());
  const [reorderKind, setReorderKind] = useState(null); // "wood" | "nonwood" | null

  // Monday-start, so "this week" resets the same day the shop week does.
  const weekBegin = weekStart(today());
  const inThisWeek = (d) => !!d && d >= weekBegin && d <= today();

  // Shipped is a one-way door (a work order never leaves "shipped"), so a
  // plain count of it is really a lifetime total. shippedAt is the real
  // timestamp; orders older than that field fall back to their planned
  // ship date.
  const shippedThisWeek = workOrders.filter((w) => w.status === "shipped" && inThisWeek(w.shippedAt ? localDay(w.shippedAt) : (w.shipDate || null))).length;

  // The one thing that actually stops a work order: a line that needs
  // more of a product than is on hand, where the raw stock behind it
  // (sourceBoardSku, the board that mills into it) can't cover the gap
  // either. Only checked against orders still being worked — packed and
  // shipped ones already have their material. A line marked done already
  // got what it needed, so it's skipped too.
  const woShortages = workOrders
    .filter((w) => ACTIVE_WO_STATUSES.includes(w.status))
    .flatMap((w) => (w.lines || [])
      .filter((l) => !l.done && l.productId)
      .map((l) => {
        const p = products.find((x) => x.id === l.productId);
        const needSF = Number(l.qtySF) || 0;
        if (!p || needSF <= 0 || !hasSF(p)) return null;
        const haveSF = convertQty(p, p.onHand, canonicalUnitFor(p), "sf");
        const gapSF = needSF - haveSF;
        if (gapSF <= 0) return null;
        const raw = findRawSource(p, products);
        const rawCapacitySF = raw ? convertQty(p, raw.onHand, "board", "sf") : 0;
        const shortSF = gapSF - rawCapacitySF;
        if (shortSF <= 0) return null;
        return { wo: w, product: p, raw, needSF, haveSF, rawCapacitySF, shortSF };
      })
      .filter(Boolean));

  // Work logs recorded this week (any process step), by whoever logged
  // them — a quick scoreboard, most logs first.
  const logsByPerson = {};
  sortLog.filter((s) => inThisWeek(s.date)).forEach((s) => {
    const name = String(s.by || "").trim() || "Unattributed";
    logsByPerson[name] = (logsByPerson[name] || 0) + 1;
  });
  const leaderboard = Object.entries(logsByPerson)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <CustomerUpdatesPanel
        updates={customerUpdates} customers={customers || []} products={products}
        sender={sender} onHandled={onCustomerUpdate} onOpenWO={onOpenWO}
      />
      {woShortages.length > 0 && (
        <div className="rounded-sm p-5 mb-5" style={{ background: C.redwood, border: `2px solid ${C.redwoodDark}` }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={24} color="#fff" style={{ flexShrink: 0 }} />
            <div style={{ fontWeight: 900, fontSize: 19, color: "#fff" }}>
              {woShortages.length} work order line{woShortages.length === 1 ? "" : "s"} short on material — reorder now
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {woShortages.map(({ wo, product, raw, needSF, haveSF, rawCapacitySF, shortSF }, i) => (
              <button
                key={`${wo.id}-${product.id}-${i}`} onClick={() => onOpenWO(wo.id)}
                className="w-full text-left px-3 py-2 rounded-sm hover:opacity-90 transition-opacity"
                style={{ background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.4)" }}
              >
                <div style={{ color: "#fff", fontWeight: 800, fontFamily: MONO }}>
                  {wo.number} · {wo.customerName || "No customer"}
                </div>
                <div style={{ color: "#fff", fontSize: 13, opacity: 0.92 }}>
                  <strong>{product.sku}</strong> — need {num(needSF)} SF, have {num(haveSF)} SF on hand
                  {raw ? ` + ${num(rawCapacitySF)} SF worth of ${raw.sku}` : " (no raw stock linked)"}
                  {" "}— short {num(shortSF)} SF
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        {STATUS_FLOW.map((s) => {
          const shipped = s === "shipped";
          return (
            <button
              key={s}
              onClick={() => goTab("orders")}
              className="rounded-sm p-4 text-left hover:shadow-md transition-shadow"
              style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, borderLeft: `4px solid ${STATUS_COLOR[s]}` }}
            >
              <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em" }}>
                {shipped ? "SHIPPED THIS WEEK" : STATUS_LABEL[s].toUpperCase()}
              </div>
              <div style={{ fontSize: 28, fontWeight: 900 }}>{shipped ? shippedThisWeek : byStatus[s]}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-sm p-4 mb-5" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em", marginBottom: 8 }}>RECORDED WORK LOGS · THIS WEEK</div>
        {leaderboard.length === 0 ? (
          <div className="text-sm" style={{ color: C.faint }}>Nothing logged yet this week.</div>
        ) : (
          <div className="space-y-1">
            {leaderboard.map((row, i) => (
              <div
                key={row.name} className="flex items-center gap-3 px-2 py-1.5 rounded-sm"
                style={{ background: i === 0 ? C.paper : "transparent" }}
              >
                <span style={{ fontFamily: MONO, fontWeight: 900, fontSize: 14, color: C.faint, width: 20 }}>{i + 1}</span>
                <span style={{ fontWeight: 700, flex: 1 }}>{row.name}</span>
                <span style={{ fontFamily: MONO, fontWeight: 800, color: C.ink }}>{row.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-sm p-4 mb-5" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em", marginBottom: 8 }}>REORDER</div>
        <div className="text-sm mb-3" style={{ color: C.faint }}>Out of something? Send a purchase request straight to Ero.</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Btn big onClick={() => setReorderKind("wood")}><Boxes size={16} /> Wood</Btn>
          <Btn big onClick={() => setReorderKind("nonwood")}><Package size={16} /> Non-wood (supplies)</Btn>
        </div>
      </div>

      {reorderKind && (
        <PurchaseRequestModal kind={reorderKind} whoWorking={whoWorking} onClose={() => setReorderKind(null)} />
      )}

      <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em", marginBottom: 6 }}>TODAY'S SORTING</div>
        {todaysSorts.length === 0 ? (
          <div className="text-sm" style={{ color: C.faint }}>No sorting logged today.</div>
        ) : (
          <div className="space-y-1">
            {todaysSorts.map((s) => (
              <div key={s.id} className="text-sm flex justify-between">
                <span>{s.batchLabel} · {s.by}</span>
                <span style={{ fontFamily: MONO, color: C.faint }}>{num(s.rawBoards)} bd → sorted</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// A quick "we're out of X" note, emailed to Ero. Opens the device's own
// mail app with the request pre-filled — no account or API key to keep
// working, at the cost of needing a mail app actually set up on it.
function PurchaseRequestModal({ kind, whoWorking, onClose }) {
  const [what, setWhat] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const kindLabel = kind === "wood" ? "Wood" : "Non-wood supplies";

  const send = () => {
    const subject = `Purchase request: ${kindLabel}${what ? ` — ${what}` : ""}`;
    const lines = [
      `What: ${what}`,
      amount ? `How much: ${amount}` : "",
      note ? `Note: ${note}` : "",
      `Requested by: ${whoWorking || "Not set on the dashboard"}`,
      `Sent from the GNWS Ops dashboard, ${new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`,
    ].filter(Boolean);
    // A plain window.location.href navigates the app itself to the mailto
    // link, which some browsers (and this app installed as a PWA) resolve
    // by loading a web mail client right over the app instead of handing
    // off to it. A clicked link with a non-http scheme is treated as a
    // hand-off instead, so the app stays put.
    const url = `mailto:${REORDER_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
    const a = document.createElement("a");
    a.href = url;
    a.click();
    setSent(true);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Reorder: {kindLabel}</div>
          <CloseBtn onClose={onClose} />
        </div>

        {sent ? (
          <>
            <div className="text-sm" style={{ color: C.ink }}>
              Your mail app should have opened with this request ready to go — just hit send there.
            </div>
            <div className="mt-4">
              <Btn kind="primary" big onClick={onClose}>Done</Btn>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <Field label="What do you need" required>
                <input
                  autoFocus type="text" style={inputStyle} value={what}
                  onChange={(e) => setWhat(e.target.value)}
                  placeholder={kind === "wood" ? "e.g. 6\" x 48\" End Trim, Natural" : "e.g. 16-gauge finish nails"}
                />
              </Field>
              <Field label="How much">
                <input
                  type="text" style={inputStyle} value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 2 boxes, or however you'd say it"
                />
              </Field>
              <Field label="Note">
                <input
                  type="text" style={inputStyle} value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything else Ero should know"
                />
              </Field>
              <div className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
                Requested by: {whoWorking || "not set — pick who's working from the menu first"}
              </div>
            </div>
            <div className="mt-4">
              <Btn kind="primary" big disabled={!what.trim()} onClick={send}>
                <Mail size={16} /> Send request
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// The job's name as people say it. Orders from before titles existed often
// had one typed onto the end of the number ("WO-2026-2512-Install 105SF"),
// or typed in place of the number entirely ("320sf 7in brushed tng"), so
// that text stands in until a real title is set. Without it those cards
// all read as just the customer, three "Huasna Wood"s in a row.
function woTitle(wo) {
  const t = (wo.title || "").trim();
  if (t) return t;
  const n = (wo.number || "").trim();
  const m = WO_NUMBER_BASE_RE.exec(n);
  if (!m) return n;
  return m[2] ? m[2].replace(/^[-\s]+/, "").trim() : "";
}
// For pickers: a real title first when there is one, then the number.
const woPickLabel = (w) => `${(w.title || "").trim() ? `${w.title.trim()} · ` : ""}${w.number} · ${w.customerName || "No customer"}`;

// Due out by the end of this week (Sunday), including anything overdue
// that hasn't shipped. Uses the ship date, or ready-by when there's no
// ship date yet.
function woDueThisWeek(wo) {
  if (wo.status === "shipped") return false;
  const due = wo.shipDate || wo.readyByDate;
  if (!due) return false;
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  const sunday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return due <= sunday;
}

// Urgent star. Lights on its own for anything due out this week, in a
// lighter gold; clicking stars it on purpose, in solid gold, and a star
// set by hand stays lit whatever the dates say.
function WoStar({ wo, onToggle, size = 16 }) {
  const week = woDueThisWeek(wo);
  const lit = !!wo.starred || week;
  const tip = wo.starred ? "Starred as urgent. Click to unstar."
    : week ? "Due out this week, so it's lit on its own. Click to star it as well."
    : "Click to star as urgent";
  return (
    <button
      type="button" draggable={false} title={tip}
      onClick={(e) => { e.stopPropagation(); onToggle(wo.id); }}
      className="shrink-0" style={{ lineHeight: 0, color: lit ? C.gold : C.kraftDark }}
    >
      <Star size={size} fill={wo.starred ? C.gold : week ? "#EAD7A4" : "none"} />
    </button>
  );
}

// Manual order: cards someone has placed keep their spot, and anything
// never placed falls in after them by ready date.
const byBoardRank = (a, b) => {
  const A = Number.isFinite(a.rank) ? a.rank : Infinity;
  const B = Number.isFinite(b.rank) ? b.rank : Infinity;
  return A === B ? byReadyDate(a, b) : A - B;
};

/* Kanban view of the shop floor: one column per pipeline stage. Drag a
   card to another column to move the job along, or up and down inside a
   column to put jobs in the order they should run. Same board the office
   side sees, so both halves of the business describe a job the same way.

   Cards lead with the job title. The WO number stays on each card as a
   hidden element (hovering shows it): it's a filing number, not what
   anyone reads the board by. */
function WorkOrderKanban({ workOrders, products, goals, onOpen, onMove, onToggleStar }) {
  const [draggedId, setDraggedId] = useState(null);
  // Where the dragged card would land: which column, and the card it
  // would sit in front of (null means the bottom of that column).
  const [drop, setDrop] = useState(null);
  const finish = () => { setDraggedId(null); setDrop(null); };
  const aim = (status, beforeId) =>
    setDrop((d) => (d && d.status === status && d.beforeId === beforeId ? d : { status, beforeId }));

  const commit = (status, beforeId) => {
    if (!draggedId) return finish();
    const ids = workOrders
      .filter((w) => (w.status || "not_started") === status && w.id !== draggedId)
      .map((w) => w.id);
    const at = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(at < 0 ? ids.length : at, 0, draggedId);
    onMove(draggedId, status, ids);
    finish();
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {STATUS_FLOW.map((status) => {
        const col = workOrders.filter((w) => (w.status || "not_started") === status);
        const others = col.filter((w) => w.id !== draggedId);
        const isOver = drop?.status === status;
        const color = STATUS_COLOR[status];
        return (
          <div
            key={status}
            onDragOver={(e) => { e.preventDefault(); setDrop((d) => (d?.status === status ? d : { status, beforeId: null })); }}
            onDrop={(e) => { e.preventDefault(); commit(status, drop?.status === status ? drop.beforeId : null); }}
            className="rounded-sm shrink-0"
            style={{
              width: 240, minHeight: 240,
              background: isOver ? "#fffaf0" : C.panel,
              border: `1px solid ${isOver ? STATUS_COLOR[status] : C.kraftDark}`,
              borderTop: `4px solid ${STATUS_COLOR[status]}`,
            }}
          >
            <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.kraft}` }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.06em", color: C.faint }}>
                {STATUS_LABEL[status].toUpperCase()}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 800 }}>{col.length}</span>
            </div>
            <div className="p-2 space-y-2">
              {col.length === 0 && <div className="text-center py-4 text-xs" style={{ color: C.faint }}>—</div>}
              {col.map((w) => {
                const late = w.readyByDate && w.readyByDate < today() && status !== "shipped";
                const title = woTitle(w);
                const urgent = !!w.starred || woDueThisWeek(w);
                // The drop line, drawn as a shadow so it never shifts the
                // cards under the pointer while dragging.
                const lineAbove = isOver && draggedId && drop.beforeId === w.id && w.id !== draggedId;
                const lineBelow = isOver && draggedId && drop.beforeId === null && others.length > 0 && w.id === others[others.length - 1].id;
                return (
                  <div
                    key={w.id}
                    draggable
                    title={w.number}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      try { e.dataTransfer.setData("text/plain", w.id); } catch { /* some browsers refuse; the drag still works */ }
                      setDraggedId(w.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault(); e.stopPropagation();
                      if (w.id === draggedId) {
                        const i = col.findIndex((x) => x.id === w.id);
                        aim(status, col.slice(i + 1).find((x) => x.id !== draggedId)?.id ?? null);
                        return;
                      }
                      const r = e.currentTarget.getBoundingClientRect();
                      const lower = e.clientY > r.top + r.height / 2;
                      const j = others.findIndex((x) => x.id === w.id);
                      aim(status, lower ? (others[j + 1]?.id ?? null) : w.id);
                    }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); commit(status, drop?.status === status ? drop.beforeId : w.id); }}
                    onDragEnd={finish}
                    onClick={() => onOpen(w.id)}
                    className="rounded-sm px-2.5 py-2"
                    style={{
                      background: C.paper, border: `1px solid ${urgent ? C.gold : C.kraft}`, cursor: "grab",
                      opacity: draggedId === w.id ? 0.4 : 1,
                      boxShadow: lineAbove ? `0 -5px 0 -2px ${color}` : lineBelow ? `0 5px 0 -2px ${color}` : "none",
                    }}
                  >
                    <span className="sr-only">{w.number}</span>
                    <div className="flex items-start justify-between gap-2">
                      <div style={{ fontWeight: 800, fontSize: 13, lineHeight: 1.25 }}>{title || w.customerName || "Untitled job"}</div>
                      <WoStar wo={w} onToggle={onToggleStar} size={15} />
                    </div>
                    {title && <div className="mt-0.5" style={{ fontSize: 12, color: C.faint }}>{w.customerName || "No customer"}</div>}
                    {isDropShip(w) && <DropShipTag wo={w} />}
                    <div className="mt-1" style={{ fontFamily: MONO, fontSize: 11, fontWeight: late ? 800 : 400, color: late ? C.redwood : C.ink }}>
                      {late ? "\u26a0 " : ""}{w.readyByDate ? `ready ${w.readyByDate}` : "no ready date"}
                    </div>
                    {woLineSummary(w, products, 2) && (
                      <div className="mt-1" style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint, lineHeight: 1.45 }}>
                        {woLineSummary(w, products, 2)}
                      </div>
                    )}
                    <ClockBadge wo={w} goals={goals} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// What a work order is actually for, in one line — the SKUs on it rather
// than "3 lines", which says nothing when you're deciding what to run next.
function woLineSummary(wo, products, max = 3) {
  const lines = wo.lines || [];
  if (!lines.length) return "";
  const parts = lines.map((l) => {
    const p = products?.find((x) => x.id === l.productId);
    const label = p?.sku || (l.desc || "").trim() || "—";
    const qty = Number(l.qtySF) || 0;
    if (isService(p)) return qty ? `${label} × ${fmtConv(qty)}` : label;
    return qty ? `${label} ${fmtConv(qty)} SF` : label;
  });
  const head = parts.slice(0, max).join(" · ");
  return parts.length > max ? `${head} +${parts.length - max} more` : head;
}

// Undated orders sort to the bottom rather than the top: an empty string
// sorts before every real date, which would have parked everything with
// no ready date ahead of the job shipping tomorrow.
const byReadyDate = (a, b) => {
  const A = a.readyByDate || "", B = b.readyByDate || "";
  if (!A && !B) return 0;
  if (!A) return 1;
  if (!B) return -1;
  return A < B ? -1 : A > B ? 1 : 0;
};

function WorkOrderBoard({ workOrders, customers, products, goals, onOpen, onNew, onImport, onPushThrough, onMove, onToggleStar }) {
  const [filter, setFilter] = useState("active");
  // Board is what the floor actually reads — the pipeline, not a wall of
  // cards. The choice sticks so switching to Cards isn't undone on reload.
  const [view, _setView] = useState(() => {
    try { return localStorage.getItem("gnws-nav-woview") || "board"; } catch { return "board"; }
  });
  const setView = (v) => { _setView(v); try { localStorage.setItem("gnws-nav-woview", v); } catch { /* private browsing */ } };
  // Sort sticks like the view does. Dragging a card into place switches to
  // Manual, since any other sort would snap it straight back out.
  const [sort, _setSort] = useState(() => {
    try { return localStorage.getItem("gnws-nav-wosort") || "ready"; } catch { return "ready"; }
  });
  const setSort = (s) => { _setSort(s); try { localStorage.setItem("gnws-nav-wosort", s); } catch { /* private browsing */ } };

  const archivedCount = workOrders.filter((w) => w.archived).length;
  const shown = workOrders
    // Archived orders are off the board unless you go looking for them.
    .filter((w) => (filter === "archived" ? !!w.archived : !w.archived))
    .filter((w) => (filter === "active" ? w.status !== "shipped" : true))
    .slice()
    .sort(sort === "ready" ? byReadyDate
      : sort === "manual" ? byBoardRank
      : sort === "number" ? (a, b) => String(b.number || "").localeCompare(String(a.number || ""))
      : (a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn kind="primary" onClick={onNew}><Plus size={14} /> New work order</Btn>
        <Btn onClick={onImport}><FileText size={14} /> Paste / import order</Btn>
        {[["active", "Active"], ["all", "All"], ["archived", `Archived${archivedCount ? ` (${archivedCount})` : ""}`]].map(([id, label]) => (
          <button
            key={id} onClick={() => setFilter(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: filter === id ? C.ink : "transparent", color: filter === id ? "#fff" : C.faint, border: `1px solid ${filter === id ? C.ink : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
        <span className="text-xs ml-2" style={{ fontFamily: MONO, color: C.faint }}>sort</span>
        {[["ready", "Ready by"], ["manual", "Manual"], ["number", "Number"], ["date", "Created"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setSort(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: sort === id ? C.moss : "transparent", color: sort === id ? "#fff" : C.faint, border: `1px solid ${sort === id ? C.moss : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
        <div className="flex rounded-sm overflow-hidden ml-auto" style={{ border: `1px solid ${C.kraftDark}` }}>
          {[["cards", "Cards"], ["board", "Board"]].map(([id, label]) => (
            <button
              key={id} onClick={() => setView(id)}
              className="px-3 py-1.5 text-xs"
              style={{ fontFamily: MONO, background: view === id ? C.ink : "transparent", color: view === id ? "#fff" : C.faint }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === "board" && (
        <WorkOrderKanban
          workOrders={shown} products={products} goals={goals} onOpen={onOpen} onToggleStar={onToggleStar}
          onMove={(id, status, ids) => { onMove(id, status, ids); setSort("manual"); }}
        />
      )}

      {view === "cards" && (shown.length === 0 ? (
        <div className="rounded-sm p-10 text-center" style={{ background: C.panel, border: `1px dashed ${C.kraftDark}` }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>No work orders</div>
          <div className="mt-1 mb-4 text-sm" style={{ color: C.faint }}>Create one to get the crew started.</div>
          <Btn kind="primary" onClick={onNew}><Plus size={14} /> New work order</Btn>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((w) => (
            <div
              key={w.id}
              className="text-left rounded-sm p-4 hover:shadow-md transition-shadow"
              style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, borderLeft: `4px solid ${STATUS_COLOR[w.status]}` }}
            >
              <div className="flex justify-between items-start gap-2">
                <button onClick={() => onOpen(w.id)} className="text-left" style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.25 }}>
                  {woTitle(w) || w.customerName || "Untitled job"}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                  <WoStar wo={w} onToggle={onToggleStar} />
                  <span className="px-2 py-0.5 rounded-sm text-xs font-bold" style={{ background: STATUS_COLOR[w.status], color: "#fff", fontFamily: MONO }}>
                    {STATUS_LABEL[w.status] || w.status}
                  </span>
                </div>
              </div>
              <button onClick={() => onOpen(w.id)} className="text-left w-full">
                <div className="mt-0.5" style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{w.number}</div>
                {woTitle(w) && <div className="mt-1 text-sm" style={{ color: C.faint }}>{w.customerName || "No customer"}</div>}
                {isDropShip(w) && <DropShipTag wo={w} />}
                {(() => {
                  const late = w.readyByDate && w.readyByDate < today() && w.status !== "shipped";
                  return (
                    <div className="mt-1.5 text-xs" style={{ fontFamily: MONO, fontWeight: late ? 800 : 400, color: late ? C.redwood : C.ink }}>
                      {late ? "⚠ " : ""}{w.readyByDate ? `ready ${w.readyByDate}` : "no ready date"}
                    </div>
                  );
                })()}
                {woLineSummary(w, products) && (
                  <div className="mt-1.5 text-xs" style={{ fontFamily: MONO, color: C.faint, lineHeight: 1.5 }}>
                    {woLineSummary(w, products)}
                  </div>
                )}
                <div className="mt-1.5 text-xs" style={{ fontFamily: MONO, color: C.faint }}>{w.lines?.length || 0} line{(w.lines?.length || 0) === 1 ? "" : "s"} · {w.date}</div>
                <ClockBadge wo={w} goals={goals} />
              </button>
              {w.status !== "shipped" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPushThrough(w.id); }}
                  className="mt-2 w-full text-center px-2 py-1.5 rounded-sm text-xs font-bold hover:opacity-85"
                  style={{ background: C.moss, color: "#fff", fontFamily: MONO }}
                >
                  Push Through → Shipped
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* The square-foot math the crew was redoing by hand on every order: what
   one piece covers, how many pieces the line works out to, and which box
   it packs into. Only states what the SKU can actually prove — a product
   with no plank or box conversion set says so rather than showing a
   number derived from nothing. */
function LineMath({ product, qtySF, products }) {
  if (!product) return null;
  const sf = Number(qtySF) || 0;
  const per = (unit) => (unitReaches(product, unit, "sf") ? convertQty(product, 1, unit, "sf") : null);
  const sfPerPlank = per("plank");
  const sfPerBoard = per("board");

  const each = [];
  if (sfPerPlank) each.push(`1 plank = ${fmtConv(sfPerPlank)} SF`);
  if (sfPerBoard) each.push(`1 board = ${fmtConv(sfPerBoard)} SF`);

  const totals = [];
  if (sf > 0) {
    if (sfPerPlank) totals.push(`${fmtConv(sf / sfPerPlank)} planks`);
    if (sfPerBoard) totals.push(`${fmtConv(sf / sfPerBoard)} boards`);
    // Whole boxes, since nobody ships 1.67 of one, plus how full each gets:
    // "2 boxes BOX8860 (36 planks per box, last box 24)".
    if (unitReaches(product, "sf", "box")) {
      const piece = sfPerPlank ? "plank" : "board";
      const perBox = convertQty(product, 1, "box", piece);
      const pieces = convertQty(product, sf, "sf", piece);
      const whole = Math.max(1, Math.ceil(pieces / perBox - 1e-9));
      const last = Math.round((pieces - (whole - 1) * perBox) * 10) / 10;
      const box = products?.find((x) => x.id === product.boxProductId);
      const fill = whole > 1 && last < perBox ? `, last box ${fmtConv(last)}` : whole === 1 ? `, this one holds ${fmtConv(last)}` : "";
      totals.push(`${whole} box${whole === 1 ? "" : "es"}${box ? ` ${box.sku}` : ""} (${fmtConv(perBox)} ${unitLabel(piece)} per box${fill})`);
    }
  }

  if (!each.length && !totals.length) return null;
  const missing = !unitReaches(product, "sf", "box");
  return (
    <div className="mt-1.5 px-2 py-1.5 rounded-sm" style={{ background: "#F3F5F0", border: `1px solid ${C.kraft}` }}>
      {each.length > 0 && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{each.join("   ·   ")}</div>
      )}
      {totals.length > 0 && (
        <div style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: C.ink, marginTop: each.length ? 2 : 0 }}>
          {fmtConv(sf)} SF = {totals.join("  ·  ")}
        </div>
      )}
      {missing && (
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, marginTop: 2 }}>
          set boards-per-box on {product.sku} to get box counts
        </div>
      )}
    </div>
  );
}

// One-line summary of a spec, for collapsed headers and the printed sheet.
const specSummary = (spec) => {
  if (!spec) return "";
  return [
    spec.minSize && `min ${spec.minSize}`,
    spec.maxSize && `max ${spec.maxSize}`,
    spec.paintTolerance,
    spec.knotTolerance,
    spec.notes,
  ].filter(Boolean).join(" · ");
};

// Downscaled before it ever reaches state — a phone photo straight off the
// camera is several MB, and every line's reference photos ride along in the
// same shared work-orders blob on every save. Capped well below anything a
// screen actually shows a swatch or grain pattern at.
function resizeImageToDataUrl(file, maxDim = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Could not read that image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/* ---------------- Start Working (from a work order) ----------------
   Launched from a work order's own screen so the crew never has to
   separately hunt down "which work order is this for" mid-form on the
   Work tab. Two screens — who, then what job(s) — and the actual logging
   happens in the normal Sort/process-step form, just pre-seeded with the
   crew, this work order, and (when a raw source or, for packing, the
   finished product itself is known) a starting guess at what they're
   pulling from. Nothing here is locked; it's a running start, not a cage.

   A linear run — sort, then chop, then rip, all in one sitting on the
   same batch — is checking off more than one job here. Each still becomes
   its own log entry (so per-task rates stay meaningful), but the crew
   only picks crew/job once; App chains straight from one step's form to
   the next instead of dropping back to this screen between them. */
function StartWorkModal({ wo, products, team, onAddTeamMember, onStart, onClose }) {
  useBackLayer(true, onClose);
  const [crew, setCrew] = useState([]);
  const [screen, setScreen] = useState("who");
  const [selected, setSelected] = useState([]); // job keys, in the order picked

  // Every (line, step) combination still open on this order — a line
  // already marked done, or a step already unchecked for it, isn't
  // offered as something to start.
  const jobs = (wo.lines || [])
    .filter((l) => !l.done)
    .flatMap((l) => {
      const p = products.find((x) => x.id === l.productId);
      return PROCESS_STEPS
        .filter((s) => l.steps && l.steps[s.id])
        .map((s) => ({ key: `${l.id}:${s.id}`, line: l, product: p, step: s }));
    });

  const toggleJob = (key) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const startJobs = () => {
    const chosen = selected.map((key) => jobs.find((j) => j.key === key)).filter(Boolean);
    const queue = chosen.map((job) => {
      // Packing pulls already-finished stock, not raw material — everything
      // else is a guess at the raw source behind the finished product.
      // Outbound isn't tracked as its own chain of intermediate SKUs, so
      // every step's best-guess "what comes out" is the line's own finished
      // product — right for the last step before Ship, a starting point to
      // correct otherwise, but always something rather than blank.
      const seedInbound = job.step.id === "pack" ? job.product : findRawSource(job.product, products);
      return {
        step: job.step.id, crew, workOrderId: wo.id,
        seedInboundId: seedInbound?.id || "",
        seedOutboundId: job.product?.id || "",
      };
    });
    onStart(queue);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-lg mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Start working</div>
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>{wo.number} · {wo.customerName || "No customer"}</div>
          </div>
          <CloseBtn onClose={onClose} />
        </div>

        {screen === "who" ? (
          <>
            <CrewSelect team={team} crew={crew} onChange={setCrew} onAddMember={onAddTeamMember} />
            <div className="mt-4">
              <Btn kind="primary" big disabled={!crew.length} onClick={() => setScreen("job")}>
                <Play size={16} /> Continue
              </Btn>
              {!crew.length && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick who's working first.</div>}
            </div>
          </>
        ) : (
          <>
            <div className="text-sm mb-3" style={{ color: C.faint }}>
              What are you doing? Check off more than one if it's a straight run — sort, then chop, then rip, all in one sitting.
            </div>
            {jobs.length === 0 ? (
              <div className="text-sm text-center py-6" style={{ color: C.faint }}>
                Nothing left checked off on this order's line items. Add steps on the work order itself first.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {jobs.map((job) => {
                  const on = selected.includes(job.key);
                  return (
                    <button
                      key={job.key} onClick={() => toggleJob(job.key)}
                      className="text-left rounded-sm p-3 hover:opacity-85"
                      style={{ background: on ? C.ink : C.paper, color: on ? "#fff" : C.ink, border: `1px solid ${on ? C.ink : C.kraft}` }}
                    >
                      <div style={{ fontWeight: 700 }}>{on ? "✓ " : ""}{job.step.label}</div>
                      <div style={{ fontSize: 12, color: on ? C.kraftDark : C.faint }}>{job.product?.sku || job.line.desc || "Custom item"}</div>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Btn onClick={() => setScreen("who")}><ChevronLeft size={14} /> Back</Btn>
              <Btn kind="primary" big disabled={!selected.length} onClick={startJobs}>
                <Play size={16} /> Start {selected.length > 1 ? `${selected.length} jobs` : "working"}
              </Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Labor estimate & job clock ----------------
   What a work order should take in man-hours, step by step, and a clock
   running against it. The estimate is square feet on each line times the
   steps checked on that line, divided by how many square feet one person
   gets through in an hour at that step.

   The clock lives on the work order itself, not on a phone, so everyone
   (office included) sees the same running number, and it keeps counting
   if the app is closed: it stores when it started and how many people
   are on it, never a ticking value. */

// Square feet per man-hour for each step, measured on the InStone run
// (31 timed runs on the production travelers, $25/man-hour, 11,040 SF
// shipped). Paint carries the dry/rack time too, since only painted stock
// gets racked and drying has no step of its own. Plane, trim and ship
// weren't broken out on those travelers, so they have no baseline and
// stay out of the total until a rate is set for them in Settings.
const BASELINE_SF_PER_MANHOUR = {
  sorting: 266, chop: 262, metal: 419, rip: 267, resaw: 196,
  mold: 535, brush: 229, paint: 56, distress: 229, pack: 179,
};

function stepSfRate(step, goals) {
  const set = Number(goals?.stepRates?.[step]);
  if (set > 0) return { rate: set, source: "set" };
  const base = BASELINE_SF_PER_MANHOUR[step];
  return base ? { rate: base, source: "baseline" } : { rate: 0, source: "none" };
}

function estimateWorkOrder(wo, goals) {
  const byStep = {};
  let unsized = 0;
  (wo.lines || []).forEach((line) => {
    const steps = PROCESS_STEPS.filter((s) => line.steps?.[s.id]);
    if (!steps.length) return;
    const sf = Number(line.qtySF) || 0;
    if (!sf) { unsized += 1; return; }
    steps.forEach((s) => {
      if (!byStep[s.id]) byStep[s.id] = { step: s.id, label: s.label, sf: 0, hours: 0, ...stepSfRate(s.id, goals) };
      byStep[s.id].sf += sf;
      if (byStep[s.id].rate > 0) byStep[s.id].hours += sf / byStep[s.id].rate;
    });
  });
  const rows = PROCESS_STEPS.map((s) => byStep[s.id]).filter(Boolean);
  return { rows, hours: rows.reduce((a, r) => a + r.hours, 0), missing: rows.filter((r) => !r.rate), unsized };
}

// Banked man-seconds plus the running stretch times the headcount on it.
function clockManSeconds(clock, now = Date.now()) {
  const banked = Number(clock?.bankedManSec) || 0;
  if (!clock?.runningSince) return banked;
  const since = Date.parse(clock.runningSince);
  if (!Number.isFinite(since)) return banked;
  return banked + Math.max(0, (now - since) / 1000) * (Number(clock.crew) || 1);
}

// Man-hours already logged in work batches against this order, by step.
// A batch timer is wall-clock time, so it's multiplied by how many people
// were on the batch; older entries only name the crew in `by`.
function loggedManSecondsByStep(sortLog, woId) {
  const out = {};
  (sortLog || []).forEach((e) => {
    if (e.workOrderId !== woId || !(Number(e.seconds) > 0)) return;
    const crew = e.crew?.length || String(e.by || "").split(" + ").filter(Boolean).length || 1;
    const k = logStep(e);
    out[k] = (out[k] || 0) + Number(e.seconds) * crew;
  });
  return out;
}

const fmtManHours = (manSec) => ((Number(manSec) || 0) / 3600).toFixed(1);

function LaborPanel({ wo, goals, sortLog, onClockChange }) {
  const est = estimateWorkOrder(wo, goals);
  const clock = wo.clock || {};
  const running = !!clock.runningSince;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const [editing, setEditing] = useState(false);
  const [editHrs, setEditHrs] = useState("");

  const now = Date.now();
  const actual = clockManSeconds(clock, now);
  const estSec = est.hours * 3600;
  const pct = estSec > 0 ? actual / estSec : 0;
  const over = estSec > 0 && actual > estSec;
  const crew = Math.max(1, Number(clock.crew) || 1);
  const loggedBy = loggedManSecondsByStep(sortLog, wo.id);
  const loggedTotal = Object.values(loggedBy).reduce((a, b) => a + b, 0);

  const set = (patch) => onClockChange({ crew, bankedManSec: Number(clock.bankedManSec) || 0, runningSince: clock.runningSince || "", ...patch });
  const start = () => set({ runningSince: new Date().toISOString() });
  const pause = () => set({ bankedManSec: clockManSeconds(clock), runningSince: "" });
  // Changing headcount mid-run banks the stretch so far at the old
  // headcount first, so hours already on the clock aren't repriced.
  const setCrew = (n) => {
    const next = Math.max(1, n);
    set(running ? { crew: next, bankedManSec: clockManSeconds(clock), runningSince: new Date().toISOString() } : { crew: next });
  };
  const applyEdit = () => {
    const h = Number(editHrs);
    if (Number.isFinite(h) && h >= 0) set({ bankedManSec: h * 3600, ...(running ? { runningSince: new Date().toISOString() } : {}) });
    setEditing(false);
  };
  const reset = () => { if (window.confirm("Reset the job clock to zero?")) set({ bankedManSec: 0, runningSince: "" }); };

  const stepIds = PROCESS_STEPS.map((s) => s.id).filter((id) => est.rows.some((r) => r.step === id) || loggedBy[id]);
  const cell = { padding: "4px 6px", fontFamily: MONO, fontSize: 11.5, textAlign: "right" };
  const sq = { width: 30, height: 30, border: `1px solid ${C.kraftDark}`, background: "#fff", fontFamily: MONO, fontSize: 16, fontWeight: 800, lineHeight: 1, borderRadius: 3 };

  return (
    <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${over ? C.redwood : C.kraftDark}` }}>
      <div className="flex items-center gap-1.5 mb-2" style={{ fontWeight: 800 }}>
        <Timer size={16} style={{ color: C.faint }} /> Labor
      </div>

      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 800, lineHeight: 1, color: over ? C.redwood : running ? C.moss : C.ink }}>
            {fmtManHours(actual)}
            <span style={{ fontSize: 15, color: C.faint, fontWeight: 700 }}> / {estSec > 0 ? fmtManHours(estSec) : "?"} man-hrs</span>
          </div>
          <div className="mt-1" style={{ fontFamily: MONO, fontSize: 11, color: over ? C.redwood : C.faint }}>
            {estSec > 0
              ? (over ? `${fmtManHours(actual - estSec)} hrs over the estimate` : `${fmtManHours(estSec - actual)} hrs left · ${Math.round(pct * 100)}% used`)
              : "no estimate yet"}
          </div>
        </div>
        {running && (
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.moss, fontWeight: 700 }}>
            ● running {fmtDuration((now - Date.parse(clock.runningSince)) / 1000)} · {crew} on it
          </div>
        )}
      </div>

      {estSec > 0 && (
        <div className="mt-2 rounded-sm overflow-hidden" style={{ height: 8, background: C.kraft }}>
          <div style={{ width: `${Math.min(100, pct * 100)}%`, height: "100%", background: over ? C.redwood : C.moss }} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {running
          ? <Btn kind="ghost" onClick={pause}><Pause size={13} /> Pause</Btn>
          : <Btn kind="moss" onClick={start}><Play size={13} /> {actual > 0 ? "Resume" : "Start job clock"}</Btn>}
        <div className="flex items-center gap-1.5 px-1">
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>crew</span>
          <button style={sq} onClick={() => setCrew(crew - 1)}>−</button>
          <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 16, minWidth: 22, textAlign: "center" }}>{crew}</span>
          <button style={sq} onClick={() => setCrew(crew + 1)}>+</button>
        </div>
        <Btn onClick={() => { setEditing(!editing); setEditHrs(fmtManHours(actual)); }}><Clock size={13} /> Edit hours</Btn>
        <Btn onClick={reset}><RefreshCw size={13} /> Reset</Btn>
      </div>
      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <input type="number" style={{ ...inputStyle, width: 90 }} value={editHrs} onChange={(e) => setEditHrs(e.target.value)} />
          <span style={{ fontFamily: MONO, fontSize: 12 }}>man-hrs</span>
          <Btn kind="primary" onClick={applyEdit}><Check size={13} /> Set</Btn>
        </div>
      )}

      {stepIds.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.kraftDark}` }}>
                {["Step", "SF", "SF/man-hr", "Estimate", "Logged"].map((h, i) => (
                  <th key={h} style={{ ...cell, textAlign: i === 0 ? "left" : "right", fontSize: 10, color: C.faint, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stepIds.map((id) => {
                const r = est.rows.find((x) => x.step === id);
                const logged = loggedBy[id] || 0;
                const stepOver = r?.hours > 0 && logged > r.hours * 3600;
                return (
                  <tr key={id} style={{ borderBottom: `1px solid ${C.kraft}` }}>
                    <td style={{ ...cell, textAlign: "left", fontFamily: "inherit", fontSize: 13 }}>{PROCESS_STEPS.find((s) => s.id === id)?.label || id}</td>
                    <td style={cell}>{r ? fmtConv(r.sf) : ""}</td>
                    <td style={{ ...cell, color: r?.rate ? C.faint : C.warn }}>{r ? (r.rate ? `${num(r.rate)}${r.source === "set" ? " set" : ""}` : "no rate") : ""}</td>
                    <td style={{ ...cell, fontWeight: 700 }}>{r?.rate ? fmtManHours(r.hours * 3600) : ""}</td>
                    <td style={{ ...cell, color: stepOver ? C.redwood : C.ink }}>{logged ? fmtManHours(logged) : ""}</td>
                  </tr>
                );
              })}
              <tr>
                <td style={{ ...cell, textAlign: "left", fontFamily: "inherit", fontSize: 13, fontWeight: 800 }}>Total</td>
                <td style={cell} />
                <td style={cell} />
                <td style={{ ...cell, fontWeight: 800 }}>{fmtManHours(estSec)}</td>
                <td style={{ ...cell, fontWeight: 800 }}>{loggedTotal ? fmtManHours(loggedTotal) : ""}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 space-y-0.5" style={{ fontFamily: MONO, fontSize: 10.5, color: C.faint }}>
        {est.rows.length === 0 && (wo.lines || []).length > 0 && <div>Check the process steps on each line to get an estimate.</div>}
        {est.missing.length > 0 && <div style={{ color: C.warn }}>No rate for {est.missing.map((r) => r.label).join(", ")}. Set one in Settings to count it.</div>}
        {est.unsized > 0 && <div style={{ color: C.warn }}>{est.unsized} line{est.unsized === 1 ? " has" : "s have"} steps checked but no quantity.</div>}
        {loggedTotal > 0 && <div>Logged = time from work batches tied to this order. The clock above is separate.</div>}
      </div>
    </div>
  );
}

// Small running-clock line for the work order list, so a job's hours are
// visible without opening it. Only shows once a clock has been used.
function ClockBadge({ wo, goals }) {
  const c = wo.clock;
  const running = !!c?.runningSince;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [running]);
  const actual = clockManSeconds(c);
  if (!running && !(actual > 0)) return null;
  const est = estimateWorkOrder(wo, goals).hours * 3600;
  const over = est > 0 && actual > est;
  return (
    <div className="mt-1" style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: over ? C.redwood : running ? C.moss : C.faint }}>
      {running ? "● " : ""}{fmtManHours(actual)}{est > 0 ? ` / ${fmtManHours(est)}` : ""} man-hrs
    </div>
  );
}

/* How long a work order has been open, and how long until it has to ship.

   "Open for" runs from when the order was created. Orders made before
   createdAt existed only carry a date, so those read in whole days: an
   hour count from midnight would be a number that looks exact and isn't.
   Once an order ships, it stops at the ship moment.

   The ship countdown runs to the ship date at the ship time. With no
   time set it counts to 5:00 PM, the end of the working day, and says
   so, so nobody reads a made-up deadline as a real one. */
const DEFAULT_SHIP_TIME = "17:00";

function woOpenedAt(wo) {
  const t = Date.parse(wo.createdAt || "");
  if (Number.isFinite(t)) return { at: t, exact: true };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(wo.date || "");
  return m ? { at: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), exact: false } : null;
}

function woShipDeadline(wo) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(wo.shipDate || "");
  if (!m) return null;
  const [hh, mi] = (wo.shipTime || DEFAULT_SHIP_TIME).split(":").map(Number);
  return new Date(+m[1], +m[2] - 1, +m[3], hh || 0, mi || 0).getTime();
}

// Days and hours when it's more than a day out, hours and minutes inside
// a day, since that's when the minutes start to matter.
function fmtSpan(ms) {
  const mins = Math.floor(Math.abs(ms) / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function WoTimers({ wo }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const shipped = wo.status === "shipped";
  const shippedAt = Date.parse(wo.shippedAt || "");
  const end = shipped && Number.isFinite(shippedAt) ? shippedAt : now;

  const opened = woOpenedAt(wo);
  const deadline = woShipDeadline(wo);

  let openText = "no open date";
  if (opened) {
    const ms = Math.max(0, end - opened.at);
    openText = opened.exact ? fmtSpan(ms) : `${Math.floor(ms / 86400000)} day${Math.floor(ms / 86400000) === 1 ? "" : "s"}`;
  }

  let shipLabel = "SHIPS IN", shipText = "no ship date", shipColor = "#fff", shipSub = "";
  if (deadline) {
    const when = new Date(deadline);
    shipSub = `${when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${wo.shipTime ? "" : " (no ship time set)"}`;
    if (shipped && Number.isFinite(shippedAt)) {
      const diff = deadline - shippedAt;
      shipLabel = "SHIPPED";
      shipText = diff >= 0 ? `${fmtSpan(diff)} early` : `${fmtSpan(diff)} late`;
      shipColor = diff >= 0 ? C.mossLight : "#E8A08F";
    } else if (deadline < now) {
      shipLabel = "PAST SHIP TIME";
      shipText = `${fmtSpan(now - deadline)} over`;
      shipColor = "#E8A08F";
    } else {
      shipText = fmtSpan(deadline - now);
      shipColor = deadline - now < 86400000 ? C.gold : "#fff";
    }
  }

  const tile = (label, value, color, sub) => (
    <div className="flex-1 rounded-sm px-3 py-2" style={{ background: "#2a241d", border: "1px solid #4a423a", minWidth: 150 }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.08em", color: C.kraftDark }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.kraftDark }}>{sub}</div>}
    </div>
  );

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {tile(shipped ? "WAS OPEN" : "OPEN FOR", openText, "#fff", opened ? `since ${new Date(opened.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "")}
      {tile(shipLabel, shipText, shipColor, shipSub)}
    </div>
  );
}

/* ---------------- Work order history ----------------
   Who did what to a work order, and when, shown at the bottom of the
   work order. There's no login, so "who" is the name this device was
   set to in the header (DeviceUserPicker).

   Entries live in their own collection, not on the work order: two
   people editing the same order at once would otherwise overwrite each
   other's entries along with the order, and a history that can lose
   lines isn't one. Separate rows with their own ids merge cleanly.

   Changes are found by comparing each order before and after a save,
   not by hooking every button, so nothing that edits an order can slip
   past. Typing lands as one line per stretch rather than one per
   keystroke. Work logs aren't copied in: the panel reads them straight
   from the production log. GNWS Office writes to the same history. */

const DEVICE_USER_KEY = "gnws-device-user";
const readDeviceUser = () => { try { return localStorage.getItem(DEVICE_USER_KEY) || ""; } catch { return ""; } };
const writeDeviceUser = (name) => { try { localStorage.setItem(DEVICE_USER_KEY, name); } catch { /* private browsing: still set for this visit */ } };

// How long a stretch of typing in one field stays one line.
const HISTORY_FOLD_MS = 3 * 60 * 1000;

const histText = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
};

// What changed between two versions of one order, in words. `typing`
// marks the fields people type into, which fold together (foldHistory).
function describeWOChanges(a, b, { customers, products, statusLabel }) {
  const out = [];
  const same = (x, y) => JSON.stringify(x ?? "") === JSON.stringify(y ?? "");
  const event = (field, label) => out.push({ field, label });
  const change = (field, label, from, to, typing = false) => {
    const f = histText(from), t = histText(to);
    if (f !== t) out.push({ field, label, from: f, to: t, typing });
  };
  if (!a) { event("created", "Created the work order"); return out; }
  if (!b) { event("deleted", "Deleted the work order"); return out; }
  const customer = (id) => (id ? customers.find((c) => c.id === id)?.company || "unknown customer" : "");
  const brand = (k) => BRANDS[k || DEFAULT_BRAND]?.label || k;
  const item = (l) => products.find((p) => p.id === l?.productId)?.sku || String(l?.desc || "").trim() || "custom item";
  const sf = (q) => (q === "" || q == null ? "" : `${fmtConv(q)} SF`);

  change("status", "Status", statusLabel[a.status || "not_started"] || a.status, statusLabel[b.status || "not_started"] || b.status);
  if (!!a.starred !== !!b.starred) event("starred", b.starred ? "Starred as urgent" : "Took the star off");
  change("title", "Title", a.title, b.title, true);
  change("number", "Number", a.number, b.number, true);
  change("customer", "Customer", customer(a.customerId), customer(b.customerId));
  change("brand", "Prints under", brand(a.brand), brand(b.brand));
  change("date", "Order date", a.date, b.date, true);
  change("readyByDate", "Ready by", a.readyByDate, b.readyByDate, true);
  change("shipDate", "Ship date", a.shipDate, b.shipDate, true);
  change("shipTime", "Ship time", a.shipTime, b.shipTime, true);
  change("shipVia", "Ship via", a.shipVia, b.shipVia, true);
  change("notes", "Notes", a.notes, b.notes, true);
  if (!!a.dropShip !== !!b.dropShip) event("dropShip", b.dropShip ? "Turned drop ship on" : "Turned drop ship off");
  change("shipTo", "Drop ship address", shipToLines(a.shipTo).join(", "), shipToLines(b.shipTo).join(", "), true);
  change("customerPO", "Customer PO #", a.customerPO, b.customerPO, true);
  if (!!a.archived !== !!b.archived) event("archived", b.archived ? "Archived" : "Took it out of the archive");
  if (b.quoteId && !same(a.quoteId, b.quoteId)) event("quote", "Linked a quote");
  if (b.salesOrderId && !same(a.salesOrderId, b.salesOrderId)) event("salesOrder", "Linked a sales order");

  // The job clock stores when it started and how much is banked, so each
  // of its buttons leaves its own fingerprint on those numbers.
  const ca = a.clock || {}, cb = b.clock || {};
  if (!same(ca, cb)) {
    const crewA = Number(ca.crew) || 1, crewB = Number(cb.crew) || 1;
    const banked = Number(cb.bankedManSec) || 0;
    const hrs = `${(banked / 3600).toFixed(1)} man-hrs`;
    if (crewA !== crewB) change("clockCrew", "Crew on the job clock", crewA, crewB);
    else if (!ca.runningSince && cb.runningSince && banked === (Number(ca.bankedManSec) || 0)) event("clock", `Started the job clock (${crewB} on it)`);
    else if (!cb.runningSince && banked === 0 && (ca.runningSince || Number(ca.bankedManSec) > 0)) event("clock", "Reset the job clock");
    else if (ca.runningSince && !cb.runningSince) event("clock", `Paused the job clock at ${hrs}`);
    else event("clock", `Set the job clock to ${hrs}`);
  }

  const before = new Map((a.lines || []).map((l) => [l.id, l]));
  const afterIds = new Set((b.lines || []).map((l) => l.id));
  (b.lines || []).forEach((l) => {
    const p = before.get(l.id);
    const name = item(l);
    const key = `line:${l.id}`;
    if (!p) { event(key, l.productId || l.desc ? `Added a line: ${name}` : "Added a line"); return; }
    const picked = !same(p.productId, l.productId);
    if (picked) change(`${key}:item`, "Line item", item(p), name);
    if (!l.productId) change(`${key}:desc`, "Line description", p.desc, l.desc, true);
    change(`${key}:qty`, `${name} quantity`, sf(p.qtySF), sf(l.qtySF), true);
    if (!!p.done !== !!l.done) event(`${key}:done`, l.done ? `Checked off ${name}` : `Unchecked ${name}`);
    change(`${key}:note`, `${name} note`, p.note, l.note, true);
    change(`${key}:spec`, `${name} spec`, specLine(p.spec), specLine(l.spec), true);
    const photos = (s) => (s?.photos || []).length;
    if (photos(p.spec) !== photos(l.spec)) event(`${key}:photo`, photos(l.spec) > photos(p.spec) ? `Added a reference photo to ${name}` : `Removed a reference photo from ${name}`);
    // Picking an item loads that item's usual steps. That's part of the
    // pick, not a string of separate step changes.
    if (!picked) PROCESS_STEPS.forEach((s) => {
      if (!!p.steps?.[s.id] !== !!l.steps?.[s.id]) event(`${key}:step`, `${name}: ${l.steps?.[s.id] ? "added" : "removed"} the ${s.label} step`);
    });
  });
  (a.lines || []).forEach((l) => { if (!afterIds.has(l.id)) event(`line:${l.id}`, `Removed a line: ${item(l)}`); });
  return out;
}

function makeHistoryEntry(wo, c, by, via) {
  const e = {
    id: uid(), woId: wo.id, woNumber: wo.number || "", at: new Date().toISOString(), by: by || "",
    field: c.field, label: via ? `${c.label} (${via})` : c.label,
  };
  if (c.from !== undefined) { e.from = c.from; e.to = c.to; }
  if (c.typing && !via) e.typing = true;
  return e;
}

// Every order that differs between two versions of the list. Unchanged
// orders keep the same object, so they're skipped without a look.
function diffWorkOrders(prevList, nextList, ctx, by, via) {
  const before = new Map((prevList || []).map((w) => [w.id, w]));
  const seen = new Set();
  const entries = [];
  (nextList || []).forEach((w) => {
    seen.add(w.id);
    const p = before.get(w.id);
    if (p !== w) describeWOChanges(p, w, ctx).forEach((c) => entries.push(makeHistoryEntry(w, c, by, via)));
  });
  before.forEach((w, id) => {
    if (!seen.has(id)) describeWOChanges(w, null, ctx).forEach((c) => entries.push(makeHistoryEntry(w, c, by, via)));
  });
  return entries;
}

// New lines go on top. Typing folds into that order's latest line when
// it's the same field, by the same person, within a few minutes. If the
// typing ends up back where it started, the line goes away, since nothing
// changed after all.
function foldHistory(list, entries) {
  let next = list;
  entries.forEach((e) => {
    if (e.typing) {
      let i = -1;
      next.forEach((h, j) => { if (h.woId === e.woId && (i < 0 || h.at > next[i].at)) i = j; });
      const last = next[i];
      if (last && last.typing && last.field === e.field && last.by === e.by && Date.parse(e.at) - Date.parse(last.at) < HISTORY_FOLD_MS) {
        const folded = { ...last, to: e.to, at: e.at, label: e.label };
        next = folded.from === folded.to ? next.filter((_, j) => j !== i) : next.map((h, j) => (j === i ? folded : h));
        return;
      }
    }
    next = [e, ...next];
  });
  return next;
}

const historyText = (h) => (h.from !== undefined ? `${h.label}: ${h.from || "blank"} → ${h.to || "blank"}` : h.label);

function workLogText(e) {
  const step = PROCESS_STEPS.find((s) => s.id === (e.step || "sorting"))?.label || e.step;
  const secs = Number(e.seconds) || 0;
  const boards = Number(e.inboundBoards ?? e.rawBoards) || 0;
  return [
    `Logged work: ${step}`,
    e.batchLabel && e.batchLabel !== step ? e.batchLabel : "",
    secs ? `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` : "",
    boards ? `${num(boards)} boards in` : "",
  ].filter(Boolean).join(" · ");
}

// Printing is something that happened to the order too. The browser
// announces every print, Print button and Ctrl+P alike, with
// "beforeprint", so this listens while one of the printouts is open.
function usePrintLog(label, onLog) {
  const logRef = useRef(onLog);
  logRef.current = onLog;
  useEffect(() => {
    if (!label) return;
    const h = () => logRef.current?.(label);
    window.addEventListener("beforeprint", h);
    return () => window.removeEventListener("beforeprint", h);
  }, [label]);
}

// Who's using this device. There's no login, so the history can only say
// who did something if the device knows. Pick once; it's remembered here.
function DeviceUserPicker({ team, value, onChange }) {
  const names = [...new Set([...(team || []), ...(value ? [value] : [])])];
  return (
    <label className="flex items-center gap-1 min-w-0" style={{ color: value ? "rgba(255,255,255,0.65)" : C.gold }} title="Who's using this device. Shows in work order history.">
      <Users size={14} className="shrink-0" />
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{ background: "transparent", color: value ? "#fff" : C.gold, border: `1px solid ${value ? "#4a423a" : C.gold}`, borderRadius: 2, padding: "2px 4px", fontFamily: MONO, fontSize: 12, maxWidth: 120, minWidth: 0 }}
      >
        <option value="" style={{ color: C.ink }}>Who are you?</option>
        {names.map((n) => <option key={n} value={n} style={{ color: C.ink }}>{n}</option>)}
      </select>
    </label>
  );
}

function WorkOrderHistory({ wo, history, sortLog }) {
  const [showAll, setShowAll] = useState(false);
  const rows = [
    ...(history || []).filter((h) => h.woId === wo.id).map((h) => ({ key: h.id, at: h.at, by: h.by, text: historyText(h) })),
    ...(sortLog || []).filter((e) => e.workOrderId === wo.id).map((e) => ({
      key: `log-${e.id}`, at: e.startedAt || `${e.date}T12:00:00`, dateOnly: !e.startedAt,
      by: e.by || (e.crew || []).join(" + "), text: workLogText(e), work: true,
    })),
  ].sort((x, y) => new Date(y.at) - new Date(x.at));
  const when = (r) => {
    const d = new Date(r.at);
    if (Number.isNaN(d.getTime())) return r.at || "";
    return r.dateOnly
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const shown = showAll ? rows : rows.slice(0, 40);
  return (
    <div className="rounded-sm overflow-hidden mb-8" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.kraftDark}` }}>
        <span className="flex items-center gap-1.5" style={{ fontWeight: 800 }}><Clock size={15} /> History</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{rows.length} {rows.length === 1 ? "entry" : "entries"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm" style={{ color: C.faint }}>Nothing recorded yet. Everything done to this order from now on shows up here.</div>
      ) : shown.map((r) => (
        <div key={r.key} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm" style={{ borderBottom: `1px solid ${C.kraft}` }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint, width: 120, flexShrink: 0 }}>{when(r)}</span>
          <span style={{ fontWeight: 700, minWidth: 70 }}>{r.by || <span style={{ color: C.faint, fontWeight: 400 }}>no name set</span>}</span>
          <span className="basis-full sm:basis-0 sm:flex-1 min-w-0" style={{ color: r.work ? C.moss : C.ink, overflowWrap: "anywhere" }}>{r.text}</span>
        </div>
      ))}
      {!showAll && rows.length > shown.length && (
        <div className="p-3"><Btn onClick={() => setShowAll(true)}>Show all {rows.length}</Btn></div>
      )}
      <div className="px-4 py-2 text-xs" style={{ color: C.faint }}>Changes are recorded from Sep 15, 2026 on. Work logs go back further.</div>
    </div>
  );
}

/* ---------------- Customer updates ----------------
   When an order is packed, ships, or a date the customer was already
   given moves, the customer should hear about it. Nothing is sent on its
   own: the order shows up under "Customer updates to send", and Email
   customer opens a ready-written email in the mail app to read and send.
   Emailing or skipping is written to the order's history, and that's
   also what takes it off the list.

   It's all worked out from the work order history, so there's no second
   record to keep in step. An update is waiting when the order reached
   that moment after the last time that update was handled, and it's
   still true now: an order dragged back out of Packed isn't waiting on a
   "packed" email any more. History starts Sep 15, 2026, so nothing from
   before then turns up. GNWS Office has the same code. */

const UPDATE_DATE_FIELDS = { readyByDate: "ready date", shipDate: "ship date" };

function pendingCustomerUpdates(workOrders, history, statusLabel) {
  const byWo = {};
  (history || []).forEach((h) => { (byWo[h.woId] = byWo[h.woId] || []).push(h); });
  const out = [];
  (workOrders || []).forEach((wo) => {
    if (wo.archived) return;
    const entries = (byWo[wo.id] || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const handledAt = (kind) => entries.reduce((t, h) => (h.field === "customerUpdate" && h.update === kind && h.at > t ? h.at : t), "");
    ["packed", "shipped"].forEach((kind) => {
      if ((wo.status || "not_started") !== kind) return;
      const reached = entries.filter((h) => h.field === "status" && h.to === statusLabel[kind]).pop();
      if (reached && reached.at > handledAt(kind)) out.push({ key: `${wo.id}:${kind}`, wo, kind, since: reached.at });
    });
    // A new date on an order that's already gone isn't news to anyone.
    if (wo.status === "shipped") return;
    // Both dates usually move together, and that's one piece of news, not
    // two, so every date that moved on an order goes out as one update.
    const done = handledAt("date");
    const dates = Object.keys(UPDATE_DATE_FIELDS).map((field) => {
      // Only a date that was already set counts. Setting one for the
      // first time isn't a change the customer was told about.
      const changes = entries.filter((h) => h.field === field && h.from && h.at > done);
      if (!changes.length) return null;
      const from = changes[0].from;
      const to = histText(wo[field]);
      return to && to !== from ? { field, from, to, at: changes[changes.length - 1].at } : null;
    }).filter(Boolean);
    if (dates.length) out.push({ key: `${wo.id}:date`, wo, kind: "date", dates, since: dates.map((d) => d.at).sort().pop() });
  });
  return out.sort((a, b) => String(b.since).localeCompare(String(a.since)));
}

const updCap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const updDate = (d, opts) => {
  const x = new Date(`${d}T12:00:00`);
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString("en-US", opts);
};
const updLongDate = (d) => updDate(d, { weekday: "long", month: "long", day: "numeric" });
const updShortDate = (d) => updDate(d, { month: "short", day: "numeric" });

// "#2026-2582" for our own orders. Orders that came in from Shopify or
// Etsy use that store's number instead, since it's what's on the buyer's
// receipt.
function updOrderRef(wo) {
  if (wo.sourceRef && wo.customerPO) return `#${String(wo.customerPO).replace(/^.*#/, "")}`;
  const m = /^[A-Z]+-(\d{4}-\d+)/.exec(wo.number || "");
  return m ? `#${m[1]}` : wo.number || "";
}

// Who the email goes to. Online orders sit under a catch-all customer
// ("Shopify Customer"), so the real buyer is whoever order intake wrote
// into the notes; everyone else is their customer record.
function updRecipient(wo, customer) {
  const notes = wo.sourceRef ? String(wo.notes || "") : "";
  const buyerEmail = /\bEmail\s+([^\s@]+@[^\s@]+\.[A-Za-z]{2,})/.exec(notes)?.[1] || "";
  const buyerName = /\bby ([^.\n]+)\.\s*$/.exec(notes.split("\n")[0] || "")?.[1] || "";
  const name = buyerName || customer?.contact || "";
  return { email: buyerEmail || customer?.email || "", first: name.trim().split(/\s+/)[0] || "" };
}

// "ready date and ship date have moved from A to B" when they moved
// together, each one named separately when they didn't.
function updDatesText(dates, fmt, full) {
  const moved = (plural) => (full ? (plural ? "have moved" : "has moved") : "moved");
  const same = dates.every((d) => d.from === dates[0].from && d.to === dates[0].to);
  if (same) return `${dates.map((d) => UPDATE_DATE_FIELDS[d.field]).join(" and ")} ${moved(dates.length > 1)} from ${fmt(dates[0].from)} to ${fmt(dates[0].to)}`;
  return dates.map((d) => `${UPDATE_DATE_FIELDS[d.field]} ${moved(false)} from ${fmt(d.from)} to ${fmt(d.to)}`).join(", and the ");
}

function updWhat(u) {
  if (u.kind === "packed") return "packed and ready";
  if (u.kind === "shipped") return "shipped";
  return updDatesText(u.dates, updShortDate, false);
}

function customerUpdateEmail(u, { customer, products, brandKey, sender }) {
  const wo = u.wo;
  const brand = BRANDS[brandKey] || BRANDS.ethica;
  const { first } = updRecipient(wo, customer);
  const ref = updOrderRef(wo);
  // A drop ship's customer is the distributor, so name their PO and who
  // it's for. The end customer never gets these.
  const po = isDropShip(wo) && wo.customerPO && !wo.sourceRef ? ` (your PO # ${wo.customerPO})` : "";
  const forWhom = isDropShip(wo) && shipToName(wo.shipTo) ? ` for ${shipToName(wo.shipTo)}` : "";
  const order = `order ${ref}${po}${forWhom}`;
  const items = (wo.lines || [])
    .map((l) => ({ l, p: products.find((x) => x.id === l.productId) }))
    .filter(({ p }) => p?.category !== "packing")
    .map(({ l, p }) => {
      const unit = l.displayUnit || "sf";
      return `  ${fmtConv(convertQty(p, l.qtySF, "sf", unit))} ${unitLabel(unit)}, ${p ? p.name : (l.desc || "custom item")}`;
    });

  let subject, news;
  if (u.kind === "packed") {
    subject = `Your order ${ref} is packed and ready`;
    news = `Your ${order} is packed and ready to ship.${wo.shipDate ? ` We're planning to ship it on ${updLongDate(wo.shipDate)}.` : ""}`;
  } else if (u.kind === "shipped") {
    const day = wo.shippedAt ? new Date(wo.shippedAt).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";
    subject = `Your order ${ref} has shipped`;
    news = `Your ${order} shipped${day ? ` on ${day}` : ""}.${wo.shipVia ? ` It's on its way by ${wo.shipVia}.` : ""}`;
  } else {
    subject = `An update on your order ${ref}`;
    news = `A quick update on your ${order}: the ${updDatesText(u.dates, updLongDate, true)}.`;
  }
  const signature = !sender || /^ero\b/i.test(sender) ? ["Ero Gorski", brand.name, "630-484-3242"] : [sender, brand.name];
  const body = [
    `Hi ${first || "there"},`, "", news, "",
    ...(items.length ? ["On this order:", ...items, ""] : []),
    "If you have any questions, just reply to this email.", "",
    "Thanks,", ...signature,
  ].join("\n");
  return { subject, body };
}

function CustomerUpdateItem({ u, customer, products, sender, onHandled, onOpenWO }) {
  const [brandKey, setBrandKey] = useState("ethica");
  const { email } = updRecipient(u.wo, customer);
  const who = customer?.company || u.wo.customerName || "No customer";
  const title = u.wo.title || u.wo.number;
  const send = () => {
    const { subject, body } = customerUpdateEmail(u, { customer, products, brandKey, sender });
    onHandled(u, "sent", brandKey);
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  return (
    <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2" style={{ borderBottom: `1px solid ${C.kraft}` }}>
      <div className="flex-1" style={{ minWidth: 200 }}>
        <div style={{ fontWeight: 700 }}>
          {onOpenWO ? <button onClick={() => onOpenWO(u.wo.id)} className="text-left hover:underline">{title}</button> : title}
        </div>
        <div className="text-sm" style={{ color: C.faint }}>
          {who} · <span style={{ color: C.ink, fontWeight: 700 }}>{updCap(updWhat(u))}</span>
        </div>
        {email
          ? <div className="text-xs" style={{ fontFamily: MONO, color: C.faint }}>to {email}</div>
          : <div className="text-xs" style={{ color: C.warn }}>No email on file, so the email opens without an address.</div>}
        {isDropShip(u.wo) && <div className="text-xs" style={{ color: C.faint }}>Drop ship: this goes to {who}, never to their customer.</div>}
      </div>
      <select value={brandKey} onChange={(e) => setBrandKey(e.target.value)} style={{ ...inputStyle, width: "auto" }} title="Which company the email is written as">
        <option value="ethica">As Ethica Wood</option>
        <option value="gnws">As Good News Wood</option>
      </select>
      <Btn kind="primary" onClick={send}><Mail size={13} /> Email customer</Btn>
      <Btn onClick={() => onHandled(u, "skipped")}>Skip</Btn>
    </div>
  );
}

function CustomerUpdatesPanel({ updates, customers, products, sender, onHandled, onOpenWO }) {
  if (!updates?.length) return null;
  return (
    <div className="rounded-sm overflow-hidden mb-4" style={{ background: C.panel, border: `1px solid ${C.gold}`, borderLeft: `4px solid ${C.gold}` }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `1px solid ${C.kraft}`, fontWeight: 800 }}>
        <Mail size={16} style={{ color: C.gold }} /> Customer updates to send
        <span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>{updates.length}</span>
      </div>
      {updates.map((u) => (
        <CustomerUpdateItem
          key={u.key} u={u} customer={customers.find((c) => c.id === u.wo.customerId)}
          products={products} sender={sender} onHandled={onHandled} onOpenWO={onOpenWO}
        />
      ))}
    </div>
  );
}

function CustomerUpdatesBadge({ count, onClick }) {
  if (!count) return null;
  return (
    <button
      onClick={onClick} title={`${count} customer update${count === 1 ? "" : "s"} waiting to be sent`}
      className="flex items-center gap-1 px-2 py-1 rounded-sm hover:opacity-85"
      style={{ background: C.gold, color: "#fff", fontFamily: MONO, fontSize: 12, fontWeight: 800 }}
    >
      <Mail size={13} /> {count}
    </button>
  );
}

function WorkOrderDetail({ wo, customers, products, goals, sortLog, history, onLog, updates, sender, onCustomerUpdate, onScheduleMe, onChange, onDelete, onBack, team, whoWorking, setWhoWorking, onAddTeamMember, onUpdateCustomerSpec, onStartWork }) {
  const customer = customers.find((c) => c.id === wo.customerId);
  const update = (patch) => onChange({ ...wo, ...patch });
  const [bolOpen, setBolOpen] = useState(false);
  const [woPrintOpen, setWoPrintOpen] = useState(false);
  const [palletModalOpen, setPalletModalOpen] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const [printLabels, setPrintLabels] = useState(null);
  const [startWorkOpen, setStartWorkOpen] = useState(false);
  const labelCount = printLabels?.length || 0;
  const labelsText = `${labelCount} pallet label${labelCount === 1 ? "" : "s"}`;
  usePrintLog(
    woPrintOpen ? "Printed the work order"
      : bolOpen ? "Printed the bill of lading"
      : slipOpen ? "Printed the packing slip"
      : labelCount ? `Printed ${labelsText}` : "",
    onLog,
  );

  const updateLine = (lineId, patch) => {
    const lines = wo.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l));
    const patchOut = { lines };
    // Keeps the number's product suffix in sync with the lines — but only
    // as long as it still exactly matches what we generated last time.
    // The moment someone types something else into the number field by
    // hand, this stops following along; there's no reliable way to tell
    // "our old suffix, now stale" from "a name someone typed on purpose."
    const m = WO_NUMBER_BASE_RE.exec(wo.number || "");
    if (m) {
      const base = m[1];
      const currentSuffix = m[2] ? m[2].slice(1) : "";
      const priorSuffix = productSuffix(wo.lines, products);
      if (currentSuffix === priorSuffix) {
        const nextSuffix = productSuffix(lines, products);
        patchOut.number = nextSuffix ? `${base}-${nextSuffix}` : base;
      }
    }
    update(patchOut);
  };
  const removeLine = (lineId) => update({ lines: wo.lines.filter((l) => l.id !== lineId) });
  const updateLineSpec = (line, patch) => updateLine(line.id, { spec: { ...(line.spec || {}), ...patch } });
  const addLine = () => update({
    lines: [...(wo.lines || []), {
      id: uid(), productId: "", desc: "",
      qtySF: "",
      displayUnit: "sf",
      done: false, note: "",
      steps: defaultSteps(),
    }],
  });

  // Stamp when it actually shipped. The ship date on the order is a plan;
  // without this there's no record of what really happened, so on-time
  // performance can only ever compare one guess against another.
  const pushThrough = () => update({ status: "shipped", shippedAt: new Date().toISOString() });
  const reopen = () => update({ status: "not_started", shippedAt: "" });


  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Btn onClick={onBack}><ChevronLeft size={14} /> All work orders</Btn>
      </div>

      {wo.archived && (
        <div className="rounded-sm p-3 mb-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <span className="text-sm flex items-center gap-1.5">
            <Archive size={14} style={{ color: C.faint }} /> Archived, so it's off the board.
          </span>
          {/* Put back by hand stays put: keepOnBoard stops the weekly
              sweep from taking it off again. */}
          <Btn onClick={() => update({ archived: false, keepOnBoard: true })}><RotateCcw size={13} /> Put back on the board</Btn>
        </div>
      )}

      <CustomerUpdatesPanel updates={updates} customers={customers} products={products} sender={sender} onHandled={onCustomerUpdate} />

      <div className="rounded-sm p-5 mb-4" style={{ background: C.ink, color: "#fff" }}>
        <div className="flex justify-between items-start flex-wrap gap-2">
          <div>
            <div className="flex items-center gap-2">
              <input
                style={{ ...inputStyle, background: "#2a241d", color: "#fff", borderColor: "#4a423a", fontSize: 20, fontWeight: 800, padding: "2px 6px", width: 320, maxWidth: "100%" }}
                value={wo.title || ""} onChange={(e) => update({ title: e.target.value })}
                placeholder={woTitle(wo) || "Job title (shows on the board)"}
                title="Job title, what the board shows"
              />
              <WoStar wo={wo} onToggle={() => update({ starred: !wo.starred })} size={20} />
            </div>
            <input
              className="mt-1 block"
              style={{ ...inputStyle, background: "#2a241d", color: C.kraftDark, borderColor: "#4a423a", fontFamily: MONO, fontSize: 13, fontWeight: 700, padding: "2px 6px", width: 320, maxWidth: "100%" }}
              value={wo.number} onChange={(e) => update({ number: e.target.value })}
              title="Work order number"
            />
            {customer ? (
              <button onClick={() => update({ customerId: "" })} className="mt-1 text-left block" title="Click to change customer">
                <div style={{ fontSize: 16, fontWeight: 700 }}>{customer.company}</div>
              </button>
            ) : (
              <select
                className="mt-1"
                style={{ ...inputStyle, background: "#2a241d", color: "#fff", borderColor: "#4a423a", maxWidth: 260 }}
                value={wo.customerId} onChange={(e) => update({ customerId: e.target.value })}
              >
                <option value="">— Assign customer —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
              </select>
            )}
            {customer?.contact ? <div style={{ fontSize: 13, color: C.kraftDark }}>{customer.contact}</div> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                style={{ ...inputStyle, background: "#2a241d", color: "#fff", borderColor: "#4a423a", maxWidth: 240 }}
                value={wo.brand || DEFAULT_BRAND} onChange={(e) => update({ brand: e.target.value })}
                title="Which company this order prints under"
              >
                {Object.entries(BRANDS).map(([key, b]) => <option key={key} value={key}>{b.label}</option>)}
              </select>
              <select
                style={{ ...inputStyle, background: "#2a241d", color: "#fff", borderColor: "#4a423a", maxWidth: 160 }}
                value={wo.status || "not_started"}
                onChange={(e) => update({
                  status: e.target.value,
                  ...(e.target.value === "shipped" ? { shippedAt: wo.shippedAt || new Date().toISOString() } : { shippedAt: "" }),
                })}
                title="Where this job is in the shop"
              >
                {STATUS_FLOW.map((st) => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
              </select>
            </div>
            {wo.quoteId ? (
              <a
                href={`${OFFICE_URL}/?quote=${wo.quoteId}`} target="_blank" rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs hover:opacity-70"
                style={{ fontFamily: MONO, color: C.kraftDark }}
              >
                <ExternalLink size={11} /> View Quote
              </a>
            ) : null}
          </div>
          <span className="px-3 py-1 rounded-sm text-sm font-bold" style={{ background: STATUS_COLOR[wo.status], fontFamily: MONO }}>
            {STATUS_LABEL[wo.status] || wo.status}
          </span>
        </div>

        {isDropShip(wo) ? (
          // Where it's actually going, up top where the crew looks first.
          // The distributor's own address would be the wrong one to use.
          <div className="mt-3 pt-3 flex items-start gap-2" style={{ borderTop: "1px solid #4a423a" }}>
            <Truck size={16} style={{ color: C.gold, marginTop: 2 }} />
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              <div style={{ fontFamily: MONO, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: C.gold }}>
                DROP SHIP TO{wo.customerPO ? `  ·  PO # ${wo.customerPO}` : ""}
              </div>
              {shipToLines(wo.shipTo).length
                ? shipToLines(wo.shipTo).map((l, i) => <div key={i}>{l}</div>)
                : <div style={{ color: C.warn }}>No ship-to address yet. Fill it in below.</div>}
              <div style={{ fontSize: 12, color: C.kraftDark }}>Do not ship to {customer?.company || "the customer"}.</div>
            </div>
          </div>
        ) : (customer?.address || customer?.city) ? (
          <div className="mt-3 pt-3 flex items-start gap-2" style={{ borderTop: "1px solid #4a423a" }}>
            <MapPin size={16} style={{ color: C.kraftDark, marginTop: 2 }} />
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {customer.address && <div>{customer.address}</div>}
              <div>{[customer.city, customer.state, customer.zip].filter(Boolean).join(", ")}</div>
              {customer.country && customer.country !== "USA" ? <div>{customer.country}</div> : null}
            </div>
          </div>
        ) : (
          <div className="mt-3 pt-3 text-sm" style={{ borderTop: "1px solid #4a423a", color: C.warn }}>
            <AlertTriangle size={13} className="inline mr-1" /> No address on file for this customer.
          </div>
        )}

        <WoTimers wo={wo} />

        <div className="mt-4 flex gap-2 flex-wrap">
          {ACTIVE_WO_STATUSES.includes(wo.status) && (
            <Btn kind="primary" onClick={() => setStartWorkOpen(true)} big>
              <Play size={16} /> Start Working
            </Btn>
          )}
          {wo.status === "shipped" ? (
            <Btn kind="ghost" onClick={reopen}>
              <span>↺ Reopen</span>
            </Btn>
          ) : (
            <Btn kind="moss" onClick={pushThrough} big>
              <Check size={16} /> Push Through → Shipped
            </Btn>
          )}
        </div>
      </div>

      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex flex-wrap gap-3">
          <Field label="Ready by" w={160}><input type="date" style={inputStyle} value={wo.readyByDate || ""} onChange={(e) => update({ readyByDate: e.target.value })} /></Field>
          <Field label="Ship date" w={160}><input type="date" style={inputStyle} value={wo.shipDate || ""} onChange={(e) => update({ shipDate: e.target.value })} /></Field>
          <Field label="Ship time" w={120}><input type="time" style={inputStyle} value={wo.shipTime || ""} onChange={(e) => update({ shipTime: e.target.value })} /></Field>
          <Field label="Ship via" w={160}><input style={inputStyle} value={wo.shipVia || ""} onChange={(e) => update({ shipVia: e.target.value })} placeholder="Dry van, pickup…" /></Field>
        </div>
        <Field label="General notes">
          <textarea style={{ ...inputStyle, minHeight: 70, marginTop: 8 }} value={wo.notes || ""} onChange={(e) => update({ notes: e.target.value })} placeholder="Anything the crew needs to know…" />
        </Field>
      </div>

      <DropShipPanel record={wo} customer={customer} onChange={update} />

      <LaborPanel wo={wo} goals={goals} sortLog={sortLog} onClockChange={(clock) => update({ clock })} />

      <div className="rounded-sm overflow-hidden mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.kraftDark}` }}>
          <span style={{ fontWeight: 800 }}>What to pull / make</span>
        </div>
        {(wo.lines || []).length === 0 && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: C.faint }}>No line items yet.</div>
        )}
        {(wo.lines || []).map((line) => {
          const p = products.find((x) => x.id === line.productId);
          const displayUnit = line.displayUnit || "sf";
          return (
            <div key={line.id} className="px-4 py-3 flex items-start gap-3" style={{ borderBottom: `1px solid ${C.kraft}`, background: line.done ? C.paper : "transparent" }}>
              <button
                onClick={() => updateLine(line.id, { done: !line.done })}
                className="shrink-0 mt-0.5 flex items-center justify-center rounded-sm"
                style={{ width: 26, height: 26, border: `2px solid ${line.done ? C.moss : C.kraftDark}`, background: line.done ? C.moss : "transparent" }}
              >
                {line.done && <Check size={16} color="#fff" />}
              </button>
              <div className="flex-1 min-w-0">
                <select
                  style={{ ...inputStyle, fontWeight: 700, marginBottom: 4 }}
                  value={line.productId}
                  onChange={(e) => {
                    const newProduct = products.find((pr) => pr.id === e.target.value);
                    updateLine(line.id, { productId: e.target.value, displayUnit: isService(newProduct) ? canonicalUnitFor(newProduct) : "sf", steps: newProduct?.steps ? { ...newProduct.steps } : defaultSteps() });
                  }}
                >
                  <option value="">Custom / describe below…</option>
                  {products.slice().sort(bySkuFavoritesFirst).map((pr) => (
                    <option key={pr.id} value={pr.id}>{pr.favorite ? "★ " : ""}{pr.sku} — {pr.name}</option>
                  ))}
                </select>
                {!line.productId && (
                  <input style={{ ...inputStyle, marginBottom: 4 }} placeholder="Describe item" value={line.desc || ""} onChange={(e) => updateLine(line.id, { desc: e.target.value })} />
                )}
                <UnitSwitchInput
                  product={p}
                  value={line.qtySF}
                  canonicalUnit="sf"
                  onChange={(v) => updateLine(line.id, { qtySF: v })}
                  displayUnit={displayUnit}
                  onDisplayUnitChange={(u) => updateLine(line.id, { displayUnit: u })}
                  width={110}
                />
                <LineMath product={p} qtySF={line.qtySF} products={products} />
                <input className="mt-2" style={inputStyle} placeholder="Note for this line" value={line.note || ""} onChange={(e) => updateLine(line.id, { note: e.target.value })} />

                {/* Spec lives on the line, not the customer. One order can mix
                    items with completely different requirements, and a
                    customer-wide spec both hid that and quietly rewrote every
                    other order for the same customer when edited. */}
                <div className="mt-2 rounded-sm" style={{ background: "#FBF6EC", border: `1px solid ${C.gold}` }}>
                  <button
                    onClick={() => updateLine(line.id, { specOpen: !line.specOpen })}
                    className="w-full flex items-center justify-between px-3 py-2 text-left"
                  >
                    <span className="flex items-center gap-1.5" style={{ fontWeight: 700, fontSize: 12, color: C.gold }}>
                      <ClipboardList size={13} /> Spec for this item
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>
                      {specSummary(line.spec) || "none set"} {line.specOpen ? "▲" : "▼"}
                    </span>
                  </button>
                  {line.specOpen && (
                    <div className="px-3 pb-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Field label="Min size"><input style={inputStyle} value={line.spec?.minSize || ""} onChange={(e) => updateLineSpec(line, { minSize: e.target.value })} placeholder='e.g. 4" face' /></Field>
                        <Field label="Max size"><input style={inputStyle} value={line.spec?.maxSize || ""} onChange={(e) => updateLineSpec(line, { maxSize: e.target.value })} placeholder='e.g. 8" face' /></Field>
                      </div>
                      <Field label="Paint tolerance"><input style={inputStyle} value={line.spec?.paintTolerance || ""} onChange={(e) => updateLineSpec(line, { paintTolerance: e.target.value })} placeholder="e.g. one side painted OK" /></Field>
                      <Field label="Knot / defect tolerance"><input style={inputStyle} value={line.spec?.knotTolerance || ""} onChange={(e) => updateLineSpec(line, { knotTolerance: e.target.value })} placeholder="e.g. no knots over 1 inch" /></Field>
                      <Field label="Other spec notes"><textarea style={{ ...inputStyle, minHeight: 50 }} value={line.spec?.notes || ""} onChange={(e) => updateLineSpec(line, { notes: e.target.value })} /></Field>
                      <Field label="Reference photos — desired look, color, etc. (optional)">
                        <div className="flex flex-wrap gap-2 mt-1">
                          {(line.spec?.photos || []).map((ph) => (
                            <div key={ph.id} className="relative" style={{ width: 64, height: 64 }}>
                              <img
                                src={ph.dataUrl} alt="" className="w-full h-full object-cover rounded-sm"
                                style={{ border: `1px solid ${C.kraftDark}` }}
                              />
                              <button
                                onClick={() => updateLineSpec(line, { photos: (line.spec?.photos || []).filter((x) => x.id !== ph.id) })}
                                className="absolute -top-1.5 -right-1.5 rounded-full flex items-center justify-center"
                                style={{ width: 18, height: 18, background: C.ink, color: "#fff" }}
                                title="Remove photo"
                              >
                                <X size={11} />
                              </button>
                            </div>
                          ))}
                          <label
                            className="flex items-center justify-center rounded-sm cursor-pointer"
                            style={{ width: 64, height: 64, border: `1px dashed ${C.kraftDark}`, color: C.faint }}
                            title="Add a reference photo"
                          >
                            <Camera size={18} />
                            <input
                              type="file" accept="image/*" multiple hidden
                              onChange={async (e) => {
                                const files = Array.from(e.target.files || []);
                                e.target.value = "";
                                if (!files.length) return;
                                const dataUrls = await Promise.all(files.map((f) => resizeImageToDataUrl(f)));
                                updateLineSpec(line, {
                                  photos: [...(line.spec?.photos || []), ...dataUrls.map((dataUrl) => ({ id: uid(), dataUrl }))],
                                });
                              }}
                            />
                          </label>
                        </div>
                      </Field>
                      {customer?.spec && specSummary(customer.spec) && (
                        <button
                          onClick={() => updateLine(line.id, { spec: { ...customer.spec } })}
                          className="mt-2 text-xs underline"
                          style={{ color: C.faint }}
                        >
                          Copy {customer.company}'s saved spec into this item
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {PROCESS_STEPS.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-xs" style={{ color: C.faint }}>
                      <input
                        type="checkbox" checked={!!(line.steps && line.steps[s.id])}
                        onChange={(e) => updateLine(line.id, { steps: { ...(line.steps || defaultSteps()), [s.id]: e.target.checked } })}
                      />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
              <button onClick={() => removeLine(line.id)} className="shrink-0 opacity-40 hover:opacity-100 mt-1"><Trash2 size={16} /></button>
            </div>
          );
        })}
        <div className="p-3">
          <Btn onClick={addLine}><Plus size={14} /> Add line</Btn>
        </div>
      </div>

      <div className="flex gap-2 mb-8 flex-wrap">
        <Btn kind="primary" onClick={() => setWoPrintOpen(true)}><Printer size={14} /> Print Work Order</Btn>
        <Btn kind="primary" onClick={() => setBolOpen(true)}><Printer size={14} /> Print Bill of Lading</Btn>
        <Btn kind="primary" onClick={() => setPalletModalOpen(true)}><Tag size={14} /> Print Pallet Labels</Btn>
        {isDropShip(wo) && <Btn kind="primary" onClick={() => setSlipOpen(true)}><FileText size={14} /> Print Packing Slip</Btn>}
        {onScheduleMe && <Btn onClick={() => onScheduleMe(wo.id)}><CalendarDays size={14} /> Put me on this job</Btn>}
        <Btn onClick={onDelete}><Trash2 size={14} /> Delete work order</Btn>
      </div>
      <WorkOrderHistory wo={wo} history={history} sortLog={sortLog} />
      {woPrintOpen && <WorkOrderPrintView wo={wo} customer={customer} products={products} onClose={() => setWoPrintOpen(false)} />}
      {slipOpen && <PackingSlipPrintView wo={wo} customer={customer} products={products} onClose={() => setSlipOpen(false)} />}
      {bolOpen && <BOLModal wo={wo} customer={customer} products={products} onClose={() => setBolOpen(false)} />}
      {palletModalOpen && (
        <PalletLabelModal
          wo={wo} customer={customer} products={products}
          onClose={() => setPalletModalOpen(false)}
          onGenerate={(labels) => { setPalletModalOpen(false); setPrintLabels(labels); }}
        />
      )}
      {printLabels && printLabels.length > 0 && (
        <FinishedLabelPrintView labels={printLabels} onClose={() => setPrintLabels(null)} onSavePdf={() => onLog?.(`Saved ${labelsText} as a PDF`)} />
      )}
      {startWorkOpen && (
        <StartWorkModal
          wo={wo} products={products} team={team} onAddTeamMember={onAddTeamMember}
          onClose={() => setStartWorkOpen(false)}
          onStart={(jobs) => { setStartWorkOpen(false); onStartWork(jobs); }}
        />
      )}
    </div>
  );
}

/* ---------------- Import Invoice/Quote (PDF -> draft Work Order) ----------------
   Sends the PDF to Claude and asks for structured JSON back. This is a
   best-effort first draft — the crew still reviews and fixes the created
   work order before relying on it. No dollar amounts are requested or
   stored anywhere in this flow. */

/* ---------------- Settings ----------------
   A starting point — whatever else belongs here can get added as it
   comes up. For now: the sorting throughput goal, the team roster
   (add/remove), and a way to reset your personal tab order. */

function SettingsModal({ team, onAddTeamMember, onRemoveTeamMember, goals, onGoalsChange, onResetTabOrder, onClose }) {
  const [newName, setNewName] = useState("");
  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Settings</div>
          <CloseBtn onClose={onClose} />
        </div>

        <div className="mb-5">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Sorting throughput goal</div>
          <div className="flex items-center gap-2">
            <input
              type="number" style={{ ...inputStyle, width: 100 }}
              value={goals?.boardsPerHour ?? ""} placeholder="—"
              onChange={(e) => onGoalsChange({ ...goals, boardsPerHour: e.target.value })}
            />
            <span className="text-sm" style={{ color: C.faint }}>boards / man-hour</span>
          </div>
        </div>

        <div className="mb-5">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Team roster</div>
          <div className="space-y-1 mb-2">
            {team.map((name) => (
              <div key={name} className="flex items-center justify-between px-3 py-1.5 rounded-sm text-sm" style={{ background: C.paper }}>
                <span>{name}</span>
                <button onClick={() => onRemoveTeamMember(name)} className="opacity-40 hover:opacity-100"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              style={{ ...inputStyle, flex: 1 }} value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Add name" onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onAddTeamMember(newName.trim()); setNewName(""); } }}
            />
            <Btn onClick={() => { if (newName.trim()) { onAddTeamMember(newName.trim()); setNewName(""); } }}><Plus size={14} /> Add</Btn>
          </div>
        </div>

        <div className="mb-5">
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>Estimating rates</div>
          <p className="text-xs mb-2" style={{ color: C.faint }}>
            Square feet one person gets through per hour at each step. Work order labor estimates use these. Blank uses the baseline measured on the InStone run.
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {PROCESS_STEPS.map((s) => (
              <label key={s.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{s.label}</span>
                <input
                  type="number" style={{ ...inputStyle, width: 80, padding: "3px 6px" }}
                  value={goals?.stepRates?.[s.id] ?? ""}
                  placeholder={BASELINE_SF_PER_MANHOUR[s.id] ? String(BASELINE_SF_PER_MANHOUR[s.id]) : "none"}
                  onChange={(e) => onGoalsChange({ ...goals, stepRates: { ...(goals?.stepRates || {}), [s.id]: e.target.value } })}
                />
              </label>
            ))}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Tab order</div>
          <p className="text-xs mb-2" style={{ color: C.faint }}>Your tab arrangement is personal to this browser. Reset it back to default here.</p>
          <Btn onClick={onResetTabOrder}><RefreshCw size={13} /> Reset to default order</Btn>
        </div>
      </div>
    </div>
  );
}

function ImportInvoiceModal({ customers, onClose, onImported }) {
  const [mode, setMode] = useState("paste");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Same extraction either way — a PDF and pasted text just become
  // different content blocks for the server to hand Claude (see
  // api/parse-invoice.js). fileName is only ever set for the PDF path;
  // it's just what goes in the new work order's notes.
  const parseAndImport = async (body, fileName) => {
    setBusy(true);
    setError("");
    try {
      // Import spends the shop's AI credits, so the server wants an access
      // code. It can't live in the app (everything in the app is public),
      // so this device asks for it once and remembers it after it works.
      const CODE_KEY = "gnws-import-access-code";
      let saved = "";
      try { saved = localStorage.getItem(CODE_KEY) || ""; } catch { /* private browsing */ }
      const send = (code) => fetch("/api/parse-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-gnws-access-code": code },
        body: JSON.stringify(body),
      });
      let response = await send(saved);
      if (response.status === 401) {
        const entered = (window.prompt("Import needs the access code. Ask Ero for it.") || "").trim();
        if (!entered) throw new Error("no access code entered");
        response = await send(entered);
        if (response.ok) { try { localStorage.setItem(CODE_KEY, entered); } catch { /* ask again next time */ } }
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Server couldn't read that");
      const textBlock = (data.content || []).find((b) => b.type === "text");
      if (!textBlock) throw new Error("No readable response came back");
      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      const nameKey = (parsed.customerName || "").toLowerCase().trim();
      const match = nameKey
        ? customers.find((c) => c.company && (c.company.toLowerCase().includes(nameKey) || nameKey.includes(c.company.toLowerCase())))
        : null;

      onImported({ parsed, matchedCustomerId: match?.id || "", fileName });
    } catch (e) {
      setError(`Couldn't read that automatically, so nothing was created — you can still start a work order manually. (${e.message || "unknown error"})`);
    } finally {
      setBusy(false);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("Could not read that file"));
        r.readAsDataURL(file);
      });
      await parseAndImport({ base64 }, file.name);
    } catch (e) {
      setError(`Couldn't read that file. (${e.message || "unknown error"})`);
    }
  };
  const handlePaste = () => {
    if (!pasted.trim()) return;
    parseAndImport({ text: pasted.trim() }, null);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Start a work order from an order</div>
          <CloseBtn onClose={onClose} />
        </div>
        <p className="text-sm mb-3" style={{ color: C.faint }}>
          Paste the order — an email, a text, whatever the customer sent — or upload the PDF. It'll try to pull the customer and line items into a new draft work order; review and fix it up before the crew works from it.
        </p>

        <div className="flex gap-2 mb-3">
          {[["paste", "Paste text"], ["pdf", "Upload PDF"]].map(([id, label]) => (
            <button
              key={id} onClick={() => { setMode(id); setError(""); }} disabled={busy}
              className="px-3 py-1.5 rounded-sm text-xs"
              style={{ fontFamily: MONO, background: mode === id ? C.ink : "transparent", color: mode === id ? "#fff" : C.faint, border: `1px solid ${mode === id ? C.ink : C.kraftDark}` }}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "paste" ? (
          <>
            <textarea
              autoFocus
              style={{ ...inputStyle, minHeight: 160 }}
              placeholder="Paste the order here…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              disabled={busy}
            />
            <div className="mt-3">
              <Btn kind="primary" onClick={handlePaste} disabled={busy || !pasted.trim()} big>
                <Check size={16} /> Create work order
              </Btn>
            </div>
          </>
        ) : (
          <input
            type="file" accept="application/pdf" disabled={busy}
            onChange={(e) => handleFileUpload(e.target.files?.[0])}
            style={{ fontSize: 13 }}
          />
        )}

        {busy && <div className="text-sm mt-3" style={{ color: C.faint }}>Reading it…</div>}
        {error && <div className="text-sm mt-3" style={{ color: C.warn }}>{error}</div>}
      </div>
    </div>
  );
}

function CustomersTab({ customers, onChange }) {
  const [openId, setOpenId] = useState(null);
  useBackLayer(!!openId, () => setOpenId(null));
  const [pinnedId, setPinnedId] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const update = (id, patch) => onChange(customers.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updateSpec = (id, patch) => onChange(customers.map((c) => (c.id === id ? { ...c, spec: { ...c.spec, ...patch } } : c)));
  const remove = (id) => onChange(customers.filter((c) => c.id !== id));
  const add = () => {
    const c = { id: uid(), company: "New customer", contact: "", address: "", city: "", state: "", zip: "", country: "USA", phone: "", email: "", flags: "", favorite: false, spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" } };
    onChange([c, ...customers]);
    setOpenId(c.id);
    setPinnedId(c.id);
  };

  const shown = customers.slice().sort((a, b) => {
    // A just-created record floats to the top regardless of sort, so you
    // never have to hunt for "New customer" alphabetically mid-list.
    if (a.id === pinnedId) return -1;
    if (b.id === pinnedId) return 1;
    const favDiff = Number(!!b.favorite) - Number(!!a.favorite);
    if (favDiff !== 0) return favDiff;
    const av = (sortBy === "city" ? a.city : a.company) || "";
    const bv = (sortBy === "city" ? b.city : b.company) || "";
    return av.localeCompare(bv);
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn kind="primary" onClick={add}><Plus size={14} /> Add customer</Btn>
        <span className="text-xs" style={{ color: C.faint, fontFamily: MONO, marginLeft: 8 }}>SORT BY</span>
        {[["name", "Name"], ["city", "City"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setSortBy(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: sortBy === id ? C.ink : "transparent", color: sortBy === id ? "#fff" : C.faint, border: `1px solid ${sortBy === id ? C.ink : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: C.faint }}>No customers to show.</div>
        ) : (
          shown.map((c) => {
            const open = openId === c.id;
            const missingAddr = !c.address && !c.city;
            return (
              <div key={c.id} style={{ borderBottom: `1px solid ${C.kraft}` }}>
                <div className="px-4 py-2.5 flex items-center gap-3">
                  <button onClick={() => update(c.id, { favorite: !c.favorite })} title={c.favorite ? "Unfavorite" : "Favorite"} className="shrink-0" style={{ color: c.favorite ? C.gold : C.kraftDark }}>
                    <Star size={16} fill={c.favorite ? C.gold : "none"} />
                  </button>
                  <button onClick={() => setOpenId(open ? null : c.id)} className="text-left flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{c.company}</span>
                      {c.city && <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>{c.city}</span>}
                    </div>
                    {missingAddr ? (
                      <div className="text-xs mt-0.5" style={{ color: C.warn, fontFamily: MONO }}><AlertTriangle size={11} className="inline mr-1" />No address on file</div>
                    ) : (
                      <div className="text-xs mt-0.5" style={{ color: C.faint }}>{[c.contact, c.phone].filter(Boolean).join(" · ")}</div>
                    )}
                  </button>
                  <button onClick={() => remove(c.id)} className="opacity-40 hover:opacity-100 shrink-0"><Trash2 size={14} /></button>
                </div>

                {open && (
                  <div className="px-4 pb-4 space-y-2" style={{ background: C.paper }}>
                    <Field label="Company"><input style={inputStyle} value={c.company} onChange={(e) => update(c.id, { company: e.target.value })} /></Field>
                    <Field label="Contact"><input style={inputStyle} value={c.contact} onChange={(e) => update(c.id, { contact: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Phone"><input style={{ ...inputStyle, fontFamily: MONO }} value={c.phone || ""} onChange={(e) => update(c.id, { phone: e.target.value })} /></Field>
                      <Field label="Email"><input style={{ ...inputStyle, fontFamily: MONO, fontSize: 13 }} value={c.email || ""} onChange={(e) => update(c.id, { email: e.target.value })} /></Field>
                    </div>
                    <Field label="Street address"><input style={inputStyle} value={c.address || ""} onChange={(e) => update(c.id, { address: e.target.value })} /></Field>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="City"><input style={inputStyle} value={c.city || ""} onChange={(e) => update(c.id, { city: e.target.value })} /></Field>
                      <Field label="State/Prov"><input style={inputStyle} value={c.state || ""} onChange={(e) => update(c.id, { state: e.target.value })} /></Field>
                      <Field label="Zip/Postal"><input style={inputStyle} value={c.zip || ""} onChange={(e) => update(c.id, { zip: e.target.value })} /></Field>
                    </div>
                    <Field label="Country"><input style={inputStyle} value={c.country || ""} onChange={(e) => update(c.id, { country: e.target.value })} /></Field>

                    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <div className="flex items-center gap-1.5 mb-2" style={{ fontWeight: 700, color: C.gold }}>
                        <ClipboardList size={14} /> Sorting / Milling Spec
                      </div>
                      <div className="text-xs mb-2" style={{ color: C.faint }}>
                        Refine this as you go — it's a reference card the crew checks while sorting, not a hard rule the app enforces.
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Min size"><input style={inputStyle} value={c.spec?.minSize || ""} onChange={(e) => updateSpec(c.id, { minSize: e.target.value })} placeholder='e.g. 4" face' /></Field>
                        <Field label="Max size"><input style={inputStyle} value={c.spec?.maxSize || ""} onChange={(e) => updateSpec(c.id, { maxSize: e.target.value })} placeholder='e.g. 8" face' /></Field>
                      </div>
                      <Field label="Paint tolerance"><input style={inputStyle} value={c.spec?.paintTolerance || ""} onChange={(e) => updateSpec(c.id, { paintTolerance: e.target.value })} placeholder="e.g. one side painted OK" /></Field>
                      <Field label="Knot / defect tolerance"><input style={inputStyle} value={c.spec?.knotTolerance || ""} onChange={(e) => updateSpec(c.id, { knotTolerance: e.target.value })} placeholder="e.g. no knots over 1 inch" /></Field>
                      <Field label="Other notes"><textarea style={{ ...inputStyle, minHeight: 60 }} value={c.spec?.notes || ""} onChange={(e) => updateSpec(c.id, { notes: e.target.value })} /></Field>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* Which units a SKU can meaningfully be counted in, and the two it shows
   by default. Categories differ in how the floor actually counts them:
   rough wood moves in boards and pallets, milled stock in planks and
   boxes, paint in gallons, packaging in whatever the roll/box is called.

   Only units with a real conversion are offered — otherwise picking
   "planks" on a SKU with no plank conversion would read 1:1 and imply a
   relationship that was never configured. */
const CATEGORY_UNITS = {
  // Raw and sorted stock lives on pallets and gets counted that way — a
  // rack is "six pallets and change", not "2,400 boards". Boards stay as
  // the second figure, since that's what the logs move in. SKUs with no
  // boards-per-pallet set (the 11xx family) have no pallet conversion to
  // fall back on, so they show boards alone.
  wood: ["pallet", "board"],
  milled: ["plank", "box"],
  paint: ["gal", "qt"],
  packing: [],
};

function unitOptionsFor(product) {
  const canonical = canonicalUnitFor(product);
  const graph = buildUnitGraph(product);
  return [canonical, ...Object.keys(graph).filter((u) => u !== canonical)];
}

function defaultUnitsFor(product) {
  const opts = unitOptionsFor(product);
  const wanted = (CATEGORY_UNITS[product.category || "wood"] || []).filter((u) => opts.includes(u));
  const rest = opts.filter((u) => !wanted.includes(u));
  return [...wanted, ...rest].slice(0, 2);
}

/* Two editable quantity boxes on one row, each with its own unit picker.
   Type into either and the stored on-hand updates; the other box follows.
   The chosen units are saved on the product, so a SKU keeps whichever
   pair makes sense for it. */
function TwoUnitCell({ product, value, onChange, onUnitsChange }) {
  const [editing, setEditing] = useState(null);
  const canonical = canonicalUnitFor(product);
  const opts = unitOptionsFor(product);
  const saved = (product.displayUnits || []).filter((u) => opts.includes(u));
  const [u1, u2] = saved.length ? [saved[0], saved[1]] : defaultUnitsFor(product);

  const show = (u) => {
    if (!u) return "";
    if (editing && editing.unit === u) return editing.raw;
    const q = convertQty(product, value, canonical, u);
    if (!Number.isFinite(q)) return "";
    const dp = u === "board" || u === "plank" ? 0 : 2;
    return String(Math.round(q * 10 ** dp) / 10 ** dp);
  };

  const box = (u, slot) => {
    if (!u) return null;
    return (
      <span key={slot} className="flex items-center gap-1">
        <input
          type="number"
          style={{ ...inputStyle, width: 66, padding: "3px 5px", fontSize: 13, textAlign: "right", fontFamily: MONO, fontWeight: 700 }}
          value={show(u)}
          onClick={(e) => e.stopPropagation()}
          onFocus={() => setEditing({ unit: u, raw: show(u) })}
          onBlur={() => setEditing(null)}
          onChange={(e) => {
            setEditing({ unit: u, raw: e.target.value });
            const asCanonical = convertQty(product, e.target.value, u, canonical);
            onChange(Number.isFinite(asCanonical) ? asCanonical : 0);
          }}
        />
        <select
          style={{ ...inputStyle, width: 72, padding: "3px 2px", fontSize: 11 }}
          value={u}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const next = slot === 0 ? [e.target.value, u2] : [u1, e.target.value];
            onUnitsChange(next.filter(Boolean));
          }}
        >
          {opts.map((o) => <option key={o} value={o}>{unitLabel(o)}</option>)}
        </select>
      </span>
    );
  };

  // Deliberately no wrapping: letting these stack doubles every row height
  // and turns a 45-SKU list into a scroll marathon.
  return <span className="flex items-center gap-1.5" style={{ whiteSpace: "nowrap" }}>{[box(u1, 0), box(u2, 1)]}</span>;
}

/* Condition buckets.

   `onHand` keeps meaning what it always did — good, usable stock — so
   every picker, conversion and report that reads it stays correct. Waste
   and rework sit alongside it rather than inside it, because a pallet of
   boards with nails in it is real material you own but can't sell today,
   and folding it into on-hand would quietly overstate what's sellable.

   Rework carries a note (to be trimmed, too thin, nails and screws) since
   what has to happen to it is the whole point of tracking it separately. */
const CONDITIONS = [
  { key: "onHand", label: "Good", color: "moss", note: false },
  { key: "reworkQty", label: "Rework", color: "gold", note: "reworkNote" },
  { key: "wasteQty", label: "Waste", color: "redwood", note: "wasteNote" },
];
const conditionTotal = (p) =>
  (Number(p.onHand) || 0) + (Number(p.reworkQty) || 0) + (Number(p.wasteQty) || 0);

/* ---------------- Inventory ----------------
   Same list-and-detail shape as GNWS Office: a sortable, searchable table
   with archive, and a full-page editor behind each row. The old accordion
   made you scroll a 45-row list to find anything and expanded editors
   inline, which pushed everything else off screen. */

function InventoryDetail({ product, products, invLog, onChange, onBack, onDelete, onDuplicate }) {
  const p = product;
  const category = p.category || "wood";
  const canonicalUnit = canonicalUnitFor(p);
  const [reorderUnit, setReorderUnit] = useState(canonicalUnit);
  const update = (patch) => onChange({ ...p, ...patch });

  const updateConversion = (key, patch) =>
    update({ conversions: (p.conversions || []).map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const addConversion = () =>
    update({ conversions: [...(p.conversions || []), { key: uid(), qtyA: "", unitA: "board", qtyB: "", unitB: "" }] });
  const removeConversion = (key) =>
    update({ conversions: (p.conversions || []).filter((c) => c.key !== key) });
  const updateDims = (patch) => {
    const merged = { ...p, ...patch };
    const w = Number(merged.widthIn) || 0;
    const l = Number(merged.lengthIn) || 0;
    const extra = w > 0 && l > 0 ? { sfPerBoard: Math.round(((w * l) / 144) * 1000) / 1000 } : {};
    update({ ...patch, ...extra });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Btn onClick={onBack}><ChevronLeft size={14} /> All inventory</Btn>
        <div className="flex items-center gap-2">
          <button
            onClick={() => update({ favorite: !p.favorite })}
            title={p.favorite ? "Unfavorite" : "Favorite — keeps it at the top of every picker"}
            style={{ color: p.favorite ? C.gold : C.kraftDark }}
          >
            <Star size={18} fill={p.favorite ? C.gold : "none"} />
          </button>
          {p.archived && <Badge color={C.faint}>Archived</Badge>}
        </div>
      </div>

      <div className="rounded-sm p-5 mb-4" style={{ background: C.ink, color: "#fff" }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="SKU">
            <input
              style={{ ...inputStyle, background: "#2a241d", color: "#fff", borderColor: "#4a423a", fontFamily: MONO, fontWeight: 800 }}
              value={p.sku} onChange={(e) => update({ sku: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <input
              style={{ ...inputStyle, background: "#2a241d", color: "#fff", borderColor: "#4a423a" }}
              value={p.name} onChange={(e) => update({ name: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="rounded-sm p-4 mb-4 space-y-2" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <Field label="Category">
          <select style={inputStyle} value={category} onChange={(e) => update({ category: e.target.value })}>
            <option value="wood">Wood (boards, pallets)</option>
            <option value="milled">Milled wood (planks, boxes)</option>
            <option value="paint">Paint</option>
            <option value="packing">Packaging</option>
            <option value="service">Service (not stocked)</option>
          </select>
        </Field>

        {category === "service" ? (
          <Field label="Sold per">
            <input style={{ ...inputStyle, width: 120 }} value={p.unitLabel || ""} placeholder="ea" onChange={(e) => update({ unitLabel: e.target.value })} />
            <div className="text-xs mt-1" style={{ color: C.faint }}>
              Sold, not stocked: no on-hand count, and it stays off count sheets and the floor pickers.
              "ea" for a flat charge, or "sf" to price it by the square foot.
            </div>
          </Field>
        ) : category === "packing" ? (
          <Field label="On hand">
            <div className="flex items-center gap-1">
              <input type="number" style={{ ...inputStyle, textAlign: "right", fontFamily: MONO }} value={p.onHand ?? ""} onChange={(e) => update({ onHand: e.target.value })} />
              <input style={{ ...inputStyle, width: 70, fontSize: 12 }} value={p.unitLabel || ""} placeholder="ea" onChange={(e) => update({ unitLabel: e.target.value })} />
            </div>
          </Field>
        ) : (
          <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2, color: C.gold }}>On hand by condition</div>
            <div className="text-xs mb-2" style={{ color: C.faint }}>
              Type into whichever unit you counted in — the others follow. Only <strong>Good</strong> counts as
              sellable stock; rework and waste are tracked separately so they don't inflate what's available.
            </div>
            {CONDITIONS.map((c) => (
              <div key={c.key} className="mb-2 pb-2" style={{ borderBottom: `1px solid ${C.kraft}` }}>
                <div className="flex items-center gap-1.5 mb-1" style={{ fontFamily: MONO, fontSize: 11, color: C[c.color] }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: C[c.color], display: "inline-block" }} />
                  {c.label.toUpperCase()}
                </div>
                <MultiUnitQty product={p} value={p[c.key]} onChange={(v) => update({ [c.key]: v })} />
                {c.note && (
                  <input
                    className="mt-1" style={{ ...inputStyle, fontSize: 13 }}
                    placeholder={c.key === "reworkQty" ? "What has to happen to it — trim, de-nail, re-sort…" : "Why it's waste"}
                    value={p[c.note] || ""} onChange={(e) => update({ [c.note]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <div style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>
              Total on site: {num(conditionTotal(p))} {unitLabel(canonicalUnit)}
            </div>
          </div>
        )}

        {(category === "wood" || category === "milled") && (
          <>
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.gold }}>Dimensions</div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Thickness (in)"><input type="number" style={inputStyle} value={p.thickness ?? ""} placeholder="—" onChange={(e) => update({ thickness: e.target.value })} /></Field>
                <Field label="Width (in)"><input type="number" style={inputStyle} value={p.widthIn ?? ""} placeholder="—" onChange={(e) => updateDims({ widthIn: e.target.value })} /></Field>
                <Field label="Length (in)"><input type="number" style={inputStyle} value={p.lengthIn ?? ""} placeholder="—" onChange={(e) => updateDims({ lengthIn: e.target.value })} /></Field>
              </div>
            </div>

            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
              <div className="grid grid-cols-2 gap-2">
                <Field label="SF per board"><input type="number" style={inputStyle} value={p.sfPerBoard ?? ""} placeholder="—" onChange={(e) => update({ sfPerBoard: e.target.value })} /></Field>
                <Field label="Boards per pallet"><input type="number" style={inputStyle} value={p.boardsPerUnit ?? ""} placeholder="—" onChange={(e) => update({ boardsPerUnit: e.target.value })} /></Field>
                {/* Milled stock is counted in planks and boxes, so those two
                    conversions get their own fields rather than having to be
                    hand-built in the conversions list below. */}
                <Field label="Planks per board"><input type="number" style={inputStyle} value={p.planksPerBoard ?? ""} placeholder="—" onChange={(e) => update({ planksPerBoard: e.target.value })} /></Field>
                <Field label="Boards per box"><input type="number" style={inputStyle} value={p.boardsPerBox ?? ""} placeholder="—" onChange={(e) => update({ boardsPerBox: e.target.value })} /></Field>
              </div>
              {/* Which box this SKU actually packs into. Knowing a box holds
                  16 boards doesn't say which box off the shelf to grab, and
                  that was being worked out fresh on every order. */}
              <div className="mt-2">
                <Field label="Packs into">
                  <select style={inputStyle} value={p.boxProductId || ""} onChange={(e) => update({ boxProductId: e.target.value })}>
                    <option value="">— No box set —</option>
                    {products.filter((x) => x.category === "packing" && !x.archived).map((x) => (
                      <option key={x.id} value={x.id}>{x.sku} — {x.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.gold }}>Packing &amp; Conversions</div>
              <div className="text-xs mb-2" style={{ color: C.faint }}>"[Qty] [Unit] per [Qty] [Unit]" — e.g. 40 boards per 1 Box. Pick from units this SKU already has, or type a brand new one.</div>
              <datalist id={`units-${p.id}`}>
                {unitsFor(p).map((u) => <option key={u} value={u} />)}
              </datalist>
              <div className="space-y-2">
                {(p.conversions || []).map((c) => (
                  <div key={c.key} className="flex items-end gap-2 flex-wrap">
                    <Field label="Qty" w={70}><input type="number" style={inputStyle} value={c.qtyA ?? ""} onChange={(e) => updateConversion(c.key, { qtyA: e.target.value })} /></Field>
                    <Field label="Unit" w={110}><input list={`units-${p.id}`} style={inputStyle} value={c.unitA ?? ""} placeholder="board" onChange={(e) => updateConversion(c.key, { unitA: e.target.value })} /></Field>
                    <span className="text-xs pb-2" style={{ color: C.faint, fontFamily: MONO }}>PER</span>
                    <Field label="Qty" w={70}><input type="number" style={inputStyle} value={c.qtyB ?? ""} onChange={(e) => updateConversion(c.key, { qtyB: e.target.value })} /></Field>
                    <Field label="Unit" w={110}><input list={`units-${p.id}`} style={inputStyle} value={c.unitB ?? ""} placeholder="e.g. Box, Skid" onChange={(e) => updateConversion(c.key, { unitB: e.target.value })} /></Field>
                    <button onClick={() => removeConversion(c.key)} className="opacity-40 hover:opacity-100 mb-2"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
              <Btn onClick={addConversion}><Plus size={14} /> Add Conversion</Btn>
            </div>

            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
              <Field label="Painted with">
                <select
                  style={{ ...inputStyle, marginTop: 8 }}
                  value={p.paintProductId || ""}
                  onChange={(e) => update({ paintProductId: e.target.value })}
                >
                  <option value="">— Not painted (natural / brushed) —</option>
                  {products.filter((x) => x.category === "paint").map((x) => (
                    <option key={x.id} value={x.id}>{x.sku} — {x.name}</option>
                  ))}
                </select>
              </Field>
              <div className="text-xs mt-1" style={{ color: C.faint }}>
                Ties this SKU to the color it's finished in, so the crew doesn't have to remember which
                Graphene Stone goes with which product. It prints on the work order.
              </div>
            </div>
          </>
        )}

        {category === "paint" && (
          <Field label="SF per gallon"><input type="number" style={inputStyle} value={p.sfPerGallon ?? ""} placeholder="250" onChange={(e) => update({ sfPerGallon: e.target.value })} /></Field>
        )}

        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <Field label="Reorder at">
            <UnitSwitchInput
              product={p} value={p.reorderPoint || 0} canonicalUnit={canonicalUnit}
              onChange={(v) => update({ reorderPoint: v })}
              displayUnit={reorderUnit} onDisplayUnitChange={setReorderUnit}
              width={110}
            />
          </Field>
          <div className="text-xs mt-1" style={{ color: C.faint }}>Flag this item when on-hand drops to or below this amount — pick whichever unit makes sense (boards, SF, pallets, gallons…).</div>
        </div>

        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.gold }}>Process Steps (defaults for this SKU)</div>
          <div className="text-xs mb-2" style={{ color: C.faint }}>Check whatever this product normally goes through — new work order lines for this SKU start with these checked, editable per order.</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {PROCESS_STEPS.map((st) => (
              <label key={st.id} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox" checked={!!(p.steps && p.steps[st.id])}
                  onChange={(e) => update({ steps: { ...(p.steps || defaultSteps()), [st.id]: e.target.checked } })}
                />
                {st.label}
              </label>
            ))}
          </div>
        </div>

        <Field label="Other notes (bundle sizes, odd conversions, anything else worth remembering)">
          <textarea style={{ ...inputStyle, minHeight: 50 }} value={p.otherNotes || ""} onChange={(e) => update({ otherNotes: e.target.value })} />
        </Field>
      </div>

      {(() => {
        const rows = (invLog || []).filter((a) => a.productId === p.id)
          .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
        return (
          <div className="rounded-sm overflow-hidden mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
            <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.kraftDark}`, fontWeight: 800 }}>
              History <span style={{ fontWeight: 400, color: C.faint, fontFamily: MONO, fontSize: 12 }}>({rows.length})</span>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm" style={{ color: C.faint }}>
                Nothing recorded yet. Counts, production and receiving all show up here from now on.
              </div>
            ) : rows.slice(0, 40).map((a) => (
              <div key={a.id} className="px-4 py-2 flex items-center justify-between gap-2 text-sm" style={{ borderTop: `1px solid ${C.kraft}` }}>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 12 }}>
                    {new Date(a.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    <span style={{ color: C.faint }}> · {ADJ_REASON[a.reason] || a.reason}{a.by ? ` · ${a.by}` : ""}</span>
                  </div>
                  {a.note && <div style={{ fontSize: 12, color: C.faint }}>{a.note}</div>}
                </div>
                <div style={{ fontFamily: MONO, whiteSpace: "nowrap" }}>
                  <span style={{ color: C.faint }}>{num(a.from)} → {num(a.to)}</span>{" "}
                  <span style={{ fontWeight: 800, color: a.delta >= 0 ? C.moss : C.redwood }}>
                    {a.delta >= 0 ? "+" : ""}{num(a.delta)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="flex gap-2 mb-8 flex-wrap">
        <Btn onClick={onDuplicate}><Copy size={13} /> Duplicate</Btn>
        <Btn onClick={() => update({ archived: !p.archived })}>
          {p.archived ? <><RotateCcw size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
        </Btn>
        <Btn onClick={onDelete}><Trash2 size={13} /> Delete permanently</Btn>
      </div>
    </div>
  );
}

/* Every print sheet renders through here — into a portal at the end of
   <body> rather than inside the app tree.

   The old approach hid the app with `visibility: hidden` and floated the
   sheet on top of it. But hidden elements still occupy their full height,
   so the browser still paged out the entire app behind the sheet — and
   because the overlay is position:fixed, the sheet got painted onto every
   one of those pages. That is why one work order came out of the printer
   as several copies. Taking the app out of the printed page box entirely
   gives exactly one copy of whatever is on the sheet. */
/* Close was a dark-on-transparent Btn floating over a dark backdrop on the
   print sheets — effectively invisible — and a small bare X on the forms.
   One control now, readable on either background and big enough to hit on
   a phone. */
function CloseBtn({ onClose, onDark = false, label = "Close" }) {
  return (
    <button
      onClick={onClose}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm"
      style={{
        fontFamily: MONO, fontSize: 13, fontWeight: 700,
        color: onDark ? "#fff" : C.ink,
        background: onDark ? "transparent" : C.kraft,
        border: `1px solid ${onDark ? "#fff" : C.kraftDark}`,
      }}
    >
      <X size={15} /> {label}
    </button>
  );
}

function PrintPortal({ children }) {
  const hostRef = useRef(null);
  if (!hostRef.current && typeof document !== "undefined") {
    hostRef.current = document.createElement("div");
    hostRef.current.className = "print-portal";
  }
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    document.body.appendChild(host);
    return () => { if (host.parentNode) host.parentNode.removeChild(host); };
  }, []);
  return hostRef.current ? createPortal(children, hostRef.current) : null;
}

const PRINT_CSS = `
  @page { size: letter; margin: 0.4in; }
  @media print {
    /* Only the portal prints. Everything else leaves the page box so it
       cannot generate pages of its own. */
    body > *:not(.print-portal) { display: none !important; }
    .print-overlay {
      position: static !important; overflow: visible !important;
      background: none !important; inset: auto !important; z-index: auto !important;
    }
    .print-shell { max-width: none !important; margin: 0 !important; }
    .print-sheet { padding: 0 !important; }
    .no-print { display: none !important; }
  }
`;

/* Labels are not sheets. A Rollo roll is one 4x1in label per page, so these
   need their own @page size and a hard page break after every label —
   sharing the letter-sized sheet CSS above made the printer offer only
   paper sizes and try to lay the roll out on a page. */
const LABEL_PRINT_CSS = `
  /* No "landscape" keyword here: mixing it with explicit dimensions is
     invalid CSS, so the browser dropped the whole size declaration and fell
     back to letter — which is why the Rollo kept offering paper sizes.
     4in x 1in is already wider than it is tall. */
  @page { size: 4in 1in; margin: 0; }
  @media print {
    body > *:not(.print-portal) { display: none !important; }
    .print-overlay {
      position: static !important; overflow: visible !important;
      background: none !important; inset: auto !important; z-index: auto !important;
    }
    .print-shell { max-width: none !important; margin: 0 !important; }
    .no-print { display: none !important; }
    .label-page, .flabel-page {
      page-break-after: always; break-after: page;
      page-break-inside: avoid; break-inside: avoid;
      border: none !important; margin: 0 !important;
    }
    .label-page:last-child, .flabel-page:last-child { page-break-after: auto; break-after: auto; }
  }
`;

/* A printable count sheet for walking the racks. Everything the counter
   needs is on the page — what the app currently believes is on hand, plus
   blank space to tally against it — so nobody has to carry a phone around
   the yard. One category at a time, because the wood racks and the paint
   shelf get counted on separate trips.

   The on-hand figure is printed deliberately: this is a check against the
   book, not a blind count, and the crew has always worked off the last
   known number. */
function InventoryCountSheet({ products, group, onClose }) {
  useBackLayer(true, onClose);
  const [cat, setCat] = useState(group || "all");

  const rows = products
    .filter((p) => !p.archived && !isService(p))
    .filter((p) => (cat === "all" ? true : (p.category || "wood") === cat))
    .slice()
    .sort(bySkuFavoritesFirst);

  // Same two units the Inventory table shows for this SKU, so the sheet
  // and the screen never disagree about what a number means.
  const onHandLine = (p) => {
    if (p.category === "packing") return `${num(p.onHand)} ${p.unitLabel || "ea"}`;
    const canonical = canonicalUnitFor(p);
    const opts = unitOptionsFor(p);
    const saved = (p.displayUnits || []).filter((u) => opts.includes(u));
    const units = (saved.length ? saved : defaultUnitsFor(p)).filter(Boolean);
    return units.map((u) => `${fmtConv(convertQty(p, p.onHand, canonical, u))} ${unitLabel(u)}`).join("   ·   ");
  };
  // Only print a square-foot figure when the SKU genuinely converts to SF.
  // convertQty falls back 1:1 otherwise, which would print "2 gal = 2 SF"
  // and put a number on the sheet that means nothing.
  const hasSF = (p) => canonicalUnitFor(p) === "sf" || Object.keys(buildUnitGraph(p)).includes("sf");
  const sfOf = (p) => (hasSF(p) ? convertQty(p, p.onHand, canonicalUnitFor(p), "sf") : null);

  // Pallets and boards are how wood gets counted. Paint and packaging come
  // off the shelf in their own units, so those sheets get their own boxes.
  const boxLabels = (p) => {
    const c = (p && p.category) || cat;
    const labels =
      c === "paint" ? ["Total gallons", "Total quarts", "Total units"]
      : c === "packing" ? [`Total ${(p && p.unitLabel) || "units"}`, "Total boxes", "Total units"]
      : ["Total pallets", "Total units", "Total boards"];
    // A SKU counted in "units" would otherwise get two identical boxes.
    return [...new Set(labels)];
  };

  const catLabel = { all: "All categories", wood: "Wood", milled: "Milled wood", paint: "Paint", packing: "Packaging" }[cat] || cat;
  const sfTotal = rows.reduce((s, p) => s + (sfOf(p) || 0), 0);
  const sfCount = rows.filter((p) => sfOf(p) != null).length;

  const Box = ({ label, height = 22 }) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>{label}</div>
      <div style={{ border: "1px solid #000", height, background: "#fff" }} />
    </div>
  );

  return (
    <PrintPortal>
    <div className="fixed inset-0 z-50 overflow-auto print-overlay" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{PRINT_CSS}</style>

      <div className="max-w-4xl mx-auto my-8 print-shell">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3 no-print">
          <div className="flex flex-wrap items-center gap-2">
            {[["all", "All"], ["wood", "Wood"], ["milled", "Milled"], ["paint", "Paint"], ["packing", "Packaging"]].map(([id, label]) => (
              <button
                key={id} onClick={() => setCat(id)}
                className="px-3 py-1.5 rounded-sm text-xs"
                style={{ fontFamily: MONO, background: cat === id ? "#fff" : "transparent", color: cat === id ? C.ink : "#fff", border: "1px solid #fff" }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn kind="primary" onClick={() => window.print()}><Printer size={13} /> Print</Btn>
            <CloseBtn onClose={onClose} onDark />
          </div>
        </div>

        <div id="count-print-root" className="print-sheet" style={{ background: "#fff", color: "#000", padding: "0.3in", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          <div className="flex items-end justify-between" style={{ borderBottom: "3px solid #000", paddingBottom: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 21, fontWeight: 900, letterSpacing: -0.3 }}>INVENTORY COUNT SHEET</div>
              <div style={{ fontSize: 11, marginTop: 3 }}>{catLabel} — {rows.length} item{rows.length === 1 ? "" : "s"}</div>
            </div>
            <div style={{ fontSize: 10, textAlign: "right", lineHeight: 1.7 }}>
              <div>Printed {new Date().toLocaleString("en-US")}</div>
              <div>Counted by ______________________</div>
              <div>Date ______________  Time __________</div>
            </div>
          </div>

          {rows.length === 0 && <div style={{ fontSize: 12 }}>Nothing in this category.</div>}

          {rows.map((p) => {
            const sf = sfOf(p);
            const rw = Number(p.reworkQty) || 0, wst = Number(p.wasteQty) || 0;
            return (
              <div key={p.id} style={{ border: "1px solid #000", marginBottom: 7, breakInside: "avoid", pageBreakInside: "avoid" }}>
                <div className="flex justify-between items-baseline" style={{ background: "#ececec", borderBottom: "1px solid #000", padding: "3px 6px", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: MONO, fontWeight: 900, fontSize: 13 }}>{p.sku}</span>
                    <span style={{ fontSize: 10.5, marginLeft: 8 }}>{p.name}</span>
                  </div>
                  <div style={{ fontSize: 9.5, textAlign: "right", whiteSpace: "nowrap" }}>
                    <strong>On book:</strong> {onHandLine(p)}
                    {sf != null && <>{"  |  "}<strong>≈ SF:</strong> {fmtConv(sf)}</>}
                  </div>
                </div>

                <div className="flex" style={{ fontSize: 8.5, padding: "2px 6px", gap: 18, borderBottom: "1px dotted #999" }}>
                  <span>Rework on book: <strong>{num(rw)}</strong>{p.reworkNote ? ` — ${p.reworkNote}` : ""}</span>
                  <span>Waste on book: <strong>{num(wst)}</strong>{p.wasteNote ? ` — ${p.wasteNote}` : ""}</span>
                </div>

                <div style={{ padding: "4px 6px 6px" }}>
                  <div style={{ fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 }}>Tick marks</div>
                  <div style={{ border: "1px solid #000", height: 54, background: "#fff" }} />
                  <div className="flex" style={{ gap: 12, marginTop: 5 }}>
                    {boxLabels(p).map((l) => <Box key={l} label={l} />)}
                  </div>
                </div>
              </div>
            );
          })}

          {rows.length > 0 && (
            <div style={{ border: "2px solid #000", marginTop: 12, padding: "6px 8px", breakInside: "avoid", pageBreakInside: "avoid" }}>
              <div className="flex justify-between items-baseline" style={{ marginBottom: 5 }}>
                <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: 0.4 }}>SHEET TOTALS — {catLabel.toUpperCase()}</div>
                <div style={{ fontSize: 9 }}>
                  On book: {sfCount > 0 ? `≈ ${fmtConv(sfTotal)} SF across ${sfCount} SKU${sfCount === 1 ? "" : "s"} · ` : ""}
                  {rows.length} SKU{rows.length === 1 ? "" : "s"} on this sheet
                </div>
              </div>
              <div className="flex" style={{ gap: 12 }}>
                {boxLabels(null).map((l) => <Box key={l} label={l} height={26} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </PrintPortal>
  );
}

/* The count sheet above is paper — this is the same walk done on a phone.
   Stock sits on the rack as whole pallets plus a loose remainder, so it
   gets counted that way: tick the pallets off one at a time, type the
   leftover boards, and the row does the multiplication. Nothing is
   written until Commit, and only rows actually touched are written at
   all — an untouched SKU is one nobody counted, which is different from
   one counted at zero. */
function InventoryCountEntry({ products, group, onCommit, onClose }) {
  useBackLayer(true, onClose);
  const [cat, setCat] = useState(group || "all");
  // { [productId]: { pallets, loose } } — strings, so a half-typed "1" in
  // the loose box doesn't get coerced to a count mid-keystroke.
  const [entries, setEntries] = useState({});

  const rows = products
    .filter((p) => !p.archived && !isService(p))
    .filter((p) => (cat === "all" ? true : (p.category || "wood") === cat))
    .slice()
    .sort(bySkuFavoritesFirst);

  const entryOf = (id) => entries[id] || { pallets: "", loose: "" };
  // Always derives from the latest state, never the render that drew the
  // button: someone ticking off a rack taps faster than React re-renders,
  // and reading the closed-over value made eight taps land as one.
  const setEntry = (id, patch) => setEntries((prev) => {
    const cur = prev[id] || { pallets: "", loose: "" };
    return { ...prev, [id]: { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) } };
  });
  const touched = (id) => {
    const e = entries[id];
    return !!e && (String(e.pallets).trim() !== "" || String(e.loose).trim() !== "");
  };
  const hasPallets = (p) => unitReaches(p, canonicalUnitFor(p), "pallet");

  // Counted total in the unit on-hand is stored in.
  const countedOf = (p) => {
    const e = entryOf(p.id);
    const canonical = canonicalUnitFor(p);
    const pal = Number(e.pallets) || 0;
    const loose = Number(e.loose) || 0;
    const fromPallets = hasPallets(p) ? convertQty(p, pal, "pallet", canonical) : 0;
    const fromLoose = canonical === "board" ? loose : convertQty(p, loose, "board", canonical);
    return fromPallets + fromLoose;
  };

  const countedRows = rows.filter((p) => touched(p.id));
  const commit = () => {
    if (!countedRows.length) return;
    const next = new Map(countedRows.map((p) => [p.id, countedOf(p)]));
    onCommit(products.map((p) => (next.has(p.id) ? { ...p, onHand: next.get(p.id) } : p)));
    onClose();
  };

  const Tick = ({ label, onClick }) => (
    <button
      onClick={onClick}
      className="rounded-sm"
      style={{ width: 34, height: 34, border: `1px solid ${C.kraftDark}`, background: "#fff", fontFamily: MONO, fontSize: 17, fontWeight: 800, lineHeight: 1 }}
    >{label}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto p-3" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="rounded-sm w-full max-w-2xl my-4" style={{ background: C.paper, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: C.ink, color: "#fff" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>Enter counts</div>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        <div className="px-4 pt-3 flex flex-wrap gap-2">
          {[["all", "All"], ["wood", "Wood"], ["milled", "Milled"], ["paint", "Paint"], ["packing", "Packaging"]].map(([id, label]) => (
            <button
              key={id} onClick={() => setCat(id)}
              className="px-3 py-1.5 rounded-sm text-xs"
              style={{ fontFamily: MONO, background: cat === id ? C.ink : "transparent", color: cat === id ? "#fff" : C.faint, border: `1px solid ${cat === id ? C.ink : C.kraftDark}` }}
            >{label}</button>
          ))}
        </div>

        <div className="p-4 space-y-2">
          {rows.map((p) => {
            const canonical = canonicalUnitFor(p);
            const e = entryOf(p.id);
            const book = Number(p.onHand) || 0;
            const counted = countedOf(p);
            const diff = counted - book;
            const on = touched(p.id);
            const pal = hasPallets(p);
            return (
              <div key={p.id} className="rounded-sm px-3 py-2" style={{ background: C.panel, border: `1px solid ${on ? (diff === 0 ? C.moss : C.warn) : C.kraft}` }}>
                <div className="flex items-baseline justify-between gap-2">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{p.sku}</div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>
                    book {num(book)} {unitLabel(canonical)}
                    {pal ? ` · ${fmtConv(convertQty(p, book, canonical, "pallet"))} pallets` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-3 mt-2">
                  {pal && (
                    <div>
                      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.6, color: C.faint, marginBottom: 3 }}>Pallets</div>
                      <div className="flex items-center gap-1.5">
                        <Tick label="−" onClick={() => setEntry(p.id, (cur) => ({ pallets: String(Math.max(0, (Number(cur.pallets) || 0) - 1)) }))} />
                        <input
                          inputMode="numeric" value={e.pallets}
                          onChange={(ev) => setEntry(p.id, { pallets: ev.target.value })}
                          style={{ ...inputStyle, width: 58, textAlign: "center", fontFamily: MONO, fontWeight: 800, fontSize: 16 }}
                          placeholder="0"
                        />
                        <Tick label="+" onClick={() => setEntry(p.id, (cur) => ({ pallets: String((Number(cur.pallets) || 0) + 1) }))} />
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.6, color: C.faint, marginBottom: 3 }}>
                      {pal ? "Loose boards" : unitLabel(canonical)}
                    </div>
                    <input
                      inputMode="numeric" value={e.loose}
                      onChange={(ev) => setEntry(p.id, { loose: ev.target.value })}
                      style={{ ...inputStyle, width: 88, fontFamily: MONO, fontSize: 15 }}
                      placeholder="0"
                    />
                  </div>
                  {on && (
                    <div style={{ fontFamily: MONO, fontSize: 12, paddingBottom: 6, color: diff === 0 ? C.moss : C.warn }}>
                      = {num(counted)} {unitLabel(canonical)}
                      {diff === 0 ? " · matches" : ` · ${diff > 0 ? "+" : ""}${num(diff)} vs book`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 pb-4 flex items-center gap-3">
          <Btn kind="primary" onClick={commit} disabled={!countedRows.length} big>
            <Check size={16} /> Commit {countedRows.length || ""} count{countedRows.length === 1 ? "" : "s"}
          </Btn>
          <Btn onClick={onClose}>Cancel</Btn>
          <span className="text-xs" style={{ color: C.faint }}>Untouched rows are left alone.</span>
        </div>
      </div>
    </div>
  );
}

function InventoryTab({ products, onChange, invLog, activeId, setActiveId }) {
  const [group, setGroup] = useState("all");
  const [pinnedId, setPinnedId] = useState(null);
  const [countSheetOpen, setCountSheetOpen] = useState(false);
  const [countEntryOpen, setCountEntryOpen] = useState(false);
  const active = products.find((p) => p.id === activeId) || null;
  useBackLayer(!!active, () => setActiveId(null));

  // A change made here is someone looking at the shelf, so it lands in the
  // history as a count rather than an anonymous edit.
  const updateOne = (p) => onChange(products.map((x) => (x.id === p.id ? p : x)), { reason: "count" });
  const remove = (id) => { onChange(products.filter((p) => p.id !== id)); setActiveId(null); };
  const add = () => {
    const p = { id: uid(), sku: "NEW-SKU", name: "New item", kind: "board", category: "wood", unitLabel: "ea", onHand: 0 };
    onChange([p, ...products]);
    setPinnedId(p.id);
    setActiveId(p.id);
  };
  // Same spec, different size or color — identity and stock deliberately
  // not carried over, since copying on-hand would invent stock.
  const duplicate = (src) => {
    const copy = { ...src, id: uid(), sku: `${src.sku}-COPY`, onHand: 0, favorite: false };
    delete copy.groupId;
    onChange([copy, ...products]);
    setPinnedId(copy.id);
    setActiveId(copy.id);
  };

  if (active) {
    return (
      <InventoryDetail
        product={active} products={products} invLog={invLog} onChange={updateOne}
        onBack={() => setActiveId(null)}
        onDelete={() => remove(active.id)}
        onDuplicate={() => duplicate(active)}
      />
    );
  }

  const sfEquivalent = (p) => (p.category === "packing" || isService(p) ? 0 : convertQty(p, p.onHand, canonicalUnitFor(p), "sf"));
  const needsReorder = (p) => Number(p.reorderPoint) > 0 && (Number(p.onHand) || 0) <= Number(p.reorderPoint);
  const filtered = products
    .filter((p) => (group === "all" ? true : (p.category || "wood") === group))
    .slice()
    .sort(bySkuFavoritesFirst);

  const columns = [
    {
      id: "sku", label: "SKU",
      render: (p) => (
        <span className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); updateOne({ ...p, favorite: !p.favorite }); }}
            title={p.favorite ? "Unfavorite" : "Favorite — keeps it at the top of every picker"}
            style={{ color: p.favorite ? C.gold : C.kraftDark }}
          >
            <Star size={13} fill={p.favorite ? C.gold : "none"} />
          </button>
          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{p.sku}</span>
        </span>
      ),
      sortValue: (p) => `${p.favorite ? "0" : "1"}${p.sku || ""}`,
    },
    { id: "name", label: "Name", render: (p) => p.name || "—", sortValue: (p) => p.name || "" },
    {
      id: "category", label: "Category",
      render: (p) => <span className="text-xs px-1.5 rounded-sm" style={{ background: C.kraft, color: C.faint, fontFamily: MONO }}>{p.category || "wood"}</span>,
      sortValue: (p) => p.category || "wood",
    },
    {
      // Editable straight from the list — two boxes, each with its own unit,
      // so you can count in whatever the pallet is actually stacked in.
      id: "onHand", label: "On hand",
      render: (p) => (isService(p) ? (
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>not stocked</span>
      ) : p.category === "packing" ? (
        <span className="flex items-center gap-1">
          <input
            type="number"
            style={{ ...inputStyle, width: 78, padding: "4px 6px", textAlign: "right", fontFamily: MONO, fontWeight: 700 }}
            value={p.onHand ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateOne({ ...p, onHand: e.target.value })}
          />
          <input
            style={{ ...inputStyle, width: 62, padding: "4px 6px", fontSize: 11 }}
            value={p.unitLabel || ""} placeholder="rolls"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => updateOne({ ...p, unitLabel: e.target.value })}
          />
        </span>
      ) : (
        <TwoUnitCell
          product={p} value={p.onHand}
          onChange={(v) => updateOne({ ...p, onHand: v })}
          onUnitsChange={(u) => updateOne({ ...p, displayUnits: u })}
        />
      )),
      sortValue: (p) => Number(p.onHand) || 0,
    },
    {
      id: "cond", label: "Rework / Waste",
      render: (p) => {
        const r = Number(p.reworkQty) || 0, w = Number(p.wasteQty) || 0;
        if (!r && !w) return <span style={{ color: C.kraftDark }}>—</span>;
        return (
          <span style={{ fontFamily: MONO, fontSize: 12 }} title={[p.reworkNote, p.wasteNote].filter(Boolean).join(" · ")}>
            {r ? <span style={{ color: C.gold }}>{num(r)} rw</span> : null}
            {r && w ? <span style={{ color: C.kraftDark }}> · </span> : null}
            {w ? <span style={{ color: C.redwood }}>{num(w)} wst</span> : null}
          </span>
        );
      },
      sortValue: (p) => (Number(p.reworkQty) || 0) + (Number(p.wasteQty) || 0),
    },
    {
      id: "sf", label: "≈ SF",
      render: (p) => (p.category === "packing" || isService(p) ? "—" :<span style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>{num(sfEquivalent(p), 0)}</span>),
      sortValue: (p) => sfEquivalent(p),
    },
    {
      id: "flag", label: "",
      render: (p) => (needsReorder(p) ? (
        <span className="text-xs flex items-center gap-1" style={{ color: C.redwood, fontFamily: MONO }}><AlertTriangle size={11} /> reorder</span>
      ) : null),
      sortValue: (p) => (needsReorder(p) ? 0 : 1),
    },
    {
      id: "dup", label: "",
      render: (p) => (
        <button onClick={(e) => { e.stopPropagation(); duplicate(p); }} title="Duplicate this item" className="opacity-40 hover:opacity-100">
          <Copy size={13} />
        </button>
      ),
    },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontWeight: 800, fontSize: 18 }}>Inventory</div>
        <div className="flex gap-2">
          <Btn onClick={() => setCountEntryOpen(true)}><ClipboardList size={14} /> Enter counts</Btn>
          <Btn onClick={() => setCountSheetOpen(true)}><Printer size={14} /> Count sheet</Btn>
          <Btn kind="primary" onClick={add}><Plus size={14} /> New item</Btn>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[["all", "All"], ["wood", "Wood"], ["milled", "Milled"], ["paint", "Paint"], ["packing", "Packaging"], ["service", "Services"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setGroup(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: group === id ? C.ink : "transparent", color: group === id ? "#fff" : C.faint, border: `1px solid ${group === id ? C.ink : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
      </div>
      <DataTable
        items={filtered} setItems={null} columns={columns}
        onRowClick={(p) => setActiveId(p.id)}
        searchable searchText={(p) => [p.sku, p.name, p.category].filter(Boolean).join(" ")}
        pinnedId={pinnedId}
        isArchived={(p) => !!p.archived}
        onToggleArchive={(p) => updateOne({ ...p, archived: !p.archived })}
        emptyText="No inventory items yet."
      />
      {countSheetOpen && (
        <InventoryCountSheet products={products} group={group} onClose={() => setCountSheetOpen(false)} />
      )}
      {countEntryOpen && (
        <InventoryCountEntry
          products={products} group={group}
          onCommit={(next) => onChange(next, { reason: "count", note: "Physical count" })}
          onClose={() => setCountEntryOpen(false)}
        />
      )}
    </div>
  );
}
/* An open log survives the app being closed.

   Everything on a log form lives in React state, which the browser throws
   away the moment the app is shut — so a batch someone had half filled in,
   timer running, came back blank the next morning. This mirrors the draft
   into localStorage on every change. localStorage writes are synchronous,
   so unlike the Supabase save (a network round trip that gets canceled
   mid-flight when the page goes away) it survives even an abrupt kill.

   The clock stores the moment it was started rather than a running count
   of seconds, so time keeps accruing while the app is closed — which is
   what actually happened on the floor. */
function useDraft(key) {
  const readDraft = () => {
    try { return JSON.parse(localStorage.getItem(key) || "null") || {}; }
    catch { return {}; }
  };
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = readDraft();

  const save = (patch) => {
    try {
      const next = { ...readDraft(), ...patch };
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* private browsing or a full quota — the form still works */ }
  };
  const clear = () => { try { localStorage.removeItem(key); } catch { /* nothing to clean up */ } };
  return { saved: savedRef.current, save, clear };
}

/* A stopwatch that can be handed a draft to resume from. */
function useStopwatch(resume) {
  // A clock that was running when the app closed keeps counting: elapsed is
  // measured from the stored start time, not frozen at the last render.
  const [running, setRunning] = useState(() => !!resume?.running);
  const [elapsed, setElapsed] = useState(() => {
    if (resume?.running && resume.startedAt) return Math.max(0, Math.floor((Date.now() - resume.startedAt) / 1000));
    return Math.max(0, Math.round(Number(resume?.elapsed) || 0));
  });
  const startRef = useRef(resume?.running && resume.startedAt ? resume.startedAt : null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    const raf = typeof window !== "undefined" && window.requestAnimationFrame;
    const caf = typeof window !== "undefined" && window.cancelAnimationFrame;
    if (raf && caf) {
      const tick = () => {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        timerRef.current = raf(tick);
      };
      timerRef.current = raf(tick);
      return () => caf(timerRef.current);
    }
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
    return () => clearInterval(timerRef.current);
  }, [running]);

  const start = () => { startRef.current = Date.now() - elapsed * 1000; setRunning(true); };
  const pause = () => setRunning(false);
  const reset = () => { setRunning(false); setElapsed(0); startRef.current = null; };
  const setManual = (seconds) => {
    const v = Math.max(0, Math.round(seconds));
    setElapsed(v);
    if (running) startRef.current = Date.now() - v * 1000;
  };

  // What a draft needs to bring this clock back exactly as it was.
  const snapshot = { running, elapsed, startedAt: startRef.current };

  return { running, elapsed, start, pause, reset, setManual, snapshot };
}

const QR = (() => {
  const SIZE = 21;

  const EXP = new Array(256), LOG = new Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = x << 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  function rsGeneratorPoly(ecLen) {
    let poly = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const res = data.concat(new Array(ecLen).fill(0));
    for (let i = 0; i < data.length; i++) {
      const coef = res[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return res.slice(data.length);
  }

  function encodeDataV1(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const totalDataCw = 19;
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, 8);
    for (const b of bytes) push(b, 8);
    const remaining = totalDataCw * 8 - bits.length;
    push(0, Math.max(0, Math.min(4, remaining)));
    while (bits.length % 8 !== 0) bits.push(0);
    const dataBytes = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      dataBytes.push(byte);
    }
    const padBytes = [0xec, 0x11];
    let p = 0;
    while (dataBytes.length < totalDataCw) { dataBytes.push(padBytes[p % 2]); p++; }
    return dataBytes;
  }

  function buildFunctionPatterns() {
    const matrix = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
    const set = (r, c, v) => { matrix[r][c] = v; };

    function placeFinderAt(topRow, topCol) {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = topRow + dr, c = topCol + dc;
          if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
          let v = 0;
          const inCore = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          if (inCore) {
            const onOuterRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
            const onInnerBlock = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
            v = (onOuterRing || onInnerBlock) ? 1 : 0;
          }
          set(r, c, v);
        }
      }
    }
    placeFinderAt(0, 0);
    placeFinderAt(0, SIZE - 7);
    placeFinderAt(SIZE - 7, 0);

    for (let i = 8; i < SIZE - 8; i++) {
      const v = i % 2 === 0 ? 1 : 0;
      set(6, i, v);
      set(i, 6, v);
    }
    return matrix;
  }

  function placeData(matrix, finalBytes, maskFn) {
    let inc = -1;
    let row = SIZE - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const dataLen = finalBytes.length;

    for (let colCounter = SIZE - 1; colCounter > 0; colCounter -= 2) {
      let col = colCounter;
      if (col <= 6) col -= 1;
      const colRange = [col, col - 1];
      while (true) {
        for (const c of colRange) {
          if (matrix[row][c] === null) {
            let dark = false;
            if (byteIndex < dataLen) dark = ((finalBytes[byteIndex] >> bitIndex) & 1) === 1;
            if (maskFn(row, c)) dark = !dark;
            matrix[row][c] = dark ? 1 : 0;
            bitIndex -= 1;
            if (bitIndex === -1) { byteIndex += 1; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || SIZE <= row) { row -= inc; inc = -inc; break; }
      }
    }
  }

  function placeFormatInfo(matrix, bits) {
    for (let i = 0; i < 15; i++) {
      const mod = (bits >> i) & 1;
      if (i < 6) matrix[i][8] = mod;
      else if (i < 8) matrix[i + 1][8] = mod;
      else matrix[SIZE - 15 + i][8] = mod;
    }
    for (let i = 0; i < 15; i++) {
      const mod = (bits >> i) & 1;
      if (i < 8) matrix[8][SIZE - i - 1] = mod;
      else if (i < 9) matrix[8][15 - i - 1 + 1] = mod;
      else matrix[8][15 - i - 1] = mod;
    }
    matrix[SIZE - 8][8] = 1;
  }

  const G15 = 0b10100110111;
  const G15_MASK = 0b101010000010010;
  function bchDigit(data) { let d = 0; while (data !== 0) { d++; data >>>= 1; } return d; }
  function bchTypeInfo(data) {
    let d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
    return ((data << 10) | d) ^ G15_MASK;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text ?? "")));
    if (bytes.length > 16) {
      throw new Error(`QR payload too long for version 1 (${bytes.length} bytes, max 16): ${text}`);
    }
    const data = encodeDataV1(String(text ?? ""));
    const ec = rsEncode(data, 7);
    const final = data.concat(ec);
    const matrix = buildFunctionPatterns();
    const bits = bchTypeInfo((1 << 3) | 0);
    placeFormatInfo(matrix, bits);
    const maskFn = (r, c) => (r + c) % 2 === 0;
    placeData(matrix, final, maskFn);
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (matrix[r][c] === null) matrix[r][c] = 0;
    return { size: SIZE, matrix };
  }

  return { encode };
})();

function QRCode({ value, size = 96 }) {
  const { matrix, size: modules } = useMemo(() => {
    try { return QR.encode(String(value || "")); }
    catch (e) { return { matrix: null, size: 0 }; }
  }, [value]);
  if (!matrix) return <div style={{ width: size, height: size, background: C.kraft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: C.faint }}>QR error</div>;
  const cell = size / modules;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${modules} ${modules}`} style={{ background: "#fff" }}>
      {matrix.map((row, r) => row.map((v, c) => v ? <rect key={`${r}-${c}`} x={c} y={r} width={1.02} height={1.02} fill="#000" /> : null))}
    </svg>
  );
}

function VendorsTab({ suppliers, onChange }) {
  const [openId, setOpenId] = useState(null);
  useBackLayer(!!openId, () => setOpenId(null));
  const [pinnedId, setPinnedId] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const [showHidden, setShowHidden] = useState(false);
  const update = (id, patch) => onChange(suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id) => onChange(suppliers.filter((s) => s.id !== id));
  const add = () => {
    const v = { id: uid(), name: "New vendor", altName: "", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, favorite: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" };
    onChange([v, ...suppliers]);
    setOpenId(v.id);
    setPinnedId(v.id);
  };

  const shown = suppliers
    .filter((s) => showHidden || !s.hidden)
    .slice()
    .sort((a, b) => {
      if (a.id === pinnedId) return -1;
      if (b.id === pinnedId) return 1;
      const favDiff = Number(!!b.favorite) - Number(!!a.favorite);
      if (favDiff !== 0) return favDiff;
      const av = (sortBy === "city" ? a.city : a.name) || "";
      const bv = (sortBy === "city" ? b.city : b.name) || "";
      return av.localeCompare(bv);
    });
  const hiddenCount = suppliers.filter((s) => s.hidden).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn kind="primary" onClick={add}><Plus size={14} /> Add vendor</Btn>
        <span className="text-xs" style={{ color: C.faint, fontFamily: MONO, marginLeft: 8 }}>SORT BY</span>
        {[["name", "Name"], ["city", "City"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setSortBy(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: sortBy === id ? C.ink : "transparent", color: sortBy === id ? "#fff" : C.faint, border: `1px solid ${sortBy === id ? C.ink : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
        {hiddenCount > 0 && (
          <label className="flex items-center gap-1.5 ml-2 text-xs" style={{ color: C.faint, fontFamily: MONO }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden ({hiddenCount})
          </label>
        )}
      </div>

      <div className="rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        {shown.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: C.faint }}>No vendors to show.</div>
        ) : (
          shown.map((s) => {
            const open = openId === s.id;
            return (
              <div key={s.id} style={{ borderBottom: `1px solid ${C.kraft}`, opacity: s.hidden ? 0.55 : 1 }}>
                <div className="px-4 py-2.5 flex items-center gap-3">
                  <button onClick={() => update(s.id, { favorite: !s.favorite })} title={s.favorite ? "Unfavorite" : "Favorite"} className="shrink-0" style={{ color: s.favorite ? C.gold : C.kraftDark }}>
                    <Star size={16} fill={s.favorite ? C.gold : "none"} />
                  </button>
                  <button onClick={() => setOpenId(open ? null : s.id)} className="text-left flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</span>
                      {s.city && <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>{s.city}</span>}
                      {s.hidden && <span className="text-xs" style={{ color: C.warn, fontFamily: MONO }}>HIDDEN</span>}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: C.faint }}>
                      {[s.contact, s.phone].filter(Boolean).join(" · ") || "No contact info yet"}
                    </div>
                  </button>
                  <button onClick={() => update(s.id, { hidden: !s.hidden })} title={s.hidden ? "Unhide" : "Hide"} className="opacity-60 hover:opacity-100 shrink-0 text-xs px-2 py-1" style={{ fontFamily: MONO, border: `1px solid ${C.kraftDark}`, borderRadius: 3 }}>
                    {s.hidden ? "Unhide" : "Hide"}
                  </button>
                  <button onClick={() => remove(s.id)} className="opacity-40 hover:opacity-100 shrink-0"><Trash2 size={14} /></button>
                </div>

                {open && (
                  <div className="px-4 pb-4 space-y-2" style={{ background: C.paper }}>
                    <Field label="Company / Vendor name"><input style={inputStyle} value={s.name} onChange={(e) => update(s.id, { name: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Alternative name"><input style={inputStyle} value={s.altName || ""} onChange={(e) => update(s.id, { altName: e.target.value })} /></Field>
                      <Field label="Code"><input style={{ ...inputStyle, fontFamily: MONO }} value={s.code || ""} onChange={(e) => update(s.id, { code: e.target.value.toUpperCase() })} /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Contact"><input style={inputStyle} value={s.contact || ""} onChange={(e) => update(s.id, { contact: e.target.value })} /></Field>
                      <Field label="Phone"><input style={{ ...inputStyle, fontFamily: MONO }} value={s.phone || ""} onChange={(e) => update(s.id, { phone: e.target.value })} /></Field>
                    </div>
                    <Field label="Email"><input style={{ ...inputStyle, fontFamily: MONO, fontSize: 13 }} value={s.email || ""} onChange={(e) => update(s.id, { email: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Address"><input style={inputStyle} value={s.address || ""} onChange={(e) => update(s.id, { address: e.target.value })} /></Field>
                      <Field label="City"><input style={inputStyle} value={s.city || ""} onChange={(e) => update(s.id, { city: e.target.value })} /></Field>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Account owner (our side)"><input style={inputStyle} value={s.accountOwner || ""} onChange={(e) => update(s.id, { accountOwner: e.target.value })} placeholder="e.g. Leo, Michael" /></Field>
                      <Field label="Pay method"><input style={inputStyle} value={s.payMethod || ""} onChange={(e) => update(s.id, { payMethod: e.target.value })} placeholder="Cash, Mail Check…" /></Field>
                    </div>
                    <Field label="Crews / notes on people"><input style={inputStyle} value={s.crews || ""} onChange={(e) => update(s.id, { crews: e.target.value })} /></Field>
                    <label className="flex items-center gap-2 mt-1">
                      <input type="checkbox" checked={!!s.has1099} onChange={(e) => update(s.id, { has1099: e.target.checked })} />
                      <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>1099 ON FILE</span>
                    </label>

                    {/* Vendor rates live in GNWS Office now. The floor app shows
                        no money at all, so they are edited there. */}
                    <Field label="General notes"><textarea style={{ ...inputStyle, minHeight: 70 }} value={s.notes || ""} onChange={(e) => update(s.id, { notes: e.target.value })} /></Field>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ---------------- QR Scanner (camera-based, in-app) ----------------
   Our printed labels encode plain text ("<unit id> <boardCount>bd"), not
   a URL — a version-1 QR code can't fit a real URL, and even if it
   could, a phone's native Camera app only makes a code tappable when
   it's a URL. So scanning happens INSIDE the app instead: this opens
   the camera in a live video feed and decodes frames with jsQR (a
   pure-JS decoder, so it works the same on iPhone Safari as anywhere
   else — no dependency on a browser's native barcode API). */

function QRScannerModal({ onClose, onDecoded }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };

    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          stop();
          onDecoded(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (canceled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch (e) {
        setError("Couldn't access the camera. Check that you've allowed camera permission for this site, or use the manual fields below instead.");
      }
    })();

    return () => { canceled = true; stop(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="rounded-sm p-4 w-full max-w-sm mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Scan unit label</div>
          <CloseBtn onClose={onClose} />
        </div>
        {error ? (
          <div className="text-sm" style={{ color: C.warn }}>{error}</div>
        ) : (
          <div className="rounded-sm overflow-hidden" style={{ background: "#000" }}>
            <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block" }} />
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <p className="text-xs mt-2" style={{ color: C.faint }}>Point the camera at the QR code on the unit's printed label.</p>
      </div>
    </div>
  );
}

/* ---------------- Bill of Lading (printable, from a Work Order) ----------------
   Kept intentionally minimal per what's actually needed: pallet count,
   weight (1.5 lbs/SF, computed from the order's line items but editable
   in case what's actually loaded differs from what's on the order),
   load description, and the consignee's address. No freight-charge
   terms, NMFC codes, etc. — those weren't asked for. */

// Two brands the shop sells under — same address, different name and logo
// on the printed paperwork depending on the customer segment. Mirrors the
// same table in GNWS Office so a document looks identical from either app.
const BRANDS = {
  gnws: { label: "Good News Wood Salvation", name: "Good News Wood Salvation", logo: "/logos/gnws.png" },
  ethica: { label: "Ethica Wood", name: "Ethica Wood", logo: "/logos/ethica.png" },
};
const DEFAULT_BRAND = "gnws";
function brandFor(key) { return BRANDS[key] || BRANDS[DEFAULT_BRAND]; }

const SHIPPER = {
  name: "Good News Wood Salvation",
  address: "15775 Celestial Valley Road",
  cityStateZip: "North San Juan, CA 95960",
};
const LBS_PER_SF = 1.5;

/* ---------------- Drop ship ----------------
   A distributor (Rockin Wood, say) orders from us as the manufacturer and
   we ship straight to their customer. The order's customer stays the
   distributor, since they're who we bill. What changes is where it goes
   (shipTo), whose PO it answers to (customerPO), and whose name the end
   customer sees: the distributor's, never ours. The end customer bought
   from them, so the BOL, labels and packing slip all ship as them.
   GNWS Office carries the same fields and helpers, since it edits the
   same orders. */

const EMPTY_SHIP_TO = { name: "", company: "", address: "", address2: "", city: "", state: "", zip: "", country: "", phone: "" };
const isDropShip = (rec) => !!rec?.dropShip;

// The address the way a label reads it. Country only when it isn't the
// US, same as customer addresses everywhere else.
function shipToLines(s) {
  if (!s) return [];
  const country = s.country && !/^(us|usa|united states)$/i.test(s.country.trim()) ? s.country : "";
  // "City, ST 12345", the way it goes on a mailing label.
  const cityLine = [s.city, [s.state, s.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [s.name, s.company, s.address, s.address2, cityLine, country].filter(Boolean);
}
const shipToName = (s) => s?.company || s?.name || "";

function DropShipPanel({ record, customer, onChange, disabled }) {
  const on = isDropShip(record);
  const shipTo = { ...EMPTY_SHIP_TO, ...(record.shipTo || {}) };
  const setShipTo = (patch) => onChange({ shipTo: { ...shipTo, ...patch } });
  const distributor = customer?.company || "the customer";
  const noDistributorAddress = customer && !customer.address && !customer.city;
  const input = (key, placeholder) => (
    <input style={inputStyle} value={shipTo[key]} onChange={(e) => setShipTo({ [key]: e.target.value })} placeholder={placeholder} disabled={disabled} />
  );
  return (
    <div className="rounded-sm p-4 mb-4" style={{ background: on ? "#FBF6EC" : C.panel, border: `1px solid ${on ? C.gold : C.kraftDark}` }}>
      <label className="flex items-center gap-2 flex-wrap" style={{ fontWeight: 800, cursor: disabled ? "default" : "pointer" }}>
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange({ dropShip: e.target.checked })} />
        <Truck size={16} style={{ color: on ? C.gold : C.faint }} /> Drop ship
        <span style={{ fontWeight: 400, fontSize: 12, color: C.faint }}>ships straight to {distributor}'s customer</span>
      </label>
      {on && (
        <div className="mt-3">
          <Field label="Customer PO #" w={240}>
            <input style={inputStyle} value={record.customerPO || ""} onChange={(e) => onChange({ customerPO: e.target.value })} placeholder={`${distributor}'s PO number`} disabled={disabled} />
          </Field>
          <div className="mt-3 mb-1" style={{ fontFamily: MONO, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", color: C.gold }}>SHIP TO</div>
          <div className="flex flex-wrap gap-3">
            <Field label="Name" w={240}>{input("name", "Who it's going to")}</Field>
            <Field label="Company (optional)" w={240}>{input("company", "")}</Field>
          </div>
          <Field label="Street address">{input("address", "")}</Field>
          <Field label="Apt, suite, etc. (optional)">{input("address2", "")}</Field>
          <div className="flex flex-wrap gap-3">
            <Field label="City" w={200}>{input("city", "")}</Field>
            <Field label="State" w={80}>{input("state", "")}</Field>
            <Field label="ZIP" w={120}>{input("zip", "")}</Field>
            <Field label="Country" w={140}>{input("country", "USA")}</Field>
            <Field label="Phone" w={160}>{input("phone", "")}</Field>
          </div>
          <div className="mt-2 text-xs" style={{ color: C.faint, lineHeight: 1.5 }}>
            Blind ship: the bill of lading, pallet labels and packing slip show {distributor} as the shipper, not us.
            {noDistributorAddress && (
              <span style={{ color: C.warn }}> {distributor} has no address on file, so the packing slip will show their name only. Add it to their contact to show it.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The boxed ship-to that goes on printed paperwork. `note` is the line
// under the address: a warning for the crew, or nothing for a customer.
function DropShipPrintBlock({ rec, note, fontSize = 11 }) {
  const lines = shipToLines(rec.shipTo);
  return (
    <div style={{ border: "2px solid #000", padding: "5px 8px", marginBottom: 8, fontSize, lineHeight: 1.35, breakInside: "avoid", pageBreakInside: "avoid" }}>
      <div style={{ fontWeight: 900, letterSpacing: 0.5 }}>DROP SHIP TO{rec.customerPO ? `  ·  PO # ${rec.customerPO}` : ""}</div>
      {lines.length ? lines.map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>{l}</div>) : <div>No ship-to address entered yet.</div>}
      {rec.shipTo?.phone && <div>{rec.shipTo.phone}</div>}
      {note && <div style={{ marginTop: 3, fontSize: fontSize - 1 }}>{note}</div>}
    </div>
  );
}

function DropShipTag({ wo }) {
  const to = shipToName(wo.shipTo);
  return (
    <div className="mt-1 flex items-center gap-1" style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 800, color: C.gold }}>
      <Truck size={11} /> DROP SHIP{to ? ` to ${to}` : ""}
    </div>
  );
}

/* ---------------- Blind packing slip ----------------
   Goes in the box on a drop ship. The end customer bought from the
   distributor, so this carries the distributor's name and PO number and
   nothing about who made it: no logo, no shop address, no prices, and no
   SKUs (those are our codes, not theirs). Crew line notes stay off too,
   since they're written for the shop floor. */
function PackingSlipPrintView({ wo, customer, products, onClose }) {
  useBackLayer(true, onClose);
  const sellerCity = [customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ");
  // Boxes and other packing supplies are how it ships, not what they bought.
  const items = (wo.lines || []).filter((l) => products.find((p) => p.id === l.productId)?.category !== "packing");
  return (
    <PrintPortal>
    <div className="fixed inset-0 z-50 overflow-auto print-overlay" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{PRINT_CSS}</style>
      <div className="max-w-3xl mx-auto my-8 print-shell">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Btn kind="dark" onClick={() => window.print()}><Printer size={13} /> Print</Btn>
          <CloseBtn onClose={onClose} onDark />
        </div>
        <div className="print-sheet" style={{ background: "#fff", color: "#000", padding: "0.4in", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          <div className="flex items-start justify-between" style={{ borderBottom: "3px solid #000", paddingBottom: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 12, lineHeight: 1.45 }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{customer?.company || ""}</div>
              {customer?.address && <div>{customer.address}</div>}
              {sellerCity && <div>{sellerCity}</div>}
              {customer?.phone && <div>{customer.phone}</div>}
              {customer?.email && <div>{customer.email}</div>}
            </div>
            <div style={{ textAlign: "right", fontSize: 12, lineHeight: 1.45 }}>
              <div style={{ fontSize: 24, fontWeight: 900 }}>PACKING SLIP</div>
              {wo.customerPO && <div><strong>PO #:</strong> {wo.customerPO}</div>}
              <div><strong>Date:</strong> {wo.shipDate || today()}</div>
            </div>
          </div>

          <div className="mb-5" style={{ fontSize: 13, lineHeight: 1.45 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555" }}>SHIP TO</div>
            {shipToLines(wo.shipTo).map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>{l}</div>)}
            {wo.shipTo?.phone && <div>{wo.shipTo.phone}</div>}
          </div>

          <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={{ border: "1px solid #999", padding: 8, textAlign: "left" }}>Item</th>
                <th style={{ border: "1px solid #999", padding: 8, textAlign: "right", width: 160 }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => {
                const p = products.find((pr) => pr.id === l.productId);
                const unit = l.displayUnit || "sf";
                return (
                  <tr key={l.id}>
                    <td style={{ border: "1px solid #999", padding: 8 }}>{p ? p.name : (l.desc || "Item")}</td>
                    <td style={{ border: "1px solid #999", padding: 8, textAlign: "right" }}>{fmtConv(convertQty(p, l.qtySF, "sf", unit))} {unitLabel(unit)}</td>
                  </tr>
                );
              })}
              {!items.length && (
                <tr><td colSpan={2} style={{ border: "1px solid #999", padding: 10, textAlign: "center", color: "#888" }}>No items</td></tr>
              )}
            </tbody>
          </table>

          <div className="mt-6" style={{ fontSize: 12 }}>
            Questions about this order? Please contact {customer?.company || "the seller"}.
          </div>
        </div>
      </div>
    </div>
    </PrintPortal>
  );
}

/* ---------------- Printable Work Order (8.5x11) ----------------
   A paper traveler for the crew: each line shows only the process
   steps actually checked for that item (as blank boxes to mark off by
   hand — the on-screen checked state means "this step applies," not
   "already done"), plus the item's on-hand conversions (boards, boxes,
   pallets, SF… whatever units that SKU's conversion graph reaches) and
   any notes, so nobody has to flip back to the app on the floor. */

const PRINT_UNIT_ORDER = ["sf", "board", "plank", "box", "pallet", "gal", "qt"];
const fmtConv = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// Spec now lives per line item rather than per customer, so the printed
// sheet shows it next to the item the crew is actually working on.
// The color a finished SKU is painted in, if any. Kept on the product so
// nobody has to remember which Graphene Stone goes with which product.
const paintFor = (product, products) =>
  product?.paintProductId ? (products || []).find((x) => x.id === product.paintProductId) || null : null;

const specLine = (spec) => {
  if (!spec) return "";
  return [
    spec.minSize && `min ${spec.minSize}`,
    spec.maxSize && `max ${spec.maxSize}`,
    spec.paintTolerance,
    spec.knotTolerance,
    spec.notes,
  ].filter(Boolean).join(" · ");
};

function lineConversions(product, qtySF) {
  if (!product) return [{ unit: "sf", qty: Number(qtySF) || 0 }];
  const units = product.category === "paint"
    ? ["sf", "gal", "qt"]
    : product.category === "packing" || isService(product)
    ? [product.unitLabel || "ea"]
    : (() => {
        const graph = buildUnitGraph(product);
        const visited = new Set(["sf"]);
        const queue = ["sf"];
        while (queue.length) {
          const node = queue.shift();
          const neighbors = graph[node] || {};
          for (const next in neighbors) {
            if (!visited.has(next)) { visited.add(next); queue.push(next); }
          }
        }
        return Array.from(visited);
      })();
  const ordered = [...PRINT_UNIT_ORDER.filter((u) => units.includes(u)), ...units.filter((u) => !PRINT_UNIT_ORDER.includes(u))];
  return ordered.map((u) => ({ unit: u, qty: convertQty(product, qtySF, "sf", u) }));
}

function WorkOrderPrintView({ wo, customer, products, onClose }) {
  useBackLayer(true, onClose);
  const brand = brandFor(wo.brand);
  return (
    <PrintPortal>
    <div className="fixed inset-0 z-50 overflow-auto print-overlay" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{PRINT_CSS}</style>
      <div className="max-w-4xl mx-auto my-8 print-shell">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Btn kind="dark" onClick={() => window.print()}><Printer size={13} /> Print</Btn>
          <CloseBtn onClose={onClose} onDark />
        </div>

        <div id="wo-print-root" className="print-sheet" style={{ background: "#fff", color: "#000", padding: "0.4in", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          <div className="flex items-center justify-between" style={{ borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 10 }}>
            <div className="flex items-center" style={{ gap: 10 }}>
              <img
                src={brand.logo} alt=""
                style={{ height: 40, width: 40, objectFit: "contain" }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <div>
                <div style={{ fontSize: 19, fontWeight: 900, lineHeight: 1.1 }}>WORK ORDER</div>
                <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 700 }}>{brand.name}</div>
                  <div>{SHIPPER.address}</div>
                  <div>{SHIPPER.cityStateZip}</div>
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 10, lineHeight: 1.45 }}>
              <div><strong>WO #:</strong> {wo.number}</div>
              <div><strong>Date:</strong> {wo.date}</div>
              {wo.readyByDate && <div><strong>Ready by:</strong> {wo.readyByDate}</div>}
              {wo.shipDate && <div><strong>Ship date:</strong> {wo.shipDate}</div>}
              {wo.shipVia && <div><strong>Ship via:</strong> {wo.shipVia}</div>}
            </div>
          </div>

          <div style={{ marginBottom: 8, fontSize: 11, lineHeight: 1.35 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", letterSpacing: 0.5 }}>CUSTOMER</div>
            <div style={{ fontWeight: 700, fontSize: 12 }}>{customer?.company || "No customer assigned"}</div>
            {customer?.address && <div>{customer.address}</div>}
            {(customer?.city || customer?.state) && <div>{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</div>}
          </div>

          {isDropShip(wo) && (
            <DropShipPrintBlock rec={wo} note={`Blind ship as ${customer?.company || "the customer"}. Do not ship to ${customer?.company || "the customer"}.`} />
          )}

          {wo.notes && (
            <div style={{ marginBottom: 8, fontSize: 11 }}>
              <strong>Notes:</strong> {wo.notes}
            </div>
          )}

          {(!wo.lines || wo.lines.length === 0) && (
            <div style={{ border: "1px solid #999", padding: 10, textAlign: "center", color: "#888" }}>No line items</div>
          )}

          {(wo.lines || []).map((line) => {
            const p = products.find((pr) => pr.id === line.productId);
            const checkedSteps = PROCESS_STEPS.filter((s) => line.steps && line.steps[s.id]);
            const conversions = lineConversions(p, line.qtySF);
            return (
              <div key={line.id} style={{ border: "1px solid #999", padding: "5px 7px", marginBottom: 5, breakInside: "avoid", pageBreakInside: "avoid" }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    {p && <div style={{ fontFamily: "monospace", fontWeight: 800, fontSize: 12, lineHeight: 1.2 }}>{p.sku}</div>}
                    <div style={{ fontSize: 11, fontWeight: p ? 400 : 700, lineHeight: 1.25 }}>{p ? p.name : (line.desc || "Item")}</div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 10, whiteSpace: "nowrap" }}>
                    {conversions.map((c) => `${fmtConv(c.qty)} ${unitLabel(c.unit)}`).join(" · ")}
                  </div>
                </div>

                {(line.note || p?.otherNotes || specLine(line.spec) || paintFor(p, products)) && (
                  <div style={{ marginTop: 3, fontSize: 10, color: "#333", lineHeight: 1.35 }}>
                    {line.note && <div><strong>Order note:</strong> {line.note}</div>}
                    {p?.otherNotes && <div><strong>Item note:</strong> {p.otherNotes}</div>}
                    {paintFor(p, products) && (
                      <div><strong>Paint:</strong> {paintFor(p, products).sku} — {paintFor(p, products).name}</div>
                    )}
                    {specLine(line.spec) && (
                      <div style={{ marginTop: 2, padding: "2px 5px", border: "1px solid #999", background: "#f4f4f4" }}>
                        <strong>Spec:</strong> {specLine(line.spec)}
                      </div>
                    )}
                  </div>
                )}

                {checkedSteps.length > 0 && (
                  <div className="flex flex-wrap" style={{ gap: "3px 10px", marginTop: 4 }}>
                    {checkedSteps.map((s) => (
                      <div key={s.id} className="flex items-center" style={{ gap: 4 }}>
                        <span style={{ width: 11, height: 11, border: "1.25px solid #000", display: "inline-block" }} />
                        <span style={{ fontSize: 10 }}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </PrintPortal>
  );
}

function BOLModal({ wo, customer, products, onClose }) {
  useBackLayer(true, onClose);
  const totalSF = (wo.lines || []).reduce((sum, l) => sum + (Number(l.qtySF) || 0), 0);
  const estimatedPallets = (wo.lines || []).reduce((sum, l) => {
    const product = products.find((p) => p.id === l.productId);
    if (!product || !unitsFor(product).includes("pallet")) return sum;
    return sum + convertQty(product, Number(l.qtySF) || 0, "sf", "pallet");
  }, 0);
  const [pallets, setPallets] = useState(estimatedPallets > 0 ? String(Math.ceil(estimatedPallets)) : "");
  const [weight, setWeight] = useState(String(Math.round(totalSF * LBS_PER_SF)));
  const [date, setDate] = useState(today());
  const [carrier, setCarrier] = useState(wo.shipVia || "");
  const bolNumber = `BOL-${wo.number}`;
  const drop = isDropShip(wo);
  // Blind ship: the driver still picks up here, so the street address
  // stays ours. Only the name changes, to the distributor's.
  const shipFromName = drop ? (customer?.company || SHIPPER.name) : SHIPPER.name;

  return (
    <PrintPortal>
    <div className="fixed inset-0 z-50 overflow-auto print-overlay" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{PRINT_CSS}</style>
      <div className="max-w-2xl mx-auto my-8 print-shell">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Field label="Pallets" w={90}><input type="number" style={inputStyle} value={pallets} onChange={(e) => setPallets(e.target.value)} /></Field>
          <Field label="Weight (lbs)" w={110}><input type="number" style={inputStyle} value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Carrier / ship via" w={160}><input style={inputStyle} value={carrier} onChange={(e) => setCarrier(e.target.value)} /></Field>
          <Field label="Date" w={140}><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Btn kind="dark" onClick={() => window.print()}><Printer size={13} /> Print</Btn>
            <CloseBtn onClose={onClose} onDark />
          </div>
        </div>

        <div id="bol-root" className="print-sheet" style={{ background: "#fff", color: "#000", padding: "0.4in", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          <div className="flex items-center justify-between" style={{ borderBottom: "3px solid #000", paddingBottom: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 24, fontWeight: 900 }}>BILL OF LADING</div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div><strong>BOL #:</strong> {bolNumber}</div>
              <div><strong>Date:</strong> {date}</div>
              {drop && wo.customerPO && <div><strong>PO #:</strong> {wo.customerPO}</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 4 }}>SHIP FROM</div>
              <div style={{ fontWeight: 700 }}>{shipFromName}</div>
              <div>{SHIPPER.address}</div>
              <div>{SHIPPER.cityStateZip}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 4 }}>CONSIGNEE (SHIP TO)</div>
              {drop ? (
                <>
                  {shipToLines(wo.shipTo).map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 700 } : undefined}>{l}</div>)}
                  {wo.shipTo?.phone && <div>{wo.shipTo.phone}</div>}
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 700 }}>{customer?.company || "—"}</div>
                  {customer?.address && <div>{customer.address}</div>}
                  <div>{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</div>
                  {customer?.country && customer.country !== "USA" ? <div>{customer.country}</div> : null}
                </>
              )}
            </div>
          </div>

          <div className="mb-6">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 4 }}>CARRIER</div>
            <div>{carrier || "—"}</div>
          </div>

          <table className="w-full" style={{ borderCollapse: "collapse", marginBottom: 24 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={{ border: "1px solid #999", padding: 8, textAlign: "left" }}>Pallets</th>
                <th style={{ border: "1px solid #999", padding: 8, textAlign: "left" }}>Description of Goods</th>
                <th style={{ border: "1px solid #999", padding: 8, textAlign: "right" }}>Weight (lbs)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border: "1px solid #999", padding: 8 }}>{pallets || "—"}</td>
                <td style={{ border: "1px solid #999", padding: 8 }}>Wood</td>
                <td style={{ border: "1px solid #999", padding: 8, textAlign: "right" }}>{weight || "—"}</td>
              </tr>
              <tr>
                <td style={{ border: "1px solid #999", padding: 8 }}></td>
                <td style={{ border: "1px solid #999", padding: 8, textAlign: "right", fontWeight: 700 }}>Total</td>
                <td style={{ border: "1px solid #999", padding: 8, textAlign: "right", fontWeight: 700 }}>{weight || "—"} lbs</td>
              </tr>
            </tbody>
          </table>

          <div className="grid grid-cols-3 gap-6" style={{ marginTop: 48 }}>
            <div>
              <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>Shipper Signature</div>
              <div style={{ marginTop: 24, borderTop: "1px solid #000", paddingTop: 4 }}>Date</div>
            </div>
            <div>
              <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>Driver Signature</div>
              <div style={{ marginTop: 24, borderTop: "1px solid #000", paddingTop: 4 }}>Date</div>
            </div>
            <div>
              <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>Consignee Signature</div>
              <div style={{ marginTop: 24, borderTop: "1px solid #000", paddingTop: 4 }}>Date</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </PrintPortal>
  );
}

/* ---------------- Finished pallet labels (from a Work Order) ----------------
   These are the outbound labels — distinct from the inbound raw-unit
   labels in Receiving. Prioritizes legibility over density: no QR code
   here, just large text, since the ask was specifically to make the
   customer name, size, and ship date very clearly readable at a glance.
   Always 4"x1" for the Rollo printer — that's the only format offered
   here, on purpose. */

/* ---------------- Labels as a PDF ----------------
   Android's print framework ignores a web page's @page size — it only
   offers the media sizes the printer driver advertises, which is why the
   phone kept showing 4x6 no matter what the CSS said. A PDF carries its
   own page geometry, so 4in x 1in pages come out at 4in x 1in wherever
   they are opened: the Rollo app, Android's own PDF print, or Preview.

   One label per page, drawn to match what's on screen. */
const LABEL_W = 4, LABEL_H = 1, LABEL_PAD = 0.07;

function newLabelPdf() {
  return new jsPDF({ unit: "in", orientation: "landscape", format: [LABEL_W, LABEL_H] });
}

// The QR is drawn as one filled square per dark module — same matrix the
// on-screen SVG uses, so a scan of the paper matches a scan of the screen.
function drawQr(pdf, value, x, y, size) {
  let matrix, modules;
  try { const enc = QR.encode(String(value || "")); matrix = enc.matrix; modules = enc.size; }
  catch (e) { return; }
  const cell = size / modules;
  pdf.setFillColor(0, 0, 0);
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c]) pdf.rect(x + c * cell, y + r * cell, cell * 1.02, cell * 1.02, "F");
    }
  }
}

function receivedLabelsPdf(units, supplierFor) {
  const pdf = newLabelPdf();
  units.forEach((unit, i) => {
    if (i > 0) pdf.addPage([LABEL_W, LABEL_H], "landscape");
    const supplier = supplierFor ? supplierFor(unit.poId) : null;
    const qr = LABEL_H - LABEL_PAD * 2;
    drawQr(pdf, `${unit.id} ${unit.boardCount}bd`, LABEL_W - LABEL_PAD - qr, LABEL_PAD, qr);
    let y = LABEL_PAD + 0.16;
    pdf.setFont("courier", "bold"); pdf.setFontSize(15);
    pdf.text(String(unit.sizeLabel || ""), LABEL_PAD, y);
    pdf.setFont("courier", "normal"); pdf.setFontSize(9);
    y += 0.15; pdf.text(String(unit.receivedDate || ""), LABEL_PAD, y);
    if (supplier?.name) { y += 0.13; pdf.text(String(supplier.name).slice(0, 30), LABEL_PAD, y); }
    y += 0.13; pdf.setFontSize(8);
    pdf.text(`${num(unit.boardCount)} bd · ${unit.id}`, LABEL_PAD, y);
  });
  return pdf;
}

function finishedLabelsPdf(labels) {
  const pdf = newLabelPdf();
  labels.forEach((l, i) => {
    if (i > 0) pdf.addPage([LABEL_W, LABEL_H], "landscape");
    let y = LABEL_PAD + 0.18;
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(14);
    pdf.text(String(l.customer || "").slice(0, 34), LABEL_PAD, y);
    y += 0.22; pdf.setFontSize(13);
    pdf.text(String(l.size || ""), LABEL_PAD, y);
    y += 0.2; pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
    pdf.text(`${l.seq} of ${l.seqTotal}`, LABEL_PAD, y);
    pdf.text(`Ship: ${l.shipDate || ""}`, LABEL_W - LABEL_PAD, y, { align: "right" });
  });
  return pdf;
}

function PalletLabelModal({ wo, customer, products, onClose, onGenerate }) {
  useBackLayer(true, onClose);
  const lineDesc = (l) => {
    const p = products.find((pr) => pr.id === l.productId);
    return p ? p.sku : (l.desc || "Item");
  };
  const blankRow = () => ({ key: uid(), size: "", pallets: "" });
  const [shipDate, setShipDate] = useState(wo.shipDate || today());
  const [rows, setRows] = useState(
    (wo.lines && wo.lines.length > 0)
      ? wo.lines.map((l) => ({ key: uid(), size: lineDesc(l), pallets: "" }))
      : [blankRow()]
  );
  const updateRow = (key, patch) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key) => setRows(rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);

  const totalLabels = rows.reduce((sum, r) => sum + Math.max(0, Math.floor(Number(r.pallets) || 0)), 0);

  const generate = () => {
    const labels = [];
    rows.forEach((r) => {
      const count = Math.max(0, Math.floor(Number(r.pallets) || 0));
      for (let i = 0; i < count; i++) {
        // A drop ship's pallet is addressed to the end customer, not to
        // the distributor we bill.
        const to = (isDropShip(wo) && shipToName(wo.shipTo)) || customer?.company || "—";
        labels.push({ key: uid(), customer: to, size: r.size || "—", shipDate, seq: i + 1, seqTotal: count });
      }
    });
    onGenerate(labels);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Print pallet labels</div>
          <CloseBtn onClose={onClose} />
        </div>
        <div className="text-sm mb-3" style={{ color: C.faint }}>4"×1" Rollo labels — customer, size, and ship date, big and legible.</div>
        <Field label="Ship date"><input type="date" style={inputStyle} value={shipDate} onChange={(e) => setShipDate(e.target.value)} /></Field>
        <div className="mt-3 space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-end gap-2">
              <Field label="Size / description" w={200}><input style={inputStyle} value={r.size} onChange={(e) => updateRow(r.key, { size: e.target.value })} /></Field>
              <Field label="Pallets" w={80}><input type="number" style={inputStyle} value={r.pallets} onChange={(e) => updateRow(r.key, { pallets: e.target.value })} /></Field>
              <button onClick={() => removeRow(r.key)} disabled={rows.length === 1} className="opacity-40 hover:opacity-100 disabled:opacity-15 mb-2"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
        <Btn onClick={() => setRows([...rows, blankRow()])}><Plus size={14} /> Add another size</Btn>
        <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="text-sm" style={{ color: C.faint }}>{totalLabels} label{totalLabels === 1 ? "" : "s"}</div>
          <Btn kind="primary" onClick={generate} disabled={totalLabels === 0}><Printer size={16} /> Generate & print</Btn>
        </div>
      </div>
    </div>
  );
}

function FinishedLabelPrintView({ labels, onClose, onSavePdf }) {
  useBackLayer(true, onClose);
  return (
    <PrintPortal>
    <div className="fixed inset-0 z-50 overflow-auto print-overlay" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{LABEL_PRINT_CSS}</style>
      <div className="max-w-md mx-auto my-8 print-shell">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Btn kind="dark" onClick={() => window.print()}><Printer size={13} /> Print all {labels.length} labels</Btn>
          <Btn kind="primary" onClick={() => { onSavePdf?.(); finishedLabelsPdf(labels).save(`pallet-labels-${today()}.pdf`); }}>
            <FileText size={13} /> Save as 4x1 PDF
          </Btn>
          <CloseBtn onClose={onClose} onDark />
        </div>
        <div id="flabels-root">
          {labels.map((l) => (
            <div
              key={l.key}
              className="flabel-page"
              style={{
                width: "4in", height: "1in", background: "#fff", color: "#000",
                display: "flex", flexDirection: "column", justifyContent: "center",
                padding: "0.1in 0.18in", boxSizing: "border-box", border: "1px solid #ccc",
                fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 21, fontWeight: 900, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.customer}</div>
              <div className="flex items-baseline justify-between" style={{ marginTop: 3 }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{l.size}</span>
                {l.seqTotal > 1 && <span style={{ fontSize: 13, fontWeight: 700, color: "#555" }}>{l.seq} of {l.seqTotal}</span>}
              </div>
              <div style={{ fontSize: 13, marginTop: 3 }}>Ship: {l.shipDate}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
    </PrintPortal>
  );
}

function LabelPrintView({ units, supplierFor, onClose }) {
  return (
    <PrintPortal>
    <div className="fixed inset-0 z-50 overflow-auto print-overlay" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{LABEL_PRINT_CSS}</style>
      <div className="max-w-md mx-auto my-8 print-shell">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Btn kind="dark" onClick={() => window.print()}>
            <Printer size={13} /> {units.length > 1 ? `Print all ${units.length} labels` : "Print label"}
          </Btn>
          <Btn kind="primary" onClick={() => receivedLabelsPdf(units, supplierFor).save(`labels-${today()}.pdf`)}>
            <FileText size={13} /> Save as 4x1 PDF
          </Btn>
          <CloseBtn onClose={onClose} onDark />
        </div>
        <div id="labels-root">
          {units.map((unit) => {
            const supplier = supplierFor(unit.poId);
            return (
              <div
                key={unit.id}
                className="label-page"
                style={{
                  width: "4in", height: "1in", background: "#fff", color: "#000",
                  display: "flex", alignItems: "center", padding: "0.06in 0.1in",
                  boxSizing: "border-box", border: "1px solid #ccc", fontFamily: MONO,
                  marginBottom: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
                  <div style={{ fontSize: 15, fontWeight: 800 }}>{unit.sizeLabel}</div>
                  <div style={{ fontSize: 10 }}>{unit.receivedDate}</div>
                  {supplier?.name ? <div style={{ fontSize: 9, color: "#333" }}>{supplier.name}</div> : null}
                  <div style={{ fontSize: 8, color: "#555" }}>{unit.boardCount} bd · {unit.id}</div>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <QRCode value={`${unit.id} ${unit.boardCount}bd`} size={70} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </PrintPortal>
  );
}

/* ---------------- New Purchase Order (replaces the old standalone
   "Receive units" form) ----------------
   A PO now captures the full picture in one dialogue: vendor, what was
   bought (one line per size, each generating its own physical units),
   what it cost, how it got here, and payment status. Submitting it
   creates the PO record, the physical received units, AND bumps the
   matching raw-size product's on-hand board count — that last part used
   to be a manual, disconnected step. */

/* Vendor pricing lookup for purchase orders.

   Vendors quote by board size (165/166/185/186), and separately for
   painted stock — painted is a REPLACEMENT price, not an add-on; it runs
   cheaper than clean because it's less desirable. So a line is priced at
   either the size price or the painted price, never the sum.

   A SKU's size is its leading three digits (185RAW, 185N, 185P are all
   "185"), which is how the vendor sheet is organized. */
/* The one ordering used by every SKU list and picker in the app:
   favorites first, then everything else, each block alphabetized by SKU.
   Numeric-aware so 5 sorts before 48, and 165 before 1650. */
const bySkuFavoritesFirst = (a, b) => {
  const fav = Number(!!b.favorite) - Number(!!a.favorite);
  if (fav !== 0) return fav;
  return String(a.sku || "").localeCompare(String(b.sku || ""), undefined, { numeric: true, sensitivity: "base" });
};

const skuSizeKey = (sku) => (/^(\d{3})/.exec(String(sku || "")) || [])[1] || null;

// Wood arrives on pallets that need a scannable label; paint and packing
// don't. Missing category is treated as wood, matching the rest of the app.
const producesUnits = (product) => !!product && ["wood", "milled"].includes(product.category || "wood");

// Boards per pallet for a SKU, falling back to a same-size sibling
// (185RAW borrows 185N's 300) so one unfilled field doesn't break the
// auto-fill for the whole size family.
function boardsPerPalletFor(products, sku) {
  const exact = products.find((p) => p.sku === sku);
  const direct = Number(exact?.boardsPerUnit) || 0;
  if (direct > 0) return direct;
  const size = skuSizeKey(sku);
  if (!size) return 0;
  const sibling = products.find((p) => skuSizeKey(p.sku) === size && Number(p.boardsPerUnit) > 0);
  return Number(sibling?.boardsPerUnit) || 0;
}

function vendorPriceFor(supplier, sku, painted) {
  const pricing = supplier?.pricing || {};
  if (painted) {
    const p = Number(pricing.paint);
    if (p > 0) return p;
  }
  const size = skuSizeKey(sku);
  const v = size ? Number(pricing[size]) : NaN;
  return v > 0 ? v : null;
}

/* What the vendor actually gets paid: the goods, and nothing else. Freight
   is still recorded on the PO, but it is billed separately and must not be
   folded into the figure being matched against a vendor invoice. Landed cost
   (goods + freight) is what costing and margin want, and stays available.

   Both derive from the lines rather than the stored totalCost, so purchase
   orders written before this rule — whose stored total had shipping baked
   in — read correctly too. */
const poGoodsTotal = (po) => (po.lines || []).reduce((s, l) => s + (Number(l.cost) || 0), 0);
const poLandedTotal = (po) => poGoodsTotal(po) + (Number(po.shippingCost) || 0);

function NewPurchaseOrderModal({ suppliers, products, editingPO, receivingPO, onClose, onCreate, onUpdate, onReceive }) {
  // New lines start empty and make you choose — pre-selecting a SKU meant a
  // half-filled line could be submitted as whatever happened to be default.
  const blankLine = () => ({ key: uid(), item: "", other: false, boardCount: "", copies: "1", costPerBoard: "", painted: false });
  const isEditing = !!editingPO;
  const isReceiving = !!receivingPO;
  const sourcePO = editingPO || receivingPO;

  const initialShipChoice = sourcePO
    ? (["Leo/Allison", "3PL"].includes(sourcePO.shipVia) ? sourcePO.shipVia : (sourcePO.shipVia ? "Other" : "Leo/Allison"))
    : "Leo/Allison";
  const initialLines = sourcePO?.lines?.length
    ? sourcePO.lines.map((l) => {
        const boards = Number(l.boardCount) || 0;
        const copies = Number(l.copies) || 1;
        const costPerBoard = boards > 0 ? (Number(l.cost) || 0) / (boards * copies) : (Number(l.cost) || 0);
        const liveProduct = l.productId ? products.find((p) => p.id === l.productId) : null;
        const item = liveProduct?.sku || l.sizeLabel || "";
        const isKnownProduct = products.some((p) => p.sku === item);
        return { key: uid(), item, other: item !== "" && !isKnownProduct, boardCount: l.boardCount ?? "", copies: String(copies), costPerBoard: costPerBoard || "", painted: !!l.painted };
      })
    : [blankLine()];

  const [number, setNumber] = useState(sourcePO?.number || "");
  const [supplierId, setSupplierId] = useState(sourcePO?.supplierId || "");
  const [date, setDate] = useState(sourcePO?.date || today());
  const [shipViaChoice, setShipViaChoice] = useState(initialShipChoice);
  const [shipViaOther, setShipViaOther] = useState(initialShipChoice === "Other" ? sourcePO?.shipVia || "" : "");
  const [paymentStatus, setPaymentStatus] = useState(sourcePO?.paymentStatus || "Unpaid");
  const [paidVia, setPaidVia] = useState(sourcePO?.paidVia || "");
  const [shippingCost, setShippingCost] = useState(sourcePO?.shippingCost || "");
  const [notes, setNotes] = useState(sourcePO?.note || "");
  const [lines, setLines] = useState(initialLines);

  // De-duped: SKUs are free text and two products can end up sharing one.
  // A duplicated <option> key breaks React's reconciliation, and a repeated
  // entry in the picker is just confusing.
  // Favorites first, then everything else, each alphabetized — the buyer's
  // usual sizes sit at the top instead of being hunted for.
  const sizeOptions = (() => {
    const seen = new Set();
    return products
      .filter((p) => !p.archived)
      .slice()
      .sort(bySkuFavoritesFirst)
      .filter((p) => (seen.has(p.sku) ? false : (seen.add(p.sku), true)))
      .map((p) => ({ sku: p.sku, favorite: !!p.favorite }));
  })();

  const supplier = suppliers.find((x) => x.id === supplierId);

  /* Auto-fill cost and pallet size when the vendor, the item, or the
     painted flag changes — but only where the crew hasn't typed their own
     number. `autoCost`/`autoBoards` remember what we filled in last, so a
     field still holding our value gets refreshed while a hand-entered one
     is left alone. Both stay fully editable. */
  const applyLine = (key, patch) => setLines((prev) => prev.map((l) => {
    if (l.key !== key) return l;
    const next = { ...l, ...patch };
    const product = products.find((p) => p.sku === next.item);

    const price = vendorPriceFor(supplier, next.item, next.painted);
    const costUntouched = !next.costPerBoard || String(next.costPerBoard) === String(next.autoCost ?? "");
    if (price != null && costUntouched) {
      next.costPerBoard = price;
      next.autoCost = price;
    }

    const perPallet = boardsPerPalletFor(products, next.item);
    const boardsUntouched = !next.boardCount || String(next.boardCount) === String(next.autoBoards ?? "");
    if (perPallet > 0 && boardsUntouched) {
      next.boardCount = perPallet;
      next.autoBoards = perPallet;
    }
    return next;
  }));

  const updateLine = (key, patch) => applyLine(key, patch);

  // Fill every line that's still on our numbers — on open, and again
  // whenever the vendor changes.
  useEffect(() => {
    setLines((prev) => prev.map((l) => {
      const next = { ...l };
      const price = vendorPriceFor(supplier, l.item, l.painted);
      if (price != null && (!l.costPerBoard || String(l.costPerBoard) === String(l.autoCost ?? ""))) {
        next.costPerBoard = price;
        next.autoCost = price;
      }
      const perPallet = boardsPerPalletFor(products, l.item);
      if (perPallet > 0 && (!l.boardCount || String(l.boardCount) === String(l.autoBoards ?? ""))) {
        next.boardCount = perPallet;
        next.autoBoards = perPallet;
      }
      return next;
    }));
  }, [supplierId]);
  const removeLine = (key) => setLines(lines.length > 1 ? lines.filter((l) => l.key !== key) : lines);

  // A line is "inventory" if it has a quantity — that's what bumps the
  // matched SKU's on-hand. Lines without a quantity are just recorded as
  // a cost (parts, fees, whatever isn't stock).
  const lineTotal = (l) => {
    const boards = Number(l.boardCount) || 0;
    const copies = Math.max(1, Math.floor(Number(l.copies) || 1));
    return boards > 0 ? (Number(l.costPerBoard) || 0) * boards * copies : (Number(l.costPerBoard) || 0);
  };

  const validLines = lines.filter((l) => l.item.trim() !== "");
  const totalUnits = validLines.reduce((sum, l) => (Number(l.boardCount) > 0 ? sum + Math.max(1, Math.floor(Number(l.copies) || 1)) : sum), 0);
  const linesCost = validLines.reduce((sum, l) => sum + lineTotal(l), 0);
  // Goods only — freight is recorded separately, not billed here.
  const totalCost = linesCost;
  const canSubmit = supplierId && date && validLines.length > 0;
  const shipVia = shipViaChoice === "Other" ? shipViaOther : shipViaChoice;

  // Matches ANY product by exact SKU now — wood, paint, or packing — not
  // just raw wood. Physical pallet "units" only make sense for wood
  // board stock though, so those are still the only ones that generate
  // trackable units below; a paint or packing match just bumps on-hand.
  const matchAnyBySku = (text) => products.find((p) => p.sku === text) || null;

  const buildLinesAndUnits = (poId) => {
    const createdUnits = [];
    const boardsBySize = {};
    for (const l of validLines) {
      const qty = Number(l.boardCount) || 0;
      if (qty <= 0) continue; // non-inventory line — cost only, no units
      const copies = Math.max(1, Math.floor(Number(l.copies) || 1));
      const matched = matchAnyBySku(l.item);
      if (matched) boardsBySize[matched.id] = (boardsBySize[matched.id] || 0) + qty * copies;
      // Physical pallet units (and therefore printable labels) are for wood
      // coming in, which is what `category` says. This used to test
      // `kind === "board"` — but `kind` describes how quantities are
      // entered, and anything added through Inventory's "Add item" defaults
      // to "each". A wood SKU created that way silently produced no unit
      // and no label while still bumping on-hand, so the PO looked right
      // and the pallet had nothing to print.
      if (matched && producesUnits(matched)) {
        for (let i = 0; i < copies; i++) {
          createdUnits.push({
            id: uid(), poId, sizeLabel: l.item, productId: matched?.id || null,
            boardCount: qty, boardsRemaining: qty,
            receivedDate: date,
          });
        }
      }
    }
    // Sequential "1 of 14" numbering, grouped by size — spans every line
    // that contributed to that size, so 13 full pallets + 1 partial (from
    // a separate row) still number 1 through 14 together.
    const bySize = {};
    createdUnits.forEach((u) => { (bySize[u.sizeLabel] = bySize[u.sizeLabel] || []).push(u); });
    Object.values(bySize).forEach((group) => {
      group.forEach((u, i) => { u.seq = i + 1; u.seqTotal = group.length; });
    });
    return { createdUnits, boardsBySize };
  };

  const submit = () => {
    if (!canSubmit) return;
    const poId = sourcePO ? sourcePO.id : uid();
    const { createdUnits, boardsBySize } = buildLinesAndUnits(poId);
    const po = {
      id: poId, supplierId, date, shipVia, paymentStatus, paidVia,
      shippingCost: Number(shippingCost) || 0,
      lines: validLines.map((l) => ({ sizeLabel: l.item, productId: matchAnyBySku(l.item)?.id || null, boardCount: Number(l.boardCount) || 0, copies: Math.max(1, Math.floor(Number(l.copies) || 1)), cost: lineTotal(l), painted: !!l.painted })),
      totalCost, note: notes,
      status: isReceiving ? "received" : (sourcePO?.status || "received"),
      ...(sourcePO ? { number } : {}),
    };
    if (isReceiving) onReceive({ original: receivingPO, po, units: createdUnits, boardsBySize });
    else if (isEditing) onUpdate({ original: editingPO, po, units: createdUnits, boardsBySize });
    else onCreate({ po, units: createdUnits, boardsBySize });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-2xl mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>{isReceiving ? "Receive shipment" : isEditing ? "Edit purchase order" : "New purchase order"}</div>
          <CloseBtn onClose={onClose} />
        </div>

        {isReceiving && (
          <div className="mb-3 text-sm rounded-sm px-3 py-2" style={{ background: C.paper, border: `1px solid ${C.kraftDark}`, color: C.faint }}>
            Confirm what actually showed up — adjust quantities below if they differ from what was ordered. Submitting will print labels and add this material to on-hand stock.
          </div>
        )}

        {sourcePO && (
          <Field label="PO #"><input style={{ ...inputStyle, fontFamily: MONO }} value={number} onChange={(e) => setNumber(e.target.value)} /></Field>
        )}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="Vendor" required>
            <select style={inputStyle} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— select vendor —</option>
              {suppliers.filter((s) => !s.hidden).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Date" required><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="Shipped via">
            <select style={inputStyle} value={shipViaChoice} onChange={(e) => setShipViaChoice(e.target.value)}>
              <option>Leo/Allison</option>
              <option>3PL</option>
              <option>Other</option>
            </select>
            {shipViaChoice === "Other" && (
              <input style={{ ...inputStyle, marginTop: 6 }} value={shipViaOther} onChange={(e) => setShipViaOther(e.target.value)} placeholder="Describe how it's getting here" />
            )}
          </Field>

        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Field label="Payment status">
            <select style={inputStyle} value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
              <option>Unpaid</option>
              <option>Paid</option>
              <option>Partial</option>
            </select>
          </Field>
          <Field label="Paid via"><input style={inputStyle} value={paidVia} onChange={(e) => setPaidVia(e.target.value)} placeholder="Cash, check, Melio…" /></Field>
        </div>

        <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>What was bought</div>
          <div className="space-y-2">
            {lines.map((l) => {
              const total = lineTotal(l);
              const isInventory = Number(l.boardCount) > 0;
              const totalUnitsForLine = Math.max(1, Math.floor(Number(l.copies) || 1)) * (Number(l.boardCount) || 0);
              const paintedPrice = Number(supplier?.pricing?.paint) || 0;
              const cleanPrice = vendorPriceFor(supplier, l.item, false);
              return (
                <div key={l.key} className="flex flex-wrap gap-2 items-end">
                  <Field label="Item / size" w={130} required>
                    <select
                      style={inputStyle}
                      value={l.other ? "__other__" : l.item}
                      onChange={(e) => {
                        if (e.target.value === "__other__") updateLine(l.key, { other: true, item: "" });
                        else updateLine(l.key, { other: false, item: e.target.value });
                      }}
                    >
                      <option value="">— Select SKU —</option>
                      {sizeOptions.map((o) => <option key={o.sku} value={o.sku}>{o.favorite ? "★ " : ""}{o.sku}</option>)}
                      <option value="__other__">Other (not inventory)…</option>
                    </select>
                    {l.other && (
                      <input style={{ ...inputStyle, marginTop: 6 }} value={l.item} onChange={(e) => updateLine(l.key, { item: e.target.value })} placeholder="Describe what this is" />
                    )}
                  </Field>
                  {(() => {
                    const matchedProduct = matchAnyBySku(l.item);
                    const unitWord = matchedProduct ? (matchedProduct.category === "paint" ? "gal" : matchedProduct.kind === "board" ? "boards" : "units") : "boards";
                    return (
                      <>
                        <Field label={`${unitWord}/unit`} w={90}><input type="number" style={inputStyle} value={l.boardCount} onChange={(e) => updateLine(l.key, { boardCount: e.target.value })} /></Field>
                        <Field label="× units" w={70}><input type="number" min="1" style={inputStyle} value={l.copies} onChange={(e) => updateLine(l.key, { copies: e.target.value })} /></Field>
                      </>
                    );
                  })()}
                  <button onClick={() => removeLine(l.key)} disabled={lines.length === 1} className="opacity-40 hover:opacity-100 disabled:opacity-15 mb-2"><Trash2 size={16} /></button>

                  <div className="w-full flex flex-wrap items-center gap-3" style={{ marginTop: -4 }}>
                    <div className="flex items-center gap-3">
                      {/* Clean/painted still drives which vendor rate GNWS Office
                          applies; the rates themselves aren't shown on the floor. */}
                      {[[false, "Clean"], [true, "Painted"]].map(([val, label]) => (
                        <label key={String(val)} className="flex items-center gap-1.5 text-xs" style={{ fontFamily: MONO, color: C.faint, cursor: "pointer" }}>
                          <input
                            type="radio" name={`painted-${l.key}`} checked={!!l.painted === val}
                            onChange={() => updateLine(l.key, { painted: val })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {(() => {
                      const mp = matchAnyBySku(l.item);
                      const qty = Number(l.boardCount) || 0;
                      if (!l.item.trim() || qty <= 0) return null;
                      if (!mp) return (
                        <span className="text-xs flex items-center gap-1" style={{ color: C.warn, fontFamily: MONO }}>
                          <AlertTriangle size={11} /> "{l.item}" isn't an inventory SKU — cost only, no labels or stock
                        </span>
                      );
                      if (!producesUnits(mp)) return (
                        <span className="text-xs flex items-center gap-1" style={{ color: C.faint, fontFamily: MONO }}>
                          {mp.category} item — adds to stock, no pallet labels
                        </span>
                      );
                      return (
                        <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
                          {Math.max(1, Math.floor(Number(l.copies) || 1))} label{Math.max(1, Math.floor(Number(l.copies) || 1)) === 1 ? "" : "s"} will print
                        </span>
                      );
                    })()}
                    {supplierId && l.item && vendorPriceFor(supplier, l.item, l.painted) == null && (
                      <span className="text-xs flex items-center gap-1" style={{ color: C.warn, fontFamily: MONO }}>
                        <AlertTriangle size={11} /> no {l.painted ? "painted" : ""} price on file for {supplier?.name} — enter it by hand
                      </span>
                    )}
                    {l.painted && paintedPrice === 0 && supplierId && (
                      <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
                        (add a painted price on {supplier?.name}'s vendor card to auto-fill this)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <Btn onClick={() => setLines([...lines, blankLine()])}><Plus size={14} /> Add another line</Btn>
        </div>

        <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 60, marginTop: 8 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="text-sm" style={{ color: C.faint }}>
            {validLines.length > 0
              ? `${totalUnits} unit${totalUnits === 1 ? "" : "s"}`
              : "Add at least one line"}
            {isEditing && <div className="mt-1">If any of this PO's units have already been sorted from, their board counts won't change — only cost and other details will update.</div>}
          </div>
          <Btn kind="primary" onClick={submit} disabled={!canSubmit} big>
            <Printer size={16} /> {isReceiving ? "Receive shipment & print labels" : isEditing ? "Save changes" : "Create PO & print labels"}
          </Btn>
        </div>
      </div>
    </div>
  );
}


function ReceivingTab({ suppliers, purchaseOrders, onPOChange, units, onUnitsChange, products, onProductsChange, runGrouped }) {
  const [printUnits, setPrintUnits] = useState(null);
  /* Payment is its own small edit on purpose. Going through the edit form
     would regenerate this PO's pallet units with fresh ids, which would
     silently invalidate every label already printed and stuck on the wood. */
  const setPaid = (po, paymentStatus) =>
    onPOChange(purchaseOrders.map((p) => (p.id === po.id ? { ...p, paymentStatus } : p)));

  const [newPOOpen, setNewPOOpen] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
  const [receivingPO, setReceivingPO] = useState(null);
  const [openPOId, setOpenPOId] = useState(null);

  const removePO = (id) => {
    runGrouped(() => {
      onPOChange(purchaseOrders.filter((p) => p.id !== id));
      onUnitsChange(units.filter((u) => u.poId !== id));
    });
  };
  const removeUnit = (id) => onUnitsChange(units.filter((u) => u.id !== id));

  const supplierFor = (poId) => {
    const po = purchaseOrders.find((p) => p.id === poId);
    return suppliers.find((s) => s.id === po?.supplierId);
  };

  // Creating a PO does three things at once: saves the PO record, creates
  // the physical received units it generated, and bumps the matching
  // raw-size product's on-hand board count — that last part used to be a
  // disconnected manual step nobody was actually doing.
  const handleCreatePO = ({ po, units: createdUnits, boardsBySize }) => {
    const numberedPO = { ...po, number: nextNumber(purchaseOrders, "PO") };
    runGrouped(() => {
      onPOChange([numberedPO, ...purchaseOrders]);
      onUnitsChange([...createdUnits, ...units]);
      onProductsChange(products.map((p) => {
        const bump = boardsBySize[p.id];
        return bump ? { ...p, onHand: (Number(p.onHand) || 0) + bump } : p;
      }), { reason: "receive" });
    });
    setNewPOOpen(false);
    setPrintUnits(createdUnits);
  };

  // Editing is safe to fully regenerate (delete + recreate the physical
  // units, adjust on-hand by the delta) ONLY if nothing on this PO has
  // been touched yet — i.e. every unit still has its full board count.
  // If any unit has already been partially or fully sorted from, we leave
  // units and inventory alone and only update the PO's own fields, so we
  // never silently erase real sorting history.
  //
  // A PO that's still just "ordered" (placed from GNWS Office, nothing
  // physically received yet) has no units at all and never bumped
  // on-hand — editing it here must only touch the PO's own fields, never
  // units or inventory, or the revert-then-rebump math below would
  // wrongly subtract stock that was never added. That case is handled by
  // "Receive" (handleReceivePO), not by editing.
  const handleUpdatePO = ({ original, po, units: newUnits, boardsBySize }) => {
    if (original.status === "ordered") {
      onPOChange(purchaseOrders.map((p) => (p.id === original.id ? po : p)));
      setEditingPO(null);
      return;
    }

    const poUnits = units.filter((u) => u.poId === original.id);
    const untouched = poUnits.every((u) => Number(u.boardsRemaining) === Number(u.boardCount));

    runGrouped(() => {
      if (untouched) {
        const revertBySize = {};
        (original.lines || []).forEach((l) => {
          if (Number(l.boardCount) > 0 && l.productId) {
            revertBySize[l.productId] = (revertBySize[l.productId] || 0) + Number(l.boardCount) * Number(l.copies || 1);
          }
        });
        onProductsChange(products.map((p) => {
          let onHand = Number(p.onHand) || 0;
          if (revertBySize[p.id]) onHand -= revertBySize[p.id];
          if (boardsBySize[p.id]) onHand += boardsBySize[p.id];
          return onHand === (Number(p.onHand) || 0) ? p : { ...p, onHand };
        }));
        onUnitsChange([...newUnits, ...units.filter((u) => u.poId !== original.id)]);
      }
      onPOChange(purchaseOrders.map((p) => (p.id === original.id ? po : p)));
    });
    if (untouched && newUnits.length > 0) setPrintUnits(newUnits);
    setEditingPO(null);
  };

  // Turns an "ordered" PO (placed from GNWS Office, no physical units
  // yet) into a "received" one: generates the QR-labeled units from
  // whatever quantities were confirmed in the modal (may differ from
  // what was originally ordered), bumps on-hand, and flips status —
  // mirrors handleCreatePO but keeps the existing id/number instead of
  // minting a new one.
  const handleReceivePO = ({ original, po, units: newUnits, boardsBySize }) => {
    runGrouped(() => {
      onPOChange(purchaseOrders.map((p) => (p.id === original.id ? po : p)));
      onUnitsChange([...newUnits, ...units]);
      onProductsChange(products.map((p) => {
        const bump = boardsBySize[p.id];
        return bump ? { ...p, onHand: (Number(p.onHand) || 0) + bump } : p;
      }), { reason: "receive" });
    });
    setPrintUnits(newUnits);
    setReceivingPO(null);
  };

  const outstandingCount = units.filter((u) => Number(u.boardsRemaining) > 0).length;

  return (
    <div>
      <div className="max-w-3xl">
          <div className="flex flex-wrap gap-2 mb-4">
            <Btn kind="primary" onClick={() => setNewPOOpen(true)}><Plus size={14} /> New purchase order</Btn>
            {/* "Outstanding" meant nothing to anyone reading it. This is every
                pallet in the yard that still has boards left on it. */}
            <Btn onClick={() => setPrintUnits(units.filter((u) => Number(u.boardsRemaining) > 0))} disabled={outstandingCount === 0}>
              <Printer size={14} /> Labels for every pallet still on hand ({outstandingCount})
            </Btn>
          </div>

          {purchaseOrders.length === 0 && (
            <div className="rounded-sm p-8 text-center" style={{ background: C.panel, border: `1px dashed ${C.kraftDark}` }}>
              <div style={{ color: C.faint }}>No purchase orders yet. Create one to receive material.</div>
            </div>
          )}

          <div className="space-y-2">
            {purchaseOrders.map((po) => {
              const sup = suppliers.find((s) => s.id === po.supplierId);
              const poUnits = units.filter((u) => u.poId === po.id);
              const open = openPOId === po.id;
              const totalBoards = (po.lines || []).reduce((sum, l) => sum + (Number(l.boardCount) || 0) * (Number(l.copies) || 1), 0);
              const isOrdered = po.status === "ordered";
              return (
                <div key={po.id} className="rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${isOrdered ? C.warn : C.kraftDark}` }}>
                  <button onClick={() => setOpenPOId(open ? null : po.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{po.number ? `${po.number} · ` : ""}{sup?.name || "Unknown vendor"}</div>
                      <div className="text-xs mt-0.5" style={{ color: C.faint, fontFamily: MONO }}>
                        {po.date} · {num(totalBoards)} boards
                        {!isOrdered ? ` · ${poUnits.length} unit${poUnits.length === 1 ? "" : "s"}` : ""}

                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isOrdered && (
                        <span className="px-2 py-0.5 rounded-sm text-xs" style={{ fontFamily: MONO, background: C.warn, color: "#fff" }}>Ordered</span>
                      )}
                      <span className="px-2 py-0.5 rounded-sm text-xs" style={{ fontFamily: MONO, background: po.paymentStatus === "Paid" ? C.moss : C.kraft, color: po.paymentStatus === "Paid" ? "#fff" : C.ink }}>
                        {po.paymentStatus || "Unpaid"}
                      </span>
                    </div>
                  </button>

                  {open && (
                    <div className="px-4 pb-4" style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <div className="grid gap-1 mt-3 text-sm">
                        {po.shipVia && <div><span style={{ color: C.faint }}>Ship via: </span>{po.shipVia}</div>}
                        {po.paidVia && <div><span style={{ color: C.faint }}>Paid via: </span>{po.paidVia}</div>}
                        {po.note && <div><span style={{ color: C.faint }}>Notes: </span>{po.note}</div>}
                      </div>

                      {(po.lines || []).length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs mb-1" style={{ color: C.faint, fontFamily: MONO }}>LINE ITEMS</div>
                          {po.lines.map((l, i) => (
                            <div key={i} className="text-sm flex justify-between px-2 py-1" style={{ background: C.paper }}>
                              <span>{l.sizeLabel} — {num(l.boardCount)} bd × {l.copies}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {isOrdered ? (
                        <div className="mt-3 text-sm flex items-center gap-1.5" style={{ color: C.warn }}>
                          <AlertTriangle size={13} /> Not yet received — nothing here has hit on-hand stock.
                        </div>
                      ) : (
                        <div className="mt-3">
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <div className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>RECEIVED UNITS</div>
                            {poUnits.length > 0 && (
                              <Btn onClick={() => setPrintUnits(poUnits)}>
                                <Printer size={13} /> Print this PO's labels ({poUnits.length})
                              </Btn>
                            )}
                          </div>
                          {poUnits.map((u) => (
                            <div key={u.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm" style={{ borderBottom: `1px solid ${C.kraft}` }}>
                              <span style={{ fontFamily: MONO }}>{u.sizeLabel}{u.seqTotal ? ` · ${u.seq} of ${u.seqTotal}` : ""} · {num(u.boardsRemaining)}/{num(u.boardCount)} bd left</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* A bare icon was too easy to miss on a phone. */}
                                <button
                                  onClick={() => setPrintUnits([u])} title="Print just this label"
                                  className="flex items-center gap-1 px-2 py-1 rounded-sm"
                                  style={{ fontFamily: MONO, fontSize: 11, color: C.ink, border: `1px solid ${C.kraftDark}` }}
                                >
                                  <Tag size={12} /> Label
                                </button>
                                <button onClick={() => removeUnit(u.id)} className="opacity-40 hover:opacity-100 p-1"><Trash2 size={13} /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex gap-2 flex-wrap">
                        {isOrdered && (
                          <Btn kind="primary" onClick={() => setReceivingPO(po)}><Printer size={13} /> Receive shipment</Btn>
                        )}
                        <Btn onClick={() => setPaid(po, (po.paymentStatus || "Unpaid") === "Paid" ? "Unpaid" : "Paid")}>
                          <Check size={13} /> {(po.paymentStatus || "Unpaid") === "Paid" ? "Mark unpaid" : "Mark paid"}
                        </Btn>
                        <Btn onClick={() => setEditingPO(po)}><Pencil size={13} /> Edit</Btn>
                        <Btn onClick={() => removePO(po.id)}><Trash2 size={13} /> Delete this PO</Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      </div>

      {newPOOpen && (
        <NewPurchaseOrderModal suppliers={suppliers} products={products} onClose={() => setNewPOOpen(false)} onCreate={handleCreatePO} />
      )}

      {editingPO && (
        <NewPurchaseOrderModal suppliers={suppliers} products={products} editingPO={editingPO} onClose={() => setEditingPO(null)} onUpdate={handleUpdatePO} />
      )}

      {receivingPO && (
        <NewPurchaseOrderModal suppliers={suppliers} products={products} receivingPO={receivingPO} onClose={() => setReceivingPO(null)} onReceive={handleReceivePO} />
      )}

      {printUnits && printUnits.length > 0 && (
        <LabelPrintView units={printUnits} supplierFor={supplierFor} onClose={() => setPrintUnits(null)} />
      )}
    </div>
  );
}

// Landing screen for the Work tab — pick which process step you're doing,
// then land on that step's log page. Sort keeps its existing dedicated
// form (SortingTab, unchanged below); every other step shares one
// generalized work-in-process log form (ProcessLogTab, further below).
function WorkTab(props) {
  const { jumpToUnitId, jumpToWorkStep, onJumpToWorkStepConsumed } = props;
  // Which step screen you're on survives a reload too, same reason the tab
  // itself does — otherwise landing back on "What are you working on?"
  // after the phone reclaimed the tab reads as the in-progress batch
  // having vanished, when the timer and form were fine the whole time.
  const [activeStep, _setActiveStep] = useState(() => {
    try {
      const saved = localStorage.getItem("gnws-nav-workstep");
      return saved && PROCESS_STEPS.some((s) => s.id === saved) ? saved : null;
    } catch { return null; }
  });
  const setActiveStep = (step) => {
    _setActiveStep(step);
    try {
      if (step) localStorage.setItem("gnws-nav-workstep", step);
      else localStorage.removeItem("gnws-nav-workstep");
    } catch { /* private browsing or full quota */ }
  };
  useBackLayer(!!activeStep, () => setActiveStep(null));
  useEffect(() => { if (jumpToUnitId) setActiveStep("sorting"); }, [jumpToUnitId]);
  // jumpToWorkStep carries a nonce so a queued run that revisits the same
  // step twice in a row (rare, but possible) still re-triggers — a plain
  // string wouldn't change and the effect would silently no-op.
  useEffect(() => {
    if (!jumpToWorkStep) return;
    setActiveStep(jumpToWorkStep.step);
    onJumpToWorkStepConsumed?.();
  }, [jumpToWorkStep]);

  if (!activeStep) {
    return (
      <div className="max-w-2xl">
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12 }}>What are you working on?</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PROCESS_STEPS.map((s) => (
            <button
              key={s.id} onClick={() => setActiveStep(s.id)}
              className="rounded-sm py-4 text-center hover:opacity-85"
              style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, fontFamily: MONO, fontWeight: 700, fontSize: 14 }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const back = () => setActiveStep(null);
  return (
    <div>
      <div className="mb-3"><Btn onClick={back}><ChevronLeft size={14} /> All work types</Btn></div>
      {activeStep === "sorting" ? <SortingTab {...props} />
        : activeStep === "ship" ? <ShipLogTab {...props} />
        : <ProcessLogTab {...props} step={activeStep} />}
    </div>
  );
}

/* ---------------- SKU picker ----------------
   Every stock picker on the shop floor uses this: it lists ALL products,
   not a role-filtered subset. The old filters (raw-only inbound,
   WIP-only outbound) meant the crew physically could not log real work —
   sorting or milling something that didn't already have a SKU in the
   right category was simply unselectable. Anything can be consumed and
   anything can be produced, and if the SKU doesn't exist yet it can be
   created right here rather than making someone stop and go set up
   inventory first. -------------------------------------------------- */

function SkuPicker({ products, value, onChange, onCreate, placeholder = "— Select SKU —", newRole = "wip" }) {
  const [creating, setCreating] = useState(false);
  const [newSku, setNewSku] = useState("");

  // Nobody sorts, rips or loads a truck with an installation, so services
  // stay out of every stock picker on the floor.
  const sorted = products.filter((p) => !isService(p)).slice().sort(bySkuFavoritesFirst);

  const create = () => {
    const sku = newSku.trim();
    if (!sku) return;
    const p = { id: uid(), sku, name: sku, kind: "board", category: "wood", role: newRole, onHand: 0 };
    onCreate(p);
    onChange(p.id);
    setNewSku("");
    setCreating(false);
  };

  if (creating) {
    return (
      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 8 }}>
        <input
          autoFocus style={{ ...inputStyle, flex: "1 1 160px" }}
          placeholder="New SKU name" value={newSku}
          onChange={(e) => setNewSku(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") { setCreating(false); setNewSku(""); } }}
        />
        <Btn kind="moss" onClick={create}><Check size={13} /> Create</Btn>
        <Btn onClick={() => { setCreating(false); setNewSku(""); }}><X size={13} /> Cancel</Btn>
      </div>
    );
  }

  return (
    <select
      style={{ ...inputStyle, marginTop: 8 }}
      value={value || ""}
      onChange={(e) => (e.target.value === "__new__" ? setCreating(true) : onChange(e.target.value))}
    >
      <option value="">{placeholder}</option>
      {sorted.map((p) => (
        <option key={p.id} value={p.id}>
          {p.favorite ? "★ " : ""}{p.sku}{p.name && p.name !== p.sku ? ` — ${p.name}` : ""} ({num(p.onHand)} on hand)
        </option>
      ))}
      <option value="__new__">+ Create new SKU…</option>
    </select>
  );
}

/* Shows the crew what "good" looks like for this step: the running
   historical average and a goal 10% above it. Once boards and a timer are
   on screen it also shows live pace against that goal, so you know where
   you stand before submitting rather than after. */
function RateTarget({ sortLog, step }) {
  const { rate, target, samples } = stepRate(sortLog, step);
  const hasHistory = samples > 0 && rate > 0;
  if (!hasHistory) return null;
  return (
    <div className="rounded-sm px-4 py-3 mb-4" style={{ background: "#FBF6EC", border: `2px solid ${C.gold}` }}>
      <div className="flex items-center gap-2" style={{ fontWeight: 800, fontSize: 18, color: C.gold }}>
        <Timer size={18} /> Target {num(target, 0)} boards per hour
      </div>
    </div>
  );
}

const shapeOfStep = (step) => (step === "sorting" ? "sorting" : "process");

// Full editor for one work-log entry (a Sort batch or a generalized process
// step). Time, crew, work order, and — now — which task this entry is are
// all real fields here, not just the numbers a batch sorted into: a batch
// logged under the wrong task (Rip instead of Chop) can be reassigned
// instead of deleted and redone. Reassigning across the Sort/everything-
// else divide resets the quantity fields that don't apply to the new
// shape — there's nothing sensible to carry a raw/N/P split into an
// inbound/outbound pair, or back.
function EditLogModal({ entry, products, workOrders, team, onAddTeamMember, onProductsChange, onSave, onClose }) {
  useBackLayer(true, onClose);
  const initialStep = entry.step || "sorting";
  const initialIsProcess = !!(entry.inboundProductId || entry.outboundProductId);
  const initialRaw = initialIsProcess ? null : resolveRawProduct(entry, products);

  // Only work orders still on the floor are pickable — but if this entry
  // is already tied to one that's since been packed or shipped, keep that
  // one in the list too, so editing something else on the entry doesn't
  // silently blank out its work order.
  const pickableWorkOrders = workOrders.filter((w) =>
    ACTIVE_WO_STATUSES.includes(w.status) || w.id === entry.workOrderId);

  const secs = Number(entry.seconds) || 0;
  const [form, setForm] = useState({
    step: initialStep,
    crew: entry.crew?.length ? entry.crew : (entry.by ? entry.by.split(" + ").filter(Boolean) : []),
    workOrderId: entry.workOrderId || "",
    h: String(Math.floor(secs / 3600)), m: String(Math.floor((secs % 3600) / 60)), s: String(secs % 60),
    description: entry.description || "",
    batchLabel: entry.batchLabel || "",
    rawProductId: initialRaw?.id || "",
    toNProductId: entry.toNProductId || "",
    toPProductId: entry.toPProductId || "",
    rawBoards: entry.rawBoards ?? "",
    toN: entry.toN ?? "",
    toP: entry.toP ?? "",
    toMill: entry.toMill ?? "",
    toWaste: entry.toWaste ?? "",
    inboundProductId: entry.inboundProductId || "",
    outboundProductId: entry.outboundProductId || "",
    inboundBoards: entry.inboundBoards ?? "",
    outboundBoards: entry.outboundBoards ?? "",
    wasteBoards: entry.wasteBoards ?? "",
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isProcess = shapeOfStep(form.step) === "process";

  const setStep = (step) => {
    setForm((f) => {
      if (shapeOfStep(step) === shapeOfStep(f.step)) return { ...f, step };
      return shapeOfStep(step) === "sorting"
        ? { ...f, step, rawProductId: "", toNProductId: "", toPProductId: "", rawBoards: "", toN: "", toP: "", toMill: "", toWaste: "" }
        : { ...f, step, inboundProductId: "", outboundProductId: "", inboundBoards: "", outboundBoards: "", wasteBoards: "" };
    });
  };

  const rawProduct = products.find((p) => p.id === form.rawProductId);
  const familyN = products.find((p) => rawProduct?.groupId && p.groupId === rawProduct.groupId && p.role === "sortedN");
  const familyP = products.find((p) => rawProduct?.groupId && p.groupId === rawProduct.groupId && p.role === "sortedP");
  const nProduct = products.find((p) => p.id === form.toNProductId) || familyN;
  const pProduct = products.find((p) => p.id === form.toPProductId) || familyP;
  const onCreate = (np) => onProductsChange([...products, np]);

  const save = () => {
    const wo = workOrders.find((w) => w.id === form.workOrderId);
    const seconds = (Number(form.h) || 0) * 3600 + (Number(form.m) || 0) * 60 + (Number(form.s) || 0);
    const base = {
      ...entry,
      step: form.step,
      crew: form.crew,
      by: form.crew.join(" + "),
      workOrderId: form.workOrderId || "",
      workOrderNumber: wo?.number || "",
      seconds,
      description: form.description,
    };
    onSave(isProcess
      ? {
          ...base,
          inboundProductId: form.inboundProductId || "", outboundProductId: form.outboundProductId || "",
          inboundBoards: Number(form.inboundBoards) || 0, outboundBoards: Number(form.outboundBoards) || 0, wasteBoards: Number(form.wasteBoards) || 0,
          rawProductId: undefined, toNProductId: undefined, toPProductId: undefined,
          rawBoards: undefined, toN: undefined, toP: undefined, toMill: undefined, toWaste: undefined,
        }
      : {
          ...base,
          batchLabel: form.batchLabel || "Unlabeled batch",
          rawProductId: form.rawProductId || "", toNProductId: nProduct?.id || "", toPProductId: pProduct?.id || "",
          rawBoards: Number(form.rawBoards) || 0, toN: Number(form.toN) || 0, toP: Number(form.toP) || 0, toMill: Number(form.toMill) || 0, toWaste: Number(form.toWaste) || 0,
          inboundProductId: undefined, outboundProductId: undefined,
          inboundBoards: undefined, outboundBoards: undefined, wasteBoards: undefined,
        });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-lg mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Edit work log entry</div>
          <CloseBtn onClose={onClose} />
        </div>

        <CrewSelect team={team} crew={form.crew} onChange={(crew) => set({ crew })} onAddMember={onAddTeamMember} />

        <div className="mt-3">
          <Field label="Which task is this?">
            <select style={{ ...inputStyle, marginTop: 8 }} value={form.step} onChange={(e) => setStep(e.target.value)}>
              {PROCESS_STEPS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>

        <div className="mt-3">
          <Field label="Which work order is this for?">
            <select style={{ ...inputStyle, marginTop: 8 }} value={form.workOrderId} onChange={(e) => set({ workOrderId: e.target.value })}>
              <option value="">— Not tied to a specific WO —</option>
              {pickableWorkOrders.map((w) => <option key={w.id} value={w.id}>{woPickLabel(w)}</option>)}
            </select>
          </Field>
        </div>

        {isProcess ? (
          <>
            <div className="mt-3">
              <Field label="Inbound stock">
                <SkuPicker products={products} value={form.inboundProductId} onChange={(id) => set({ inboundProductId: id })} onCreate={onCreate} placeholder="— Select what's going in —" />
              </Field>
            </div>
            <div className="mt-2">
              <Field label="Outbound stock (SKU produced)">
                <SkuPicker products={products} value={form.outboundProductId} onChange={(id) => set({ outboundProductId: id })} onCreate={onCreate} placeholder="— Select what's coming out —" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <Field label="Inbound boards"><input type="number" style={inputStyle} value={form.inboundBoards} onChange={(e) => set({ inboundBoards: e.target.value })} /></Field>
              <Field label="Outbound boards"><input type="number" style={inputStyle} value={form.outboundBoards} onChange={(e) => set({ outboundBoards: e.target.value })} /></Field>
              <Field label="Waste"><input type="number" style={inputStyle} value={form.wasteBoards} onChange={(e) => set({ wasteBoards: e.target.value })} /></Field>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3"><Field label="Batch label"><input style={inputStyle} value={form.batchLabel} onChange={(e) => set({ batchLabel: e.target.value })} /></Field></div>
            <div className="mt-2">
              <Field label="What was sorted?">
                <SkuPicker products={products} value={form.rawProductId} onChange={(id) => set({ rawProductId: id })} onCreate={onCreate} placeholder="— Select what's coming in —" newRole="raw" />
              </Field>
              <Field label="Raw boards"><input type="number" style={{ ...inputStyle, marginTop: 8 }} value={form.rawBoards} onChange={(e) => set({ rawBoards: e.target.value })} /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 mt-2">
              <div>
                <Field label="Sorted Clean">
                  <SkuPicker products={products} value={nProduct?.id || ""} onChange={(id) => set({ toNProductId: id })} onCreate={onCreate} placeholder="— Select destination —" newRole="sortedN" />
                </Field>
                <Field label={`→ ${nProduct?.sku || "boards"}`}><input type="number" style={{ ...inputStyle, marginTop: 8 }} value={form.toN} onChange={(e) => set({ toN: e.target.value })} /></Field>
              </div>
              <div>
                <Field label="Sorted Paint">
                  <SkuPicker products={products} value={pProduct?.id || ""} onChange={(id) => set({ toPProductId: id })} onCreate={onCreate} placeholder="— Select destination —" newRole="sortedP" />
                </Field>
                <Field label={`→ ${pProduct?.sku || "boards"}`}><input type="number" style={{ ...inputStyle, marginTop: 8 }} value={form.toP} onChange={(e) => set({ toP: e.target.value })} /></Field>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Field label="→ Mill Stock"><input type="number" style={inputStyle} value={form.toMill} onChange={(e) => set({ toMill: e.target.value })} /></Field>
              <Field label="→ Waste"><input type="number" style={inputStyle} value={form.toWaste} onChange={(e) => set({ toWaste: e.target.value })} /></Field>
            </div>
          </>
        )}

        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Time on this batch</div>
          <div className="flex items-center gap-2">
            <input type="number" style={{ ...inputStyle, width: 60 }} value={form.h} onChange={(e) => set({ h: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>h</span>
            <input type="number" style={{ ...inputStyle, width: 60 }} value={form.m} onChange={(e) => set({ m: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>m</span>
            <input type="number" style={{ ...inputStyle, width: 60 }} value={form.s} onChange={(e) => set({ s: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>s</span>
          </div>
        </div>

        <div className="mt-3">
          <Field label="Description"><textarea style={{ ...inputStyle, minHeight: 60 }} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>

        <div className="flex gap-2 mt-4">
          <Btn kind="moss" onClick={save}><Check size={14} /> Save changes</Btn>
          <Btn onClick={onClose}><X size={14} /> Cancel</Btn>
        </div>
      </div>
    </div>
  );
}

function SortingTab({ products, onProductsChange, sortLog, onLogSort, onUpdateSort, onDeleteSort, team, whoWorking, setWhoWorking, onAddTeamMember, workOrders, units, onUnitsChange, jumpToUnitId, onBatchLogged, queuedSteps, runGrouped, purchaseOrders }) {
  const millStock = products.find((p) => p.role === "millStock");
  const rawProducts = products.filter((p) => p.kind === "board" && p.role === "raw");

  // Anything typed here is kept on the device, so closing the app mid-batch
  // doesn't wipe the log. Cleared when the batch is actually submitted.
  const { saved, save, clear: clearDraft } = useDraft("gnws-draft-sorting");

  const [workOrderId, setWorkOrderId] = useState(saved.workOrderId || "");
  const [unitId, setUnitId] = useState(jumpToUnitId || saved.unitId || "");
  const [rawProductId, setRawProductId] = useState(saved.rawProductId || "");
  const [rawBoards, setRawBoards] = useState(saved.rawBoards || "");
  const [toN, setToN] = useState(saved.toN || "");
  const [toP, setToP] = useState(saved.toP || "");
  const [toMill, setToMill] = useState(saved.toMill || "");
  const [toWaste, setToWaste] = useState(saved.toWaste || "");
  const [description, setDescription] = useState(saved.description || "");
  const sw = useStopwatch(saved.clock);
  const [manualEdit, setManualEdit] = useState(false);
  const [manualHMS, setManualHMS] = useState({ h: "0", m: "0", s: "0" });

  const [editingEntry, setEditingEntry] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");

  // Seeded from the open draft first, then from whoever the header already
  // had picked, so someone who set their name once doesn't set it again.
  const [logLimit, setLogLimit] = useState(15);
  const shownLogCount = sortLog.length;
  const [crew, setCrew] = useState(() => (saved.crew?.length ? saved.crew : whoWorking ? [whoWorking] : []));
  const setCrewSynced = (next) => { setCrew(next); setWhoWorking(next[0] || ""); };

  const rawProduct = products.find((p) => p.id === rawProductId);
  // Where the sorted boards land. These used to be derived purely from the
  // inbound SKU's size family, which meant sorting anything without a
  // pre-wired family silently credited nothing — the counts were logged but
  // no product's on-hand moved. They're explicit now, defaulted to the
  // family siblings when those exist so the common case still needs no
  // extra clicks.
  const [toNProductId, setToNProductId] = useState(saved.toNProductId || "");
  const [toPProductId, setToPProductId] = useState(saved.toPProductId || "");
  const familyN = products.find((p) => rawProduct?.groupId && p.groupId === rawProduct.groupId && p.role === "sortedN");
  const familyP = products.find((p) => rawProduct?.groupId && p.groupId === rawProduct.groupId && p.role === "sortedP");
  const nProduct = products.find((p) => p.id === toNProductId) || familyN;
  const pProduct = products.find((p) => p.id === toPProductId) || familyP;

  useEffect(() => {
    save({ workOrderId, unitId, rawProductId, rawBoards, toN, toP, toMill, toWaste, description, crew, toNProductId, toPProductId });
  }, [workOrderId, unitId, rawProductId, rawBoards, toN, toP, toMill, toWaste, description, crew, toNProductId, toPProductId]);

  // The clock is saved on every tick so a kill mid-batch loses at most a second.
  useEffect(() => { save({ clock: sw.snapshot }); }, [sw.running, sw.elapsed]);

  // Picking a different inbound SKU re-defaults the destinations to that
  // SKU's family; anything hand-picked stays put until then. Skipped on the
  // first render, which would otherwise wipe the destinations restored from
  // an open draft.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    setToNProductId(""); setToPProductId("");
  }, [rawProductId]);

  useEffect(() => { if (jumpToUnitId) setUnitId(jumpToUnitId); }, [jumpToUnitId]);

  // A scanned label's text is "<unit id> <boardCount>bd". We look the
  // unit up, then figure out which raw product it is — preferring the
  // unit's own productId (set for anything received through a PO after
  // the rename-proofing fix), falling back to matching its sizeLabel
  // text against a raw SKU for older units that predate that field.
  const handleScanned = (rawText) => {
    setScannerOpen(false);
    const scannedId = (rawText || "").trim().split(/\s+/)[0];
    const unit = units.find((u) => u.id === scannedId);
    if (!unit) {
      setScanError(`Scanned "${scannedId || rawText}" but couldn't find a matching received unit. Pick it manually below.`);
      return;
    }
    setScanError("");
    setUnitId(unit.id);
    let matched = unit.productId ? products.find((p) => p.id === unit.productId) : null;
    if (!matched && unit.sizeLabel) {
      matched = products.find((p) => p.kind === "board" && p.role === "raw" && p.sku === unit.sizeLabel);
    }
    if (matched) setRawProductId(matched.id);
    setRawBoards(String(Number(unit.boardsRemaining) || ""));
  };


  const sumSorted = (Number(toN) || 0) + (Number(toP) || 0) + (Number(toMill) || 0) + (Number(toWaste) || 0);
  const rawIn = Number(rawBoards) || 0;
  const mismatch = rawIn > 0 && sumSorted !== rawIn;

  const openWorkOrders = workOrders.filter((w) => ACTIVE_WO_STATUSES.includes(w.status));
  const availableUnits = units.filter((u) => Number(u.boardsRemaining) > 0);
  const selectedUnit = units.find((u) => u.id === unitId);

  const applyManualTime = () => {
    const h = Number(manualHMS.h) || 0, m = Number(manualHMS.m) || 0, s = Number(manualHMS.s) || 0;
    sw.setManual(h * 3600 + m * 60 + s);
    setManualEdit(false);
  };

  const submit = () => {
    if (!rawIn || !crew.length || !rawProductId) return;
    const updates = products.map((p) => {
      if (p.id === rawProduct?.id) return { ...p, onHand: (Number(p.onHand) || 0) - rawIn };
      if (p.id === nProduct?.id) return { ...p, onHand: (Number(p.onHand) || 0) + (Number(toN) || 0) };
      if (p.id === pProduct?.id) return { ...p, onHand: (Number(p.onHand) || 0) + (Number(toP) || 0) };
      if (p.id === millStock?.id) return { ...p, onHand: (Number(p.onHand) || 0) + (Number(toMill) || 0) };
      return p;
    });
    const wo = workOrders.find((w) => w.id === workOrderId);
    const autoLabel = selectedUnit ? `${selectedUnit.sizeLabel} unit` : (rawProduct?.sku || "Batch");
    runGrouped(() => {
      onProductsChange(updates);
      if (unitId) {
        onUnitsChange(units.map((u) => u.id === unitId ? { ...u, boardsRemaining: Math.max(0, (Number(u.boardsRemaining) || 0) - rawIn) } : u));
      }
      onLogSort({
        id: uid(), date: today(), by: crew.join(" + "), crew, batchLabel: autoLabel,
        expectedBoards: selectedUnit ? Number(selectedUnit.boardsRemaining) || 0 : null,
        countVariance: selectedUnit ? rawIn - (Number(selectedUnit.boardsRemaining) || 0) : null,
        workOrderId: workOrderId || "", workOrderNumber: wo?.number || "",
        unitId: unitId || "", rawProductId,
        toNProductId: nProduct?.id || "", toPProductId: pProduct?.id || "",
        rawBoards: rawIn, toN: Number(toN) || 0, toP: Number(toP) || 0, toMill: Number(toMill) || 0, toWaste: Number(toWaste) || 0,
        description,
        seconds: sw.elapsed,
        startedAt: new Date().toISOString(),
      });
    });
    setWorkOrderId(""); setUnitId(""); setRawProductId(""); setRawBoards(""); setToN(""); setToP(""); setToMill(""); setToWaste(""); setDescription(""); setToNProductId(""); setToPProductId("");
    sw.reset();
    clearDraft();
    onBatchLogged?.();
  };

  return (
    <div className="max-w-2xl">
      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Log a Sorting Batch</div>
        </div>
        {queuedSteps?.length > 0 && (
          <div className="mb-3 text-xs" style={{ fontFamily: MONO, color: C.faint }}>
            Up next: {queuedSteps.map((s) => PROCESS_STEPS.find((p) => p.id === s)?.label || s).join(", ")}
          </div>
        )}
        <RateTarget sortLog={sortLog} step="sorting" />
        <div className="mb-3 pb-3" style={{ borderBottom: `1px solid ${C.kraft}` }}>
          <CrewSelect team={team} crew={crew} onChange={setCrewSynced} onAddMember={onAddTeamMember} />
        </div>
        <p className="text-sm mb-3" style={{ color: C.faint }}>
          Pick the received unit you're breaking down, then split it into what it actually sorted into.
          Everything here is counted in <strong>boards</strong>.
        </p>

        <Btn kind="primary" onClick={() => { setScanError(""); setScannerOpen(true); }} big>
          <Tag size={16} /> Scan QR to start
        </Btn>
        {scanError && (
          <div className="mt-2 text-xs flex items-center gap-1" style={{ color: C.warn }}>
            <AlertTriangle size={12} /> {scanError}
          </div>
        )}
        <div className="my-3 text-xs" style={{ color: C.faint, fontFamily: MONO }}>— or fill in manually —</div>

        <Field label="Which received unit is this?">
          <select
            style={inputStyle} value={unitId}
            onChange={(e) => {
              const newUnitId = e.target.value;
              setUnitId(newUnitId);
              const unit = units.find((u) => u.id === newUnitId);
              if (unit) {
                let matched = unit.productId ? products.find((p) => p.id === unit.productId) : null;
                if (!matched && unit.sizeLabel) {
                  matched = products.find((p) => p.kind === "board" && p.role === "raw" && p.sku === unit.sizeLabel);
                }
                if (matched) setRawProductId(matched.id);
                setRawBoards(String(Number(unit.boardsRemaining) || ""));
              }
            }}
          >
            <option value="">— Not tied to a specific unit —</option>
            {availableUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.sizeLabel} · {purchaseOrders.find((po) => po.id === u.poId)?.number || "no PO"} · {u.boardsRemaining} boards left
              </option>
            ))}
          </select>
        </Field>
        {selectedUnit && (
          <div className="mt-1 text-xs" style={{ color: C.faint, fontFamily: MONO }}>Unit {selectedUnit.id} · received {selectedUnit.receivedDate}</div>
        )}

        <Field label="What are you sorting?" required>
          <SkuPicker
            products={products} value={rawProductId} onChange={setRawProductId}
            onCreate={(np) => onProductsChange([...products, np])}
            placeholder="— Select what's coming in —" newRole="raw"
          />
        </Field>
        <div className="text-xs mt-1" style={{ color: C.faint }}>Picking a unit above fills this in automatically — change it here if it's wrong. Any SKU can be sorted; create one on the spot if it doesn't exist yet.</div>

        <Field label="Which work order is this for?">
          <select style={{ ...inputStyle, marginTop: 8 }} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
            <option value="">— Not tied to a specific WO —</option>
            {openWorkOrders.map((w) => <option key={w.id} value={w.id}>{woPickLabel(w)}</option>)}
          </select>
        </Field>

        <Field label="Raw boards brought in — count them, don't trust the tag" required>
          <input type="number" style={{ ...inputStyle, marginTop: 8 }} value={rawBoards} onChange={(e) => setRawBoards(e.target.value)} />
        </Field>
        {selectedUnit && Number(rawBoards) > 0 && Number(rawBoards) !== Number(selectedUnit.boardsRemaining) && (
          /* Vendors miscount both ways. Whatever is typed here wins, and the
             difference is recorded on the batch so it can be taken back to
             them as an over or short shipment. */
          <div className="mt-1 text-xs flex items-start gap-1.5" style={{ color: C.warn, fontFamily: MONO }}>
            <AlertTriangle size={12} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>
              Unit says {num(selectedUnit.boardsRemaining)} boards, you counted {num(rawBoards)} —
              {" "}{Number(rawBoards) > Number(selectedUnit.boardsRemaining) ? "over" : "short"} by
              {" "}{num(Math.abs(Number(rawBoards) - Number(selectedUnit.boardsRemaining)))}.
              Your count is what gets saved, and the difference is logged against the PO.
            </span>
          </div>
        )}

        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>What did it sort into?</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Field label="Sorted Clean">
                <SkuPicker
                  products={products} value={nProduct?.id || ""} onChange={setToNProductId}
                  onCreate={(np) => onProductsChange([...products, np])}
                  placeholder="— Select destination —" newRole="sortedN"
                />
              </Field>
              <Field label={`→ ${nProduct?.sku || "boards"}`}>
                <input type="number" style={{ ...inputStyle, marginTop: 8 }} value={toN} onChange={(e) => setToN(e.target.value)} />
              </Field>
            </div>
            <div>
              <Field label="Sorted Paint">
                <SkuPicker
                  products={products} value={pProduct?.id || ""} onChange={setToPProductId}
                  onCreate={(np) => onProductsChange([...products, np])}
                  placeholder="— Select destination —" newRole="sortedP"
                />
              </Field>
              <Field label={`→ ${pProduct?.sku || "boards"}`}>
                <input type="number" style={{ ...inputStyle, marginTop: 8 }} value={toP} onChange={(e) => setToP(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Field label="→ Mill Stock boards (slush)"><input type="number" style={inputStyle} value={toMill} onChange={(e) => setToMill(e.target.value)} /></Field>
            <Field label="→ Waste boards"><input type="number" style={inputStyle} value={toWaste} onChange={(e) => setToWaste(e.target.value)} /></Field>
          </div>
          {((Number(toN) > 0 && !nProduct) || (Number(toP) > 0 && !pProduct)) && (
            <div className="mt-2 text-xs flex items-center gap-1" style={{ color: C.warn, fontFamily: MONO }}>
              <AlertTriangle size={12} /> Pick a destination SKU for those boards, or they won't be added to any inventory.
            </div>
          )}
        </div>

        {mismatch && (
          <div className="mt-2 text-xs flex items-center gap-1" style={{ color: C.warn, fontFamily: MONO }}>
            <AlertTriangle size={12} /> Sorted total ({num(sumSorted)}) doesn't match raw brought in ({num(rawIn)}) — that's OK if some is still in process, just double check.
          </div>
        )}

        <Field label="Description">
          <textarea style={{ ...inputStyle, marginTop: 8, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything worth noting about this batch…" />
        </Field>

        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5" style={{ fontWeight: 700, fontSize: 13 }}>
              <Timer size={15} style={{ color: C.faint }} /> Time on this batch
            </div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: sw.running ? C.moss : C.ink }}>{fmtDuration(sw.elapsed)}</div>
          </div>
          <div className="flex gap-2">
            {!sw.running ? (
              <Btn kind="moss" onClick={sw.start}><Play size={13} /> {sw.elapsed > 0 ? "Resume" : "Start"}</Btn>
            ) : (
              <Btn kind="ghost" onClick={sw.pause}><Pause size={13} /> Pause</Btn>
            )}
            <Btn onClick={() => { setManualEdit(!manualEdit); const s = sw.elapsed; setManualHMS({ h: String(Math.floor(s / 3600)), m: String(Math.floor((s % 3600) / 60)), s: String(s % 60) }); }}>
              <Clock size={13} /> Edit time
            </Btn>
            <Btn onClick={sw.reset}><RefreshCw size={13} /> Reset</Btn>
          </div>
          {manualEdit && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.h} onChange={(e) => setManualHMS({ ...manualHMS, h: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>h</span>
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.m} onChange={(e) => setManualHMS({ ...manualHMS, m: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>m</span>
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.s} onChange={(e) => setManualHMS({ ...manualHMS, s: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>s</span>
              <Btn kind="primary" onClick={applyManualTime}><Check size={13} /> Set</Btn>
            </div>
          )}
        </div>

        <div className="mt-4">
          <Btn kind="primary" onClick={submit} disabled={!rawIn || !crew.length || !rawProductId} big>
            <Check size={16} /> Log this batch
          </Btn>
          {!rawProductId && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick a raw size above first.</div>}
          {!crew.length && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick your name above first.</div>}
        </div>
      </div>

      <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div style={{ fontWeight: 800, fontSize: 15 }}>Recent Sorting Log</div>
          <div className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
            {sortLog.length} logged
          </div>
        </div>
        <div className="text-xs mb-2" style={{ color: C.faint }}>
          Newest first. Anyone can edit or delete a logged entry below.
        </div>
        {sortLog.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: C.faint }}>Nothing logged yet.</div>
        ) : (
          <div className="space-y-2">
            {sortLog.slice().sort(byNewest).slice(0, logLimit).map((s) => {
              const entryRaw = resolveRawProduct(s, products);
              const entryN = products.find((p) => p.groupId === entryRaw?.groupId && p.role === "sortedN");
              const entryP = products.find((p) => p.groupId === entryRaw?.groupId && p.role === "sortedP");
              return (
                <div key={s.id} className="px-3 py-2 rounded-sm text-sm" style={{ background: C.paper, border: `1px solid ${C.kraft}` }}>
                  <div className="flex justify-between items-start gap-2">
                    <span style={{ fontWeight: 700 }}>{s.batchLabel}{s.workOrderNumber ? ` · ${s.workOrderNumber}` : ""}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{s.date} · {s.by}</span>
                      <button onClick={() => setEditingEntry(s)} title="Edit" className="opacity-50 hover:opacity-100"><Pencil size={13} /></button>
                      <button onClick={() => onDeleteSort(s)} title="Delete" className="opacity-50 hover:opacity-100"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, marginTop: 2 }}>
                    {num(s.rawBoards)} bd → {num(s.toN)} {entryN?.sku || "?"} · {num(s.toP)} {entryP?.sku || "?"} · {num(s.toMill)} mill · {num(s.toWaste)} waste
                    {s.seconds ? ` · ${fmtDuration(s.seconds)}` : ""}
                  </div>
                  {s.description && <div style={{ fontSize: 12, marginTop: 4 }}>{s.description}</div>}
                </div>
              );
            })}
          </div>
        )}
        {logLimit < shownLogCount && (
          <button
            onClick={() => setLogLimit(shownLogCount)}
            className="mt-3 w-full py-2 rounded-sm text-xs"
            style={{ fontFamily: MONO, color: C.ink, border: `1px solid ${C.kraftDark}` }}
          >
            Show all {shownLogCount} entries
          </button>
        )}
      </div>
      {scannerOpen && (
        <QRScannerModal onClose={() => setScannerOpen(false)} onDecoded={handleScanned} />
      )}
      {editingEntry && (
        <EditLogModal
          entry={editingEntry} products={products} workOrders={workOrders}
          team={team} onAddTeamMember={onAddTeamMember} onProductsChange={onProductsChange}
          onSave={(updated) => { onUpdateSort(editingEntry, updated); setEditingEntry(null); }}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

// Generalized log page shared by every process step except Sort (which
// keeps its own dedicated N/P-split form above). Each step consumes some
// inbound board stock and produces a work-in-process (WIP) SKU — pick an
// existing one or create a new one inline. Pack/Ship allow picking any
// wood product as outbound (not just WIP) since they may target a
// finished, sellable SKU rather than another intermediate stage.
function ProcessLogTab({ step, products, onProductsChange, sortLog, onLogSort, onUpdateSort, onDeleteSort, team, whoWorking, setWhoWorking, onAddTeamMember, workOrders, onBatchLogged, queuedSteps, runGrouped }) {
  const [editingEntry, setEditingEntry] = useState(null);
  const stepDef = PROCESS_STEPS.find((s) => s.id === step);
  const { saved: draft0 } = useDraft(`gnws-draft-${step}`);
  const [inboundProductId, setInboundProductId] = useState(draft0.inboundProductId || "");
  const [inboundBoards, setInboundBoards] = useState(draft0.inboundBoards || "");
  const [outboundProductId, setOutboundProductId] = useState(draft0.outboundProductId || "");
  const [outboundBoards, setOutboundBoards] = useState(draft0.outboundBoards || "");
  const [wasteBoards, setWasteBoards] = useState(draft0.wasteBoards || "");
  const [workOrderId, setWorkOrderId] = useState(draft0.workOrderId || "");
  const [description, setDescription] = useState(draft0.description || "");
  const sw = useStopwatch();
  const [manualEdit, setManualEdit] = useState(false);
  const [manualHMS, setManualHMS] = useState({ h: "0", m: "0", s: "0" });


  const inboundProduct = products.find((p) => p.id === inboundProductId);
  const outboundProduct = products.find((p) => p.id === outboundProductId);

  const applyManualTime = () => {
    const h = Number(manualHMS.h) || 0, m = Number(manualHMS.m) || 0, s = Number(manualHMS.s) || 0;
    sw.setManual(h * 3600 + m * 60 + s);
    setManualEdit(false);
  };

  const inBoards = Number(inboundBoards) || 0;
  const outBoards = Number(outboundBoards) || 0;
  const wasteN = Number(wasteBoards) || 0;
  const [logLimit, setLogLimit] = useState(15);
  // Same device-side draft the sorting form uses, keyed per step, so a screen
  // lock mid-entry loses nothing.
  const { save: saveDraft, clear: clearDraft } = useDraft(`gnws-draft-${step}`);
  const [crew, setCrew] = useState(() => (draft0.crew?.length ? draft0.crew : whoWorking ? [whoWorking] : []));
  const setCrewSynced = (next) => { setCrew(next); setWhoWorking(next[0] || ""); };
  useEffect(() => {
    saveDraft({ inboundProductId, inboundBoards, outboundProductId, outboundBoards,
                wasteBoards, workOrderId, description, crew });
  }, [inboundProductId, inboundBoards, outboundProductId, outboundBoards,
      wasteBoards, workOrderId, description, crew]);
  const canSubmit = inBoards > 0 && crew.length > 0 && inboundProductId && outboundProductId;
  const openWorkOrders = workOrders.filter((w) => ACTIVE_WO_STATUSES.includes(w.status));
  const stepEntries = sortLog.filter((s) => s.step === step);
  const shownLogCount = stepEntries.length;

  const submit = () => {
    if (!canSubmit) return;
    const wo = workOrders.find((w) => w.id === workOrderId);
    runGrouped(() => {
      onProductsChange(products.map((p) => {
        if (p.id === inboundProductId) return { ...p, onHand: (Number(p.onHand) || 0) - inBoards };
        if (p.id === outboundProductId) return { ...p, onHand: (Number(p.onHand) || 0) + outBoards };
        return p;
      }));
      onLogSort({
        id: uid(), date: today(), by: crew.join(" + "), crew,
        batchLabel: `${stepDef?.label || step} — ${inboundProduct?.sku || "?"} → ${outboundProduct?.sku || "?"}`,
        step,
        workOrderId: workOrderId || "", workOrderNumber: wo?.number || "",
        inboundProductId, inboundBoards: inBoards,
        outboundProductId, outboundBoards: outBoards,
        wasteBoards: wasteN,
        description,
        seconds: sw.elapsed,
        startedAt: new Date().toISOString(),
      });
    });
    setInboundProductId(""); setInboundBoards(""); setOutboundProductId(""); setOutboundBoards(""); setWasteBoards(""); setWorkOrderId(""); setDescription("");
    sw.reset();
    clearDraft();
    onBatchLogged?.();
  };

  return (
    <div className="max-w-2xl">
      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Log — {stepDef?.label || step}</div>
        </div>
        {queuedSteps?.length > 0 && (
          <div className="mb-3 text-xs" style={{ fontFamily: MONO, color: C.faint }}>
            Up next: {queuedSteps.map((s) => PROCESS_STEPS.find((p) => p.id === s)?.label || s).join(", ")}
          </div>
        )}
        <RateTarget sortLog={sortLog} step={step} />

        <Field label="Who's working on this" required>
          <CrewSelect team={team} crew={crew} onChange={setCrewSynced} onAddMember={onAddTeamMember} />
        </Field>

        <div className="mt-3">
          <Field label="Inbound stock" required>
            <SkuPicker
              products={products} value={inboundProductId} onChange={setInboundProductId}
              onCreate={(np) => onProductsChange([...products, np])}
              placeholder="— Select what's going in —"
            />
          </Field>
          <Field label="Inbound boards" required><input type="number" style={{ ...inputStyle, marginTop: 8 }} value={inboundBoards} onChange={(e) => setInboundBoards(e.target.value)} /></Field>
        </div>

        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <Field label="Outbound stock (SKU produced)" required>
            <SkuPicker
              products={products} value={outboundProductId} onChange={setOutboundProductId}
              onCreate={(np) => onProductsChange([...products, np])}
              placeholder="— Select what's coming out —"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <Field label="Outbound boards" required><input type="number" style={inputStyle} value={outboundBoards} onChange={(e) => setOutboundBoards(e.target.value)} /></Field>
            <Field label="Waste boards"><input type="number" style={inputStyle} value={wasteBoards} onChange={(e) => setWasteBoards(e.target.value)} /></Field>
          </div>
        </div>

        <Field label="Which work order is this for?">
          <select style={{ ...inputStyle, marginTop: 8 }} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
            <option value="">— Not tied to a specific WO —</option>
            {openWorkOrders.map((w) => <option key={w.id} value={w.id}>{woPickLabel(w)}</option>)}
          </select>
        </Field>

        <Field label="Description">
          <textarea style={{ ...inputStyle, marginTop: 8, minHeight: 60 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything worth noting about this batch…" />
        </Field>

        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5" style={{ fontWeight: 700, fontSize: 13 }}>
              <Timer size={15} style={{ color: C.faint }} /> Time on this batch
            </div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: sw.running ? C.moss : C.ink }}>{fmtDuration(sw.elapsed)}</div>
          </div>
          <div className="flex gap-2">
            {!sw.running ? (
              <Btn kind="moss" onClick={sw.start}><Play size={13} /> {sw.elapsed > 0 ? "Resume" : "Start"}</Btn>
            ) : (
              <Btn kind="ghost" onClick={sw.pause}><Pause size={13} /> Pause</Btn>
            )}
            <Btn onClick={() => { setManualEdit(!manualEdit); const s = sw.elapsed; setManualHMS({ h: String(Math.floor(s / 3600)), m: String(Math.floor((s % 3600) / 60)), s: String(s % 60) }); }}>
              <Clock size={13} /> Edit time
            </Btn>
            <Btn onClick={sw.reset}><RefreshCw size={13} /> Reset</Btn>
          </div>
          {manualEdit && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.h} onChange={(e) => setManualHMS({ ...manualHMS, h: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>h</span>
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.m} onChange={(e) => setManualHMS({ ...manualHMS, m: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>m</span>
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.s} onChange={(e) => setManualHMS({ ...manualHMS, s: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>s</span>
              <Btn kind="primary" onClick={applyManualTime}><Check size={13} /> Set</Btn>
            </div>
          )}
        </div>

        <div className="mt-4">
          <Btn kind="primary" onClick={submit} disabled={!canSubmit} big>
            <Check size={16} /> Log this batch
          </Btn>
          {!inboundProductId && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick inbound stock above first.</div>}
          {!outboundProductId && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick or create an outbound SKU above first.</div>}
          {!crew.length && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick your name above first.</div>}
        </div>
      </div>

      <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Recent {stepDef?.label || step} Log</div>
        {stepEntries.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: C.faint }}>Nothing logged yet.</div>
        ) : (
          <div className="space-y-2">
            {stepEntries.slice().sort(byNewest).slice(0, logLimit).map((s) => {
              const inP = products.find((p) => p.id === s.inboundProductId);
              const outP = products.find((p) => p.id === s.outboundProductId);
              return (
                <div key={s.id} className="px-3 py-2 rounded-sm text-sm" style={{ background: C.paper, border: `1px solid ${C.kraft}` }}>
                  <div className="flex justify-between items-start gap-2">
                    <span style={{ fontWeight: 700 }}>{inP?.sku || "?"} → {outP?.sku || "?"}{s.workOrderNumber ? ` · ${s.workOrderNumber}` : ""}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{s.date} · {s.by}</span>
                      <button onClick={() => setEditingEntry(s)} title="Edit" className="opacity-50 hover:opacity-100"><Pencil size={13} /></button>
                      <button onClick={() => onDeleteSort(s)} title="Delete" className="opacity-50 hover:opacity-100"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, marginTop: 2 }}>
                    {num(s.inboundBoards)} bd in → {num(s.outboundBoards)} out · {num(s.wasteBoards)} waste
                    {s.seconds ? ` · ${fmtDuration(s.seconds)}` : ""}
                  </div>
                  {s.description && <div style={{ fontSize: 12, marginTop: 4 }}>{s.description}</div>}
                </div>
              );
            })}
          </div>
        )}
        {logLimit < shownLogCount && (
          <button
            onClick={() => setLogLimit(shownLogCount)}
            className="mt-3 w-full py-2 rounded-sm text-xs"
            style={{ fontFamily: MONO, color: C.ink, border: `1px solid ${C.kraftDark}` }}
          >
            Show all {shownLogCount} entries
          </button>
        )}
      </div>
      {editingEntry && (
        <EditLogModal
          entry={editingEntry} products={products} workOrders={workOrders}
          team={team} onAddTeamMember={onAddTeamMember} onProductsChange={onProductsChange}
          onSave={(updated) => { onUpdateSort(editingEntry, updated); setEditingEntry(null); }}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

/* ---------------- Ship log ----------------
   Shipping is a counting job, not a conversion job: you walk the truck
   and tally what physically goes on it, SKU by SKU, usually on a phone
   with one hand. The generalized ProcessLogTab (one inbound SKU -> one
   outbound SKU, typed board counts) doesn't describe that at all, which
   is why Ship read as nonsense there. It gets its own page instead: a
   tap-to-count tally that draws stock down as it goes and, when the load
   is tied to a work order, counts each SKU against what that order
   actually calls for. -------------------------------------------- */

// Is there a real conversion path between two units on this product?
// convertViaGraph returns the quantity UNCONVERTED when there isn't one,
// so anything that shows a converted number has to ask this first —
// otherwise 20 SF renders as "20 boxes" and nobody can tell.
function unitReaches(product, fromUnit, toUnit) {
  if (fromUnit === toUnit) return true;
  const graph = buildUnitGraph(product);
  const visited = new Set([fromUnit]);
  const queue = [fromUnit];
  while (queue.length) {
    const node = queue.shift();
    if (node === toUnit) return true;
    for (const next in (graph[node] || {})) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return false;
}

function ShipLogTab({ products, onProductsChange, sortLog, onLogSort, onDeleteSort, team, whoWorking, setWhoWorking, onAddTeamMember, workOrders, onBatchLogged, runGrouped }) {
  const { saved: draft0, save: saveDraft, clear: clearDraft } = useDraft("gnws-draft-ship");
  const [workOrderId, setWorkOrderId] = useState(draft0.workOrderId || "");
  // [{ productId, unit, count }] — unit is what a tap means for that row.
  const [rows, setRows] = useState(draft0.rows || []);
  const [description, setDescription] = useState(draft0.description || "");
  const [crew, setCrew] = useState(() => (draft0.crew?.length ? draft0.crew : whoWorking ? [whoWorking] : []));
  const [logLimit, setLogLimit] = useState(15);
  const sw = useStopwatch(draft0.timer);
  const [manualEdit, setManualEdit] = useState(false);
  const [manualHMS, setManualHMS] = useState({ h: "0", m: "0", s: "0" });

  const setCrewSynced = (next) => { setCrew(next); setWhoWorking(next[0] || ""); };
  useEffect(() => { saveDraft({ workOrderId, rows, description, crew }); }, [workOrderId, rows, description, crew]);

  const openWorkOrders = workOrders.filter((w) => ACTIVE_WO_STATUSES.includes(w.status));
  const wo = workOrders.find((w) => w.id === workOrderId);
  const productOf = (id) => products.find((p) => p.id === id);

  // A tap should move stock by a real amount, so a row counts in a unit
  // that actually converts to the unit onHand is kept in. Anything that
  // doesn't convert falls back to the stock unit itself.
  const unitsForRow = (p) => {
    const canonical = canonicalUnitFor(p);
    return unitsFor(p).filter((u) => unitReaches(p, canonical, u));
  };
  // Count in whatever unit Inventory leads with for that SKU — pallets for
  // raw/sorted stock, boxes for milled goods — so the tally and the shelf
  // never disagree about what one tap means.
  const preferredUnit = (p) => {
    const avail = unitsForRow(p);
    return defaultUnitsFor(p).find((u) => avail.includes(u))
      || ["box", "pallet", "plank", "board"].find((u) => avail.includes(u))
      || canonicalUnitFor(p);
  };

  const addRow = (p) => {
    if (!p || rows.some((r) => r.productId === p.id)) return;
    setRows((prev) => [...prev, { productId: p.id, unit: preferredUnit(p), count: 0 }]);
  };
  const bump = (productId, by) =>
    setRows((prev) => prev.map((r) => (r.productId === productId ? { ...r, count: Math.max(0, (Number(r.count) || 0) + by) } : r)));
  const setRowUnit = (productId, unit) =>
    setRows((prev) => prev.map((r) => (r.productId === productId ? { ...r, unit } : r)));
  const removeRow = (productId) => setRows((prev) => prev.filter((r) => r.productId !== productId));

  // Pull this order's SKUs onto the board so the truck can be counted
  // without hunting for each one in a picker.
  const loadFromWorkOrder = () => {
    if (!wo) return;
    const next = [...rows];
    (wo.lines || []).forEach((l) => {
      const p = productOf(l.productId);
      if (!p || isService(p) || next.some((r) => r.productId === p.id)) return;
      next.push({ productId: p.id, unit: preferredUnit(p), count: 0 });
    });
    setRows(next);
  };

  // What the order calls for, in the unit this row is being counted in —
  // only when the product can actually make that conversion.
  const targetFor = (row) => {
    const p = productOf(row.productId);
    if (!p || !wo) return null;
    const line = (wo.lines || []).find((l) => l.productId === row.productId);
    const sf = Number(line?.qtySF) || 0;
    if (!sf || !unitReaches(p, "sf", row.unit)) return null;
    return convertQty(p, sf, "sf", row.unit);
  };

  const applyManualTime = () => {
    const h = Number(manualHMS.h) || 0, m = Number(manualHMS.m) || 0, s = Number(manualHMS.s) || 0;
    sw.setManual(h * 3600 + m * 60 + s);
    setManualEdit(false);
  };

  const counted = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const canSubmit = crew.length > 0 && counted > 0;
  const shipEntries = sortLog.filter((s) => s.step === "ship");

  const submit = () => {
    if (!canSubmit) return;
    const tallies = rows
      .filter((r) => (Number(r.count) || 0) > 0)
      .map((r) => {
        const p = productOf(r.productId);
        const canonical = p ? canonicalUnitFor(p) : "board";
        return {
          productId: r.productId,
          sku: p?.sku || "?",
          count: Number(r.count) || 0,
          unit: r.unit,
          // Stock moves in the product's own unit; store it so a delete
          // can put back exactly what was taken.
          stockQty: p ? convertQty(p, Number(r.count) || 0, r.unit, canonical) : 0,
          stockUnit: canonical,
        };
      });
    runGrouped(() => {
      const byId = Object.fromEntries(tallies.map((t) => [t.productId, t.stockQty]));
      onProductsChange(products.map((p) => (byId[p.id] ? { ...p, onHand: (Number(p.onHand) || 0) - byId[p.id] } : p)));
      onLogSort({
        id: uid(), date: today(), by: crew.join(" + "), crew,
        step: "ship",
        batchLabel: `Ship${wo ? ` — ${wo.number}` : ""}`,
        workOrderId: workOrderId || "", workOrderNumber: wo?.number || "",
        tallies,
        // Reports read throughput off inboundBoards; without it a shipping
        // run would time itself and then not show up in any rate table.
        inboundBoards: tallies.reduce((s, t) => s + t.stockQty, 0),
        description,
        seconds: sw.elapsed,
        startedAt: new Date().toISOString(),
      });
    });
    setRows([]); setWorkOrderId(""); setDescription("");
    sw.reset();
    clearDraft();
    onBatchLogged?.();
  };

  return (
    <div className="max-w-2xl">
      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex items-center gap-2 mb-3">
          <Truck size={17} style={{ color: C.faint }} />
          <div style={{ fontWeight: 800, fontSize: 16 }}>Ship — count the load</div>
        </div>

        <Field label="Who's loading" required>
          <CrewSelect team={team} crew={crew} onChange={setCrewSynced} onAddMember={onAddTeamMember} />
        </Field>

        <Field label="Which work order is this truck for?">
          <select style={{ ...inputStyle, marginTop: 8 }} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
            <option value="">— Not tied to a specific WO —</option>
            {openWorkOrders.map((w) => <option key={w.id} value={w.id}>{woPickLabel(w)}</option>)}
          </select>
        </Field>
        {wo && (wo.lines || []).length > 0 && (
          <div className="mt-2">
            <Btn onClick={loadFromWorkOrder}><Plus size={13} /> Load this order's SKUs</Btn>
          </div>
        )}

        {/* ---- the tally board ---- */}
        <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="flex items-center justify-between mb-2">
            <div style={{ fontWeight: 700, fontSize: 13 }}>Tally</div>
            <div style={{ fontFamily: MONO, fontSize: 13, color: C.faint }}>{num(counted)} counted</div>
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: C.faint }}>
              Add the SKUs on this truck, then tap each one as it loads.
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const p = productOf(r.productId);
                const target = targetFor(r);
                const units = p ? unitsForRow(p) : [];
                const over = target != null && r.count > target;
                return (
                  <div key={r.productId} className="rounded-sm" style={{ background: C.paper, border: `1px solid ${over ? C.warn : C.kraft}` }}>
                    <div className="flex items-stretch">
                      {/* whole left side is the tap target */}
                      <button
                        onClick={() => bump(r.productId, 1)}
                        className="flex-1 text-left px-3 py-3 active:opacity-70"
                        style={{ minHeight: 62 }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{p?.sku || "?"}</div>
                        <div style={{ fontFamily: MONO, fontSize: 11, color: over ? C.warn : C.faint, marginTop: 2 }}>
                          {target != null
                            ? `${num(r.count)} of ${num(target)} ${unitLabel(r.unit)}${over ? " — over" : ""}`
                            : `${unitLabel(r.unit)} · tap to add`}
                        </div>
                      </button>
                      <div className="flex items-center gap-2 pr-2">
                        <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 800, minWidth: 54, textAlign: "right", color: over ? C.warn : C.ink }}>
                          {num(r.count)}
                        </div>
                        <button
                          onClick={() => bump(r.productId, -1)}
                          className="rounded-sm"
                          style={{ width: 40, height: 40, border: `1px solid ${C.kraftDark}`, background: "#fff", fontFamily: MONO, fontSize: 20, fontWeight: 800, lineHeight: 1 }}
                          title="Undo one"
                        >−</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-3 pb-2 pt-1" style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <select
                        value={r.unit} onChange={(e) => setRowUnit(r.productId, e.target.value)}
                        style={{ ...inputStyle, padding: "3px 6px", fontSize: 11, width: "auto" }}
                      >
                        {units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                      </select>
                      <button onClick={() => removeRow(r.productId)} className="opacity-50 hover:opacity-100" title="Remove from tally">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3">
            <Field label="Add a SKU to the tally">
              <SkuPicker
                products={products} value="" onChange={(id) => addRow(productOf(id))}
                onCreate={(np) => { onProductsChange([...products, np]); addRow(np); }}
                placeholder="— Add SKU —"
              />
            </Field>
          </div>
        </div>

        <Field label="Notes">
          <textarea style={{ ...inputStyle, marginTop: 8, minHeight: 50 }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Seal number, carrier, anything odd about the load…" />
        </Field>

        <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5" style={{ fontWeight: 700, fontSize: 13 }}>
              <Timer size={15} style={{ color: C.faint }} /> Time loading
            </div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800, color: sw.running ? C.moss : C.ink }}>{fmtDuration(sw.elapsed)}</div>
          </div>
          <div className="flex gap-2">
            {!sw.running ? (
              <Btn kind="moss" onClick={sw.start}><Play size={13} /> {sw.elapsed > 0 ? "Resume" : "Start"}</Btn>
            ) : (
              <Btn kind="ghost" onClick={sw.pause}><Pause size={13} /> Pause</Btn>
            )}
            <Btn onClick={() => { setManualEdit(!manualEdit); const s = sw.elapsed; setManualHMS({ h: String(Math.floor(s / 3600)), m: String(Math.floor((s % 3600) / 60)), s: String(s % 60) }); }}>
              <Clock size={13} /> Edit time
            </Btn>
            <Btn onClick={sw.reset}><RefreshCw size={13} /> Reset</Btn>
          </div>
          {manualEdit && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.h} onChange={(e) => setManualHMS({ ...manualHMS, h: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>h</span>
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.m} onChange={(e) => setManualHMS({ ...manualHMS, m: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>m</span>
              <input type="number" style={{ ...inputStyle, width: 60 }} value={manualHMS.s} onChange={(e) => setManualHMS({ ...manualHMS, s: e.target.value })} /><span style={{ fontFamily: MONO, fontSize: 12 }}>s</span>
              <Btn kind="primary" onClick={applyManualTime}><Check size={13} /> Set</Btn>
            </div>
          )}
        </div>

        <div className="mt-4">
          <Btn kind="primary" onClick={submit} disabled={!canSubmit} big>
            <Check size={16} /> Log this load ({num(counted)})
          </Btn>
          {!crew.length && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick your name above first.</div>}
          {!counted && <div className="mt-2 text-xs" style={{ color: C.warn }}>Nothing counted yet.</div>}
        </div>
      </div>

      <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Recent Ship Log</div>
        {shipEntries.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: C.faint }}>Nothing shipped yet.</div>
        ) : (
          <div className="space-y-2">
            {shipEntries.slice().sort(byNewest).slice(0, logLimit).map((s) => (
              <div key={s.id} className="px-3 py-2 rounded-sm text-sm" style={{ background: C.paper, border: `1px solid ${C.kraft}` }}>
                <div className="flex justify-between items-start gap-2">
                  <span style={{ fontWeight: 700 }}>{s.workOrderNumber || "No work order"}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{s.date} · {s.by}</span>
                    <button onClick={() => onDeleteSort(s)} title="Delete" className="opacity-50 hover:opacity-100"><Trash2 size={13} /></button>
                  </div>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, marginTop: 2 }}>
                  {(s.tallies || []).map((t) => `${t.sku} ${num(t.count)}${t.unit ? ` ${unitLabel(t.unit)}` : ""}`).join(" · ") || "—"}
                  {s.seconds ? ` · ${fmtDuration(s.seconds)}` : ""}
                </div>
                {s.description && <div style={{ fontSize: 12, marginTop: 4 }}>{s.description}</div>}
              </div>
            ))}
          </div>
        )}
        {logLimit < shipEntries.length && (
          <button
            onClick={() => setLogLimit(shipEntries.length)}
            className="mt-3 w-full py-2 rounded-sm text-xs"
            style={{ fontFamily: MONO, color: C.ink, border: `1px solid ${C.kraftDark}` }}
          >
            Show all {shipEntries.length} entries
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Time clock ----------------
   Separate from the per-batch stopwatches on the Work pages. Those
   measure how long a specific job took; this measures who was on the
   clock, which is what payroll runs off.

   A shift is one record: clock-in, optional breaks, clock-out. An open
   shift (clockOut === null) is someone currently on the clock, so
   "who's working right now" is just a filter, not separate state. Break
   time is subtracted from the paid total.

   Everything is editable after the fact — people forget to clock out,
   and a timesheet nobody can correct gets abandoned within a week. */

const shiftBreakSeconds = (shift, now) =>
  (shift.breaks || []).reduce((sum, b) => {
    if (!b.start) return sum;
    const end = b.end ? new Date(b.end).getTime() : (b.end === null && !shift.clockOut ? now : new Date(b.start).getTime());
    return sum + Math.max(0, (end - new Date(b.start).getTime()) / 1000);
  }, 0);

// Paid seconds = wall time on the clock minus break time. An open shift
// counts up to `now` so the running total ticks live.
const shiftSeconds = (shift, now = Date.now()) => {
  if (!shift.clockIn) return 0;
  const start = new Date(shift.clockIn).getTime();
  const end = shift.clockOut ? new Date(shift.clockOut).getTime() : now;
  return Math.max(0, (end - start) / 1000 - shiftBreakSeconds(shift, now));
};

const openBreak = (shift) => (shift.breaks || []).find((b) => b.start && !b.end) || null;
const isOnBreak = (shift) => !!openBreak(shift);

const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtClock = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—";

// <input type="datetime-local"> wants local time with no zone suffix,
// so we can't just slice an ISO string (that would show UTC).
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

// Monday-start week containing `dayStr`.
const weekStart = (dayStr) => {
  const d = new Date(`${dayStr}T12:00:00`);
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return localDay(d.toISOString());
};
const addDays = (dayStr, n) => {
  const d = new Date(`${dayStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d.toISOString());
};
const dayLabel = (dayStr) =>
  new Date(`${dayStr}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });

// Ticks once a second so open shifts show a live running total.
function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/* ---------------- Schedule ----------------
   Who is working which day, and on what. One row per person per day per
   job, so a day split between two orders is two rows and the hours still
   add up.

   These are planned hours. What actually happened is the time clock (the
   Time tab) and the work logs. No money here on purpose: pay rates and
   job cost live in GNWS Office, which keeps wages off the shop floor. */

const SHIFT_HOURS = 8;
const NO_JOB = "shop";

const scheduleFor = (schedule, day, person) => (schedule || []).filter((r) => r.date === day && r.person === person);
const scheduleHours = (rows) => rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
const fmtHours = (h) => String(Math.round((Number(h) || 0) * 10) / 10);

function ScheduleEditor({ row, team, workOrders, onSave, onDelete, onClose }) {
  useBackLayer(true, onClose);
  const [draft, setDraft] = useState(row);
  const set = (patch) => setDraft({ ...draft, ...patch });
  // Finished orders aren't worth scheduling against, but one already on
  // this row stays in the list so editing it doesn't silently move it.
  const jobs = (workOrders || []).filter((w) => !w.archived && (ACTIVE_WO_STATUSES.includes(w.status) || w.id === draft.workOrderId));
  return (
    <div className="fixed inset-0 z-50 overflow-auto p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md mx-auto my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontWeight: 800, fontSize: 16 }}>{row.id ? "Edit this day" : "Add to the schedule"}</div>
          <CloseBtn onClose={onClose} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Field label="Who" w={180}>
            <select style={inputStyle} value={draft.person} onChange={(e) => set({ person: e.target.value })}>
              <option value="">Pick someone</option>
              {(team || []).map((t) => <option key={t} value={t}>{t}</option>)}
              {draft.person && !(team || []).includes(draft.person) && <option value={draft.person}>{draft.person}</option>}
            </select>
          </Field>
          <Field label="Day" w={170}><input type="date" style={inputStyle} value={draft.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Hours" w={90}><input type="number" step="0.5" min="0" style={inputStyle} value={draft.hours} onChange={(e) => set({ hours: e.target.value })} /></Field>
        </div>
        <Field label="Job">
          <select style={inputStyle} value={draft.workOrderId || NO_JOB} onChange={(e) => set({ workOrderId: e.target.value })}>
            <option value={NO_JOB}>Shop work, no order</option>
            {jobs.map((w) => <option key={w.id} value={w.id}>{w.number} · {woTitle(w) || w.customerName || "Untitled job"}</option>)}
          </select>
        </Field>
        <Field label="Note"><input style={inputStyle} value={draft.note || ""} onChange={(e) => set({ note: e.target.value })} placeholder="Anything worth saying about the day" /></Field>
        <div className="mt-4 flex gap-2 flex-wrap">
          <Btn kind="primary" big disabled={!draft.person || !draft.date} onClick={() => onSave(draft)}><Check size={16} /> Save</Btn>
          {row.id && <Btn onClick={() => onDelete(row.id)}><Trash2 size={14} /> Take off the schedule</Btn>}
        </div>
      </div>
    </div>
  );
}

function ScheduleTab({ schedule, onChange, team, workOrders, me, onOpenWO }) {
  const [anchor, setAnchor] = useState(today());
  const [editing, setEditing] = useState(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i));
  const weekRows = (schedule || []).filter((r) => days.includes(r.date));
  const jobName = (id) => {
    if (!id || id === NO_JOB) return "Shop";
    const w = (workOrders || []).find((x) => x.id === id);
    return w ? (woTitle(w) || w.customerName || w.number) : "Order since removed";
  };
  // Everyone on the roster, plus anyone scheduled this week who isn't on it.
  const people = [...new Set([...(team || []), ...weekRows.map((r) => r.person)])].filter(Boolean);
  const save = (row) => {
    const clean = { ...row, hours: Number(row.hours) || 0, workOrderId: row.workOrderId || NO_JOB };
    onChange(row.id
      ? (schedule || []).map((r) => (r.id === row.id ? clean : r))
      : [{ ...clean, id: uid(), at: new Date().toISOString() }, ...(schedule || [])]);
    setEditing(null);
  };
  const remove = (id) => { onChange((schedule || []).filter((r) => r.id !== id)); setEditing(null); };
  const blank = (person, date) => ({ id: "", person: person || me || "", date, hours: SHIFT_HOURS, workOrderId: NO_JOB, note: "" });

  const byJob = {};
  weekRows.forEach((r) => { const k = r.workOrderId || NO_JOB; byJob[k] = (byJob[k] || 0) + (Number(r.hours) || 0); });
  const jobRows = Object.entries(byJob).sort((a, b) => b[1] - a[1]);

  const hcell = { padding: "6px 8px", fontFamily: MONO, fontSize: 11, color: C.faint, fontWeight: 700, borderBottom: `1px solid ${C.kraftDark}`, textAlign: "center", whiteSpace: "nowrap" };
  const cell = { padding: "5px 6px", borderBottom: `1px solid ${C.kraft}`, fontSize: 12, textAlign: "center" };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Schedule</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.faint }}>
            Week of {dayLabel(days[0])} · {fmtHours(scheduleHours(weekRows))} hours planned
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Btn onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft size={14} /> Previous</Btn>
          <Btn onClick={() => setAnchor(today())}>This week</Btn>
          <Btn onClick={() => setAnchor(addDays(anchor, 7))}>Next <ChevronLeft size={14} style={{ transform: "rotate(180deg)" }} /></Btn>
          <Btn kind="primary" onClick={() => setEditing(blank(me, today()))}><Plus size={14} /> Add</Btn>
        </div>
      </div>

      <div className="overflow-x-auto rounded-sm mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 780 }}>
          <thead>
            <tr>
              <th style={{ ...hcell, textAlign: "left", minWidth: 110 }}>Crew</th>
              {days.map((d) => (
                <th key={d} style={{ ...hcell, background: d === today() ? "#FBF6EC" : "transparent" }}>
                  {dayLabel(d)}
                  <div style={{ fontWeight: 400 }}>{fmtHours(scheduleHours(weekRows.filter((r) => r.date === d)))} h</div>
                </th>
              ))}
              <th style={hcell}>Week</th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr><td colSpan={9} style={{ ...cell, padding: 20, color: C.faint }}>Nobody on the roster yet. Add crew under Settings.</td></tr>
            )}
            {people.map((p) => (
              <tr key={p}>
                <td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>{p}</td>
                {days.map((d) => (
                  <td key={d} style={{ ...cell, verticalAlign: "top", background: d === today() ? "#FBF6EC" : "transparent" }}>
                    {scheduleFor(schedule, d, p).map((r) => (
                      <button
                        key={r.id} onClick={() => setEditing(r)} title={r.note || jobName(r.workOrderId)}
                        className="block w-full text-left rounded-sm px-1.5 py-1 mb-1 hover:opacity-85"
                        style={{
                          background: r.workOrderId && r.workOrderId !== NO_JOB ? C.ink : C.kraft,
                          color: r.workOrderId && r.workOrderId !== NO_JOB ? "#fff" : C.ink,
                          fontSize: 11, lineHeight: 1.35,
                        }}
                      >
                        <div style={{ fontWeight: 800, fontFamily: MONO }}>{fmtHours(r.hours)} h</div>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{jobName(r.workOrderId)}</div>
                      </button>
                    ))}
                    <button
                      onClick={() => setEditing(blank(p, d))} title={`Put ${p} on a job for ${dayLabel(d)}`}
                      className="w-full rounded-sm hover:opacity-70"
                      style={{ border: `1px dashed ${C.kraftDark}`, color: C.faint, fontSize: 11, padding: "1px 0" }}
                    >
                      +
                    </button>
                  </td>
                ))}
                <td style={{ ...cell, fontWeight: 800, fontFamily: MONO }}>{fmtHours(scheduleHours(weekRows.filter((r) => r.person === p)))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.kraftDark}`, fontWeight: 800 }}>This week by job</div>
        {jobRows.length === 0 && <div className="px-4 py-6 text-center text-sm" style={{ color: C.faint }}>Nothing scheduled this week yet.</div>}
        {jobRows.map(([id, hours]) => (
          <div key={id} className="px-4 py-2 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.kraft}` }}>
            {id !== NO_JOB && onOpenWO
              ? <button onClick={() => onOpenWO(id)} className="text-left hover:underline" style={{ fontWeight: 700 }}>{jobName(id)}</button>
              : <span style={{ fontWeight: 700 }}>{jobName(id)}</span>}
            <span style={{ fontFamily: MONO, fontWeight: 800 }}>{fmtHours(hours)} h</span>
          </div>
        ))}
      </div>

      {editing && (
        <ScheduleEditor
          row={editing} team={team} workOrders={workOrders}
          onSave={save} onDelete={remove} onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function TimeClockTab({ shifts, onChange, team, whoWorking, setWhoWorking, onAddTeamMember, runGrouped }) {
  const [view, setView] = useState("clock");
  const [day, setDay] = useState(today());
  const [editingId, setEditingId] = useState(null);

  const openShifts = shifts.filter((s) => !s.clockOut);
  const now = useNow(openShifts.length > 0);

  const mineOpen = shifts.find((s) => s.person === whoWorking && !s.clockOut) || null;

  const clockIn = () => {
    if (!whoWorking || mineOpen) return;
    onChange([
      { id: uid(), person: whoWorking, clockIn: new Date().toISOString(), clockOut: null, breaks: [], note: "" },
      ...shifts,
    ]);
  };
  const clockOut = () => {
    if (!mineOpen) return;
    const stamp = new Date().toISOString();
    onChange(shifts.map((s) => (s.id === mineOpen.id
      ? { ...s, clockOut: stamp, breaks: (s.breaks || []).map((b) => (b.end ? b : { ...b, end: stamp })) }
      : s)));
  };
  const toggleBreak = () => {
    if (!mineOpen) return;
    const stamp = new Date().toISOString();
    const running = openBreak(mineOpen);
    onChange(shifts.map((s) => {
      if (s.id !== mineOpen.id) return s;
      const breaks = running
        ? (s.breaks || []).map((b) => (b.start === running.start && !b.end ? { ...b, end: stamp } : b))
        : [...(s.breaks || []), { id: uid(), start: stamp, end: null }];
      return { ...s, breaks };
    }));
  };

  const updateShift = (id, patch) =>
    onChange(shifts.map((s) => (s.id === id ? { ...s, ...patch, edited: true } : s)));
  const removeShift = (id) => onChange(shifts.filter((s) => s.id !== id));
  const addManual = (person, forDay) => {
    const start = new Date(`${forDay}T08:00:00`);
    const end = new Date(`${forDay}T16:00:00`);
    const s = {
      id: uid(), person, clockIn: start.toISOString(), clockOut: end.toISOString(),
      breaks: [], note: "", edited: true, manual: true,
    };
    onChange([s, ...shifts]);
    setEditingId(s.id);
  };

  /* ---- Clock view: the crew-facing screen ---- */
  const ClockView = () => {
    const mineToday = shifts
      .filter((s) => s.person === whoWorking && s.clockIn && localDay(s.clockIn) === today())
      .sort((a, b) => new Date(b.clockIn) - new Date(a.clockIn));
    const todaySec = mineToday.reduce((sum, s) => sum + shiftSeconds(s, now), 0);
    const onBreakNow = mineOpen && isOnBreak(mineOpen);

    return (
      <div>
        <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <Field label="Who's clocking in" required>
            <WhoSelect team={team} current={whoWorking} onChange={setWhoWorking} onAddMember={onAddTeamMember} big />
          </Field>

          {!whoWorking ? (
            <div className="text-sm text-center py-6" style={{ color: C.faint }}>Pick your name to clock in.</div>
          ) : (
            <>
              <div className="text-center py-5">
                <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.08em", color: C.faint }}>
                  {mineOpen ? (onBreakNow ? "ON BREAK" : "ON THE CLOCK") : "CLOCKED OUT"}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 44, fontWeight: 800, lineHeight: 1.1, color: onBreakNow ? C.gold : mineOpen ? C.moss : C.ink }}>
                  {fmtDuration(mineOpen ? shiftSeconds(mineOpen, now) : todaySec)}
                </div>
                <div className="mt-1 text-sm" style={{ color: C.faint }}>
                  {mineOpen
                    ? `since ${fmtClock(mineOpen.clockIn)}${todaySec > shiftSeconds(mineOpen, now) ? ` · ${fmtDuration(todaySec)} today` : ""}`
                    : todaySec > 0 ? "logged today" : "nothing logged today"}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                {!mineOpen ? (
                  <button
                    onClick={clockIn}
                    className="w-full rounded-sm font-bold"
                    style={{ background: C.moss, color: "#fff", fontFamily: MONO, fontSize: 18, padding: "18px 12px", letterSpacing: "0.05em" }}
                  >
                    CLOCK IN
                  </button>
                ) : (
                  <>
                    <button
                      onClick={toggleBreak}
                      className="w-full rounded-sm font-bold"
                      style={{ background: onBreakNow ? C.moss : C.gold, color: "#fff", fontFamily: MONO, fontSize: 16, padding: "16px 12px", letterSpacing: "0.05em" }}
                    >
                      {onBreakNow ? "END BREAK" : "START BREAK"}
                    </button>
                    <button
                      onClick={clockOut}
                      className="w-full rounded-sm font-bold"
                      style={{ background: C.redwood, color: "#fff", fontFamily: MONO, fontSize: 18, padding: "18px 12px", letterSpacing: "0.05em" }}
                    >
                      CLOCK OUT
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>
            On the clock now {openShifts.length > 0 && <span style={{ fontFamily: MONO, color: C.faint, fontWeight: 400 }}>({openShifts.length})</span>}
          </div>
          {openShifts.length === 0 ? (
            <div className="text-sm text-center py-4" style={{ color: C.faint }}>Nobody's clocked in.</div>
          ) : (
            <div className="space-y-2">
              {openShifts.map((s) => {
                const br = isOnBreak(s);
                return (
                  <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-sm" style={{ background: C.paper, border: `1px solid ${C.kraft}` }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{s.person}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: br ? C.gold : C.faint }}>
                        {br ? "on break · " : ""}in at {fmtClock(s.clockIn)}
                      </div>
                    </div>
                    <div style={{ fontFamily: MONO, fontWeight: 800, color: br ? C.gold : C.moss }}>{fmtDuration(shiftSeconds(s, now))}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {mineToday.length > 0 && (
          <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>My shifts today</div>
            <div className="space-y-1.5">
              {mineToday.map((s) => (
                <div key={s.id} className="flex justify-between items-center px-3 py-2 rounded-sm text-sm" style={{ background: C.paper }}>
                  <span style={{ fontFamily: MONO }}>
                    {fmtClock(s.clockIn)} – {s.clockOut ? fmtClock(s.clockOut) : "now"}
                    {(s.breaks || []).length > 0 && <span style={{ color: C.faint }}> · {(s.breaks || []).length} break</span>}
                  </span>
                  <span style={{ fontFamily: MONO, fontWeight: 700 }}>{fmtDuration(shiftSeconds(s, now))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ---- Timesheet: one day, everyone, fully editable ---- */
  const TimesheetView = () => {
    const dayShifts = shifts
      .filter((s) => s.clockIn && localDay(s.clockIn) === day)
      .sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
    const people = [...new Set(dayShifts.map((s) => s.person))];
    const dayTotal = dayShifts.reduce((sum, s) => sum + shiftSeconds(s, now), 0);

    return (
      <div>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <Field label="Day" w={170}>
            <input type="date" style={inputStyle} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Btn onClick={() => setDay(addDays(day, -1))}>← Prev</Btn>
          <Btn onClick={() => setDay(today())}>Today</Btn>
          <Btn onClick={() => setDay(addDays(day, 1))}>Next →</Btn>
        </div>

        <div className="rounded-sm p-4 mb-3" style={{ background: C.ink, color: "#fff" }}>
          <div className="flex justify-between items-center">
            <span style={{ fontWeight: 800 }}>{dayLabel(day)}</span>
            <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800 }}>
              {fmtDuration(dayTotal)} <span style={{ fontSize: 13, color: C.kraftDark }}>({hoursDecimal(dayTotal).toFixed(2)}h)</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {team.map((name) => (
            <Btn key={name} onClick={() => addManual(name, day)}><Plus size={12} /> {name}</Btn>
          ))}
        </div>

        {dayShifts.length === 0 ? (
          <div className="rounded-sm p-8 text-center" style={{ background: C.panel, border: `1px dashed ${C.kraftDark}`, color: C.faint }}>
            Nothing logged on {dayLabel(day)}. Use a name button above to add a shift by hand.
          </div>
        ) : (
          people.map((person) => {
            const rows = dayShifts.filter((s) => s.person === person);
            const personSec = rows.reduce((sum, s) => sum + shiftSeconds(s, now), 0);
            return (
              <div key={person} className="rounded-sm mb-3 overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
                <div className="px-4 py-2 flex justify-between items-center" style={{ borderBottom: `1px solid ${C.kraft}` }}>
                  <span style={{ fontWeight: 800 }}>{person}</span>
                  <span style={{ fontFamily: MONO, fontWeight: 800 }}>
                    {fmtDuration(personSec)} <span style={{ color: C.faint, fontWeight: 400 }}>({hoursDecimal(personSec).toFixed(2)}h)</span>
                  </span>
                </div>
                {rows.map((s) => {
                  const editing = editingId === s.id;
                  const brSec = shiftBreakSeconds(s, now);
                  return (
                    <div key={s.id} style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <div className="px-4 py-2 flex items-center justify-between gap-2 flex-wrap">
                        <div style={{ fontFamily: MONO, fontSize: 13 }}>
                          {fmtClock(s.clockIn)} – {s.clockOut ? fmtClock(s.clockOut) : <span style={{ color: C.moss }}>on the clock</span>}
                          {brSec > 0 && <span style={{ color: C.faint }}> · {fmtDuration(brSec)} break</span>}
                          {s.edited && <span style={{ color: C.faint }}> · edited</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span style={{ fontFamily: MONO, fontWeight: 700 }}>{fmtDuration(shiftSeconds(s, now))}</span>
                          <button onClick={() => setEditingId(editing ? null : s.id)} className="opacity-50 hover:opacity-100" title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => removeShift(s.id)} className="opacity-40 hover:opacity-100" title="Delete"><Trash2 size={13} /></button>
                        </div>
                      </div>

                      {editing && (
                        <div className="px-4 pb-4 pt-1" style={{ background: C.paper }}>
                          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                            <Field label="Clocked in">
                              <input
                                type="datetime-local" style={inputStyle}
                                value={toLocalInput(s.clockIn)}
                                onChange={(e) => updateShift(s.id, { clockIn: fromLocalInput(e.target.value) })}
                              />
                            </Field>
                            <Field label="Clocked out">
                              <input
                                type="datetime-local" style={inputStyle}
                                value={toLocalInput(s.clockOut)}
                                onChange={(e) => updateShift(s.id, { clockOut: fromLocalInput(e.target.value) })}
                              />
                            </Field>
                            <Field label="Person">
                              <select style={inputStyle} value={s.person} onChange={(e) => updateShift(s.id, { person: e.target.value })}>
                                {[...new Set([...team, s.person])].map((n) => <option key={n} value={n}>{n}</option>)}
                              </select>
                            </Field>
                          </div>
                          {!s.clockOut && (
                            <div className="mt-2">
                              <Btn kind="moss" onClick={() => updateShift(s.id, { clockOut: new Date().toISOString() })}>
                                <Check size={13} /> Close out now
                              </Btn>
                            </div>
                          )}

                          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs" style={{ fontFamily: MONO, color: C.faint }}>BREAKS</span>
                              <Btn onClick={() => updateShift(s.id, { breaks: [...(s.breaks || []), { id: uid(), start: s.clockIn, end: s.clockIn }] })}>
                                <Plus size={12} /> Add break
                              </Btn>
                            </div>
                            {(s.breaks || []).length === 0 ? (
                              <div className="text-xs" style={{ color: C.faint }}>No breaks on this shift.</div>
                            ) : (
                              (s.breaks || []).map((b) => (
                                <div key={b.id || b.start} className="flex items-end gap-2 flex-wrap mb-1">
                                  <Field label="Break start" w={170}>
                                    <input
                                      type="datetime-local" style={inputStyle} value={toLocalInput(b.start)}
                                      onChange={(e) => updateShift(s.id, { breaks: s.breaks.map((x) => (x === b ? { ...x, start: fromLocalInput(e.target.value) } : x)) })}
                                    />
                                  </Field>
                                  <Field label="Break end" w={170}>
                                    <input
                                      type="datetime-local" style={inputStyle} value={toLocalInput(b.end)}
                                      onChange={(e) => updateShift(s.id, { breaks: s.breaks.map((x) => (x === b ? { ...x, end: fromLocalInput(e.target.value) } : x)) })}
                                    />
                                  </Field>
                                  <button onClick={() => updateShift(s.id, { breaks: s.breaks.filter((x) => x !== b) })} className="opacity-40 hover:opacity-100 mb-2"><Trash2 size={15} /></button>
                                </div>
                              ))
                            )}
                          </div>

                          <Field label="Note">
                            <input style={inputStyle} value={s.note || ""} onChange={(e) => updateShift(s.id, { note: e.target.value })} placeholder="Why this was edited, anything worth recording…" />
                          </Field>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    );
  };

  /* ---- Payroll: one week, hours per person per day ---- */
  const PayrollView = () => {
    const start = weekStart(day);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const weekShifts = shifts.filter((s) => s.clockIn && days.includes(localDay(s.clockIn)));
    const people = [...new Set(weekShifts.map((s) => s.person))].sort();
    const secFor = (person, d) =>
      weekShifts.filter((s) => s.person === person && localDay(s.clockIn) === d)
        .reduce((sum, s) => sum + shiftSeconds(s, now), 0);
    const weekTotal = weekShifts.reduce((sum, s) => sum + shiftSeconds(s, now), 0);

    const copyPayroll = () => {
      const lines = [["Person", ...days.map(dayLabel), "Total (h)"].join("\t")];
      people.forEach((p) => {
        const daily = days.map((d) => hoursDecimal(secFor(p, d)).toFixed(2));
        const total = days.reduce((sum, d) => sum + secFor(p, d), 0);
        lines.push([p, ...daily, hoursDecimal(total).toFixed(2)].join("\t"));
      });
      navigator.clipboard?.writeText(lines.join("\n"));
    };

    return (
      <div>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <Field label="Week of" w={170}>
            <input type="date" style={inputStyle} value={day} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Btn onClick={() => setDay(addDays(day, -7))}>← Prev week</Btn>
          <Btn onClick={() => setDay(today())}>This week</Btn>
          <Btn onClick={() => setDay(addDays(day, 7))}>Next week →</Btn>
          <Btn onClick={copyPayroll}><ClipboardList size={13} /> Copy for payroll</Btn>
        </div>

        <div className="rounded-sm p-4 mb-3" style={{ background: C.ink, color: "#fff" }}>
          <div className="flex justify-between items-center flex-wrap gap-2">
            <span style={{ fontWeight: 800 }}>{dayLabel(start)} – {dayLabel(addDays(start, 6))}</span>
            <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800 }}>{hoursDecimal(weekTotal).toFixed(2)}h</span>
          </div>
        </div>

        {people.length === 0 ? (
          <div className="rounded-sm p-8 text-center" style={{ background: C.panel, border: `1px dashed ${C.kraftDark}`, color: C.faint }}>
            No time logged this week.
          </div>
        ) : (
          <div className="rounded-sm overflow-x-auto" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
            <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.kraft }}>
                  <th className="text-left px-3 py-2" style={{ fontFamily: MONO, fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>PERSON</th>
                  {days.map((d) => (
                    <th key={d} className="px-2 py-2" style={{ fontFamily: MONO, fontSize: 11, color: d === today() ? C.ink : C.faint, whiteSpace: "nowrap" }}>
                      {dayLabel(d)}
                    </th>
                  ))}
                  <th className="px-3 py-2" style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const total = days.reduce((sum, d) => sum + secFor(p, d), 0);
                  return (
                    <tr key={p} style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <td className="px-3 py-2" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{p}</td>
                      {days.map((d) => {
                        const sec = secFor(p, d);
                        return (
                          <td key={d} className="px-2 py-2 text-center" style={{ fontFamily: MONO, color: sec ? C.ink : C.kraftDark }}>
                            {sec ? hoursDecimal(sec).toFixed(2) : "·"}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right" style={{ fontFamily: MONO, fontWeight: 800, whiteSpace: "nowrap" }}>
                        {hoursDecimal(total).toFixed(2)}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap gap-1 mb-4">
        {[["clock", "Clock", Timer], ["timesheet", "Timesheets", CalendarDays], ["payroll", "Payroll", ClipboardList]].map(([id, label, Icon]) => (
          <button
            key={id} onClick={() => setView(id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: view === id ? C.ink : "transparent", color: view === id ? "#fff" : C.faint, border: `1px solid ${view === id ? C.ink : C.kraftDark}` }}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {view === "clock" && <ClockView />}
      {view === "timesheet" && <TimesheetView />}
      {view === "payroll" && <PayrollView />}
    </div>
  );
}

/* ---------------- Reports ----------------
   Ten shop-floor reports over one date range and one work-type filter.
   Everything is derived from records the crew already produce — the work
   log, the time clock, POs, received units, work orders — so nothing here
   needs extra data entry to stay true.

   Where a number can't be trusted (no timed batches yet, a ship date
   that's still only a plan) the report says so rather than printing a
   confident zero. */

const REPORTS = [
  { id: "throughput", label: "Throughput by step", stepFilter: true },
  { id: "yield", label: "Yield & recovery", stepFilter: false },
  { id: "waste", label: "Waste", stepFilter: true },
  { id: "people", label: "Person productivity", stepFilter: true },
  { id: "labor", label: "Clock hours vs logged", stepFilter: true },
  { id: "purchasing", label: "Purchasing summary", stepFilter: false },
  { id: "aging", label: "Yard aging", stepFilter: false },
  { id: "stock", label: "Stock & days of cover", stepFilter: false },
  { id: "ontime", label: "Work orders & on-time", stepFilter: false },
];

function ReportShell({ title, subtitle, children, empty }) {
  return (
    <div className="rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
      <div className="px-4 py-3" style={{ borderBottom: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontWeight: 800 }}>{title}</div>
        {subtitle && <div className="text-xs mt-0.5" style={{ color: C.faint }}>{subtitle}</div>}
      </div>
      {empty ? <div className="px-4 py-10 text-center text-sm" style={{ color: C.faint }}>{empty}</div> : children}
    </div>
  );
}

function RTable({ head, rows, foot }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full" style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: C.kraft }}>
            {head.map((h, i) => (
              <th key={i} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}
                  style={{ fontFamily: MONO, fontSize: 11, color: C.faint, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${C.kraft}` }}>
              {r.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "text-left" : "text-right"}`}
                    style={{ fontFamily: j === 0 ? undefined : MONO, fontWeight: j === 0 ? 700 : 400, whiteSpace: "nowrap" }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr style={{ borderTop: `2px solid ${C.kraftDark}`, background: C.paper }}>
              {foot.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "text-left" : "text-right"}`}
                    style={{ fontFamily: MONO, fontWeight: 800, whiteSpace: "nowrap" }}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function ReportsTab({ sortLog, shifts, products, units, purchaseOrders, suppliers, workOrders, team }) {
  const [report, setReport] = useState("throughput");
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const [step, setStep] = useState("all");

  const def = REPORTS.find((r) => r.id === report);
  const inRange = (d) => !!d && d >= from && d <= to;
  const rangeLabel = `${from} → ${to}`;

  // Work-log rows for the current range and work type.
  const logRows = (sortLog || []).filter((e) => inRange(e.date) && (step === "all" || logStep(e) === step));
  const stepName = (id) => PROCESS_STEPS.find((p) => p.id === id)?.label || id;

  const copyTSV = (head, rows) => {
    const text = [head.join("\t"), ...rows.map((r) => r.map((c) => (typeof c === "object" ? "" : String(c))).join("\t"))].join("\n");
    navigator.clipboard?.writeText(text);
  };

  /* ---- 1. Throughput by step ---- */
  const Throughput = () => {
    const steps = step === "all" ? PROCESS_STEPS.map((p) => p.id) : [step];
    const rows = steps.map((id) => {
      const rs = logRows.filter((e) => logStep(e) === id && Number(e.seconds) > 0);
      const boards = rs.reduce((s, e) => s + logBoardsIn(e), 0);
      const secs = rs.reduce((s, e) => s + (Number(e.seconds) || 0), 0);
      const rate = secs > 0 ? boards / (secs / 3600) : 0;
      return { id, batches: rs.length, boards, hours: hoursDecimal(secs), rate, target: rate * TARGET_MULTIPLIER };
    }).filter((r) => r.batches > 0).sort((a, b) => b.boards - a.boards);

    const head = ["Step", "Batches", "Boards", "Hours", "Bd/hr", "Target"];
    const body = rows.map((r) => [stepName(r.id), num(r.batches), num(r.boards), r.hours.toFixed(2), num(r.rate, 0), num(r.target, 0)]);
    const tb = rows.reduce((s, r) => s + r.boards, 0), th = rows.reduce((s, r) => s + r.hours, 0);
    return (
      <ReportShell
        title="Throughput by process step" subtitle={`${rangeLabel} · only batches with a timer count`}
        empty={rows.length ? null : "No timed batches in this range."}
      >
        <RTable head={head} rows={body} foot={["All steps", num(rows.reduce((s, r) => s + r.batches, 0)), num(tb), th.toFixed(2), num(th > 0 ? tb / th : 0, 0), ""]} />
      </ReportShell>
    );
  };

  /* ---- 2. Yield & recovery (Sort only) ---- */
  const Yield = () => {
    const rs = (sortLog || []).filter((e) => inRange(e.date) && logStep(e) === "sorting" && Number(e.rawBoards) > 0);
    const bySize = {};
    rs.forEach((e) => {
      const p = resolveRawProduct(e, products);
      const key = p?.sku || e.rawSku || "Unknown";
      const b = (bySize[key] = bySize[key] || { raw: 0, n: 0, p: 0, mill: 0, waste: 0, batches: 0 });
      b.raw += Number(e.rawBoards) || 0;
      b.n += Number(e.toN) || 0;
      b.p += Number(e.toP) || 0;
      b.mill += Number(e.toMill) || 0;
      b.waste += Number(e.toWaste) || 0;
      b.batches += 1;
    });
    const rows = Object.entries(bySize).map(([sku, b]) => ({ sku, ...b, good: b.n + b.p }))
      .sort((a, b) => (a.raw ? a.good / a.raw : 0) - (b.raw ? b.good / b.raw : 0));
    const pct = (x, of) => (of > 0 ? `${((x / of) * 100).toFixed(1)}%` : "—");
    const head = ["Raw size", "Batches", "Boards in", "Sellable", "Mill", "Waste", "Recovery", "Waste %"];
    const body = rows.map((r) => [r.sku, num(r.batches), num(r.raw), num(r.good), num(r.mill), num(r.waste), pct(r.good, r.raw), pct(r.waste, r.raw)]);
    const t = rows.reduce((a, r) => ({ raw: a.raw + r.raw, good: a.good + r.good, mill: a.mill + r.mill, waste: a.waste + r.waste }), { raw: 0, good: 0, mill: 0, waste: 0 });
    return (
      <ReportShell
        title="Yield & recovery by raw size" subtitle={`${rangeLabel} · sorting only · worst recovery first`}
        empty={rows.length ? null : "No sort batches in this range."}
      >
        <RTable head={head} rows={body} foot={["All sizes", "", num(t.raw), num(t.good), num(t.mill), num(t.waste), pct(t.good, t.raw), pct(t.waste, t.raw)]} />
      </ReportShell>
    );
  };

  /* ---- 3. Waste ---- */
  const Waste = () => {
    const byStep = {}, byPerson = {};
    logRows.forEach((e) => {
      const w = logWaste(e); if (!w) return;
      byStep[logStep(e)] = (byStep[logStep(e)] || 0) + w;
      byPerson[e.by || "Unattributed"] = (byPerson[e.by || "Unattributed"] || 0) + w;
    });
    const boardsIn = logRows.reduce((s, e) => s + logBoardsIn(e), 0);
    const totalWaste = Object.values(byStep).reduce((s, v) => s + v, 0);
    const stepRows = Object.entries(byStep).sort((a, b) => b[1] - a[1]).map(([id, w]) => [stepName(id), num(w), boardsIn > 0 ? `${((w / boardsIn) * 100).toFixed(1)}%` : "—"]);
    const personRows = Object.entries(byPerson).sort((a, b) => b[1] - a[1]).map(([n, w]) => [n, num(w)]);
    return (
      <div className="space-y-3">
        <ReportShell title="Waste by step" subtitle={`${rangeLabel} · ${num(totalWaste)} boards wasted of ${num(boardsIn)} handled`}
          empty={stepRows.length ? null : "No waste recorded in this range."}>
          <RTable head={["Step", "Waste boards", "% of boards handled"]} rows={stepRows} />
        </ReportShell>
        {personRows.length > 0 && (
          <ReportShell title="Waste by person" subtitle="Same range and work type">
            <RTable head={["Person", "Waste boards"]} rows={personRows} />
          </ReportShell>
        )}
      </div>
    );
  };

  /* ---- 4. Person productivity ---- */
  const People = () => {
    const by = {};
    logRows.forEach((e) => {
      const k = e.by || "Unattributed";
      const b = (by[k] = by[k] || { boards: 0, seconds: 0, batches: 0, waste: 0 });
      b.boards += logBoardsIn(e); b.seconds += Number(e.seconds) || 0; b.batches += 1; b.waste += logWaste(e);
    });
    const rows = Object.entries(by).map(([name, b]) => ({ name, ...b, rate: b.seconds > 0 ? b.boards / (b.seconds / 3600) : 0 }))
      .sort((a, b) => b.rate - a.rate);
    const head = ["Person", "Batches", "Boards", "Hours", "Bd/hr", "Waste"];
    const body = rows.map((r) => [r.name, num(r.batches), num(r.boards), hoursDecimal(r.seconds).toFixed(2), r.seconds > 0 ? num(r.rate, 0) : "—", num(r.waste)]);
    return (
      <ReportShell title="Person productivity" subtitle={`${rangeLabel}${step === "all" ? " · all work types" : ` · ${stepName(step)} only`}`}
        empty={rows.length ? null : "Nothing logged in this range."}>
        <RTable head={head} rows={body} />
      </ReportShell>
    );
  };

  /* ---- 5. Clock hours vs logged work ---- */
  const Labor = () => {
    const clocked = {};
    (shifts || []).filter((sh) => sh.clockIn && inRange(localDay(sh.clockIn))).forEach((sh) => {
      clocked[sh.person] = (clocked[sh.person] || 0) + shiftSeconds(sh);
    });
    const logged = {};
    logRows.forEach((e) => { logged[e.by || "Unattributed"] = (logged[e.by || "Unattributed"] || 0) + (Number(e.seconds) || 0); });
    const names = [...new Set([...Object.keys(clocked), ...Object.keys(logged)])].sort();
    const rows = names.map((n) => {
      const c = clocked[n] || 0, l = logged[n] || 0;
      return [n, hoursDecimal(c).toFixed(2), hoursDecimal(l).toFixed(2), hoursDecimal(Math.max(0, c - l)).toFixed(2), c > 0 ? `${((l / c) * 100).toFixed(0)}%` : "—"];
    });
    const tc = Object.values(clocked).reduce((s, v) => s + v, 0);
    const tl = Object.values(logged).reduce((s, v) => s + v, 0);
    return (
      <ReportShell
        title="Clock hours vs logged work" subtitle={`${rangeLabel} · the gap is paid time not attached to a batch`}
        empty={names.length ? null : "No clock or work records in this range. The time clock only started collecting recently."}
      >
        <RTable
          head={["Person", "Clocked", "Logged", "Unaccounted", "Captured"]} rows={rows}
          foot={["Everyone", hoursDecimal(tc).toFixed(2), hoursDecimal(tl).toFixed(2), hoursDecimal(Math.max(0, tc - tl)).toFixed(2), tc > 0 ? `${((tl / tc) * 100).toFixed(0)}%` : "—"]}
        />
      </ReportShell>
    );
  };

  /* ---- 7. Purchasing summary ---- */
  const Purchasing = () => {
    const pos = (purchaseOrders || []).filter((po) => inRange(po.date));
    const rows = pos.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((po) => {
      const v = suppliers.find((s) => s.id === po.supplierId);
      const boards = (po.lines || []).reduce((s, l) => s + (Number(l.boardCount) || 0) * (Number(l.copies) || 1), 0);
      return [po.number || "—", v?.name || "Unknown", po.date || "—", num(boards), po.status === "ordered" ? "Ordered" : "Received", po.paymentStatus || "Unpaid"];
    });
    const boards = pos.reduce((s, po) => s + (po.lines || []).reduce((x, l) => x + (Number(l.boardCount) || 0) * (Number(l.copies) || 1), 0), 0);
    return (
      <ReportShell title="Purchasing summary" subtitle={`${rangeLabel} · ${num(boards)} boards received`}
        empty={rows.length ? null : "No purchase orders in this range."}>
        <RTable head={["PO", "Vendor", "Date", "Boards", "Status", "Payment"]} rows={rows}
          foot={["Total", "", "", num(boards), "", ""]} />
      </ReportShell>
    );
  };

  /* ---- 8. Yard aging ---- */
  const Aging = () => {
    const open = (units || []).filter((u) => Number(u.boardsRemaining) > 0);
    const days = (d) => (d ? Math.floor((new Date(`${today()}T12:00:00`) - new Date(`${d}T12:00:00`)) / 86400000) : null);
    const buckets = [
      { label: "0–30 days", min: 0, max: 30 },
      { label: "31–60 days", min: 31, max: 60 },
      { label: "61–90 days", min: 61, max: 90 },
      { label: "Over 90 days", min: 91, max: Infinity },
    ];
    const rows = buckets.map((b) => {
      const us = open.filter((u) => { const a = days(u.receivedDate); return a != null && a >= b.min && a <= b.max; });
      return [b.label, num(us.length), num(us.reduce((s, u) => s + (Number(u.boardsRemaining) || 0), 0))];
    });
    const oldest = open.slice().sort((a, b) => (a.receivedDate || "").localeCompare(b.receivedDate || "")).slice(0, 12).map((u) => {
      const po = purchaseOrders.find((p) => p.id === u.poId);
      const v = suppliers.find((s) => s.id === po?.supplierId);
      return [u.sizeLabel, po?.number || "—", v?.name || "—", u.receivedDate || "—", `${days(u.receivedDate) ?? "—"} d`, num(u.boardsRemaining)];
    });
    const unknownDate = open.filter((u) => !u.receivedDate).length;
    return (
      <div className="space-y-3">
        <ReportShell title="Yard aging — unsorted pallets" subtitle={`As of ${today()} · ${num(open.length)} pallets still holding boards${unknownDate ? ` · ${unknownDate} with no received date` : ""}`}
          empty={open.length ? null : "Nothing sitting in the yard."}>
          <RTable head={["Age", "Pallets", "Boards"]} rows={rows} />
        </ReportShell>
        {oldest.length > 0 && (
          <ReportShell title="Oldest pallets" subtitle="Clear these first">
            <RTable head={["Size", "PO", "Vendor", "Received", "Age", "Boards left"]} rows={oldest} />
          </ReportShell>
        )}
      </div>
    );
  };

  /* ---- 9. Stock & days of cover ---- */
  const Stock = () => {
    const daysInRange = Math.max(1, Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1);
    const consumed = {};
    (sortLog || []).filter((e) => inRange(e.date)).forEach((e) => {
      const id = e.inboundProductId || e.rawProductId;
      if (id) consumed[id] = (consumed[id] || 0) + logBoardsIn(e);
    });
    const rows = (products || [])
      .filter((p) => !p.archived && (p.category || "wood") === "wood")
      .map((p) => {
        const perDay = (consumed[p.id] || 0) / daysInRange;
        const onHand = Number(p.onHand) || 0;
        const cover = perDay > 0 ? onHand / perDay : null;
        const low = Number(p.reorderPoint) > 0 && onHand <= Number(p.reorderPoint);
        return { p, onHand, perDay, cover, low, sf: convertQty(p, onHand, canonicalUnitFor(p), "sf") };
      })
      .sort((a, b) => (a.cover == null ? Infinity : a.cover) - (b.cover == null ? Infinity : b.cover));
    const body = rows.map((r) => [
      `${r.low ? "⚠ " : ""}${r.p.sku}`,
      num(r.onHand),
      num(r.sf, 0),
      r.p.reorderPoint ? num(r.p.reorderPoint) : "—",
      r.perDay > 0 ? num(r.perDay, 1) : "—",
      r.cover == null ? "—" : `${num(r.cover, 0)} d`,
    ]);
    return (
      <ReportShell title="Stock position & days of cover"
        subtitle={`On hand now · burn rate from ${rangeLabel} (${daysInRange} days) · shortest cover first`}
        empty={rows.length ? null : "No wood SKUs to report."}>
        <RTable head={["SKU", "On hand", "≈ SF", "Reorder at", "Bd/day", "Cover"]} rows={body} />
      </ReportShell>
    );
  };

  /* ---- 10. Work orders & on-time ---- */
  const OnTime = () => {
    const wos = (workOrders || []).filter((w) => !w.archived);
    const byStatus = STATUS_FLOW.map((st) => [STATUS_LABEL[st], num(wos.filter((w) => (w.status || "not_started") === st).length)]);

    // Shipped inside the range. shippedAt is the real stamp; older orders
    // predate it and fall back to the planned ship date, which is flagged.
    const shipped = wos.filter((w) => w.status === "shipped").map((w) => ({
      w, actual: w.shippedAt ? localDay(w.shippedAt) : (w.shipDate || null), estimated: !w.shippedAt,
    })).filter((r) => inRange(r.actual));

    const withPromise = shipped.filter((r) => r.w.readyByDate);
    const lateness = (r) => Math.round((new Date(`${r.actual}T12:00:00`) - new Date(`${r.w.readyByDate}T12:00:00`)) / 86400000);
    const late = withPromise.filter((r) => lateness(r) > 0);
    const avgLate = late.length ? late.reduce((s, r) => s + lateness(r), 0) / late.length : 0;
    const estimatedCount = shipped.filter((r) => r.estimated).length;

    const openOverdue = wos.filter((w) => w.status !== "shipped" && w.readyByDate && w.readyByDate < today())
      .sort((a, b) => a.readyByDate.localeCompare(b.readyByDate))
      .map((w) => [w.number, w.customerName || "—", STATUS_LABEL[w.status] || w.status, w.readyByDate, `${Math.round((new Date(`${today()}T12:00:00`) - new Date(`${w.readyByDate}T12:00:00`)) / 86400000)} d`]);

    return (
      <div className="space-y-3">
        <ReportShell title="Work orders by stage" subtitle="Current pipeline, all open orders">
          <RTable head={["Stage", "Orders"]} rows={byStatus} />
        </ReportShell>
        <ReportShell
          title="On-time performance"
          subtitle={`Shipped ${rangeLabel}${estimatedCount ? ` · ${estimatedCount} shipped before ship-time was recorded, using their planned date` : ""}`}
          empty={shipped.length ? null : "Nothing shipped in this range."}
        >
          <RTable head={["Measure", "Value"]} rows={[
            ["Shipped in range", num(shipped.length)],
            ["Had a ready-by promise", num(withPromise.length)],
            ["Shipped late", num(late.length)],
            ["On-time rate", withPromise.length ? `${(((withPromise.length - late.length) / withPromise.length) * 100).toFixed(0)}%` : "—"],
            ["Average days late (when late)", late.length ? num(avgLate, 1) : "—"],
          ]} />
        </ReportShell>
        {openOverdue.length > 0 && (
          <ReportShell title="Open and past ready-by" subtitle="Still not shipped">
            <RTable head={["WO", "Customer", "Stage", "Ready by", "Overdue"]} rows={openOverdue} />
          </ReportShell>
        )}
      </div>
    );
  };

  const body = {
    throughput: Throughput, yield: Yield, waste: Waste, people: People, labor: Labor,
    purchasing: Purchasing, aging: Aging, stock: Stock, ontime: OnTime,
  }[report];
  const Body = body || Throughput;

  const preset = (days) => { setFrom(addDays(today(), -days)); setTo(today()); };

  return (
    <div className="max-w-4xl">
      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" w={150}><input type="date" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" w={150}><input type="date" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Btn onClick={() => { setFrom(weekStart(today())); setTo(today()); }}>This week</Btn>
          <Btn onClick={() => preset(30)}>Last 30 days</Btn>
          <Btn onClick={() => preset(365)}>Last year</Btn>
        </div>

        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="text-xs mb-1.5" style={{ fontFamily: MONO, color: C.faint }}>
            TYPE OF WORK {!def?.stepFilter && <span style={{ color: C.kraftDark }}>· not used by this report</span>}
          </div>
          <div className="flex flex-wrap gap-1.5" style={{ opacity: def?.stepFilter ? 1 : 0.4 }}>
            {[["all", "All work"], ...PROCESS_STEPS.map((p) => [p.id, p.label])].map(([id, label]) => (
              <button
                key={id} onClick={() => setStep(id)} disabled={!def?.stepFilter}
                className="px-2.5 py-1 rounded-sm text-xs"
                style={{ fontFamily: MONO, background: step === id ? C.ink : "transparent", color: step === id ? "#fff" : C.faint, border: `1px solid ${step === id ? C.ink : C.kraftDark}` }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {REPORTS.map((r) => (
          <button
            key={r.id} onClick={() => setReport(r.id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: report === r.id ? C.redwood : "transparent", color: report === r.id ? "#fff" : C.faint, border: `1px solid ${report === r.id ? C.redwood : C.kraftDark}` }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <Body />
    </div>
  );
}

function mergeCollections(baseline, ours, theirs) {
  if (!Array.isArray(ours) || !Array.isArray(theirs)) return ours;
  const keyed = (arr) => {
    const m = new Map();
    for (const r of arr) { if (r && r.id != null) m.set(r.id, r); }
    return m;
  };
  // Anything without a stable id can't be reconciled; fall back to ours.
  if (ours.some((r) => !r || r.id == null) || theirs.some((r) => !r || r.id == null)) return ours;

  const base = keyed(Array.isArray(baseline) ? baseline : []);
  const mine = keyed(ours);
  const yours = keyed(theirs);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const result = [];
  const taken = new Set();
  // Walk their order first so records we never saw keep their position.
  for (const r of theirs) {
    if (base.has(r.id) && !mine.has(r.id)) continue;        // we deleted it
    const ourRow = mine.get(r.id);
    if (!ourRow) { result.push(r); taken.add(r.id); continue; }
    const baseRow = base.get(r.id);
    const weChanged = !baseRow || !same(baseRow, ourRow);
    result.push(weChanged ? ourRow : r);
    taken.add(r.id);
  }
  // Then anything we added that they've never seen.
  for (const r of ours) {
    if (!taken.has(r.id) && !yours.has(r.id)) result.push(r);
  }
  return result;
}

/* Sync status + manual controls. Lives in the header so it's on every
   page: a dot for save state, "Save" to push pending edits immediately,
   and "Sync" to pull the latest. Turns into a prompt when another
   session has moved ahead and this tab has unsaved work. */
function SyncBar({ state, remoteAhead, lastSyncedAt, onSave, onSync, compact, saveError }) {
  const failed = state === "error";
  const label = failed ? "NOT SAVED" : state === "saving" ? "Saving…" : state === "synced" ? "Saved"
    : remoteAhead ? "Out of date" : "Up to date";
  const dot = failed ? C.redwood : state === "saving" ? C.gold : remoteAhead ? C.warn : C.moss;
  const ago = lastSyncedAt ? Math.round((Date.now() - lastSyncedAt) / 1000) : null;
  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <span
          className="flex items-center gap-1.5"
          style={{ fontFamily: MONO, fontSize: 11, fontWeight: failed ? 700 : 400,
                   color: failed ? "#fff" : remoteAhead ? C.warn : "rgba(255,255,255,0.65)",
                   background: failed ? C.redwood : "transparent",
                   padding: failed ? "2px 6px" : 0, borderRadius: 3 }}
          title={failed ? `Save failed: ${saveError || "unknown error"}` : ago != null ? `Last synced ${ago}s ago` : ""}
        >
          <span style={{ width: 7, height: 7, borderRadius: 99, background: dot, display: "inline-block" }} />
          {/* On a phone the dot carries the state and the words are what
              push this row off the screen, so they wait for a wider one. */}
          <span className="hidden sm:inline">{label}</span>
        </span>
      )}
      <button
        onClick={onSave} title="Save now"
        className="flex items-center gap-1 px-2 py-1 rounded-sm hover:opacity-80"
        style={{ fontFamily: MONO, fontSize: 11, color: "#fff", border: "1px solid #4a423a" }}
      >
        <Check size={12} /> Save
      </button>
      <button
        onClick={onSync} title="Pull the latest data from the other devices"
        className="flex items-center gap-1 px-2 py-1 rounded-sm hover:opacity-80"
        style={{
          fontFamily: MONO, fontSize: 11,
          color: remoteAhead ? "#fff" : "#fff",
          background: remoteAhead ? C.warn : "transparent",
          border: `1px solid ${remoteAhead ? C.warn : "#4a423a"}`,
        }}
      >
        <RefreshCw size={12} /> Sync
      </button>
    </div>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  // Which tab you're on survives a reload — phones reclaim a backgrounded
  // tab often enough that "closed it for a bit, came back" was silently
  // dumping people back at the dashboard mid-batch. Draft data (the timer,
  // what's typed into the log form) already survived that in localStorage;
  // this makes the screen itself come back too, not just the data behind it.
  const [tab, _setTab] = useState(() => {
    try { return localStorage.getItem("gnws-nav-tab") || "dashboard"; } catch { return "dashboard"; }
  });
  const setTab = (next) => {
    _setTab(next);
    try { localStorage.setItem("gnws-nav-tab", next); } catch { /* private browsing or full quota */ }
  };
  const [customers, _setCustomers] = useState(SEED_CUSTOMERS);
  const [products, _setProducts] = useState(SEED_PRODUCTS);
  const [workOrders, _setWorkOrders] = useState([]);
  const [sortLog, _setSortLog] = useState([]);
  const [team, _setTeam] = useState(SEED_TEAM);
  const [suppliers, _setSuppliers] = useState(SEED_VENDORS);
  const [purchaseOrders, _setPurchaseOrders] = useState([]);
  const [units, _setUnits] = useState([]);
  const [shifts, _setShifts] = useState([]);
  const [schedule, _setSchedule] = useState([]);
  const [invLog, _setInvLog] = useState([]);
  const [goals, setGoals] = useState({ boardsPerHour: 100 });
  // Office's records, loaded only so work order edits can carry up to them.
  // Kept out of undo: undoing a work order edit here doesn't reach into Office.
  const [quotes, setQuotes] = useState([]);
  const [salesOrders, setSalesOrders] = useState([]);

  // --- Undo/redo history --------------------------------------------
  // Every meaningful action touches one or more of the 8 arrays above.
  // We snapshot all of them together before each change so undo always
  // restores a fully consistent state, never just one array out of sync
  // with the others. Two things keep this usable rather than annoying:
  //  1. Rapid-fire changes (typing into a field) are debounced into a
  //     single checkpoint instead of one step per keystroke.
  //  2. Actions that touch multiple arrays at once (e.g. logging a sort
  //     batch adjusts products, units, AND the sort log) are wrapped in
  //     runGrouped() so they undo together as one step, not three.
  const HISTORY_LIMIT = 60;
  const HISTORY_DEBOUNCE_MS = 800;
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const skipHistoryRef = useRef(false);
  const lastPushRef = useRef(0);
  const latestRef = useRef(null);
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });

  useEffect(() => {
    latestRef.current = { customers, products, workOrders, sortLog, team, suppliers, purchaseOrders, units, shifts, invLog, schedule };
  });

  const refreshHistoryCounts = () => setHistoryCounts({ undo: historyRef.current.length, redo: futureRef.current.length });

  const pushHistory = () => {
    if (skipHistoryRef.current || !latestRef.current || !loaded) return;
    const now = Date.now();
    if (now - lastPushRef.current < HISTORY_DEBOUNCE_MS) return;
    lastPushRef.current = now;
    historyRef.current.push(latestRef.current);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    futureRef.current = [];
    refreshHistoryCounts();
  };

  const runGrouped = (fn) => {
    pushHistory();
    skipHistoryRef.current = true;
    try { fn(); } finally { skipHistoryRef.current = false; }
  };

  const applySnapshot = (snap, via) => {
    skipHistoryRef.current = true;
    _setCustomers(snap.customers);
    _setProducts(snap.products);
    // An undo changes orders too, and says so in their history.
    logWorkOrderChanges(workOrdersRef.current, snap.workOrders, via);
    workOrdersRef.current = snap.workOrders;
    _setWorkOrders(snap.workOrders);
    _setSortLog(snap.sortLog);
    _setTeam(snap.team);
    _setSuppliers(snap.suppliers);
    _setPurchaseOrders(snap.purchaseOrders);
    _setUnits(snap.units);
    _setShifts(snap.shifts || []);
    _setInvLog(snap.invLog || []);
    _setSchedule(snap.schedule || []);
    skipHistoryRef.current = false;
  };

  const undo = () => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    futureRef.current.push(latestRef.current);
    if (futureRef.current.length > HISTORY_LIMIT) futureRef.current.shift();
    lastPushRef.current = 0; // next edit after an undo always gets its own checkpoint
    applySnapshot(prev, "undo");
    refreshHistoryCounts();
  };
  const redo = () => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop();
    historyRef.current.push(latestRef.current);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    lastPushRef.current = 0;
    applySnapshot(next, "redo");
    refreshHistoryCounts();
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const setCustomers = (v) => { pushHistory(); _setCustomers(v); };
  const setProducts = (v) => { pushHistory(); _setProducts(v); };

  /* Writes products AND records what moved. Every path that changes stock
     goes through this so an item's history is complete — a count, a sort
     batch, a receipt and a hand edit all leave the same kind of trail.
     Only real on-hand changes are recorded; renaming a SKU doesn't. */
  const setProductsLogged = (rawNext, { reason = "edit", note = "", by = "", sessionId = "" } = {}) => {
    const before = new Map((latestRef.current?.products || products).map((p) => [p.id, p]));
    // A SKU can't hold less than nothing. When sorting runs a count into the
    // ground the work log is the true record and the count was the error, so
    // the stock floors at zero and the shortfall is remembered on the item
    // rather than silently swallowed — the dashboards surface it in red.
    const next = clampProducts(rawNext, before);
    const adjustments = [];
    next.forEach((p) => {
      const prev = before.get(p.id);
      if (!prev) return;
      // Rework and waste move for their own reasons and are worth their own
      // history rows — otherwise "where did 300 boards go" has no answer.
      CONDITIONS.forEach((c) => {
        const from = Number(prev[c.key]) || 0;
        const to = Number(p[c.key]) || 0;
        if (from === to) return;
        adjustments.push(makeAdjustment({
          productId: p.id, from, to, reason, by, sessionId,
          note: [c.key === "onHand" ? "" : c.label, note].filter(Boolean).join(" · "),
        }));
      });
    });
    if (adjustments.length) {
      runGrouped(() => {
        _setProducts(next);
        _setInvLog([...adjustments, ...(latestRef.current?.invLog || invLog)]);
      });
    } else {
      setProducts(next);
    }
  };
  // Every change to an order is compared with what it was a moment ago
  // and written to that order's history (see diffWorkOrders).
  const setWorkOrders = (v) => {
    pushHistory();
    const next = typeof v === "function" ? v(workOrdersRef.current) : v;
    logWorkOrderChanges(workOrdersRef.current, next);
    workOrdersRef.current = next;
    _setWorkOrders(next);
  };
  const setSortLog = (v) => { pushHistory(); _setSortLog(v); };
  const setTeam = (v) => { pushHistory(); _setTeam(v); };
  const setSuppliers = (v) => { pushHistory(); _setSuppliers(v); };
  const setPurchaseOrders = (v) => { pushHistory(); _setPurchaseOrders(v); };
  const setUnits = (v) => { pushHistory(); _setUnits(v); };
  const setShifts = (v) => { pushHistory(); _setShifts(v); };
  const setInvLog = (v) => { pushHistory(); _setInvLog(v); };
  const setSchedule = (v) => { pushHistory(); _setSchedule(v); };

  // Work order history (see describeWOChanges). Its own collection, and
  // deliberately not part of undo snapshots: undoing a change is itself
  // something that happened, and gets its own line.
  const [woHistory, _setWoHistory] = useState([]);
  const woHistoryRef = useRef(woHistory);
  woHistoryRef.current = woHistory;
  const [deviceUser, _setDeviceUser] = useState(readDeviceUser);
  const setDeviceUser = (name) => { writeDeviceUser(name); _setDeviceUser(name); };
  const deviceUserRef = useRef(deviceUser);
  deviceUserRef.current = deviceUser;
  // The list as of the last change, so two changes before the screen
  // redraws still each compare against the right "before".
  const workOrdersRef = useRef(workOrders);
  workOrdersRef.current = workOrders;
  const addWOHistory = (entries) => {
    if (!entries.length) return;
    const next = foldHistory(woHistoryRef.current, entries);
    woHistoryRef.current = next;
    _setWoHistory(next);
  };
  const logWorkOrderChanges = (prev, next, via) =>
    addWOHistory(diffWorkOrders(prev, next, { customers, products, statusLabel: STATUS_LABEL }, deviceUserRef.current, via));
  // Things that happen to an order without changing it: printing, starting work.
  const logWOEvent = (woId, label) => {
    const wo = workOrdersRef.current.find((w) => w.id === woId);
    if (wo) addWOHistory([makeHistoryEntry(wo, { field: "event", label }, deviceUserRef.current)]);
  };

  // Customer updates waiting to be sent (see pendingCustomerUpdates).
  const customerUpdates = useMemo(() => pendingCustomerUpdates(workOrders, woHistory, STATUS_LABEL), [workOrders, woHistory]);
  const handleCustomerUpdate = (u, how, brandKey) => {
    const label = how === "sent"
      ? `Opened an email to the customer: ${updWhat(u)} (as ${BRANDS[brandKey]?.label || BRANDS.ethica.label})`
      : `Skipped the customer update: ${updWhat(u)}`;
    addWOHistory([{ ...makeHistoryEntry(u.wo, { field: "customerUpdate", label }, deviceUserRef.current), update: u.kind }]);
  };

  const [whoWorking, setWhoWorking] = useState("");
  const [activeWOId, setActiveWOId] = useState(null);
  const [activeProductId, setActiveProductId] = useState(null);
  const [jumpToUnitId, setJumpToUnitId] = useState(null);
  const [jumpToWorkStep, setJumpToWorkStep] = useState(null);
  // Jobs still to come in a linear run started from a work order — sort,
  // then chop, then rip, all picked at once. The current job isn't in
  // here; it's whatever's already seeded into the active step's draft.
  const [workQueue, setWorkQueue] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [exitHint, setExitHint] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const saveTimers = useRef({});
  // Baseline per key: what this tab last saw in storage. Used to tell our
  // own edits apart from another tab's when merging at save time.
  const baselineRef = useRef({});

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const u = params.get("unit");
      if (u) { setJumpToUnitId(u); setTab("work"); }
    } catch (e) { /* no-op if URL access is unavailable */ }
  }, []);

  // Seeds the exact same localStorage draft the Work tab's log form reads
  // on mount (see useDraft) — crew, work order, and starting guesses at
  // what's coming in and what it turns into. The form itself doesn't know
  // or care this came from a work order rather than someone filling it in
  // by hand; it's the same draft either way.
  const seedDraftFor = ({ step, crew, workOrderId, seedInboundId, seedOutboundId }) => {
    try {
      const draftKey = step === "sorting" ? "gnws-draft-sorting" : `gnws-draft-${step}`;
      const existing = JSON.parse(localStorage.getItem(draftKey) || "null") || {};
      const patch = { ...existing, workOrderId, crew };
      if (step === "sorting") {
        if (seedInboundId) patch.rawProductId = seedInboundId;
      } else {
        if (seedInboundId) patch.inboundProductId = seedInboundId;
        if (seedOutboundId) patch.outboundProductId = seedOutboundId;
      }
      localStorage.setItem(draftKey, JSON.stringify(patch));
    } catch (e) { /* private browsing or a full quota — the flow still works, just unseeded */ }
  };

  // jobs is the whole queue for a linear run — seed and jump to the
  // first, hold the rest for advanceQueue to work through as each one
  // gets logged.
  const startWork = (jobs) => {
    if (!jobs.length) return;
    const [first, ...rest] = jobs;
    if (first.workOrderId) {
      const steps = jobs.map((j) => PROCESS_STEPS.find((s) => s.id === j.step)?.label || j.step).join(", ");
      logWOEvent(first.workOrderId, `Started working: ${steps} (${first.crew.join(" + ")})`);
    }
    seedDraftFor(first);
    setWhoWorking(first.crew[0] || "");
    setJumpToWorkStep({ step: first.step, nonce: Math.random() });
    setWorkQueue(rest);
    goTab("work");
  };

  // Fired by the log form right after a batch is submitted. If there's
  // more queued from a linear run, seed the next one and jump — the crew
  // never sees "What are you working on?" again until the whole run is
  // logged.
  const advanceQueue = () => {
    setWorkQueue((queue) => {
      if (!queue.length) return queue;
      const [next, ...rest] = queue;
      seedDraftFor(next);
      setJumpToWorkStep({ step: next.step, nonce: Math.random() });
      return rest;
    });
  };

  /* ---- Storage sync ------------------------------------------------
     Collections are pulled and pushed through one table, so a tab that
     has been sitting open all day shows whatever it loaded that morning.
     Saving merges (see mergeCollections) so nothing is lost, but the
     screen can still be out of date, which is its own hazard on a shop
     floor. So this tab watches for changes from other sessions and says
     so, and you can pull or push on demand from the header. ---------- */

  // One list drives loading, syncing and saving, so a collection can't be
  // wired into one and forgotten in another.
  const COLLECTIONS = [
    { key: KEY.customers, set: _setCustomers, get: () => customers, arr: true },
    { key: KEY.products, set: _setProducts, get: () => products, arr: true },
    { key: KEY.workOrders, set: _setWorkOrders, get: () => workOrders, arr: true },
    { key: KEY.sortLog, set: _setSortLog, get: () => sortLog, arr: true },
    { key: KEY.team, set: _setTeam, get: () => team, arr: true },
    { key: KEY.suppliers, set: _setSuppliers, get: () => suppliers, arr: true },
    { key: KEY.purchaseOrders, set: _setPurchaseOrders, get: () => purchaseOrders, arr: true },
    { key: KEY.units, set: _setUnits, get: () => units, arr: true },
    { key: KEY.timeLog, set: _setShifts, get: () => shifts, arr: true },
    { key: KEY.invLog, set: _setInvLog, get: () => invLog, arr: true },
    { key: KEY.woHistory, set: _setWoHistory, get: () => woHistory, arr: true },
    { key: KEY.schedule, set: _setSchedule, get: () => schedule, arr: true },
    { key: KEY.quotes, set: setQuotes, get: () => quotes, arr: true },
    { key: KEY.salesOrders, set: setSalesOrders, get: () => salesOrders, arr: true },
    { key: KEY.goals, set: (d) => setGoals(d && !Array.isArray(d) ? d : { boardsPerHour: 100 }), get: () => goals, arr: false },
  ];
  const collectionsRef = useRef(COLLECTIONS);
  collectionsRef.current = COLLECTIONS;

  const [syncState, setSyncState] = useState("idle"); // idle | saving | synced
  const [remoteAhead, setRemoteAhead] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const pendingRef = useRef({});
  const loadedRef = useRef(false);

  const readKey = async (key) => {
    try {
      const res = await window.storage.get(key, true);
      return res && res.value ? JSON.parse(res.value) : null;
    } catch (e) { return null; }
  };

  // One storage conversation per key at a time. A sync's read landing in
  // the middle of a save for the same key can come back with the copy from
  // just before the save, and putting that on screen quietly undoes the
  // edit that was being saved.
  const keyLocksRef = useRef({});
  const withKeyLock = (key, fn) => {
    const run = (keyLocksRef.current[key] || Promise.resolve()).then(fn);
    keyLocksRef.current[key] = run.catch(() => {});
    return run;
  };

  // Values that came straight from storage, so the save effect knows not
  // to queue them right back up as if someone had edited them. Used once
  // and cleared: an undo can later put the very same value back on screen,
  // and that one does need saving.
  const fromStorageRef = useRef({});

  // Put a newer copy from storage on screen without losing anything typed,
  // dragged or clicked while it was on its way. If nothing local is queued
  // for this key, storage's copy simply wins. If something is, it gets
  // merged on top of storage's copy and stays queued, now based on that
  // copy, so the eventual save merges against the right starting point
  // (see the note on writeKey).
  const applyFromStorage = (key, theirs) => {
    const c = collectionsRef.current.find((x) => x.key === key);
    if (!c) return;
    if (c.arr && !Array.isArray(theirs)) return;
    const entry = pendingRef.current[key];
    const seen = c.get();
    let next = theirs;
    if (entry) {
      // Goals is one object, not a list; the local edit is the newer one.
      next = c.arr ? mergeCollections(entry.base, entry.value, theirs) : entry.value;
      if (next !== entry.value) pendingRef.current[key] = { value: next, base: theirs };
    }
    baselineRef.current[key] = theirs;
    if (next === seen) return;
    if (!entry) fromStorageRef.current[key] = theirs;
    // A change can still be on its way to the screen when this runs (set,
    // but not drawn yet). If what's there isn't what we looked at, fold
    // that change in too rather than painting over it; it gets saved
    // like any other edit, against storage's copy.
    c.set((prev) => (prev === seen ? next : c.arr ? mergeCollections(seen, prev, next) : prev));
  };

  // Pull everything down, replacing what's on screen. Safe to call any
  // time: pending edits are flushed first, and anything edited while the
  // pull is still coming in is merged in rather than overwritten.
  const syncNow = async ({ silent = false } = {}) => {
    if (!silent) setSyncState("saving");
    await flushSaves();
    // All at once rather than one after another, so the stretch where the
    // screen is being refreshed is a single round trip, not eleven.
    await Promise.all(collectionsRef.current.map((c) => withKeyLock(c.key, async () => {
      const d = await readKey(c.key);
      if (d != null) applyFromStorage(c.key, d);
    })));
    setRemoteAhead(false);
    setLastSyncedAt(Date.now());
    if (!silent) { setSyncState("synced"); setTimeout(() => setSyncState("idle"), 1200); }
  };

  // `base` is the version the value being written was derived from. It must
  // be passed in rather than read at write time: a save queued before a
  // sync would otherwise merge against the *post*-sync baseline, and every
  // row the sync pulled in would look like something we had deleted — and
  // get dropped. That silently ate five SKUs before it was caught.
  const writeKey = (key, entry) => withKeyLock(key, async () => {
    const { value, base } = entry;
    let toWrite = value;
    if (Array.isArray(value)) {
      const remote = await readKey(key);
      if (Array.isArray(remote)) {
        const merged = mergeCollections(base, value, remote);
        if (JSON.stringify(merged) !== JSON.stringify(value)) {
          console.info("[merge] %s: reconciled with a change from another session", key);
        }
        toWrite = merged;
      }
    }
    await window.storage.set(key, JSON.stringify(toWrite), true);
    // Only clear if nothing newer queued while this write was in
    // flight — otherwise a keystroke mid-await gets silently dropped
    // instead of waiting for its own turn.
    if (pendingRef.current[key] === entry) delete pendingRef.current[key];
    if (toWrite === value) {
      baselineRef.current[key] = toWrite;
    } else if (JSON.stringify(toWrite) !== JSON.stringify(value)) {
      // The merge pulled in another session's rows. Get them on screen
      // now: if the screen kept the unmerged list while the baseline
      // held the merged one, those rows would look like something we'd
      // deleted, and the next save would delete them for real.
      applyFromStorage(key, toWrite);
    } else {
      baselineRef.current[key] = toWrite;
    }
    return toWrite;
  });

  // Write anything still waiting on its debounce, right now.
  const flushSaves = async () => {
    const keys = Object.keys(pendingRef.current);
    if (!keys.length) return;
    setSyncState("saving");
    for (const key of keys) {
      if (saveTimers.current[key]) { clearTimeout(saveTimers.current[key]); delete saveTimers.current[key]; }
      const entry = pendingRef.current[key];
      if (!entry) continue; // already flushed by something else mid-loop
      try {
        // writeKey only clears it if nothing newer was queued meanwhile.
        await writeKey(key, entry);
      } catch (e) {
        // Leave it pending so the next save or flush retries it, and say so
        // out loud — a silent failure here is how a day's work disappears.
        console.error("Save failed for", key, e);
        setSaveError(e?.message || String(e));
        setSyncState("error");
        return;
      }
    }
    setSaveError(null);
    setSyncState("synced");
    setTimeout(() => setSyncState((v) => (v === "synced" ? "idle" : v)), 1200);
  };

  useEffect(() => {
    (async () => {
      for (const c of collectionsRef.current) {
        const d = await readKey(c.key);
        if (d == null) continue;
        baselineRef.current[c.key] = d;
        if (c.arr) { if (Array.isArray(d) && d.length) c.set(d); }
        else c.set(d);
      }
      setLastSyncedAt(Date.now());
      loadedRef.current = true;
      setLoaded(true);
    })();
  }, []);

  const saveKey = (key, value) => {
    // Just pulled from storage (a sync, or a save that merged in another
    // session's rows): storage already has it, and queuing it would only
    // hand the next edit a stale copy to fight with.
    const fromStorage = fromStorageRef.current[key];
    delete fromStorageRef.current[key];
    if (value === fromStorage) return;
    // Capture the baseline now, while it still matches the value.
    const entry = { value, base: pendingRef.current[key]?.base ?? baselineRef.current[key] };
    pendingRef.current[key] = entry;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      delete saveTimers.current[key];
      // A concurrent flushSaves (tab hidden, another save mid-flight) may
      // have already written and cleared this — nothing left to do.
      if (!pendingRef.current[key]) return;
      setSyncState("saving");
      try {
        await writeKey(key, entry);
      } catch (e) {
        console.error("Save failed for", key, e);
        setSaveError(e?.message || String(e));
        setSyncState("error");
        return;
      }
      setSaveError(null);
      setSyncState("synced");
      setTimeout(() => setSyncState((x) => (x === "synced" ? "idle" : x)), 1200);
    }, 500);
  };

  // Poll for other sessions' writes. If nothing local is pending we just
  // pull them in; if the user has unsaved edits we flag it and let them
  // choose, rather than yanking the screen out from under them.
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(async () => {
      if (document.hidden) return;
      const busy = Object.keys(pendingRef.current).length > 0;
      let ahead = false;
      for (const c of collectionsRef.current) {
        const d = await readKey(c.key);
        if (d == null) continue;
        if (JSON.stringify(d) !== JSON.stringify(baselineRef.current[c.key])) { ahead = true; break; }
      }
      if (!ahead) { setRemoteAhead(false); return; }
      if (busy) setRemoteAhead(true);
      else await syncNow({ silent: true });
    }, 20000);
    return () => clearInterval(id);
  }, [loaded]);

  // Don't lose the last few hundred milliseconds of typing on a refresh.
  // Leaving: push anything still on its debounce so a refresh or an app
  // switch can't drop the last half-second of typing.
  // Coming back: pull straight away rather than waiting out the poll —
  // picking a phone back up after an hour is exactly when the screen is
  // most likely to be stale.
  useEffect(() => {
    const onHide = () => { if (Object.keys(pendingRef.current).length) flushSaves(); };
    const onVisibility = () => {
      if (document.hidden) onHide();
      else if (loadedRef.current) syncNow({ silent: true });
    };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => { if (loaded) saveKey(KEY.customers, customers); }, [customers, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.products, products); }, [products, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.workOrders, workOrders); }, [workOrders, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.sortLog, sortLog); }, [sortLog, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.team, team); }, [team, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.suppliers, suppliers); }, [suppliers, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.purchaseOrders, purchaseOrders); }, [purchaseOrders, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.units, units); }, [units, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.timeLog, shifts); }, [shifts, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.invLog, invLog); }, [invLog, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.woHistory, woHistory); }, [woHistory, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.schedule, schedule); }, [schedule, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.quotes, quotes); }, [quotes, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.salesOrders, salesOrders); }, [salesOrders, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.goals, goals); }, [goals, loaded]);

  const addTeamMember = (name) => { if (!team.includes(name)) setTeam([...team, name]); };
  const removeTeamMember = (name) => {
    setTeam(team.filter((t) => t !== name));
    if (whoWorking === name) setWhoWorking("");
  };

  // Editing or deleting a sort-log entry has to undo its original inventory
  // effect (raw boards consumed, sorted outputs added) before applying the
  // new one — otherwise counts drift every time someone fixes a typo.
  // original and updated can each independently be sort-shaped or
  // process-shaped now that the edit dialog can reassign an entry's task
  // — e.g. correcting a batch logged as Rip to actually have been Chop.
  // Reverse whichever shape the original was in, then apply whichever
  // shape the update is in; same math as before when they match, correct
  // when they don't.
  const isProcessShapedEntry = (e) => !!(e.inboundProductId || e.outboundProductId);
  const updateSortEntry = (original, updated) => {
    runGrouped(() => {
      setProducts((prev) => {
        const origRaw = isProcessShapedEntry(original) ? null : resolveRawProduct(original, prev);
        const newRaw = isProcessShapedEntry(updated) ? null : resolveRawProduct(updated, prev);
        return prev.map((p) => {
          let onHand = Number(p.onHand) || 0;
          if (isProcessShapedEntry(original)) {
            if (p.id === original.inboundProductId) onHand += Number(original.inboundBoards) || 0;
            if (p.id === original.outboundProductId) onHand -= Number(original.outboundBoards) || 0;
          } else {
            // Matching by groupId/role means this still works even if
            // SKUs got renamed since the entry was logged.
            const origN = original.toNProductId, origP = original.toPProductId;
            if (origRaw) {
              if (p.id === origRaw.id) onHand += Number(original.rawBoards) || 0;
              if (origN ? p.id === origN : (p.groupId === origRaw.groupId && p.role === "sortedN")) onHand -= Number(original.toN) || 0;
              if (origP ? p.id === origP : (p.groupId === origRaw.groupId && p.role === "sortedP")) onHand -= Number(original.toP) || 0;
            }
            if (p.role === "millStock") onHand -= Number(original.toMill) || 0;
          }
          if (isProcessShapedEntry(updated)) {
            if (p.id === updated.inboundProductId) onHand -= Number(updated.inboundBoards) || 0;
            if (p.id === updated.outboundProductId) onHand += Number(updated.outboundBoards) || 0;
          } else {
            const updN = updated.toNProductId, updP = updated.toPProductId;
            if (newRaw) {
              if (p.id === newRaw.id) onHand -= Number(updated.rawBoards) || 0;
              if (updN ? p.id === updN : (p.groupId === newRaw.groupId && p.role === "sortedN")) onHand += Number(updated.toN) || 0;
              if (updP ? p.id === updP : (p.groupId === newRaw.groupId && p.role === "sortedP")) onHand += Number(updated.toP) || 0;
            }
            if (p.role === "millStock") onHand += Number(updated.toMill) || 0;
          }
          return onHand === (Number(p.onHand) || 0) ? p : { ...p, onHand };
        });
      });
      setUnits((prev) => prev.map((u) => {
        let remaining = Number(u.boardsRemaining) || 0;
        if (u.id === original.unitId) remaining += Number(original.rawBoards) || 0;
        if (u.id === updated.unitId) remaining -= Number(updated.rawBoards) || 0;
        return remaining === (Number(u.boardsRemaining) || 0) ? u : { ...u, boardsRemaining: Math.max(0, remaining) };
      }));
      setSortLog((prev) => prev.map((s) => (s.id === original.id ? { ...updated, id: original.id } : s)));
    });
  };

  const deleteSortEntry = (entry) => {
    // The work log line leaves the order's history with the entry, so
    // the deletion itself is what stays on record.
    if (entry.workOrderId) logWOEvent(entry.workOrderId, `Deleted a work log: ${workLogText(entry)}`);
    runGrouped(() => {
      // A ship load is a tally across many SKUs at once, so it puts back
      // each line's own stock quantity. This has to come first: ship
      // entries carry no inbound/outbound product id, and would otherwise
      // fall through to the Sort path and be reversed as if they were a
      // raw-size split.
      if (entry.tallies?.length) {
        const back = {};
        entry.tallies.forEach((t) => { back[t.productId] = (back[t.productId] || 0) + (Number(t.stockQty) || 0); });
        setProducts((prev) => prev.map((p) => (back[p.id] ? { ...p, onHand: (Number(p.onHand) || 0) + back[p.id] } : p)));
        setSortLog((prev) => prev.filter((s) => s.id !== entry.id));
        return;
      }
      // Generalized process-log entries (ProcessLogTab) reference exact
      // product ids directly — no groupId indirection needed, unlike the
      // Sort-specific path below which resolves by raw-size family.
      if (entry.inboundProductId || entry.outboundProductId) {
        setProducts((prev) => prev.map((p) => {
          if (p.id === entry.inboundProductId) return { ...p, onHand: (Number(p.onHand) || 0) + (Number(entry.inboundBoards) || 0) };
          if (p.id === entry.outboundProductId) return { ...p, onHand: (Number(p.onHand) || 0) - (Number(entry.outboundBoards) || 0) };
          return p;
        }));
        setSortLog((prev) => prev.filter((s) => s.id !== entry.id));
        return;
      }
      setProducts((prev) => {
        const raw = resolveRawProduct(entry, prev);
        // Newer Sort entries record exactly which SKUs the boards went to.
        // Older ones don't, so fall back to resolving by size family.
        const nId = entry.toNProductId || prev.find((p) => raw && p.groupId === raw.groupId && p.role === "sortedN")?.id;
        const pId = entry.toPProductId || prev.find((p) => raw && p.groupId === raw.groupId && p.role === "sortedP")?.id;
        return prev.map((p) => {
          let onHand = Number(p.onHand) || 0;
          if (raw && p.id === raw.id) onHand += Number(entry.rawBoards) || 0;
          if (nId && p.id === nId) onHand -= Number(entry.toN) || 0;
          if (pId && p.id === pId) onHand -= Number(entry.toP) || 0;
          if (p.role === "millStock") onHand -= Number(entry.toMill) || 0;
          return onHand === (Number(p.onHand) || 0) ? p : { ...p, onHand };
        });
      });
      setUnits((prev) => prev.map((u) => (u.id === entry.unitId ? { ...u, boardsRemaining: Math.max(0, (Number(u.boardsRemaining) || 0) + (Number(entry.rawBoards) || 0)) } : u)));
      setSortLog((prev) => prev.filter((s) => s.id !== entry.id));
    });
  };

  const newWorkOrder = () => {
    const w = {
      id: uid(), number: nextNumber(workOrders, "WO"),
      customerId: "", customerName: "", status: "not_started", brand: DEFAULT_BRAND, date: today(),
      createdAt: new Date().toISOString(),
      lines: [], readyByDate: "", shipDate: "", shipVia: "", notes: "",
    };
    setWorkOrders([w, ...workOrders]);
    setActiveWOId(w.id);
    goTab("orders");
    setOrdersSubTab("workorders");
  };

  const updateWO = (w) => {
    const cust = customers.find((c) => c.id === w.customerId);
    const before = workOrders.find((x) => x.id === w.id);
    setWorkOrders(workOrders.map((x) => (x.id === w.id ? { ...w, customerName: cust?.company || "" } : x)));
    carryWorkOrderUp(before, w, { workOrders, salesOrders, setSalesOrders, setQuotes });
  };
  const deleteWO = (id) => {
    setWorkOrders(workOrders.filter((w) => w.id !== id));
    setActiveWOId(null);
  };
  const pushWOThrough = (id) => {
    setWorkOrders(workOrders.map((w) => (w.id === id ? { ...w, status: "shipped", shippedAt: w.shippedAt || new Date().toISOString() } : w)));
  };

  /* A shipped order stays on the board for a week, so the crew can still
     see what just went out and reopen it if something comes back. After
     that it takes itself off. Orders put back by hand carry keepOnBoard
     and are left alone. Orders from before we stamped a real ship time
     count from their planned ship date instead, so they age off too
     rather than sitting on the board for good. */
  const AUTO_ARCHIVE_DAYS = 7;
  useEffect(() => {
    if (!loaded) return;
    const shippedOn = (w) => {
      const stamped = Date.parse(w.shippedAt || "");
      if (Number.isFinite(stamped)) return stamped;
      const planned = Date.parse(w.shipDate ? `${w.shipDate}T12:00:00` : "");
      return Number.isFinite(planned) ? planned : NaN;
    };
    const sweep = () => {
      const cutoff = Date.now() - AUTO_ARCHIVE_DAYS * 86400000;
      const due = workOrdersRef.current.filter((w) =>
        w.status === "shipped" && !w.archived && !w.keepOnBoard && shippedOn(w) < cutoff);
      if (!due.length) return;
      const ids = new Set(due.map((w) => w.id));
      const next = workOrdersRef.current.map((w) => (ids.has(w.id) ? { ...w, archived: true } : w));
      workOrdersRef.current = next;
      _setWorkOrders(next);
      addWOHistory(due.map((w) => makeHistoryEntry(w, {
        field: "archived", label: `Archived automatically, a week after it shipped`,
      }, "")));
    };
    sweep();
    const t = setInterval(sweep, 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [loaded, workOrders]);

  /* Anyone on the floor can put themselves on a job for today. The name
     comes from the header picker, or from whoever is logging work. */
  const scheduleMe = (woId) => {
    const person = deviceUser || whoWorking;
    if (!person) { window.alert("Pick your name at the top of the screen first, then try again."); return; }
    setSchedule([{ id: uid(), person, date: today(), workOrderId: woId, hours: SHIFT_HOURS, note: "", at: new Date().toISOString() }, ...schedule]);
    logWOEvent(woId, `${person} put themselves on the schedule for today`);
  };

  const activeWO = workOrders.find((w) => w.id === activeWOId) || null;

  // Back out of an open work order or the invoice importer before anything else.
  useBackLayer(!!activeWO, () => setActiveWOId(null));
  useBackLayer(importOpen, () => setImportOpen(false));

  /* Which tabs have been visited, so Back returns to where you came from
     rather than a fixed home screen. Repeats collapse — bouncing between
     two tabs shouldn't build a stack you have to unwind press by press. */
  const tabStackRef = useRef([tab]);
  const TAB_IDS = ["dashboard", "work", "orders", "inventory", "contacts", "schedule", "time", "reports"];
  const goTab = (next) => {
    if (!next || next === tab || !TAB_IDS.includes(next)) return;
    const stack = tabStackRef.current;
    const seen = stack.indexOf(next);
    if (seen >= 0) stack.length = seen + 1; else stack.push(next);
    armBack();
    setTab(next);
  };

  // Innermost layer first, then the tab you came from, then out.
  const goBack = () => {
    if (backLayers.length) { backLayers[backLayers.length - 1].close(); return true; }
    const stack = tabStackRef.current;
    if (stack.length > 1) { stack.pop(); setTab(stack[stack.length - 1]); return true; }
    return false;
  };
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;

  const exitArmRef = useRef(0);
  useEffect(() => {
    armBack();
    const onPop = () => {
      backArmed = false; // the press just consumed our spare entry
      if (goBackRef.current()) { armBack(); return; }
      // Top of the app. A single press deliberately does NOT leave — that
      // is what made Back feel like it deleted the app mid-shift. Press it
      // again within a couple of seconds and we let go.
      const now = Date.now();
      if (now - exitArmRef.current < 2500) return; // second press: let it through
      exitArmRef.current = now;
      armBack();
      setExitHint(true);
      setTimeout(() => setExitHint(false), 2500);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const handleImported = ({ parsed, matchedCustomerId, fileName }) => {
    const cust = customers.find((c) => c.id === matchedCustomerId);
    const lines = (parsed.lines || []).map((l) => ({
      id: uid(), productId: "", desc: l.description || "",
      qtySF: (!l.unit || l.unit === "sf") ? (Number(l.quantity) || 0) : 0,
      displayUnit: "sf", done: false,
      note: l.unit && l.unit !== "sf" ? `${l.quantity} ${l.unit} on the invoice — double check against SF` : "",
    }));
    const unmatchedFlag = !matchedCustomerId && parsed.customerName
      ? `⚠ No matching customer found for "${parsed.customerName}" — assign one above.`
      : "";
    const baseNumber = nextNumber(workOrders, "WO");
    const suffix = productSuffix(lines, products);
    const w = {
      id: uid(), number: suffix ? `${baseNumber}-${suffix}` : baseNumber,
      customerId: matchedCustomerId || "", customerName: cust?.company || parsed.customerName || "",
      status: "not_started", date: today(), createdAt: new Date().toISOString(),
      lines, readyByDate: "", shipDate: parsed.shipDate || "", shipVia: "",
      notes: [parsed.notes, fileName ? `Imported from invoice: ${fileName}` : "Imported from pasted order text", unmatchedFlag].filter(Boolean).join("\n"),
    };
    setWorkOrders([w, ...workOrders]);
    setActiveWOId(w.id);
    goTab("orders");
    setOrdersSubTab("workorders");
    setImportOpen(false);
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", short: "Home", icon: LayoutGrid },
    { id: "work", label: "Work", short: "Work", icon: Scissors },
    { id: "orders", label: "Orders", short: "Orders", icon: ClipboardList },
    { id: "inventory", label: "Inventory", short: "Stock", icon: Boxes },
    { id: "contacts", label: "Contacts", short: "People", icon: Users },
    { id: "schedule", label: "Schedule", short: "Sched", icon: CalendarDays },
    { id: "time", label: "Time", short: "Time", icon: Clock },
    { id: "reports", label: "Reports", short: "Rates", icon: Timer },
  ];

  const [ordersSubTab, setOrdersSubTab] = useState("workorders");
  const [contactsSubTab, setContactsSubTab] = useState("customers");
  const [navMenuOpen, setNavMenuOpen] = useState(false);

  // Tab order is a personal display preference (which order YOU like to
  // see them in), not shared business data — so it lives in this browser's
  // localStorage rather than the shared Supabase store. Each device/person
  // can arrange it differently.
  const [tabOrderIds, setTabOrderIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("gnws-tab-order") || "null");
      return Array.isArray(saved) ? saved : tabs.map((t) => t.id);
    } catch (e) { return tabs.map((t) => t.id); }
  });
  useEffect(() => {
    try { localStorage.setItem("gnws-tab-order", JSON.stringify(tabOrderIds)); } catch (e) { /* no-op */ }
  }, [tabOrderIds]);

  const knownIds = new Set(tabOrderIds);
  const fullOrder = [...tabOrderIds, ...tabs.filter((t) => !knownIds.has(t.id)).map((t) => t.id)];
  const orderedTabs = fullOrder.map((id) => tabs.find((t) => t.id === id)).filter(Boolean);

  const [draggedTabId, setDraggedTabId] = useState(null);
  const reorderTabs = (targetId) => {
    if (!draggedTabId || draggedTabId === targetId) return;
    setTabOrderIds((prev) => {
      const order = prev.includes(draggedTabId) ? prev.slice() : [...prev, draggedTabId];
      const without = order.filter((id) => id !== draggedTabId);
      const targetIndex = without.indexOf(targetId);
      without.splice(targetIndex === -1 ? without.length : targetIndex, 0, draggedTabId);
      return without;
    });
  };
  const resetTabOrder = () => setTabOrderIds(tabs.map((t) => t.id));

  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper, fontFamily: MONO, color: C.faint }}>Loading shared data…</div>;
  }

  return (
    <div className="min-h-screen" style={{ background: C.paper, color: C.ink, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      <header style={{ background: C.ink, color: "#fff" }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <span style={{ fontWeight: 900, letterSpacing: "0.08em", fontSize: 16 }}>GNWS OPS</span>
          </div>
          {/* Wraps and shrinks rather than running off the side: on a
              phone these controls are wider than the screen, and the
              overflow turned into a screen of white you could scroll into. */}
          <div className="flex flex-wrap items-center justify-end gap-2 relative min-w-0">
            <CustomerUpdatesBadge count={customerUpdates.length} onClick={() => goTab("dashboard")} />
            <DeviceUserPicker team={team} value={deviceUser} onChange={setDeviceUser} />
            <SyncBar
              state={syncState} remoteAhead={remoteAhead} lastSyncedAt={lastSyncedAt}
              onSave={flushSaves} onSync={() => syncNow()}
            saveError={saveError}
            />
            <button onClick={() => setSettingsOpen(true)} title="Settings" className="p-1.5 rounded-sm hover:opacity-70" style={{ border: "1px solid #4a423a" }}>
              <Settings size={15} />
            </button>
            <button onClick={() => setNavMenuOpen(!navMenuOpen)} title="Menu" className="p-1.5 rounded-sm hover:opacity-70" style={{ border: "1px solid #4a423a" }}>
              <Menu size={15} />
            </button>
            {navMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setNavMenuOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-2 rounded-sm p-3 z-50"
                  style={{ background: C.ink, border: "1px solid #4a423a", minWidth: 220 }}
                >
                <div className="text-xs mb-1.5" style={{ color: C.kraftDark, fontFamily: MONO, letterSpacing: "0.08em" }}>UNDO / REDO</div>
                <div className="flex items-center gap-1 mb-3">
                  <button
                    onClick={undo} disabled={historyCounts.undo === 0} title={`Undo (${historyCounts.undo} available)`}
                    className="p-1.5 rounded-sm disabled:opacity-30 hover:opacity-70"
                    style={{ border: "1px solid #4a423a" }}
                  >
                    <RefreshCw size={13} style={{ transform: "scaleX(-1)" }} />
                  </button>
                  <button
                    onClick={redo} disabled={historyCounts.redo === 0} title={`Redo (${historyCounts.redo} available)`}
                    className="p-1.5 rounded-sm disabled:opacity-30 hover:opacity-70"
                    style={{ border: "1px solid #4a423a" }}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <span className="text-xs" style={{ color: C.kraftDark, fontFamily: MONO }}>{historyCounts.undo} / {historyCounts.redo}</span>
                </div>
                <div className="text-xs mb-1.5" style={{ color: C.kraftDark, fontFamily: MONO, letterSpacing: "0.08em" }}>WHO'S WORKING</div>
                <WhoSelect team={team} current={whoWorking} onChange={setWhoWorking} onAddMember={addTeamMember} onDark />
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid #4a423a" }}>
                  <a
                    href={OFFICE_URL} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-bold hover:opacity-70"
                    style={{ fontFamily: MONO, color: "#fff" }}
                  >
                    <ExternalLink size={13} /> GNWS Office
                  </a>
                </div>
                </div>
              </>
            )}
          </div>
        </div>
        {!(tab === "orders" && ordersSubTab === "workorders" && activeWO) && (
          <nav className="max-w-6xl mx-auto px-4 gap-1 overflow-x-auto hidden sm:flex">
            {orderedTabs.map((t) => (
              <button
                key={t.id}
                draggable
                onDragStart={() => setDraggedTabId(t.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); reorderTabs(t.id); setDraggedTabId(null); }}
                onDragEnd={() => setDraggedTabId(null)}
                onClick={() => { goTab(t.id); if (t.id === "orders" && ordersSubTab === "workorders") setActiveWOId(null); }}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold whitespace-nowrap cursor-grab active:cursor-grabbing"
                style={{
                  fontFamily: MONO, letterSpacing: "0.05em",
                  background: tab === t.id ? C.paper : "transparent",
                  color: tab === t.id ? C.ink : C.kraftDark,
                  borderRadius: "4px 4px 0 0",
                  opacity: draggedTabId === t.id ? 0.4 : 1,
                }}
              >
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {/* Phone navigation: a thumb-reachable bottom bar. The top tab strip
          is hidden under `sm`, where it would need horizontal scrolling to
          reach half the app. Tab order still comes from the same
          user-reorderable list. */}
      {!(tab === "orders" && ordersSubTab === "workorders" && activeWO) && (
        <nav
          className="sm:hidden fixed bottom-0 left-0 right-0 z-40 flex"
          style={{
            background: C.ink,
            borderTop: `1px solid #4a423a`,
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          {orderedTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { goTab(t.id); if (t.id === "orders" && ordersSubTab === "workorders") setActiveWOId(null); }}
              className="flex flex-col items-center justify-center gap-0.5"
              style={{
                flex: "1 1 0", minWidth: 0, padding: "9px 2px 8px",
                fontFamily: MONO, fontSize: 9, letterSpacing: 0,
                background: tab === t.id ? "#2a241d" : "transparent",
                color: tab === t.id ? "#fff" : C.kraftDark,
                borderTop: `2px solid ${tab === t.id ? C.redwood : "transparent"}`,
              }}
            >
              <t.icon size={19} />
              {t.short || t.label}
            </button>
          ))}
        </nav>
      )}

      <main className="max-w-6xl mx-auto px-4 py-5 pb-24 sm:pb-5">
        {tab === "dashboard" && (
          <Dashboard workOrders={workOrders} products={products} sortLog={sortLog} units={units}
            customerUpdates={customerUpdates} customers={customers} sender={deviceUser} onCustomerUpdate={handleCustomerUpdate} onOpenWO={(id) => { setActiveWOId(id); goTab("orders"); setOrdersSubTab("workorders"); }} goTab={goTab} whoWorking={whoWorking} />
        )}

        {tab === "orders" && !(ordersSubTab === "workorders" && activeWO) && (
          <div className="flex items-center gap-2 mb-4">
            {[["workorders", "Work Orders"], ["purchaseorders", "Purchase Orders"]].map(([id, label]) => (
              <button
                key={id} onClick={() => setOrdersSubTab(id)}
                className="px-3 py-1.5 rounded-sm text-xs"
                style={{ fontFamily: MONO, background: ordersSubTab === id ? C.ink : "transparent", color: ordersSubTab === id ? "#fff" : C.faint, border: `1px solid ${ordersSubTab === id ? C.ink : C.kraftDark}` }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {tab === "orders" && ordersSubTab === "workorders" && (
          activeWO ? (
            <WorkOrderDetail
              wo={activeWO} customers={customers} products={products} goals={goals} sortLog={sortLog}
              history={woHistory} onLog={(label) => logWOEvent(activeWO.id, label)}
              updates={customerUpdates.filter((u) => u.wo.id === activeWO.id)} sender={deviceUser} onCustomerUpdate={handleCustomerUpdate}
              onScheduleMe={scheduleMe}
              onChange={updateWO} onDelete={() => deleteWO(activeWO.id)} onBack={() => setActiveWOId(null)}
              team={team} whoWorking={whoWorking} setWhoWorking={setWhoWorking} onAddTeamMember={addTeamMember}
              onUpdateCustomerSpec={(customerId, patch) => setCustomers(customers.map((c) => (c.id === customerId ? { ...c, spec: { ...c.spec, ...patch } } : c)))}
              onStartWork={startWork}
            />
          ) : (
            <WorkOrderBoard workOrders={workOrders} customers={customers} products={products} goals={goals} onOpen={(id) => setActiveWOId(id)} onNew={newWorkOrder} onImport={() => setImportOpen(true)} onPushThrough={pushWOThrough}
              onMove={(id, status, orderedIds) => {
                // A move between columns shows up as a status change on
                // its own. A drag within one only reorders the cards, which
                // leaves no mark on the order worth describing, so say it.
                const card = workOrders.find((w) => w.id === id);
                if (card && (card.status || "not_started") === status && orderedIds.indexOf(id) !== card.rank) logWOEvent(id, "Moved on the board");
                setWorkOrders(workOrders.map((w) => {
                // Every card in the destination column gets its position,
                // so the order holds on every device, not just this one.
                const rank = orderedIds.indexOf(w.id);
                const moving = w.id === id && (w.status || "not_started") !== status;
                if (rank < 0 || (w.rank === rank && !moving)) return w;
                const next = { ...w, rank };
                if (moving) Object.assign(next, { status }, status === "shipped" ? { shippedAt: w.shippedAt || new Date().toISOString() } : { shippedAt: "" });
                return next;
              }));
              }}
              onToggleStar={(id) => setWorkOrders(workOrders.map((w) => (w.id === id ? { ...w, starred: !w.starred } : w)))} />
          )
        )}
        {tab === "orders" && ordersSubTab === "purchaseorders" && (
          <ReceivingTab
            suppliers={suppliers}
            purchaseOrders={purchaseOrders} onPOChange={setPurchaseOrders}
            units={units} onUnitsChange={setUnits}
            products={products} onProductsChange={(v) => setProductsLogged(v, { reason: "work", by: whoWorking })}
            runGrouped={runGrouped}
          />
        )}
        {exitHint && (
          <div
            className="fixed left-1/2 z-50 px-3 py-2 rounded-sm no-print"
            style={{ bottom: 90, transform: "translateX(-50%)", background: C.ink, color: "#fff", fontFamily: MONO, fontSize: 12, whiteSpace: "nowrap" }}
          >
            Press back again to leave
          </div>
        )}
        {importOpen && (
          <ImportInvoiceModal customers={customers} onClose={() => setImportOpen(false)} onImported={handleImported} />
        )}
        {settingsOpen && (
          <SettingsModal
            team={team} onAddTeamMember={addTeamMember} onRemoveTeamMember={removeTeamMember}
            goals={goals} onGoalsChange={setGoals}
            onResetTabOrder={resetTabOrder}
            onClose={() => setSettingsOpen(false)}
          />
        )}

        {tab === "work" && (
          <WorkTab
            products={products} onProductsChange={(v) => setProductsLogged(v, { reason: "work", by: whoWorking })}
            sortLog={sortLog} onLogSort={(s) => setSortLog([s, ...sortLog])}
            onUpdateSort={updateSortEntry} onDeleteSort={deleteSortEntry}
            team={team} whoWorking={whoWorking} setWhoWorking={setWhoWorking} onAddTeamMember={addTeamMember}
            workOrders={workOrders}
            units={units} onUnitsChange={setUnits}
            jumpToUnitId={jumpToUnitId}
            jumpToWorkStep={jumpToWorkStep}
            onJumpToWorkStepConsumed={() => setJumpToWorkStep(null)}
            onBatchLogged={advanceQueue}
            queuedSteps={workQueue.map((j) => j.step)}
            runGrouped={runGrouped}
            purchaseOrders={purchaseOrders}
          />
        )}

        {tab === "inventory" && (
          <InventoryTab
            products={products}
            onChange={(v, opts) => setProductsLogged(v, { by: whoWorking, ...opts })}
            invLog={invLog}
            activeId={activeProductId} setActiveId={setActiveProductId}
          />
        )}

        {tab === "contacts" && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              {[["customers", "Customers"], ["vendors", "Vendors"]].map(([id, label]) => (
                <button
                  key={id} onClick={() => setContactsSubTab(id)}
                  className="px-3 py-1.5 rounded-sm text-xs"
                  style={{ fontFamily: MONO, background: contactsSubTab === id ? C.ink : "transparent", color: contactsSubTab === id ? "#fff" : C.faint, border: `1px solid ${contactsSubTab === id ? C.ink : C.kraftDark}` }}
                >
                  {label}
                </button>
              ))}
            </div>
            {contactsSubTab === "customers" && <CustomersTab customers={customers} onChange={setCustomers} />}
            {contactsSubTab === "vendors" && <VendorsTab suppliers={suppliers} onChange={setSuppliers} />}
          </div>
        )}

        {tab === "schedule" && (
          <ScheduleTab
            schedule={schedule} onChange={setSchedule} team={team} workOrders={workOrders}
            me={deviceUser || whoWorking}
            onOpenWO={(id) => { setActiveWOId(id); goTab("orders"); setOrdersSubTab("workorders"); }}
          />
        )}
        {tab === "time" && (
          <TimeClockTab
            shifts={shifts} onChange={setShifts} team={team}
            whoWorking={whoWorking} setWhoWorking={setWhoWorking}
            onAddTeamMember={addTeamMember} runGrouped={runGrouped}
          />
        )}
        {tab === "reports" && (
          <ReportsTab
            sortLog={sortLog} shifts={shifts} products={products} units={units}
            purchaseOrders={purchaseOrders} suppliers={suppliers} workOrders={workOrders} team={team}
          />
        )}
      </main>
    </div>
  );
}
