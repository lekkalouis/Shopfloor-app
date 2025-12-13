import express from "express";
import fetch from "node-fetch";
import { config, hasParcelPerfectConfig } from "../config.js";
import { badRequest } from "../utils/responses.js";

const router = express.Router();

const ensureBaseUrl = (res) => {
  const { baseUrl } = config.parcelPerfect;
  if (!hasParcelPerfectConfig || !baseUrl.startsWith("http")) {
    res.status(500).json({
      error: "CONFIG_ERROR",
      message: "PP_BASE_URL must be a valid URL"
    });
    return null;
  }
  return baseUrl;
};

router.post("/", async (req, res) => {
  try {
    const { method, classVal, params } = req.body || {};

    if (!method || !classVal || typeof params !== "object") {
      return badRequest(res, "Expected { method, classVal, params } in body");
    }

    const baseUrl = ensureBaseUrl(res);
    if (!baseUrl) return;

    const form = new URLSearchParams();
    form.set("method", String(method));
    form.set("class", String(classVal));
    form.set("params", JSON.stringify(params));

    if (config.parcelPerfect.requireToken && config.parcelPerfect.token) {
      form.set("token_id", config.parcelPerfect.token);
    }

    const upstream = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    const text = await upstream.text();
    const contentType =
      upstream.headers.get("content-type") || "application/json; charset=utf-8";
    res.set("content-type", contentType);

    try {
      const json = JSON.parse(text);
      return res.status(upstream.status).json(json);
    } catch {
      return res.status(upstream.status).send(text);
    }
  } catch (err) {
    console.error("PP proxy error:", err);
    return res.status(502).json({
      error: "UPSTREAM_ERROR",
      message: String(err?.message || err)
    });
  }
});

router.get("/place", async (req, res) => {
  try {
    const query = (req.query.q || req.query.query || "").trim();
    if (!query) {
      return badRequest(res, "Missing ?q= query string for place search");
    }

    if (!config.parcelPerfect.token) {
      return res.status(500).json({
        error: "CONFIG_ERROR",
        message: "PP_TOKEN is required for getPlace"
      });
    }

    const baseUrl = ensureBaseUrl(res);
    if (!baseUrl) return;

    const paramsObj = {
      id: config.parcelPerfect.placeId,
      accnum: config.parcelPerfect.accountNumber,
      ppcust: ""
    };

    const qs = new URLSearchParams();
    qs.set("Class", "Waybill");
    qs.set("method", "getPlace");
    qs.set("token_id", config.parcelPerfect.token);
    qs.set("params", JSON.stringify(paramsObj));
    qs.set("query", query);

    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = `${normalizedBase}?${qs.toString()}`;

    const upstream = await fetch(url, { method: "GET" });
    const text = await upstream.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error("PP getPlace JSON parse error:", e);
      return res.status(upstream.status).send(text);
    }

    return res.status(upstream.status).json(json);
  } catch (err) {
    console.error("PP getPlace error:", err);
    return res.status(502).json({
      error: "UPSTREAM_ERROR",
      message: String(err?.message || err)
    });
  }
});

export const parcelPerfectRouter = router;
