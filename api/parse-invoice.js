// Vercel serverless function. Lives at /api/parse-invoice.js in the
// project, which Vercel automatically exposes at /api/parse-invoice.
// The Anthropic API key stays here, server-side, in an environment
// variable — it's never sent to the browser.

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!fromTheApp(req)) {
    return res.status(403).json({ error: "Only the GNWS Ops app can use this", code: "not_from_app" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
  }

  // Either a PDF (base64) or plain pasted text (an emailed order, a note
  // typed straight from a phone call) — same extraction either way, just
  // a different content block for Claude to read it from.
  // catalog is the shop's own SKU list, sent by the app. Without it every
  // line came back as free text and landed on "Custom / describe below",
  // so the crew had to pick the item by hand on every import.
  // customers is our own customer list, so the buyer comes back as a
  // name we already have instead of a near miss that makes a duplicate.
  const { base64, text, catalog, customers } = req.body || {};
  if (!base64 && !text) {
    return res.status(400).json({ error: "Missing PDF data or pasted text" });
  }
  const catalogLines = Array.isArray(catalog)
    ? catalog.filter((c) => c && c.sku).slice(0, 400).map((c) => `${c.sku} = ${c.name || ""}`).join("\n")
    : "";
  const customerLines = Array.isArray(customers)
    ? customers.filter((c) => c && c.company).slice(0, 600)
        .map((c) => [c.company, c.contact, c.email].filter(Boolean).join(" | ")).join("\n")
    : "";

  // Orders say "ship Sept 30" and leave the year off. Without today's
  // date the model picks one from its own training and the work order
  // lands with a ship date years in the past.
  const todayISO = new Date().toISOString().slice(0, 10);
  // Same reading Claude does when an order is entered by hand: who pays
  // us, who the job is really for, their order number, what it costs and
  // whether it's been paid. The app builds the sales order and the work
  // order from this, so both come out the same as a hand-entered order.
  const prompt = `Today is ${todayISO}. Extract structured data from this wholesale reclaimed-wood order, invoice, or quote${text ? " (pasted as plain text, possibly from an email)" : ""}. A date with no year means the next time that date comes around on or after today. Respond with ONLY valid JSON, no markdown fences, no preamble, exactly this shape:
{
  "customerName": string,
  "senderName": string,
  "endCustomer": string,
  "orderDate": string,
  "shipDate": string,
  "customerPO": string,
  "dropShip": boolean,
  "shipTo": { "name": string, "company": string, "address": string, "address2": string, "city": string, "state": string, "zip": string, "country": string, "phone": string },
  "details": string,
  "notes": string,
  "payment": { "amount": number, "method": string, "reference": string, "paid": boolean },
  "lines": [ { "sku": string, "description": string, "quantity": number, "unit": string, "unitPrice": number } ]
}
"customerName" is the business that placed the order with us and pays us, not their end customer. A distributor or reseller writing "order request for <person>" is the customer, and <person> is "endCustomer". When the sender is a person who works for a business on our customer list (match on name, contact or email), "customerName" is that business.${customerLines ? ` Copy "customerName" exactly from this list of our customers when one of them is the buyer (format: company | contact | email):
${customerLines}` : ""}
"senderName" is the person who wrote or sent the order. "endCustomer" is the person or business the job is for when that isn't the buyer, otherwise "". "orderDate" is the date on the order or email as YYYY-MM-DD, or "".
"customerPO" is the buyer's own order, request, invoice or PO number for this job, exactly as written (keep a leading "#"). An Amazon or marketplace order number counts, written as "Amazon 111-1234567-1234567".
Set "dropShip" true and fill "shipTo" only when the order gives a ship-to address somewhere other than the buyer. Otherwise "dropShip" is false and "shipTo" fields are all "". A name with no address is not a drop ship.
"details" is anything the shop floor needs to know beyond the line items, in one short plain sentence, for example "customer wants as many rough sawn marks as possible". Leave it "" if there's nothing. "notes" is any other context worth keeping, or "".
"payment.amount" is the money already paid or sent, "method" is how (Melio, Zelle, card, check...), "reference" is its payment or transaction ID, and "paid" is true only when the order says it was paid or sent. Use 0, "", "" and false when it says nothing about payment.
"unit" should be "sf", "board", "plank", "box", or "ea": guess "sf" if it's unclear, since most line items here are priced per square foot. "unitPrice" is the price per that unit when the order states one (for "$6/sf" it is 6), else 0. Never work a price out from a total.${catalogLines ? `
"sku" must be copied exactly from this list of the shop's items, picking the one the line is describing. Match on size, profile and finish (for example "5 inch tongue and groove natural" is TNG-548-NAT, "1x8x5 redwood unsorted" is 185RAW). Use "" only when nothing on the list is a reasonable match:
${catalogLines}` : `
Leave "sku" as "".`}
Use "" or [] for anything not present on the document.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: base64
            ? [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
                { type: "text", text: prompt },
              ]
            : [
                { type: "text", text: `${prompt}\n\n---\n${text}` },
              ],
        }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Anthropic API request failed" });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown server error" });
  }
}
