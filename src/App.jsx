import React, { useState, useEffect, useMemo, useRef } from "react";
import jsQR from "jsqr";
import {
  Plus, Trash2, ChevronLeft, Users, Package, LayoutGrid, Scissors,
  Boxes, MapPin, AlertTriangle, Check, Clock, CircleDot, User,
  Ruler, Palette, StickyNote, ClipboardList, Truck, RefreshCw,
  Play, Pause, Square, Timer, CalendarDays, Tag, QrCode, Printer,
  FileText, X, Search, Pencil, Star, Settings, Menu
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
};

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
// Resolves which raw product a sort-log entry refers to. Prefers the
// stable rawProductId (immune to renaming the SKU later); falls back to
// the legacy rawSku text match only for entries logged before this field
// existed, so old history doesn't just vanish.
const resolveRawProduct = (entry, products) => {
  if (entry?.rawProductId) return products.find((p) => p.id === entry.rawProductId) || null;
  if (entry?.rawSku) return products.find((p) => p.sku === entry.rawSku) || null;
  return null;
};
const today = () => new Date().toISOString().slice(0, 10);
const num = (n, d = 0) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

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
  if (product.category === "packing") return [product.unitLabel || "ea"];
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
    ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.kraftDark}` },
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

const STATUS_FLOW = ["not_started", "sorting", "milling", "packed", "shipped"];
const STATUS_LABEL = {
  not_started: "Not Started", sorting: "Sorting", milling: "Milling", packed: "Packed", shipped: "Shipped",
};
const STATUS_COLOR = {
  not_started: C.faint, sorting: C.gold, milling: C.redwood, packed: C.moss, shipped: C.ink,
};

const fmtDuration = (seconds) => {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const hoursDecimal = (seconds) => (Number(seconds) || 0) / 3600;

function WhoSelect({ team, current, onChange, onAddMember }) {
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
          style={{ ...inputStyle, width: 140, padding: "4px 8px", fontSize: 13, background: "transparent", color: "#fff", borderColor: "#4a423a" }}
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

function Dashboard({ workOrders, products, sortLog, units, onOpenWO, goTab, goals, onGoalsChange }) {
  const active = workOrders.filter((w) => w.status !== "shipped");
  const byStatus = STATUS_FLOW.reduce((acc, s) => ({ ...acc, [s]: workOrders.filter((w) => w.status === s).length }), {});
  const needsReorder = products.filter((p) => Number(p.reorderPoint) > 0 && (Number(p.onHand) || 0) <= Number(p.reorderPoint));
  const todaysSorts = sortLog.filter((s) => s.date === today());
  const unclaimedUnits = (units || []).filter((u) => Number(u.boardsRemaining) > 0);

  // Throughput over the trailing 30 days — total boards sorted divided by
  // total logged hours. Only counts entries with an actual timer value;
  // entries logged with no time attached don't skew the rate.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recentTimed = sortLog.filter((s) => s.date >= cutoffStr && Number(s.seconds) > 0);
  const totalBoards30 = recentTimed.reduce((sum, s) => sum + (Number(s.rawBoards) || 0), 0);
  const totalSeconds30 = recentTimed.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0);
  const boardsPerHour = totalSeconds30 > 0 ? totalBoards30 / (totalSeconds30 / 3600) : 0;
  const goal = Number(goals?.boardsPerHour) || 0;
  const aboveGoal = totalSeconds30 > 0 && goal > 0 && boardsPerHour >= goal;
  const belowGoal = totalSeconds30 > 0 && goal > 0 && boardsPerHour < goal;

  // "A unit" is a pallet — 300 boards for 1x8 stock, 400 for 1x6, etc.
  // Sorted stock (185N, 185P) accumulates as boards come in off the sort
  // line; whatever doesn't divide evenly is the remainder still short of
  // a full pallet. This is a live read of onHand, not a separate count
  // anyone has to maintain.
  const unitProducts = products
    .filter((p) => p.kind === "board" && Number(p.boardsPerUnit) > 0)
    .map((p) => {
      const onHand = Number(p.onHand) || 0;
      const perUnit = Number(p.boardsPerUnit) || 1;
      return { ...p, units: Math.floor(onHand / perUnit), remainder: onHand % perUnit };
    });

  return (
    <div>
      <div className="rounded-sm p-4 mb-5" style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, borderLeft: `4px solid ${aboveGoal ? C.moss : belowGoal ? C.redwood : C.gold}` }}>
        <div className="flex items-center justify-between">
          <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em" }}>SORTING THROUGHPUT · LAST 30 DAYS</div>
          <div className="flex items-center gap-1 text-xs" style={{ color: C.faint, fontFamily: MONO }}>
            GOAL
            <input
              type="number" value={goals?.boardsPerHour ?? ""} placeholder="—"
              onChange={(e) => onGoalsChange({ ...goals, boardsPerHour: e.target.value })}
              style={{ width: 55, border: `1px solid ${C.kraftDark}`, borderRadius: 3, padding: "2px 4px", textAlign: "right", fontFamily: MONO }}
            />
            bd/hr
          </div>
        </div>
        {totalSeconds30 === 0 ? (
          <div className="text-sm mt-1" style={{ color: C.faint }}>No timed sorting batches logged in the last 30 days yet.</div>
        ) : (
          <div className="flex items-baseline gap-2 mt-1">
            <span style={{ fontSize: 28, fontWeight: 900, color: aboveGoal ? C.moss : belowGoal ? C.redwood : C.ink }}>{num(boardsPerHour, 1)}</span>
            <span style={{ fontSize: 13, color: C.faint }}>boards / man-hour (actual)</span>
            <span style={{ fontSize: 12, color: C.faint, marginLeft: 8 }}>({num(totalBoards30)} boards over {num(hoursDecimal(totalSeconds30), 1)}h logged)</span>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 mb-5">
        {unitProducts.map((p) => (
          <div key={p.id} className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, borderLeft: `4px solid ${C.moss}` }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em" }}>{p.sku} · UNITS READY</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span style={{ fontSize: 28, fontWeight: 900 }}>{p.units}</span>
              <span style={{ fontSize: 13, color: C.faint }}>full unit{p.units === 1 ? "" : "s"} ({p.boardsPerUnit}/unit)</span>
            </div>
            {p.remainder > 0 && (
              <div className="text-xs mt-1" style={{ color: C.faint }}>+ {num(p.remainder)} boards short of the next unit</div>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-5">
        {STATUS_FLOW.map((s) => (
          <button
            key={s}
            onClick={() => goTab("workorders")}
            className="rounded-sm p-4 text-left hover:shadow-md transition-shadow"
            style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, borderLeft: `4px solid ${STATUS_COLOR[s]}` }}
          >
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em" }}>{STATUS_LABEL[s].toUpperCase()}</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{byStatus[s]}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <div className="flex items-center justify-between mb-3">
            <div style={{ fontWeight: 800, fontSize: 15 }}>Active Work Orders</div>
            <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{active.length} open</span>
          </div>
          {active.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: C.faint }}>Nothing active right now.</div>
          ) : (
            <div className="space-y-2">
              {active.slice(0, 8).map((w) => (
                <button
                  key={w.id} onClick={() => onOpenWO(w.id)}
                  className="w-full text-left flex items-center justify-between px-3 py-2 rounded-sm hover:opacity-80"
                  style={{ background: C.paper, border: `1px solid ${C.kraft}` }}
                >
                  <div>
                    <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>{w.number}</div>
                    <div style={{ fontSize: 12, color: C.faint }}>{w.customerName || "No customer"}</div>
                  </div>
                  <span
                    className="px-2 py-0.5 rounded-sm text-xs font-bold"
                    style={{ background: STATUS_COLOR[w.status], color: "#fff", fontFamily: MONO }}
                  >
                    {STATUS_LABEL[w.status]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <div style={{ fontWeight: 800, fontSize: 15 }}>Reordering</div>
              {needsReorder.length > 0 && (
                <span className="px-2 py-0.5 rounded-sm text-xs font-bold" style={{ background: C.redwood, color: "#fff", fontFamily: MONO }}>
                  {needsReorder.length} SKU{needsReorder.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <button onClick={() => goTab("inventory")} style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>View all →</button>
          </div>
          {needsReorder.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: C.moss }}>Everything's above its reorder point.</div>
          ) : (
            <div className="space-y-2">
              {needsReorder.slice(0, 6).map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2 rounded-sm" style={{ background: "#FDF6F4", border: `1px solid ${C.redwood}22` }}>
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{p.sku}</div>
                    <div style={{ fontSize: 11, color: C.faint }}>{num(p.onHand)} on hand · reorder at {num(p.reorderPoint)}</div>
                  </div>
                  <div className="flex items-center gap-1" style={{ color: C.redwood, fontSize: 12, fontFamily: MONO }}>
                    <AlertTriangle size={12} /> Reorder
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
            <div className="flex items-center justify-between mb-1">
              <span style={{ fontFamily: MONO, fontSize: 10, color: C.faint, letterSpacing: "0.08em" }}>RECEIVED UNITS AWAITING SORT</span>
              <button onClick={() => goTab("receiving")} style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>View →</button>
            </div>
            {unclaimedUnits.length === 0 ? (
              <div className="text-sm" style={{ color: C.faint }}>Nothing waiting.</div>
            ) : (
              <div className="text-sm">{unclaimedUnits.length} unit{unclaimedUnits.length === 1 ? "" : "s"} on hand</div>
            )}
          </div>

          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
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
      </div>
    </div>
  );
}

function WorkOrderBoard({ workOrders, customers, onOpen, onNew, onImport }) {
  const [filter, setFilter] = useState("active");
  const shown = workOrders.filter((w) => (filter === "active" ? w.status !== "shipped" : true));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Btn kind="primary" onClick={onNew}><Plus size={14} /> New work order</Btn>
        <Btn onClick={onImport}><FileText size={14} /> Import invoice (PDF)</Btn>
        {[["active", "Active"], ["all", "All"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setFilter(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: filter === id ? C.ink : "transparent", color: filter === id ? "#fff" : C.faint, border: `1px solid ${filter === id ? C.ink : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-sm p-10 text-center" style={{ background: C.panel, border: `1px dashed ${C.kraftDark}` }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>No work orders</div>
          <div className="mt-1 mb-4 text-sm" style={{ color: C.faint }}>Create one to get the crew started.</div>
          <Btn kind="primary" onClick={onNew}><Plus size={14} /> New work order</Btn>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((w) => (
            <button
              key={w.id} onClick={() => onOpen(w.id)}
              className="text-left rounded-sm p-4 hover:shadow-md transition-shadow"
              style={{ background: C.panel, border: `1px solid ${C.kraftDark}`, borderLeft: `4px solid ${STATUS_COLOR[w.status]}` }}
            >
              <div className="flex justify-between items-start">
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14 }}>{w.number}</span>
                <span className="px-2 py-0.5 rounded-sm text-xs font-bold" style={{ background: STATUS_COLOR[w.status], color: "#fff", fontFamily: MONO }}>
                  {STATUS_LABEL[w.status]}
                </span>
              </div>
              <div className="mt-1 text-sm" style={{ color: C.faint }}>{w.customerName || "No customer"}</div>
              <div className="mt-2 text-xs" style={{ fontFamily: MONO, color: C.faint }}>{w.lines?.length || 0} line{(w.lines?.length || 0) === 1 ? "" : "s"} · {w.date}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkOrderDetail({ wo, customers, products, onChange, onDelete, onBack, team, whoWorking, setWhoWorking, onAddTeamMember }) {
  const customer = customers.find((c) => c.id === wo.customerId);
  const update = (patch) => onChange({ ...wo, ...patch });
  const [bolOpen, setBolOpen] = useState(false);

  const updateLine = (lineId, patch) => update({ lines: wo.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) });
  const removeLine = (lineId) => update({ lines: wo.lines.filter((l) => l.id !== lineId) });
  const addLine = () => update({
    lines: [...(wo.lines || []), {
      id: uid(), productId: "", desc: "",
      qtySF: "",
      displayUnit: "sf",
      done: false, note: "",
    }],
  });

  const advanceStatus = () => {
    const idx = STATUS_FLOW.indexOf(wo.status);
    if (idx < STATUS_FLOW.length - 1) update({ status: STATUS_FLOW[idx + 1] });
  };
  const revertStatus = () => {
    const idx = STATUS_FLOW.indexOf(wo.status);
    if (idx > 0) update({ status: STATUS_FLOW[idx - 1] });
  };

  const spec = customer?.spec || {};
  const hasSpec = spec.minSize || spec.maxSize || spec.paintTolerance || spec.knotTolerance || spec.notes;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <Btn onClick={onBack}><ChevronLeft size={14} /> All work orders</Btn>
      </div>

      <div className="rounded-sm p-5 mb-4" style={{ background: C.ink, color: "#fff" }}>
        <div className="flex justify-between items-start flex-wrap gap-2">
          <div>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 800 }}>{wo.number}</div>
            {customer ? (
              <button onClick={() => update({ customerId: "" })} className="mt-1 text-left" title="Click to change customer">
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
          </div>
          <span className="px-3 py-1 rounded-sm text-sm font-bold" style={{ background: STATUS_COLOR[wo.status], fontFamily: MONO }}>
            {STATUS_LABEL[wo.status]}
          </span>
        </div>

        {(customer?.address || customer?.city) ? (
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

        {customer?.flags ? (
          <div className="mt-2 text-sm" style={{ color: "#E8A87C", fontFamily: MONO }}>⚑ {customer.flags}</div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Btn kind="ghost" onClick={revertStatus} disabled={wo.status === STATUS_FLOW[0]}>
            <span style={{ color: "#fff" }}>← Back a step</span>
          </Btn>
          <Btn kind="moss" onClick={advanceStatus} disabled={wo.status === STATUS_FLOW[STATUS_FLOW.length - 1]} big>
            <Check size={16} /> Mark {STATUS_LABEL[STATUS_FLOW[Math.min(STATUS_FLOW.indexOf(wo.status) + 1, STATUS_FLOW.length - 1)]]}
          </Btn>
        </div>
      </div>

      {hasSpec && (
        <div className="rounded-sm p-4 mb-4" style={{ background: "#FBF6EC", border: `2px solid ${C.gold}` }}>
          <div className="flex items-center gap-2 mb-2">
            <ClipboardList size={16} style={{ color: C.gold }} />
            <div style={{ fontWeight: 800, fontSize: 15 }}>Customer Spec — check while sorting/milling</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2" style={{ fontSize: 14 }}>
            {spec.minSize && <div><Ruler size={13} className="inline mr-1" style={{ color: C.faint }} /><strong>Min size:</strong> {spec.minSize}</div>}
            {spec.maxSize && <div><Ruler size={13} className="inline mr-1" style={{ color: C.faint }} /><strong>Max size:</strong> {spec.maxSize}</div>}
            {spec.paintTolerance && <div><Palette size={13} className="inline mr-1" style={{ color: C.faint }} /><strong>Paint:</strong> {spec.paintTolerance}</div>}
            {spec.knotTolerance && <div><CircleDot size={13} className="inline mr-1" style={{ color: C.faint }} /><strong>Knots:</strong> {spec.knotTolerance}</div>}
          </div>
          {spec.notes && (
            <div className="mt-2 pt-2 flex items-start gap-1.5" style={{ borderTop: `1px solid ${C.gold}55`, fontSize: 13 }}>
              <StickyNote size={13} style={{ color: C.faint, marginTop: 2 }} />
              <span>{spec.notes}</span>
            </div>
          )}
          <div className="mt-2 text-xs italic" style={{ color: C.faint }}>
            Anything that doesn't meet this spec goes to Mill Stock or Waste — don't force it into this order.
          </div>
        </div>
      )}

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
                  value={line.productId} onChange={(e) => updateLine(line.id, { productId: e.target.value, displayUnit: "sf" })}
                >
                  <option value="">Custom / describe below…</option>
                  {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.sku} — {pr.name}</option>)}
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
                <input className="mt-2" style={inputStyle} placeholder="Note for this line" value={line.note || ""} onChange={(e) => updateLine(line.id, { note: e.target.value })} />
              </div>
              <button onClick={() => removeLine(line.id)} className="shrink-0 opacity-40 hover:opacity-100 mt-1"><Trash2 size={16} /></button>
            </div>
          );
        })}
        <div className="p-3">
          <Btn onClick={addLine}><Plus size={14} /> Add line</Btn>
        </div>
      </div>

      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex flex-wrap gap-3">
          <Field label="Ship date" w={160}><input type="date" style={inputStyle} value={wo.shipDate || ""} onChange={(e) => update({ shipDate: e.target.value })} /></Field>
          <Field label="Ship via" w={160}><input style={inputStyle} value={wo.shipVia || ""} onChange={(e) => update({ shipVia: e.target.value })} placeholder="Dry van, pickup…" /></Field>
        </div>
        <Field label="General notes">
          <textarea style={{ ...inputStyle, minHeight: 70, marginTop: 8 }} value={wo.notes || ""} onChange={(e) => update({ notes: e.target.value })} placeholder="Anything the crew needs to know…" />
        </Field>
      </div>

      <div className="flex gap-2 mb-8">
        <Btn kind="primary" onClick={() => setBolOpen(true)}><Printer size={14} /> Print Bill of Lading</Btn>
        <Btn onClick={onDelete}><Trash2 size={14} /> Delete work order</Btn>
      </div>
      {bolOpen && <BOLModal wo={wo} customer={customer} products={products} onClose={() => setBolOpen(false)} />}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-auto" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-4">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Settings</div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("Could not read that file"));
        r.readAsDataURL(file);
      });

      const prompt = `Extract structured data from this wholesale reclaimed-wood invoice or quote PDF. Respond with ONLY valid JSON, no markdown fences, no preamble, exactly this shape:
{
  "customerName": string,
  "contactName": string,
  "shipDate": string,
  "notes": string,
  "lines": [ { "description": string, "quantity": number, "unit": string } ]
}
"unit" should be "sf", "board", "plank", or "ea" — guess "sf" if it's unclear, since most line items here are priced per square foot. Use "" or [] for anything not present on the document. Do not include any dollar amounts anywhere in your output.`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: prompt },
            ],
          }],
        }),
      });
      const data = await response.json();
      const textBlock = (data.content || []).find((b) => b.type === "text");
      if (!textBlock) throw new Error("No readable response came back");
      const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);

      const nameKey = (parsed.customerName || "").toLowerCase().trim();
      const match = nameKey
        ? customers.find((c) => c.company && (c.company.toLowerCase().includes(nameKey) || nameKey.includes(c.company.toLowerCase())))
        : null;

      onImported({ parsed, matchedCustomerId: match?.id || "", fileName: file.name });
    } catch (e) {
      setError(`Couldn't read that file automatically, so nothing was created — you can still start a work order manually. (${e.message || "unknown error"})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-md" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Import invoice / quote (PDF)</div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>
        <p className="text-sm mb-3" style={{ color: C.faint }}>
          Upload the PDF from Good News Ops or QuickBooks. It'll try to pull the customer and line items into a new draft work order — review and fix it up before the crew works from it.
        </p>
        <input
          type="file" accept="application/pdf" disabled={busy}
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ fontSize: 13 }}
        />
        {busy && <div className="text-sm mt-3" style={{ color: C.faint }}>Reading the document…</div>}
        {error && <div className="text-sm mt-3" style={{ color: C.warn }}>{error}</div>}
      </div>
    </div>
  );
}

function CustomersTab({ customers, onChange }) {
  const [openId, setOpenId] = useState(null);
  const [sortBy, setSortBy] = useState("name");
  const update = (id, patch) => onChange(customers.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updateSpec = (id, patch) => onChange(customers.map((c) => (c.id === id ? { ...c, spec: { ...c.spec, ...patch } } : c)));
  const remove = (id) => onChange(customers.filter((c) => c.id !== id));
  const add = () => {
    const c = { id: uid(), company: "New customer", contact: "", address: "", city: "", state: "", zip: "", country: "USA", phone: "", email: "", flags: "", favorite: false, spec: { minSize: "", maxSize: "", paintTolerance: "", knotTolerance: "", notes: "" } };
    onChange([...customers, c]);
    setOpenId(c.id);
  };

  const shown = customers.slice().sort((a, b) => {
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
                    <Field label="Flags (shows on work orders)"><input style={{ ...inputStyle, color: C.warn }} value={c.flags} onChange={(e) => update(c.id, { flags: e.target.value })} /></Field>

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

function InventoryTab({ products, onChange }) {
  const [group, setGroup] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [openId, setOpenId] = useState(null);
  const update = (id, patch) => onChange(products.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id) => onChange(products.filter((p) => p.id !== id));
  const add = () => {
    const p = { id: uid(), sku: "NEW-SKU", name: "New item", kind: "each", category: "wood", unitLabel: "ea", onHand: 0 };
    onChange([...products, p]);
    setOpenId(p.id);
  };
  const [unitPrefs, setUnitPrefs] = useState({});
  const [reorderUnitPrefs, setReorderUnitPrefs] = useState({});

  const updateConversion = (pid, key, patch) => {
    const prod = products.find((p) => p.id === pid);
    const convs = (prod?.conversions || []).map((c) => (c.key === key ? { ...c, ...patch } : c));
    update(pid, { conversions: convs });
  };
  const addConversion = (pid) => {
    const prod = products.find((p) => p.id === pid);
    update(pid, { conversions: [...(prod?.conversions || []), { key: uid(), qtyA: "", unitA: "board", qtyB: "", unitB: "" }] });
  };
  const removeConversion = (pid, key) => {
    const prod = products.find((p) => p.id === pid);
    update(pid, { conversions: (prod?.conversions || []).filter((c) => c.key !== key) });
  };
  // Width × Length ÷ 144 = SF per board — one-directional: editing
  // dimensions recalculates SF/board, but editing SF/board directly
  // never touches the dimensions back.
  const updateDims = (pid, patch) => {
    const prod = products.find((p) => p.id === pid);
    const merged = { ...prod, ...patch };
    const w = Number(merged.widthIn) || 0;
    const l = Number(merged.lengthIn) || 0;
    const extra = w > 0 && l > 0 ? { sfPerBoard: Math.round(((w * l) / 144) * 1000) / 1000 } : {};
    update(pid, { ...patch, ...extra });
  };

  const canonicalUnitFor = (p) => (p.category === "paint" ? "gal" : p.category === "packing" ? (p.unitLabel || "ea") : (p.kind === "sf" ? "sf" : "board"));
  const sfEquivalent = (p) => (p.category === "packing" ? 0 : convertQty(p, p.onHand, canonicalUnitFor(p), "sf"));
  const needsReorder = (p) => Number(p.reorderPoint) > 0 && (Number(p.onHand) || 0) <= Number(p.reorderPoint);

  const filtered = products.filter((p) => group === "all" ? true : (p.category || "wood") === group);
  const shown = filtered.slice().sort((a, b) => {
    if (sortBy === "sf") return sfEquivalent(b) - sfEquivalent(a);
    return (a.name || a.sku || "").localeCompare(b.name || b.sku || "");
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Btn kind="primary" onClick={add}><Plus size={14} /> Add item</Btn>
        {[["all", "All"], ["wood", "Wood"], ["paint", "Paint"], ["packing", "Packing"]].map(([id, label]) => (
          <button
            key={id} onClick={() => setGroup(id)}
            className="px-3 py-1.5 rounded-sm text-xs"
            style={{ fontFamily: MONO, background: group === id ? C.ink : "transparent", color: group === id ? "#fff" : C.faint, border: `1px solid ${group === id ? C.ink : C.kraftDark}` }}
          >
            {label}
          </button>
        ))}
        <span className="text-xs" style={{ color: C.faint, fontFamily: MONO, marginLeft: 8 }}>SORT BY</span>
        {[["name", "Name"], ["sf", "Square Feet"]].map(([id, label]) => (
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
          <div className="px-4 py-8 text-center text-sm" style={{ color: C.faint }}>No items to show.</div>
        ) : (
          shown.map((p) => {
            const category = p.category || "wood";
            const canonicalUnit = canonicalUnitFor(p);
            const displayUnit = unitPrefs[p.id] || canonicalUnit;
            const sfEq = sfEquivalent(p);
            const open = openId === p.id;
            const reorderDisplayUnit = reorderUnitPrefs[p.id] || canonicalUnit;
            const flagged = needsReorder(p);

            return (
              <div key={p.id} style={{ borderBottom: `1px solid ${C.kraft}` }}>
                <div className="px-4 py-2.5 flex items-center gap-3">
                  <button onClick={() => setOpenId(open ? null : p.id)} className="text-left flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 14 }}>{p.sku}</span>
                      <span className="text-xs" style={{ color: C.faint }}>{p.name}</span>
                      <span className="text-xs px-1.5 rounded-sm" style={{ background: C.kraft, color: C.faint, fontFamily: MONO }}>{category}</span>
                      {flagged && (
                        <span className="text-xs flex items-center gap-1" style={{ color: C.redwood, fontFamily: MONO }}>
                          <AlertTriangle size={11} /> reorder
                        </span>
                      )}
                    </div>
                    {category !== "packing" && (
                      <div className="text-xs mt-0.5" style={{ color: C.faint, fontFamily: MONO }}>≈ {num(sfEq, 0)} SF on hand</div>
                    )}
                  </button>

                  {category === "packing" ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number" style={{ ...inputStyle, width: 80, textAlign: "right", fontFamily: MONO, color: Number(p.onHand) <= 0 ? C.redwood : C.ink, fontWeight: 700 }}
                        value={p.onHand ?? ""} onChange={(e) => update(p.id, { onHand: e.target.value })}
                      />
                      <input
                        style={{ ...inputStyle, width: 55, fontSize: 11, padding: "4px 6px" }}
                        value={p.unitLabel || ""} placeholder="ea"
                        onChange={(e) => update(p.id, { unitLabel: e.target.value })}
                      />
                    </div>
                  ) : (
                    <div className="shrink-0">
                      <UnitSwitchInput
                        product={p} value={p.onHand} canonicalUnit={canonicalUnit}
                        onChange={(v) => update(p.id, { onHand: v })}
                        displayUnit={displayUnit}
                        onDisplayUnitChange={(u) => setUnitPrefs({ ...unitPrefs, [p.id]: u })}
                        width={90}
                      />
                    </div>
                  )}
                  <button onClick={() => remove(p.id)} className="opacity-40 hover:opacity-100 shrink-0"><Trash2 size={14} /></button>
                </div>

                {open && (
                  <div className="px-4 pb-4 space-y-2" style={{ background: C.paper }}>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="SKU"><input style={{ ...inputStyle, fontFamily: MONO }} value={p.sku} onChange={(e) => update(p.id, { sku: e.target.value })} /></Field>
                      <Field label="Name"><input style={inputStyle} value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} /></Field>
                    </div>
                    <Field label="Category">
                      <select style={inputStyle} value={category} onChange={(e) => update(p.id, { category: e.target.value })}>
                        <option value="wood">Wood</option>
                        <option value="paint">Paint</option>
                        <option value="packing">Packing</option>
                      </select>
                    </Field>

                    {category === "wood" && (
                      <>
                        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.gold }}>Dimensions</div>
                          <div className="grid grid-cols-3 gap-2">
                            <Field label="Thickness (in)"><input type="number" style={inputStyle} value={p.thickness ?? ""} placeholder="—" onChange={(e) => update(p.id, { thickness: e.target.value })} /></Field>
                            <Field label="Width (in)"><input type="number" style={inputStyle} value={p.widthIn ?? ""} placeholder="—" onChange={(e) => updateDims(p.id, { widthIn: e.target.value })} /></Field>
                            <Field label="Length (in)"><input type="number" style={inputStyle} value={p.lengthIn ?? ""} placeholder="—" onChange={(e) => updateDims(p.id, { lengthIn: e.target.value })} /></Field>
                          </div>
                        </div>

                        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
                          <div className="grid grid-cols-2 gap-2">
                            <Field label="SF per board"><input type="number" style={inputStyle} value={p.sfPerBoard ?? ""} placeholder="—" onChange={(e) => update(p.id, { sfPerBoard: e.target.value })} /></Field>
                            <Field label="Boards per pallet"><input type="number" style={inputStyle} value={p.boardsPerUnit ?? ""} placeholder="—" onChange={(e) => update(p.id, { boardsPerUnit: e.target.value })} /></Field>
                          </div>
                        </div>

                        <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: C.gold }}>Packing & Conversions</div>
                          <div className="text-xs mb-2" style={{ color: C.faint }}>"[Qty] [Unit] per [Qty] [Unit]" — e.g. 40 boards per 1 Box. Pick from units this SKU already has, or type a brand new one.</div>
                          <datalist id={`units-${p.id}`}>
                            {unitsFor(p).map((u) => <option key={u} value={u} />)}
                          </datalist>
                          <div className="space-y-2">
                            {(p.conversions || []).map((c) => (
                              <div key={c.key} className="flex items-end gap-2 flex-wrap">
                                <Field label="Qty" w={70}><input type="number" style={inputStyle} value={c.qtyA ?? ""} onChange={(e) => updateConversion(p.id, c.key, { qtyA: e.target.value })} /></Field>
                                <Field label="Unit" w={110}><input list={`units-${p.id}`} style={inputStyle} value={c.unitA ?? ""} placeholder="board" onChange={(e) => updateConversion(p.id, c.key, { unitA: e.target.value })} /></Field>
                                <span className="text-xs pb-2" style={{ color: C.faint, fontFamily: MONO }}>PER</span>
                                <Field label="Qty" w={70}><input type="number" style={inputStyle} value={c.qtyB ?? ""} onChange={(e) => updateConversion(p.id, c.key, { qtyB: e.target.value })} /></Field>
                                <Field label="Unit" w={110}><input list={`units-${p.id}`} style={inputStyle} value={c.unitB ?? ""} placeholder="e.g. Box, Skid" onChange={(e) => updateConversion(p.id, c.key, { unitB: e.target.value })} /></Field>
                                <button onClick={() => removeConversion(p.id, c.key)} className="opacity-40 hover:opacity-100 mb-2"><Trash2 size={16} /></button>
                              </div>
                            ))}
                          </div>
                          <Btn onClick={() => addConversion(p.id)}><Plus size={14} /> Add Conversion</Btn>
                        </div>
                      </>
                    )}

                    {category === "paint" && (
                      <Field label="SF per gallon"><input type="number" style={inputStyle} value={p.sfPerGallon ?? ""} placeholder="250" onChange={(e) => update(p.id, { sfPerGallon: e.target.value })} /></Field>
                    )}

                    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <Field label="Reorder at">
                        <UnitSwitchInput
                          product={p} value={p.reorderPoint || 0} canonicalUnit={canonicalUnit}
                          onChange={(v) => update(p.id, { reorderPoint: v })}
                          displayUnit={reorderDisplayUnit}
                          onDisplayUnitChange={(u) => setReorderUnitPrefs({ ...reorderUnitPrefs, [p.id]: u })}
                          width={90}
                        />
                      </Field>
                      <div className="text-xs mt-1" style={{ color: C.faint }}>Flag this item when on-hand drops to or below this amount — pick whichever unit makes sense (boards, SF, pallets, gallons…).</div>
                    </div>

                    <Field label="Other notes (bundle sizes, odd conversions, anything else worth remembering)">
                      <textarea style={{ ...inputStyle, minHeight: 50 }} value={p.otherNotes || ""} onChange={(e) => update(p.id, { otherNotes: e.target.value })} />
                    </Field>
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

function useStopwatch() {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
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
  const reset = () => { setRunning(false); setElapsed(0); };
  const setManual = (seconds) => setElapsed(Math.max(0, Math.round(seconds)));

  return { running, elapsed, start, pause, reset, setManual };
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
  const [sortBy, setSortBy] = useState("name");
  const [showHidden, setShowHidden] = useState(false);
  const update = (id, patch) => onChange(suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updatePricing = (id, patch) => onChange(suppliers.map((s) => (s.id === id ? { ...s, pricing: { ...s.pricing, ...patch } } : s)));
  const remove = (id) => onChange(suppliers.filter((s) => s.id !== id));
  const add = () => {
    const v = { id: uid(), name: "New vendor", altName: "", code: "", contact: "", phone: "", email: "", address: "", city: "", hidden: false, favorite: false, accountOwner: "", crews: "", has1099: false, payMethod: "", notes: "", pricing: {}, priceNotes: "" };
    onChange([...suppliers, v]);
    setOpenId(v.id);
  };
  const sizePriceFields = ["165", "166", "185", "186"];

  const shown = suppliers
    .filter((s) => showHidden || !s.hidden)
    .slice()
    .sort((a, b) => {
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

                    <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <div className="flex items-center gap-1.5 mb-2" style={{ fontWeight: 700, color: C.gold }}>
                        <Tag size={14} /> Pricing ($/board by size)
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {sizePriceFields.map((size) => (
                          <Field key={size} label={size} w={undefined}>
                            <input
                              type="number" style={{ ...inputStyle, fontFamily: MONO }}
                              value={s.pricing?.[size] ?? ""} placeholder="—"
                              onChange={(e) => updatePricing(s.id, { [size]: e.target.value })}
                            />
                          </Field>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Field label="4ft"><input type="number" style={{ ...inputStyle, fontFamily: MONO }} value={s.pricing?.fourFt ?? ""} placeholder="—" onChange={(e) => updatePricing(s.id, { fourFt: e.target.value })} /></Field>
                        <Field label="Paint adder"><input type="number" style={{ ...inputStyle, fontFamily: MONO }} value={s.pricing?.paint ?? ""} placeholder="—" onChange={(e) => updatePricing(s.id, { paint: e.target.value })} /></Field>
                      </div>
                      <Field label="Pricing notes (bundles, delivery fees, etc)"><textarea style={{ ...inputStyle, minHeight: 50 }} value={s.priceNotes || ""} onChange={(e) => update(s.id, { priceNotes: e.target.value })} /></Field>
                    </div>

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
    let cancelled = false;

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
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
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

    return () => { cancelled = true; stop(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="rounded-sm p-4 w-full max-w-sm" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Scan unit label</div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
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

const SHIPPER = {
  name: "Good News Wood Salvation",
  address: "15775 Celestial Valley Road",
  cityStateZip: "North San Juan, CA 95960",
};
const LBS_PER_SF = 1.5;

function BOLModal({ wo, customer, products, onClose }) {
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

  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{`
        @page { size: letter; margin: 0.5in; }
        @media print {
          body * { visibility: hidden !important; }
          #bol-root, #bol-root * { visibility: visible !important; }
          #bol-root { position: absolute !important; left: 0; top: 0; margin: 0; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="max-w-2xl mx-auto my-8">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Field label="Pallets" w={90}><input type="number" style={inputStyle} value={pallets} onChange={(e) => setPallets(e.target.value)} /></Field>
          <Field label="Weight (lbs)" w={110}><input type="number" style={inputStyle} value={weight} onChange={(e) => setWeight(e.target.value)} /></Field>
          <Field label="Carrier / ship via" w={160}><input style={inputStyle} value={carrier} onChange={(e) => setCarrier(e.target.value)} /></Field>
          <Field label="Date" w={140}><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex items-end gap-2">
            <Btn kind="dark" onClick={() => window.print()}><Printer size={13} /> Print</Btn>
            <Btn onClick={onClose}><X size={13} /> Close</Btn>
          </div>
        </div>

        <div id="bol-root" style={{ background: "#fff", color: "#000", padding: "0.4in", fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          <div className="flex items-center justify-between" style={{ borderBottom: "3px solid #000", paddingBottom: 10, marginBottom: 16 }}>
            <div style={{ fontSize: 24, fontWeight: 900 }}>BILL OF LADING</div>
            <div style={{ textAlign: "right", fontSize: 12 }}>
              <div><strong>BOL #:</strong> {bolNumber}</div>
              <div><strong>Date:</strong> {date}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 4 }}>SHIP FROM</div>
              <div style={{ fontWeight: 700 }}>{SHIPPER.name}</div>
              <div>{SHIPPER.address}</div>
              <div>{SHIPPER.cityStateZip}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 4 }}>CONSIGNEE (SHIP TO)</div>
              <div style={{ fontWeight: 700 }}>{customer?.company || "—"}</div>
              {customer?.address && <div>{customer.address}</div>}
              <div>{[customer?.city, customer?.state, customer?.zip].filter(Boolean).join(", ")}</div>
              {customer?.country && customer.country !== "USA" ? <div>{customer.country}</div> : null}
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

          <div className="grid grid-cols-2 gap-10" style={{ marginTop: 48 }}>
            <div>
              <div style={{ borderTop: "1px solid #000", paddingTop: 4 }}>Shipper Signature</div>
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
  );
}

function LabelPrintView({ units, supplierFor, onClose }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto" style={{ background: "rgba(34,29,25,0.6)" }}>
      <style>{`
        @page { size: 4in 1in; margin: 0; }
        @media print {
          body * { visibility: hidden !important; }
          #labels-root, #labels-root * { visibility: visible !important; }
          #labels-root { margin: 0 !important; }
          .label-page { page-break-after: always; break-after: page; border: none !important; margin: 0 !important; }
          .label-page:last-child { page-break-after: auto; break-after: auto; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="max-w-md mx-auto my-8">
        <div className="flex justify-end gap-2 mb-3 no-print">
          <Btn kind="dark" onClick={() => window.print()}>
            <Printer size={13} /> {units.length > 1 ? `Print all ${units.length} labels` : "Print label"}
          </Btn>
          <Btn onClick={onClose}><X size={13} /> Close</Btn>
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

function NewPurchaseOrderModal({ suppliers, products, editingPO, onClose, onCreate, onUpdate }) {
  const blankLine = () => ({ key: uid(), item: "185", boardCount: "", copies: "1", costPerBoard: "" });
  const isEditing = !!editingPO;

  const initialShipChoice = editingPO
    ? (["Leo/Allison", "3PL"].includes(editingPO.shipVia) ? editingPO.shipVia : (editingPO.shipVia ? "Other" : "Leo/Allison"))
    : "Leo/Allison";
  const initialLines = editingPO?.lines?.length
    ? editingPO.lines.map((l) => {
        const boards = Number(l.boardCount) || 0;
        const copies = Number(l.copies) || 1;
        const costPerBoard = boards > 0 ? (Number(l.cost) || 0) / (boards * copies) : (Number(l.cost) || 0);
        const liveProduct = l.productId ? products.find((p) => p.id === l.productId) : null;
        return { key: uid(), item: liveProduct?.sku || l.sizeLabel || "", boardCount: l.boardCount ?? "", copies: String(copies), costPerBoard: costPerBoard || "" };
      })
    : [blankLine()];

  const [supplierId, setSupplierId] = useState(editingPO?.supplierId || "");
  const [date, setDate] = useState(editingPO?.date || today());
  const [shipViaChoice, setShipViaChoice] = useState(initialShipChoice);
  const [shipViaOther, setShipViaOther] = useState(initialShipChoice === "Other" ? editingPO?.shipVia || "" : "");
  const [paymentStatus, setPaymentStatus] = useState(editingPO?.paymentStatus || "Unpaid");
  const [paidVia, setPaidVia] = useState(editingPO?.paidVia || "");
  const [shippingCost, setShippingCost] = useState(editingPO?.shippingCost || "");
  const [notes, setNotes] = useState(editingPO?.note || "");
  const [lines, setLines] = useState(initialLines);

  const sizeOptions = products.filter((p) => p.kind === "board" && p.role === "raw").map((p) => p.sku);

  const updateLine = (key, patch) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setLines(lines.length > 1 ? lines.filter((l) => l.key !== key) : lines);

  // A line is "inventory" if it has a board count — that's what generates
  // physical units and bumps the matching raw SKU. Lines without a board
  // count are just recorded as a cost (parts, fees, whatever isn't stock).
  const lineTotal = (l) => {
    const boards = Number(l.boardCount) || 0;
    const copies = Math.max(1, Math.floor(Number(l.copies) || 1));
    return boards > 0 ? (Number(l.costPerBoard) || 0) * boards * copies : (Number(l.costPerBoard) || 0);
  };

  const validLines = lines.filter((l) => l.item.trim() !== "");
  const totalUnits = validLines.reduce((sum, l) => (Number(l.boardCount) > 0 ? sum + Math.max(1, Math.floor(Number(l.copies) || 1)) : sum), 0);
  const linesCost = validLines.reduce((sum, l) => sum + lineTotal(l), 0);
  const totalCost = linesCost + (Number(shippingCost) || 0);
  const canSubmit = supplierId && date && validLines.length > 0;
  const shipVia = shipViaChoice === "Other" ? shipViaOther : shipViaChoice;

  const rawByExactSku = (text) => products.find((p) => p.kind === "board" && p.role === "raw" && p.sku === text) || null;

  const buildLinesAndUnits = (poId) => {
    const createdUnits = [];
    const boardsBySize = {};
    for (const l of validLines) {
      const boardCount = Number(l.boardCount) || 0;
      if (boardCount <= 0) continue; // non-inventory line — cost only, no units
      const copies = Math.max(1, Math.floor(Number(l.copies) || 1));
      const matched = rawByExactSku(l.item);
      if (matched) boardsBySize[matched.id] = (boardsBySize[matched.id] || 0) + boardCount * copies;
      for (let i = 0; i < copies; i++) {
        createdUnits.push({
          id: uid(), poId, sizeLabel: l.item, productId: matched?.id || null,
          boardCount, boardsRemaining: boardCount,
          receivedDate: date,
        });
      }
    }
    return { createdUnits, boardsBySize };
  };

  const submit = () => {
    if (!canSubmit) return;
    const poId = isEditing ? editingPO.id : uid();
    const { createdUnits, boardsBySize } = buildLinesAndUnits(poId);
    const po = {
      id: poId, supplierId, date, shipVia, paymentStatus, paidVia,
      shippingCost: Number(shippingCost) || 0,
      lines: validLines.map((l) => ({ sizeLabel: l.item, productId: rawByExactSku(l.item)?.id || null, boardCount: Number(l.boardCount) || 0, copies: Math.max(1, Math.floor(Number(l.copies) || 1)), cost: lineTotal(l) })),
      totalCost, note: notes,
    };
    if (isEditing) onUpdate({ original: editingPO, po, units: createdUnits, boardsBySize });
    else onCreate({ po, units: createdUnits, boardsBySize });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-auto" style={{ background: "rgba(34,29,25,0.6)" }}>
      <div className="rounded-sm p-5 w-full max-w-2xl my-8" style={{ background: C.panel }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>{isEditing ? "Edit purchase order" : "New purchase order"}</div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Shipping cost"><input type="number" style={inputStyle} value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} placeholder="$" /></Field>
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
          <datalist id="po-item-options">
            {sizeOptions.map((code) => <option key={code} value={code} />)}
          </datalist>
          <div className="space-y-2">
            {lines.map((l) => {
              const total = lineTotal(l);
              const isInventory = Number(l.boardCount) > 0;
              const totalUnitsForLine = Math.max(1, Math.floor(Number(l.copies) || 1)) * (Number(l.boardCount) || 0);
              return (
                <div key={l.key} className="flex flex-wrap gap-2 items-end">
                  <Field label="Item / size" w={130} required>
                    <input list="po-item-options" style={inputStyle} value={l.item} onChange={(e) => updateLine(l.key, { item: e.target.value })} placeholder="185, or type anything" />
                  </Field>
                  <Field label="Boards/unit" w={90}><input type="number" style={inputStyle} value={l.boardCount} onChange={(e) => updateLine(l.key, { boardCount: e.target.value })} /></Field>
                  <Field label="× units" w={70}><input type="number" min="1" style={inputStyle} value={l.copies} onChange={(e) => updateLine(l.key, { copies: e.target.value })} /></Field>
                  {isInventory ? (
                    <>
                      <Field label="Cost/board ($)" w={100}>
                        <input type="number" style={inputStyle} value={l.costPerBoard} onChange={(e) => updateLine(l.key, { costPerBoard: e.target.value })} />
                      </Field>
                      <Field label="Total ($)" w={100}>
                        <input
                          type="number" style={inputStyle}
                          value={total ? Number(total.toFixed(2)) : ""}
                          onChange={(e) => {
                            const enteredTotal = Number(e.target.value) || 0;
                            const perBoard = totalUnitsForLine > 0 ? enteredTotal / totalUnitsForLine : enteredTotal;
                            updateLine(l.key, { costPerBoard: perBoard });
                          }}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field label="Cost ($)" w={100}>
                      <input type="number" style={inputStyle} value={l.costPerBoard} onChange={(e) => updateLine(l.key, { costPerBoard: e.target.value })} />
                    </Field>
                  )}
                  <button onClick={() => removeLine(l.key)} disabled={lines.length === 1} className="opacity-40 hover:opacity-100 disabled:opacity-15 mb-2"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
          <Btn onClick={() => setLines([...lines, blankLine()])}><Plus size={14} /> Add another line</Btn>
        </div>

        <Field label="Notes"><textarea style={{ ...inputStyle, minHeight: 60, marginTop: 8 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.kraft}` }}>
          <div className="text-sm" style={{ color: C.faint }}>
            {validLines.length > 0 ? `${totalUnits} unit${totalUnits === 1 ? "" : "s"} · total cost $${totalCost.toFixed(2)}` : "Add at least one line"}
            {isEditing && <div className="mt-1">If any of this PO's units have already been sorted from, their board counts won't change — only cost and other details will update.</div>}
          </div>
          <Btn kind="primary" onClick={submit} disabled={!canSubmit} big>
            <Printer size={16} /> {isEditing ? "Save changes" : "Create PO & print labels"}
          </Btn>
        </div>
      </div>
    </div>
  );
}


function ReceivingTab({ suppliers, purchaseOrders, onPOChange, units, onUnitsChange, products, onProductsChange, runGrouped }) {
  const [printUnits, setPrintUnits] = useState(null);
  const [newPOOpen, setNewPOOpen] = useState(false);
  const [editingPO, setEditingPO] = useState(null);
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
    runGrouped(() => {
      onPOChange([po, ...purchaseOrders]);
      onUnitsChange([...createdUnits, ...units]);
      onProductsChange(products.map((p) => {
        const bump = boardsBySize[p.id];
        return bump ? { ...p, onHand: (Number(p.onHand) || 0) + bump } : p;
      }));
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
  const handleUpdatePO = ({ original, po, units: newUnits, boardsBySize }) => {
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

  const outstandingCount = units.filter((u) => Number(u.boardsRemaining) > 0).length;

  return (
    <div>
      <div className="max-w-3xl">
          <div className="flex flex-wrap gap-2 mb-4">
            <Btn kind="primary" onClick={() => setNewPOOpen(true)}><Plus size={14} /> New purchase order</Btn>
            <Btn onClick={() => setPrintUnits(units.filter((u) => Number(u.boardsRemaining) > 0))} disabled={outstandingCount === 0}>
              <Printer size={14} /> Print all outstanding labels ({outstandingCount})
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
              return (
                <div key={po.id} className="rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
                  <button onClick={() => setOpenPOId(open ? null : po.id)} className="w-full text-left px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{sup?.name || "Unknown vendor"}</div>
                      <div className="text-xs mt-0.5" style={{ color: C.faint, fontFamily: MONO }}>
                        {po.date} · {num(totalBoards)} boards · {poUnits.length} unit{poUnits.length === 1 ? "" : "s"}
                        {po.totalCost ? ` · $${Number(po.totalCost).toFixed(2)}` : ""}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-sm text-xs" style={{ fontFamily: MONO, background: po.paymentStatus === "Paid" ? C.moss : C.kraft, color: po.paymentStatus === "Paid" ? "#fff" : C.ink }}>
                      {po.paymentStatus || "Unpaid"}
                    </span>
                  </button>

                  {open && (
                    <div className="px-4 pb-4" style={{ borderTop: `1px solid ${C.kraft}` }}>
                      <div className="grid gap-1 mt-3 text-sm">
                        {po.shipVia && <div><span style={{ color: C.faint }}>Ship via: </span>{po.shipVia}</div>}
                        {po.paidVia && <div><span style={{ color: C.faint }}>Paid via: </span>{po.paidVia}</div>}
                        {po.shippingCost > 0 && <div><span style={{ color: C.faint }}>Shipping: </span>${Number(po.shippingCost).toFixed(2)}</div>}
                        {po.note && <div><span style={{ color: C.faint }}>Notes: </span>{po.note}</div>}
                      </div>

                      {(po.lines || []).length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs mb-1" style={{ color: C.faint, fontFamily: MONO }}>LINE ITEMS</div>
                          {po.lines.map((l, i) => (
                            <div key={i} className="text-sm flex justify-between px-2 py-1" style={{ background: C.paper }}>
                              <span>{l.sizeLabel} — {num(l.boardCount)} bd × {l.copies}</span>
                              <span style={{ fontFamily: MONO, color: C.faint }}>{l.cost ? `$${Number(l.cost).toFixed(2)}` : ""}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3">
                        <div className="text-xs mb-1" style={{ color: C.faint, fontFamily: MONO }}>RECEIVED UNITS</div>
                        {poUnits.map((u) => (
                          <div key={u.id} className="flex items-center justify-between px-2 py-1.5 text-sm" style={{ borderBottom: `1px solid ${C.kraft}` }}>
                            <span style={{ fontFamily: MONO }}>{u.sizeLabel} · {num(u.boardsRemaining)}/{num(u.boardCount)} bd left</span>
                            <div className="flex items-center gap-2">
                              <button onClick={() => setPrintUnits([u])} title="Print label" className="opacity-60 hover:opacity-100"><Tag size={14} /></button>
                              <button onClick={() => removeUnit(u.id)} className="opacity-40 hover:opacity-100"><Trash2 size={13} /></button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex gap-2">
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

      {printUnits && printUnits.length > 0 && (
        <LabelPrintView units={printUnits} supplierFor={supplierFor} onClose={() => setPrintUnits(null)} />
      )}
    </div>
  );
}

function SortingTab({ products, onProductsChange, sortLog, onLogSort, onUpdateSort, onDeleteSort, team, whoWorking, setWhoWorking, onAddTeamMember, workOrders, units, onUnitsChange, jumpToUnitId, runGrouped }) {
  const millStock = products.find((p) => p.role === "millStock");
  const rawProducts = products.filter((p) => p.kind === "board" && p.role === "raw");

  const [workOrderId, setWorkOrderId] = useState("");
  const [unitId, setUnitId] = useState(jumpToUnitId || "");
  const [rawProductId, setRawProductId] = useState("");
  const [rawBoards, setRawBoards] = useState("");
  const [toN, setToN] = useState("");
  const [toP, setToP] = useState("");
  const [toMill, setToMill] = useState("");
  const [toWaste, setToWaste] = useState("");
  const sw = useStopwatch();
  const [manualEdit, setManualEdit] = useState(false);
  const [manualHMS, setManualHMS] = useState({ h: "0", m: "0", s: "0" });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");

  const rawProduct = products.find((p) => p.id === rawProductId);
  const nProduct = products.find((p) => p.groupId === rawProduct?.groupId && p.role === "sortedN");
  const pProduct = products.find((p) => p.groupId === rawProduct?.groupId && p.role === "sortedP");

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

  const startEdit = (s) => {
    setEditingId(s.id);
    setEditForm({
      batchLabel: s.batchLabel || "",
      rawBoards: s.rawBoards ?? "",
      toN: s.toN ?? "",
      toP: s.toP ?? "",
      toMill: s.toMill ?? "",
      toWaste: s.toWaste ?? "",
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditForm({}); };
  const saveEdit = (original) => {
    onUpdateSort(original, {
      ...original,
      batchLabel: editForm.batchLabel || "Unlabeled batch",
      rawBoards: Number(editForm.rawBoards) || 0,
      toN: Number(editForm.toN) || 0,
      toP: Number(editForm.toP) || 0,
      toMill: Number(editForm.toMill) || 0,
      toWaste: Number(editForm.toWaste) || 0,
    });
    setEditingId(null);
    setEditForm({});
  };

  const sumSorted = (Number(toN) || 0) + (Number(toP) || 0) + (Number(toMill) || 0) + (Number(toWaste) || 0);
  const rawIn = Number(rawBoards) || 0;
  const mismatch = rawIn > 0 && sumSorted !== rawIn;

  const openWorkOrders = workOrders.filter((w) => w.status !== "shipped");
  const availableUnits = units.filter((u) => Number(u.boardsRemaining) > 0);
  const selectedUnit = units.find((u) => u.id === unitId);

  const applyManualTime = () => {
    const h = Number(manualHMS.h) || 0, m = Number(manualHMS.m) || 0, s = Number(manualHMS.s) || 0;
    sw.setManual(h * 3600 + m * 60 + s);
    setManualEdit(false);
  };

  const submit = () => {
    if (!rawIn || !whoWorking || !rawProductId) return;
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
        id: uid(), date: today(), by: whoWorking, batchLabel: autoLabel,
        workOrderId: workOrderId || "", workOrderNumber: wo?.number || "",
        unitId: unitId || "", rawProductId,
        rawBoards: rawIn, toN: Number(toN) || 0, toP: Number(toP) || 0, toMill: Number(toMill) || 0, toWaste: Number(toWaste) || 0,
        seconds: sw.elapsed,
        startedAt: new Date().toISOString(),
      });
    });
    setWorkOrderId(""); setUnitId(""); setRawProductId(""); setRawBoards(""); setToN(""); setToP(""); setToMill(""); setToWaste("");
    sw.reset();
  };

  return (
    <div className="max-w-2xl">
      <div className="rounded-sm p-4 mb-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div className="flex items-center justify-between mb-3">
          <div style={{ fontWeight: 800, fontSize: 16 }}>Log a Sorting Batch</div>
        </div>
        <p className="text-sm mb-3" style={{ color: C.faint }}>
          Pick the received unit you're breaking down, then split it into what it actually sorted into.
          Everything here is counted in <strong>boards</strong>. Make sure your name is picked in the top right first.
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
            {availableUnits.map((u) => <option key={u.id} value={u.id}>{u.sizeLabel} · received {u.receivedDate} · {u.boardsRemaining} boards left</option>)}
          </select>
        </Field>
        {selectedUnit && (
          <div className="mt-1 text-xs" style={{ color: C.faint, fontFamily: MONO }}>Unit {selectedUnit.id} · received {selectedUnit.receivedDate}</div>
        )}

        <Field label="Which size are you sorting?" required>
          <select style={{ ...inputStyle, marginTop: 8 }} value={rawProductId} onChange={(e) => setRawProductId(e.target.value)}>
            <option value="">— Select raw size —</option>
            {rawProducts.map((p) => <option key={p.id} value={p.id}>{p.sku} (on hand: {num(p.onHand)} bd)</option>)}
          </select>
        </Field>
        <div className="text-xs mt-1" style={{ color: C.faint }}>Picking a unit above fills this in automatically — change it here if it's wrong.</div>

        <Field label="Which work order is this for?">
          <select style={{ ...inputStyle, marginTop: 8 }} value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
            <option value="">— Not tied to a specific WO —</option>
            {openWorkOrders.map((w) => <option key={w.id} value={w.id}>{w.number} · {w.customerName || "No customer"}</option>)}
          </select>
        </Field>

        <Field label="Raw boards brought in" required><input type="number" style={{ ...inputStyle, marginTop: 8 }} value={rawBoards} onChange={(e) => setRawBoards(e.target.value)} /></Field>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label={`→ ${nProduct?.sku || "?"} boards (no paint)`}><input type="number" style={inputStyle} value={toN} onChange={(e) => setToN(e.target.value)} /></Field>
          <Field label={`→ ${pProduct?.sku || "?"} boards (one side painted)`}><input type="number" style={inputStyle} value={toP} onChange={(e) => setToP(e.target.value)} /></Field>
          <Field label="→ Mill Stock boards (slush)"><input type="number" style={inputStyle} value={toMill} onChange={(e) => setToMill(e.target.value)} /></Field>
          <Field label="→ Waste boards"><input type="number" style={inputStyle} value={toWaste} onChange={(e) => setToWaste(e.target.value)} /></Field>
        </div>

        {mismatch && (
          <div className="mt-2 text-xs flex items-center gap-1" style={{ color: C.warn, fontFamily: MONO }}>
            <AlertTriangle size={12} /> Sorted total ({num(sumSorted)}) doesn't match raw brought in ({num(rawIn)}) — that's OK if some is still in process, just double check.
          </div>
        )}

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
          <Btn kind="primary" onClick={submit} disabled={!rawIn || !whoWorking || !rawProductId} big>
            <Check size={16} /> Log this batch
          </Btn>
          {!rawProductId && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick a raw size above first.</div>}
          {!whoWorking && <div className="mt-2 text-xs" style={{ color: C.warn }}>Pick your name above first.</div>}
        </div>
      </div>

      <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Recent Sorting Log</div>
        <div className="text-xs mb-2" style={{ color: C.faint }}>
          Anyone can edit or delete a logged entry below.
        </div>
        {sortLog.length === 0 ? (
          <div className="text-sm text-center py-4" style={{ color: C.faint }}>Nothing logged yet.</div>
        ) : (
          <div className="space-y-2">
            {sortLog.slice(0, 15).map((s) => {
              const isEditing = editingId === s.id;
              const entryRaw = resolveRawProduct(s, products);
              const entryN = products.find((p) => p.groupId === entryRaw?.groupId && p.role === "sortedN");
              const entryP = products.find((p) => p.groupId === entryRaw?.groupId && p.role === "sortedP");
              return (
                <div key={s.id} className="px-3 py-2 rounded-sm text-sm" style={{ background: C.paper, border: `1px solid ${C.kraft}` }}>
                  {isEditing ? (
                    <div>
                      <Field label="Batch label"><input style={inputStyle} value={editForm.batchLabel} onChange={(e) => setEditForm({ ...editForm, batchLabel: e.target.value })} /></Field>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Field label="Raw boards"><input type="number" style={inputStyle} value={editForm.rawBoards} onChange={(e) => setEditForm({ ...editForm, rawBoards: e.target.value })} /></Field>
                        <Field label={`→ ${entryN?.sku || "?"}`}><input type="number" style={inputStyle} value={editForm.toN} onChange={(e) => setEditForm({ ...editForm, toN: e.target.value })} /></Field>
                        <Field label={`→ ${entryP?.sku || "?"}`}><input type="number" style={inputStyle} value={editForm.toP} onChange={(e) => setEditForm({ ...editForm, toP: e.target.value })} /></Field>
                        <Field label="→ Mill Stock"><input type="number" style={inputStyle} value={editForm.toMill} onChange={(e) => setEditForm({ ...editForm, toMill: e.target.value })} /></Field>
                        <Field label="→ Waste"><input type="number" style={inputStyle} value={editForm.toWaste} onChange={(e) => setEditForm({ ...editForm, toWaste: e.target.value })} /></Field>
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Btn kind="moss" onClick={() => saveEdit(s)}><Check size={13} /> Save</Btn>
                        <Btn onClick={cancelEdit}><X size={13} /> Cancel</Btn>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start gap-2">
                        <span style={{ fontWeight: 700 }}>{s.batchLabel}{s.workOrderNumber ? ` · ${s.workOrderNumber}` : ""}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span style={{ fontFamily: MONO, fontSize: 11, color: C.faint }}>{s.date} · {s.by}</span>
                          <button onClick={() => startEdit(s)} title="Edit" className="opacity-50 hover:opacity-100"><Pencil size={13} /></button>
                          <button onClick={() => onDeleteSort(s)} title="Delete" className="opacity-50 hover:opacity-100"><Trash2 size={13} /></button>
                        </div>
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: C.faint, marginTop: 2 }}>
                        {num(s.rawBoards)} bd → {num(s.toN)} {entryN?.sku || "?"} · {num(s.toP)} {entryP?.sku || "?"} · {num(s.toMill)} mill · {num(s.toWaste)} waste
                        {s.seconds ? ` · ${fmtDuration(s.seconds)}` : ""}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {scannerOpen && (
        <QRScannerModal onClose={() => setScannerOpen(false)} onDecoded={handleScanned} />
      )}
    </div>
  );
}

function TimeTab({ sortLog, team, whoWorking, setWhoWorking, onAddTeamMember }) {
  const [date, setDate] = useState(today());
  const [view, setView] = useState("mine");

  const dayEntries = sortLog.filter((s) => s.date === date && Number(s.seconds) > 0);
  const mine = dayEntries.filter((s) => s.by === whoWorking);
  const byPerson = team.map((name) => {
    const entries = dayEntries.filter((s) => s.by === name);
    const totalSec = entries.reduce((sum, e) => sum + (Number(e.seconds) || 0), 0);
    return { name, entries, totalSec };
  }).filter((p) => p.totalSec > 0 || p.name === whoWorking);

  const mineTotalSec = mine.reduce((sum, e) => sum + (Number(e.seconds) || 0), 0);
  const teamTotalSec = dayEntries.reduce((sum, e) => sum + (Number(e.seconds) || 0), 0);

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Field label="Day" w={160}><input type="date" style={inputStyle} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <div className="flex items-end gap-1 pb-0.5">
          {[["mine", "My day"], ["team", "Whole team"]].map(([id, label]) => (
            <button
              key={id} onClick={() => setView(id)}
              className="px-3 py-2 rounded-sm text-xs"
              style={{ fontFamily: MONO, background: view === id ? C.ink : "transparent", color: view === id ? "#fff" : C.faint, border: `1px solid ${view === id ? C.ink : C.kraftDark}` }}
            >
              <CalendarDays size={12} className="inline mr-1" /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === "mine" ? (
        <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <div className="flex items-center justify-between mb-3">
            <div style={{ fontWeight: 800, fontSize: 15 }}>{whoWorking || "Pick your name"} · {date}</div>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 800 }}>{fmtDuration(mineTotalSec)}</div>
          </div>
          {!whoWorking ? (
            <div className="text-sm text-center py-6" style={{ color: C.faint }}>Select your name above to see your day.</div>
          ) : mine.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: C.faint }}>No time logged on {date}.</div>
          ) : (
            <div className="space-y-2">
              {mine.map((e) => (
                <div key={e.id} className="flex justify-between px-3 py-2 rounded-sm text-sm" style={{ background: C.paper }}>
                  <span>{e.batchLabel}{e.workOrderNumber ? ` · ${e.workOrderNumber}` : ""}</span>
                  <span style={{ fontFamily: MONO }}>{fmtDuration(e.seconds)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-sm p-4" style={{ background: C.panel, border: `1px solid ${C.kraftDark}` }}>
          <div className="flex items-center justify-between mb-3">
            <div style={{ fontWeight: 800, fontSize: 15 }}>Whole team · {date}</div>
            <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 800 }}>{fmtDuration(teamTotalSec)}</div>
          </div>
          {byPerson.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: C.faint }}>No time logged by anyone on {date}.</div>
          ) : (
            <div className="space-y-3">
              {byPerson.map((p) => (
                <div key={p.name}>
                  <div className="flex justify-between items-center px-3 py-2 rounded-sm" style={{ background: C.paper, fontWeight: 700 }}>
                    <span>{p.name}</span>
                    <span style={{ fontFamily: MONO }}>{fmtDuration(p.totalSec)} <span style={{ color: C.faint, fontWeight: 400 }}>({hoursDecimal(p.totalSec).toFixed(2)}h)</span></span>
                  </div>
                  {p.entries.map((e) => (
                    <div key={e.id} className="flex justify-between px-3 py-1.5 text-sm" style={{ color: C.faint }}>
                      <span>{e.batchLabel}{e.workOrderNumber ? ` · ${e.workOrderNumber}` : ""}</span>
                      <span style={{ fontFamily: MONO }}>{fmtDuration(e.seconds)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [customers, _setCustomers] = useState(SEED_CUSTOMERS);
  const [products, _setProducts] = useState(SEED_PRODUCTS);
  const [workOrders, _setWorkOrders] = useState([]);
  const [sortLog, _setSortLog] = useState([]);
  const [team, _setTeam] = useState(SEED_TEAM);
  const [suppliers, _setSuppliers] = useState(SEED_VENDORS);
  const [purchaseOrders, _setPurchaseOrders] = useState([]);
  const [units, _setUnits] = useState([]);
  const [goals, setGoals] = useState({ boardsPerHour: 100 });

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
    latestRef.current = { customers, products, workOrders, sortLog, team, suppliers, purchaseOrders, units };
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

  const applySnapshot = (snap) => {
    skipHistoryRef.current = true;
    _setCustomers(snap.customers);
    _setProducts(snap.products);
    _setWorkOrders(snap.workOrders);
    _setSortLog(snap.sortLog);
    _setTeam(snap.team);
    _setSuppliers(snap.suppliers);
    _setPurchaseOrders(snap.purchaseOrders);
    _setUnits(snap.units);
    skipHistoryRef.current = false;
  };

  const undo = () => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    futureRef.current.push(latestRef.current);
    if (futureRef.current.length > HISTORY_LIMIT) futureRef.current.shift();
    lastPushRef.current = 0; // next edit after an undo always gets its own checkpoint
    applySnapshot(prev);
    refreshHistoryCounts();
  };
  const redo = () => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop();
    historyRef.current.push(latestRef.current);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    lastPushRef.current = 0;
    applySnapshot(next);
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
  const setWorkOrders = (v) => { pushHistory(); _setWorkOrders(v); };
  const setSortLog = (v) => { pushHistory(); _setSortLog(v); };
  const setTeam = (v) => { pushHistory(); _setTeam(v); };
  const setSuppliers = (v) => { pushHistory(); _setSuppliers(v); };
  const setPurchaseOrders = (v) => { pushHistory(); _setPurchaseOrders(v); };
  const setUnits = (v) => { pushHistory(); _setUnits(v); };
  const [whoWorking, setWhoWorking] = useState("");
  const [activeWOId, setActiveWOId] = useState(null);
  const [jumpToUnitId, setJumpToUnitId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const saveTimers = useRef({});

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const u = params.get("unit");
      if (u) { setJumpToUnitId(u); setTab("work"); }
    } catch (e) { /* no-op if URL access is unavailable */ }
  }, []);

  useEffect(() => {
    (async () => {
      const tryLoad = async (key, setter) => {
        try {
          const res = await window.storage.get(key, true);
          if (res && res.value) {
            const d = JSON.parse(res.value);
            if (Array.isArray(d) && d.length) setter(d);
            else if (!Array.isArray(d)) setter(d);
          }
        } catch (e) { /* not found yet — seed stands */ }
      };
      await tryLoad(KEY.customers, setCustomers);
      await tryLoad(KEY.products, setProducts);
      await tryLoad(KEY.workOrders, (d) => setWorkOrders(Array.isArray(d) ? d : []));
      await tryLoad(KEY.sortLog, (d) => setSortLog(Array.isArray(d) ? d : []));
      await tryLoad(KEY.team, setTeam);
      await tryLoad(KEY.suppliers, (d) => setSuppliers(Array.isArray(d) ? d : []));
      await tryLoad(KEY.purchaseOrders, (d) => setPurchaseOrders(Array.isArray(d) ? d : []));
      await tryLoad(KEY.units, (d) => setUnits(Array.isArray(d) ? d : []));
      await tryLoad(KEY.goals, (d) => setGoals(d && !Array.isArray(d) ? d : { boardsPerHour: 100 }));
      setLoaded(true);
    })();
  }, []);

  const saveKey = (key, value) => {
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      try { await window.storage.set(key, JSON.stringify(value), true); }
      catch (e) { console.error("Save failed for", key, e); }
    }, 500);
  };

  useEffect(() => { if (loaded) saveKey(KEY.customers, customers); }, [customers, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.products, products); }, [products, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.workOrders, workOrders); }, [workOrders, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.sortLog, sortLog); }, [sortLog, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.team, team); }, [team, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.suppliers, suppliers); }, [suppliers, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.purchaseOrders, purchaseOrders); }, [purchaseOrders, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.units, units); }, [units, loaded]);
  useEffect(() => { if (loaded) saveKey(KEY.goals, goals); }, [goals, loaded]);

  const addTeamMember = (name) => { if (!team.includes(name)) setTeam([...team, name]); };
  const removeTeamMember = (name) => {
    setTeam(team.filter((t) => t !== name));
    if (whoWorking === name) setWhoWorking("");
  };

  // Editing or deleting a sort-log entry has to undo its original inventory
  // effect (raw boards consumed, sorted outputs added) before applying the
  // new one — otherwise counts drift every time someone fixes a typo.
  const updateSortEntry = (original, updated) => {
    runGrouped(() => {
      setProducts((prev) => {
        const origRaw = resolveRawProduct(original, prev);
        const newRaw = resolveRawProduct(updated, prev);
        return prev.map((p) => {
          let onHand = Number(p.onHand) || 0;
          // Reverse the original entry's effect using ITS group, then apply
          // the updated entry's effect using ITS group — these can differ if
          // someone corrects which size was actually sorted. Matching by
          // groupId/role means this still works even if SKUs got renamed.
          if (origRaw) {
            if (p.id === origRaw.id) onHand += Number(original.rawBoards) || 0;
            if (p.groupId === origRaw.groupId && p.role === "sortedN") onHand -= Number(original.toN) || 0;
            if (p.groupId === origRaw.groupId && p.role === "sortedP") onHand -= Number(original.toP) || 0;
          }
          if (p.role === "millStock") onHand -= Number(original.toMill) || 0;
          if (newRaw) {
            if (p.id === newRaw.id) onHand -= Number(updated.rawBoards) || 0;
            if (p.groupId === newRaw.groupId && p.role === "sortedN") onHand += Number(updated.toN) || 0;
            if (p.groupId === newRaw.groupId && p.role === "sortedP") onHand += Number(updated.toP) || 0;
          }
          if (p.role === "millStock") onHand += Number(updated.toMill) || 0;
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
    runGrouped(() => {
      setProducts((prev) => {
        const raw = resolveRawProduct(entry, prev);
        return prev.map((p) => {
          if (raw && p.id === raw.id) return { ...p, onHand: (Number(p.onHand) || 0) + (Number(entry.rawBoards) || 0) };
          if (raw && p.groupId === raw.groupId && p.role === "sortedN") return { ...p, onHand: (Number(p.onHand) || 0) - (Number(entry.toN) || 0) };
          if (raw && p.groupId === raw.groupId && p.role === "sortedP") return { ...p, onHand: (Number(p.onHand) || 0) - (Number(entry.toP) || 0) };
          if (p.role === "millStock") return { ...p, onHand: (Number(p.onHand) || 0) - (Number(entry.toMill) || 0) };
          return p;
        });
      });
      setUnits((prev) => prev.map((u) => (u.id === entry.unitId ? { ...u, boardsRemaining: Math.max(0, (Number(u.boardsRemaining) || 0) + (Number(entry.rawBoards) || 0)) } : u)));
      setSortLog((prev) => prev.filter((s) => s.id !== entry.id));
    });
  };

  const newWorkOrder = () => {
    const year = new Date().getFullYear();
    const maxSeq = workOrders.reduce((max, w) => {
      const m = /^WO-(\d{4})-(\d+)$/.exec(w.number || "");
      return m && Number(m[1]) === year ? Math.max(max, Number(m[2])) : max;
    }, 0);
    const w = {
      id: uid(), number: `WO-${year}-${String(maxSeq + 1).padStart(3, "0")}`,
      customerId: "", customerName: "", status: "not_started", date: today(),
      lines: [], shipDate: "", shipVia: "", notes: "",
    };
    setWorkOrders([w, ...workOrders]);
    setActiveWOId(w.id);
    setTab("orders");
    setOrdersSubTab("workorders");
  };

  const updateWO = (w) => {
    const cust = customers.find((c) => c.id === w.customerId);
    setWorkOrders(workOrders.map((x) => (x.id === w.id ? { ...w, customerName: cust?.company || "" } : x)));
  };
  const deleteWO = (id) => {
    setWorkOrders(workOrders.filter((w) => w.id !== id));
    setActiveWOId(null);
  };

  const activeWO = workOrders.find((w) => w.id === activeWOId) || null;

  const handleImported = ({ parsed, matchedCustomerId, fileName }) => {
    const year = new Date().getFullYear();
    const maxSeq = workOrders.reduce((max, w) => {
      const m = /^WO-(\d{4})-(\d+)$/.exec(w.number || "");
      return m && Number(m[1]) === year ? Math.max(max, Number(m[2])) : max;
    }, 0);
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
    const w = {
      id: uid(), number: `WO-${year}-${String(maxSeq + 1).padStart(3, "0")}`,
      customerId: matchedCustomerId || "", customerName: cust?.company || parsed.customerName || "",
      status: "not_started", date: today(),
      lines, shipDate: parsed.shipDate || "", shipVia: "",
      notes: [parsed.notes, `Imported from invoice: ${fileName}`, unmatchedFlag].filter(Boolean).join("\n"),
    };
    setWorkOrders([w, ...workOrders]);
    setActiveWOId(w.id);
    setTab("orders");
    setOrdersSubTab("workorders");
    setImportOpen(false);
  };

  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
    { id: "work", label: "Work", icon: Scissors },
    { id: "orders", label: "Orders", icon: ClipboardList },
    { id: "inventory", label: "Inventory", icon: Boxes },
    { id: "contacts", label: "Contacts", icon: Users },
    { id: "reports", label: "Reports", icon: Timer },
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
          <div className="flex items-center gap-2 relative">
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
                <WhoSelect team={team} current={whoWorking} onChange={setWhoWorking} onAddMember={addTeamMember} />
                </div>
              </>
            )}
          </div>
        </div>
        {!(tab === "orders" && ordersSubTab === "workorders" && activeWO) && (
          <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
            {orderedTabs.map((t) => (
              <button
                key={t.id}
                draggable
                onDragStart={() => setDraggedTabId(t.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); reorderTabs(t.id); setDraggedTabId(null); }}
                onDragEnd={() => setDraggedTabId(null)}
                onClick={() => { setTab(t.id); if (t.id === "orders" && ordersSubTab === "workorders") setActiveWOId(null); }}
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

      <main className="max-w-6xl mx-auto px-4 py-5">
        {tab === "dashboard" && (
          <Dashboard workOrders={workOrders} products={products} sortLog={sortLog} units={units} onOpenWO={(id) => { setActiveWOId(id); setTab("orders"); setOrdersSubTab("workorders"); }} goTab={setTab} goals={goals} onGoalsChange={setGoals} />
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
              wo={activeWO} customers={customers} products={products}
              onChange={updateWO} onDelete={() => deleteWO(activeWO.id)} onBack={() => setActiveWOId(null)}
              team={team} whoWorking={whoWorking} setWhoWorking={setWhoWorking} onAddTeamMember={addTeamMember}
            />
          ) : (
            <WorkOrderBoard workOrders={workOrders} customers={customers} onOpen={(id) => setActiveWOId(id)} onNew={newWorkOrder} onImport={() => setImportOpen(true)} />
          )
        )}
        {tab === "orders" && ordersSubTab === "purchaseorders" && (
          <ReceivingTab
            suppliers={suppliers}
            purchaseOrders={purchaseOrders} onPOChange={setPurchaseOrders}
            units={units} onUnitsChange={setUnits}
            products={products} onProductsChange={setProducts}
            runGrouped={runGrouped}
          />
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
          <SortingTab
            products={products} onProductsChange={setProducts}
            sortLog={sortLog} onLogSort={(s) => setSortLog([s, ...sortLog])}
            onUpdateSort={updateSortEntry} onDeleteSort={deleteSortEntry}
            team={team} whoWorking={whoWorking} setWhoWorking={setWhoWorking} onAddTeamMember={addTeamMember}
            workOrders={workOrders}
            units={units} onUnitsChange={setUnits}
            jumpToUnitId={jumpToUnitId}
            runGrouped={runGrouped}
          />
        )}

        {tab === "inventory" && <InventoryTab products={products} onChange={setProducts} />}

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

        {tab === "reports" && (
          <TimeTab sortLog={sortLog} team={team} whoWorking={whoWorking} setWhoWorking={setWhoWorking} onAddTeamMember={addTeamMember} />
        )}
      </main>
    </div>
  );
}
