/* Shopify orders/create webhook: POST /api/shopify-order

   Shopify calls this the moment an order is placed on the Ethica Wood
   store, and the order goes into GNWS as a sales order and a linked work
   order through enterOrder(), the same code the scheduled order checks
   run (scripts/order-intake/enter-order.mjs). Nothing about orders is
   reimplemented here; this file only proves the request came from
   Shopify and translates Shopify's order JSON into the order file shape
   enter-order.mjs already takes (see RUNBOOK.md next to it).

   Proving it came from Shopify: Shopify signs the exact bytes of the body
   with HMAC-SHA256 using the webhook secret, base64, in the
   X-Shopify-Hmac-Sha256 header. Checked against the raw body before
   anything is parsed. No secret configured means every call is refused,
   never that every call is let through.

   Responses: 200 for anything Shopify shouldn't send again (entered,
   already in the app, held for Ero, a test or cancelled order); 401 for a
   bad signature; 503 when no secret is set; 500 when saving failed, so
   Shopify retries. Retries are safe: an order already in the app is
   answered "already entered" and nothing is written. */

import crypto from "node:crypto";
import { enterOrder, loadListings } from "../scripts/order-intake/enter-order.mjs";

function signatureOk(rawBody, header, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(String(header || ""), "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const num = (v) => Number(v) || 0;

// Shopify's order JSON, as the order file RUNBOOK.md describes.
export function toIntakeOrder(o) {
  const addr = o.shipping_address || null;
  const cust = o.customer || {};
  const fullName = (x) => [x?.first_name, x?.last_name].filter(Boolean).join(" ");
  return {
    channel: "shopify",
    orderNumber: String(o.order_number ?? o.name ?? "").replace(/^#/, "").trim(),
    placedAt: o.created_at,
    buyer: {
      name: fullName(cust) || addr?.name || fullName(o.billing_address),
      email: o.email || o.contact_email || cust.email || "",
      phone: o.phone || cust.phone || addr?.phone || "",
    },
    shipTo: addr ? {
      name: addr.name || fullName(addr), company: addr.company || "",
      address: addr.address1 || "", address2: addr.address2 || "",
      city: addr.city || "", state: addr.province_code || addr.province || "", zip: addr.zip || "",
      country: addr.country || "", phone: addr.phone || "",
    } : null,
    lines: (o.line_items || []).map((l) => ({
      title: l.title || l.name || "", variant: l.variant_title || "", sku: l.sku || "",
      quantity: num(l.quantity), unitPrice: num(l.price),
    })),
    shippingMethod: (o.shipping_lines || []).map((s) => s.title).filter(Boolean).join(", "),
    shippingCost: (o.shipping_lines || []).reduce((s, x) => s + num(x.price), 0),
    discount: num(o.total_discounts),
    discountCodes: (o.discount_codes || []).map((d) => d.code).filter(Boolean),
    tax: num(o.total_tax),
    total: num(o.total_price),
    paid: o.financial_status === "paid",
    // Shopify's own gateway reads "shopify_payments"; left out, enter-order
    // writes "Shopify Payments", same as the scheduled checks do.
    ...((o.payment_gateway_names || []).some((g) => g !== "shopify_payments") ? { paidVia: o.payment_gateway_names.join(", ") } : {}),
    buyerNote: o.note || "",
  };
}

export async function POST(request) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook secret isn't configured" }, { status: 503 });

  const raw = Buffer.from(await request.arrayBuffer());
  if (!signatureOk(raw, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") || "";
  if (topic && topic !== "orders/create") return Response.json({ status: "ignored", reason: `topic ${topic}` });

  let order;
  try { order = JSON.parse(raw.toString("utf8")); } catch { return Response.json({ error: "body isn't JSON" }, { status: 400 }); }
  const label = `Shopify #${order.order_number ?? order.name ?? "?"}`;
  if (order.test) return Response.json({ status: "ignored", reason: "test order", order: label });
  if (order.cancelled_at) return Response.json({ status: "ignored", reason: "cancelled", order: label });

  try {
    const { code, lines, ...result } = await enterOrder(toIntakeOrder(order));
    console.log(`[shopify-order] ${label} (webhook ${request.headers.get("x-shopify-webhook-id") || "?"}): ${result.status}\n${lines.join("\n")}`);
    return Response.json(result);
  } catch (e) {
    console.error(`[shopify-order] ${label}: ${e.message}`);
    return Response.json({ error: e.message, order: label }, { status: 500 });
  }
}

// A health check that reveals nothing secret: whether a secret is set, and
// whether the catalog map made it into the deployed function.
export async function GET() {
  let listings = null;
  try { const l = loadListings(); listings = Object.values(l).filter(Array.isArray).reduce((s, a) => s + a.length, 0); } catch { /* reported as null */ }
  return Response.json({ route: "shopify orders/create", secretConfigured: !!process.env.SHOPIFY_WEBHOOK_SECRET, listingEntries: listings });
}
