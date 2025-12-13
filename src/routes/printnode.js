import express from "express";
import fetch from "node-fetch";
import { config, hasPrintNodeConfig } from "../config.js";
import { badRequest, configError } from "../utils/responses.js";

const router = express.Router();

router.post("/print", async (req, res) => {
  try {
    const { pdfBase64, title } = req.body || {};

    if (!pdfBase64) {
      return badRequest(res, "Missing pdfBase64");
    }

    if (!hasPrintNodeConfig) {
      return configError(
        res,
        "Set PRINTNODE_API_KEY and PRINTNODE_PRINTER_ID in your .env file"
      );
    }

    const auth = Buffer.from(config.printNode.apiKey + ":").toString("base64");

    const payload = {
      printerId: Number(config.printNode.printerId),
      title: title || "Parcel Label",
      contentType: "pdf_base64",
      content: pdfBase64.replace(/\s/g, ""),
      source: "Flippen Lekka Scan Station"
    };

    const upstream = await fetch("https://api.printnode.com/printjobs", {
      method: "POST",
      headers: {
        Authorization: "Basic " + auth,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!upstream.ok) {
      console.error(
        "PrintNode error:",
        upstream.status,
        upstream.statusText,
        text
      );
      return res.status(upstream.status).json({
        error: "PRINTNODE_UPSTREAM",
        status: upstream.status,
        statusText: upstream.statusText,
        body: data
      });
    }

    return res.json({ ok: true, printJob: data });
  } catch (err) {
    console.error("PrintNode proxy error:", err);
    return res.status(502).json({
      error: "UPSTREAM_ERROR",
      message: String(err?.message || err)
    });
  }
});

export const printNodeRouter = router;
