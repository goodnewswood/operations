// Vercel serverless function at /api/shippo. Talks to Shippo for the
// work order's Shipping panel: box sizes, rates, buying a label, and
// tracking. The Shippo key stays here in SHIPPO_API_KEY and never reaches
// the browser.

// Only calls made from inside the app itself get through: the browser
// stamps every request with the page it came from, and it has to be this
// same site. Ero dropped the access code so nobody has to type one. This
// stops casual use of the URL from elsewhere, though a determined person
// could fake the header.
function fromTheApp(req) {
  const origin = req.headers.origin || req.headers.referer || "";
  const hosts = [req.headers.host, req.headers["x-forwarded-host"]].filter(Boolean);
  try { return hosts.includes(new URL(origin).host); } catch { return false; }
}

// Where labels ship from. The shop is out at Celestial Valley, but boxes
// get dropped at the UPS Store in town and returns come to Hwy 49, and
// every one of those ZIPs is the same rate zone anyway. Same sender Ero
// already uses in Shippo.
const FROM = {
  name: "Ero Gorski",
  company: "Ethica Wood",
  street1: "27091 State Highway 49",
  city: "Nevada City",
  state: "CA",
  zip: "95959",
  country: "US",
  phone: "6304843242",
  email: "ethicawood@gmail.com",
};

const API = "https://api.goshippo.com";

async function shippo(path, { method = "GET", body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.detail || data?.messages?.[0]?.text || JSON.stringify(data).slice(0, 300);
    throw Object.assign(new Error(`Shippo said: ${msg}`), { status: r.status });
  }
  return data;
}

const str = (v, max = 100) => String(v ?? "").trim().slice(0, max);

// "USA", "United States", "" all mean US. Anything else is passed as is,
// and the app stops before rates for anything outside the US.
function countryCode(c) {
  const s = str(c).toUpperCase();
  if (!s || s === "USA" || s === "US" || s === "UNITED STATES") return "US";
  if (s === "CANADA" || s === "CA") return "CA";
  return s.slice(0, 2);
}

const toAddress = (a = {}) => ({
  name: str(a.name) || str(a.company) || "Receiver",
  company: str(a.company),
  street1: str(a.street1, 200),
  street2: str(a.street2, 200),
  city: str(a.city),
  state: str(a.state, 30),
  zip: str(a.zip, 20),
  country: countryCode(a.country),
  phone: str(a.phone, 30),
  email: str(a.email, 120),
});

const toParcel = (p = {}) => ({
  length: String(Number(p.length) || 0),
  width: String(Number(p.width) || 0),
  height: String(Number(p.height) || 0),
  distance_unit: "in",
  weight: String(Number(p.weight) || 0),
  mass_unit: "lb",
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!fromTheApp(req)) {
    return res.status(403).json({ error: "Only the GNWS Ops app can use this", code: "not_from_app" });
  }
  if (!process.env.SHIPPO_API_KEY) {
    return res.status(503).json({ error: "Shippo isn't connected yet: SHIPPO_API_KEY is not set on the server", code: "no_key" });
  }

  const { action } = req.body || {};
  try {
    // The box sizes saved in Shippo, so the crew picks "Master Box"
    // instead of typing dimensions.
    if (action === "boxes") {
      const data = await shippo("/user-parcel-templates");
      return res.json({
        boxes: (data.results || []).map((t) => ({
          id: t.object_id, name: t.name,
          length: Number(t.length), width: Number(t.width), height: Number(t.height),
          weight: Number(t.weight) || 0,
        })),
      });
    }

    if (action === "rates") {
      const { to, parcels, fromName, reference } = req.body;
      if (!Array.isArray(parcels) || !parcels.length || parcels.length > 30) {
        return res.status(400).json({ error: "Add at least one box" });
      }
      // On a drop ship the label shows the distributor's name, never ours,
      // same as the rest of the blind paperwork. Address stays ours.
      const from = fromName ? { ...FROM, name: str(fromName), company: str(fromName) } : FROM;
      const shipment = await shippo("/shipments", {
        method: "POST",
        body: {
          address_from: from,
          address_to: toAddress(to),
          parcels: parcels.map(toParcel),
          metadata: str(reference, 100),
          async: false,
        },
      });
      const rates = (shipment.rates || [])
        .map((r) => ({
          id: r.object_id,
          carrier: r.provider,
          service: r.servicelevel?.name || r.servicelevel?.token || "",
          amount: Number(r.amount),
          currency: r.currency,
          days: r.estimated_days ?? null,
          terms: r.duration_terms || "",
          tags: r.attributes || [],
        }))
        // USPS can't take several boxes as one shipment. Shippo still
        // quotes it, but the label would only cover the first box.
        .filter((r) => parcels.length === 1 || !/usps/i.test(r.carrier))
        .sort((a, b) => a.amount - b.amount);
      const messages = (shipment.messages || []).map((m) => m.text).filter(Boolean).slice(0, 6);
      return res.json({ shipmentId: shipment.object_id, rates, messages });
    }

    if (action === "buy") {
      const { rateId, reference } = req.body;
      if (!rateId) return res.status(400).json({ error: "Pick a rate first" });
      const t = await shippo("/transactions", {
        method: "POST",
        body: { rate: str(rateId, 64), label_file_type: "PDF_4x6", metadata: str(reference, 100), async: false },
      });
      if (t.status !== "SUCCESS") {
        const why = (t.messages || []).map((m) => m.text).join(" ") || t.status;
        return res.status(422).json({ error: `Label not bought: ${why}` });
      }
      // A multi-box UPS or FedEx shipment comes back as one transaction
      // per box. Pick them all up so every label prints.
      let labels = [{ labelUrl: t.label_url, trackingNumber: t.tracking_number }];
      try {
        // Bounded to the last day: an open-ended list scans the whole
        // account history and can time out.
        const since = new Date(Date.now() - 86400000).toISOString().slice(0, 19);
        const all = await shippo(`/transactions?rate=${encodeURIComponent(t.rate)}&object_created_gte=${since}&results=50`);
        const more = (all.results || []).filter((x) => x.status === "SUCCESS" && x.label_url);
        if (more.length > 1) labels = more.map((x) => ({ labelUrl: x.label_url, trackingNumber: x.tracking_number }));
      } catch { /* the first label is still good */ }
      return res.json({
        transactionId: t.object_id,
        trackingNumber: t.tracking_number,
        trackingUrl: t.tracking_url_provider || "",
        labelUrl: t.label_url,
        labels,
        eta: t.eta || null,
      });
    }

    if (action === "track") {
      const { carrier, trackingNumber } = req.body;
      if (!carrier || !trackingNumber) return res.status(400).json({ error: "Need a carrier and tracking number" });
      const t = await shippo(`/tracks/${encodeURIComponent(str(carrier, 40).toLowerCase())}/${encodeURIComponent(str(trackingNumber, 60))}`);
      const st = t.tracking_status || {};
      return res.json({
        status: st.status || "UNKNOWN",
        detail: st.status_details || "",
        at: st.status_date || null,
        where: [st.location?.city, st.location?.state].filter(Boolean).join(", "),
        eta: t.eta || null,
      });
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (e) {
    return res.status(e.status && e.status < 500 ? 422 : 502).json({ error: e.message || "Shippo request failed" });
  }
}
