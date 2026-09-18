// Vercel serverless function. Lives at /api/parse-invoice.js in the
// project, which Vercel automatically exposes at /api/parse-invoice.
// The Anthropic API key stays here, server-side, in an environment
// variable — it's never sent to the browser.

import crypto from "node:crypto";

// Every call spends the Anthropic key, and this URL is public, so a call
// has to carry the import access code. The code can't be built into the
// app: the app has no login and everything in it is readable by anyone.
// Instead each device is asked for it once (Ops prompts the first time an
// import is refused) and sends it in a header. Hashing both sides first
// gives timingSafeEqual equal-length inputs, so the comparison takes the
// same time whatever was sent.
function accessCodeOk(given) {
  const expected = process.env.PARSE_INVOICE_ACCESS_CODE;
  if (!expected || typeof given !== "string" || !given) return false;
  const hash = (s) => crypto.createHash("sha256").update(s, "utf8").digest();
  return crypto.timingSafeEqual(hash(given), hash(expected));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Closed unless a code is configured: no code set means nobody gets in,
  // never that everybody does.
  if (!process.env.PARSE_INVOICE_ACCESS_CODE) {
    return res.status(503).json({ error: "Import isn't switched on: no access code is set on the server", code: "access_code_not_set" });
  }
  if (!accessCodeOk(req.headers["x-gnws-access-code"])) {
    return res.status(401).json({ error: "Import access code is missing or wrong", code: "access_code" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
  }

  // Either a PDF (base64) or plain pasted text (an emailed order, a note
  // typed straight from a phone call) — same extraction either way, just
  // a different content block for Claude to read it from.
  const { base64, text } = req.body || {};
  if (!base64 && !text) {
    return res.status(400).json({ error: "Missing PDF data or pasted text" });
  }

  // Orders say "ship Sept 30" and leave the year off. Without today's
  // date the model picks one from its own training and the work order
  // lands with a ship date years in the past.
  const todayISO = new Date().toISOString().slice(0, 10);
  const prompt = `Today is ${todayISO}. Extract structured data from this wholesale reclaimed-wood order, invoice, or quote${text ? " (pasted as plain text, possibly from an email)" : ""}. A date with no year means the next time that date comes around on or after today. Respond with ONLY valid JSON, no markdown fences, no preamble, exactly this shape:
{
  "customerName": string,
  "contactName": string,
  "shipDate": string,
  "notes": string,
  "lines": [ { "description": string, "quantity": number, "unit": string } ]
}
"unit" should be "sf", "board", "plank", or "ea" — guess "sf" if it's unclear, since most line items here are priced per square foot. Use "" or [] for anything not present on the document. Do not include any dollar amounts anywhere in your output.`;

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
        max_tokens: 1200,
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
