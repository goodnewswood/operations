// Vercel serverless function. Lives at /api/parse-invoice.js in the
// project, which Vercel automatically exposes at /api/parse-invoice.
// The Anthropic API key stays here, server-side, in an environment
// variable — it's never sent to the browser.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server" });
  }

  const { base64 } = req.body || {};
  if (!base64) {
    return res.status(400).json({ error: "Missing PDF data" });
  }

  const prompt = `Extract structured data from this wholesale reclaimed-wood invoice or quote PDF. Respond with ONLY valid JSON, no markdown fences, no preamble, exactly this shape:
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
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: prompt },
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
