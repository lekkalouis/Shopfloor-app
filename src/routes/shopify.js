import express from "express";
import { config, hasShopifyConfig } from "../config.js";
import { badRequest, configError, upstreamError } from "../utils/responses.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";

const router = express.Router();

const buildApiBase = () => {
  const { store, apiVersion } = config.shopify;
  if (!store) return "";
  return `${store}/admin/api/${apiVersion}`;
};

const ensureShopifyConfigured = (res) => {
  if (!hasShopifyConfig) {
    configError(res, "Set SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN in .env");
    return false;
  }
  return true;
};

router.get("/orders/by-name/:name", async (req, res) => {
  try {
    if (!ensureShopifyConfigured(res)) return;

    let name = req.params.name || "";
    if (!name.startsWith("#")) name = `#${name}`;

    const orderUrl = `${buildApiBase()}/orders.json?status=any&name=${encodeURIComponent(
      name
    )}`;

    const orderResp = await fetchWithTimeout(
      orderUrl,
      {
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json"
        }
      },
      20000
    );

    if (!orderResp.ok) {
      const body = await orderResp.text();
      return upstreamError(res, orderResp.status, orderResp.statusText, body);
    }

    const orderData = await orderResp.json();
    const order =
      Array.isArray(orderData.orders) && orderData.orders.length
        ? orderData.orders[0]
        : null;
    if (!order) {
      return res
        .status(404)
        .json({ error: "NOT_FOUND", message: "Order not found" });
    }

    let customerPlaceCode = null;
    try {
      if (order.customer && order.customer.id) {
        const metaUrl = `${buildApiBase()}/customers/${order.customer.id}/metafields.json`;
        const metaResp = await fetchWithTimeout(
          metaUrl,
          {
            headers: {
              "X-Shopify-Access-Token": config.shopify.accessToken,
              "Content-Type": "application/json"
            }
          },
          15000
        );

        if (metaResp.ok) {
          const metaData = await metaResp.json();
          const match = (metaData.metafields || []).find(
            (mf) =>
              mf.namespace === "custom" &&
              mf.key === "parcelperfect_place_code"
          );
          if (match && match.value) customerPlaceCode = match.value;
        } else {
          const body = await metaResp.text();
          console.warn("Customer metafields fetch failed:", metaResp.status, body);
        }
      }
    } catch (e) {
      console.warn("Customer metafields error:", e);
    }

    return res.json({ order, customerPlaceCode });
  } catch (err) {
    console.error("Shopify proxy error:", err);
    return res
      .status(502)
      .json({ error: "UPSTREAM_ERROR", message: String(err?.message || err) });
  }
});

router.get("/orders/open", async (_req, res) => {
  try {
    if (!ensureShopifyConfigured(res)) return;

    const url =
      `${buildApiBase()}/orders.json?status=any` +
      `&fulfillment_status=unfulfilled,in_progress` +
      `&limit=50&order=created_at+desc`;

    const resp = await fetchWithTimeout(
      url,
      {
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json"
        }
      },
      20000
    );

    if (!resp.ok) {
      const body = await resp.text();
      return upstreamError(res, resp.status, resp.statusText, body);
    }

    const data = await resp.json();
    const ordersRaw = Array.isArray(data.orders) ? data.orders : [];

    const orders = ordersRaw.map((o) => {
      const shipping = o.shipping_address || {};
      const customer = o.customer || {};

      let parcelCountFromTag = null;
      if (typeof o.tags === "string" && o.tags.trim()) {
        const parts = o.tags.split(",").map((t) => t.trim().toLowerCase());
        for (const t of parts) {
          const match = t.match(/^parcel_count_(\d+)$/);
          if (match) {
            parcelCountFromTag = parseInt(match[1], 10);
            break;
          }
        }
      }

      const customerName =
        shipping.name ||
        `${(customer.first_name || "").trim()} ${(customer.last_name || "").trim()}`.trim() ||
        (o.name ? o.name.replace(/^#/, "") : "");

      return {
        id: o.id,
        name: o.name,
        customer_name: customerName,
        created_at: o.processed_at || o.created_at,
        fulfillment_status: o.fulfillment_status,
        shipping_city: shipping.city || "",
        shipping_postal: shipping.zip || "",
        parcel_count: parcelCountFromTag,
        line_items: (o.line_items || []).map((li) => ({
          title: li.title,
          quantity: li.quantity
        }))
      };
    });

    return res.json({ orders });
  } catch (err) {
    console.error("Shopify open-orders error:", err);
    return res.status(502).json({
      error: "UPSTREAM_ERROR",
      message: String(err?.message || err)
    });
  }
});

router.get("/customers/search", async (req, res) => {
  try {
    if (!ensureShopifyConfigured(res)) return;

    const q = (req.query.q || "").trim();
    if (!q) {
      return badRequest(res, "Missing ?q= query string for customer search");
    }

    const url = `${buildApiBase()}/customers/search.json?query=${encodeURIComponent(
      q
    )}&limit=10`;

    const resp = await fetchWithTimeout(
      url,
      {
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      },
      20000
    );

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!resp.ok) {
      return upstreamError(res, resp.status, resp.statusText, data);
    }

    const customers = [];
    for (const c of Array.isArray(data.customers) ? data.customers : []) {
      let deliveryMethod = null;
      if (Array.isArray(c.tags)) {
        const lowerTags = c.tags.map((t) => String(t).toLowerCase());
        if (lowerTags.includes("delivery")) deliveryMethod = "deliver";
        if (lowerTags.includes("pickup")) deliveryMethod = "pickup";
      }

      const name =
        `${c.first_name || ""} ${c.last_name || ""}`.trim() ||
        c.company ||
        c.email ||
        String(c.id);

      customers.push({
        id: c.id,
        name,
        email: c.email || "",
        phone: c.phone || "",
        delivery_method: deliveryMethod,
        default_address: c.default_address || null,
        addresses: Array.isArray(c.addresses) ? c.addresses : []
      });
    }

    return res.json({ customers });
  } catch (err) {
    console.error("Shopify customer search error:", err);
    return res
      .status(502)
      .json({ error: "UPSTREAM_ERROR", message: String(err?.message || err) });
  }
});

router.post("/draft-orders", async (req, res) => {
  try {
    if (!ensureShopifyConfigured(res)) return;

    const {
      customerId,
      shippingAddress,
      billingAddress,
      shippingMethod,
      poNumber,
      lineItems,
      shippingPrice,
      shippingService
    } = req.body || {};

    if (!customerId) {
      return badRequest(res, "Missing customerId", req.body);
    }
    if (!Array.isArray(lineItems) || !lineItems.length) {
      return badRequest(res, "No lineItems supplied", req.body);
    }

    const url = `${buildApiBase()}/draft_orders.json`;

    const normalizedLineItems = lineItems.map((li) => ({
      variant_id: li.variantId,
      quantity: li.quantity || 1,
      sku: li.sku || undefined,
      title: li.title || undefined,
      ...(li.price != null ? { price: Number(li.price).toFixed(2) } : {})
    }));

    const metafields = [];
    if (poNumber) {
      metafields.push({
        namespace: "flocs",
        key: "po_number",
        type: "single_line_text_field",
        value: String(poNumber)
      });
    }
    if (shippingMethod) {
      metafields.push({
        namespace: "flocs",
        key: "delivery_method",
        type: "single_line_text_field",
        value: String(shippingMethod)
      });
    }

    const shipping_line =
      shippingMethod === "ship" && shippingPrice != null
        ? {
            title: shippingService
              ? `Courier – ${shippingService}`
              : "Courier shipping",
            price: Number(shippingPrice).toFixed(2)
          }
        : undefined;

    const draftPayload = {
      draft_order: {
        customer: { id: customerId },
        line_items: normalizedLineItems,
        note: poNumber ? `PO: ${poNumber}` : undefined,
        tags: ["FLOCS"],
        shipping_line,
        billing_address: billingAddress || undefined,
        shipping_address:
          shippingMethod === "ship" ? shippingAddress || undefined : undefined,
        metafields
      }
    };

    const upstream = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(draftPayload)
      },
      20000
    );

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      console.error("Draft order error:", upstream.status, text.slice(0, 400));
      return upstreamError(res, upstream.status, upstream.statusText, data);
    }

    const draft = data.draft_order || data;
    const adminUrl =
      draft && draft.id
        ? `${config.shopify.store}/admin/draft_orders/${draft.id}`
        : null;

    return res.json({
      ok: true,
      draftOrder: {
        id: draft.id,
        name: draft.name,
        invoiceUrl: draft.invoice_url || null,
        adminUrl,
        subtotalPrice: draft.subtotal_price,
        totalPrice: draft.total_price
      }
    });
  } catch (err) {
    console.error("Draft order create error:", err);
    return res
      .status(502)
      .json({ error: "UPSTREAM_ERROR", message: String(err?.message || err) });
  }
});

router.post("/fulfill", async (req, res) => {
  try {
    if (!ensureShopifyConfigured(res)) return;

    const {
      orderId,
      lineItems,
      trackingNumber,
      trackingUrl,
      trackingCompany
    } = req.body || {};

    if (!orderId || !trackingNumber) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_FIELDS",
        message: "orderId and trackingNumber are required"
      });
    }

    const url = `${buildApiBase()}/orders/${orderId}/fulfillments.json`;

    const fulfillmentPayload = {
      fulfillment: {
        ...(config.shopify.locationId
          ? { location_id: Number(config.shopify.locationId) }
          : {}),
        tracking_company: trackingCompany || config.shopify.trackingCompany,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl || undefined,
        notify_customer: true,
        ...(Array.isArray(lineItems) && lineItems.length
          ? {
              line_items: lineItems.map((li) => ({
                id: li.id,
                quantity: li.quantity
              }))
            }
          : {})
      }
    };

    const resp = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": config.shopify.accessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fulfillmentPayload)
      },
      20000
    );

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    console.log(
      "Shopify fulfill POST",
      url,
      "→",
      resp.status,
      String(text).slice(0, 400)
    );

    if (!resp.ok) {
      return res.status(resp.status).json({
        ok: false,
        status: resp.status,
        error: "SHOPIFY_ERROR",
        detail: data
      });
    }

    return res.json({
      ok: true,
      fulfillment: data.fulfillment || data
    });
  } catch (err) {
    console.error("Fulfill error:", err);
    return res.status(500).json({
      ok: false,
      error: "SERVER_ERROR",
      detail: String(err?.message || err)
    });
  }
});

export const shopifyRouter = router;
