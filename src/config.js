import dotenv from "dotenv";

dotenv.config();

const toBoolean = (value, defaultValue = false) => {
  if (value === undefined) return defaultValue;
  return String(value).toLowerCase() === "true";
};

const parseOrigins = (rawOrigins) =>
  new Set(
    (rawOrigins || "http://localhost:3000")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

const normalizeShopifyStore = (store) => {
  if (!store) return "";
  if (store.startsWith("http://") || store.startsWith("https://")) {
    return store.replace(/\/$/, "");
  }
  return `https://${store}.myshopify.com`;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  allowedOrigins: parseOrigins(process.env.FRONTEND_ORIGIN),
  parcelPerfect: {
    baseUrl: process.env.PP_BASE_URL || "",
    token: process.env.PP_TOKEN || "",
    requireToken: toBoolean(process.env.PP_REQUIRE_TOKEN, true),
    accountNumber: process.env.PP_ACCNUM || "",
    placeId: process.env.PP_PLACE_ID || "ShopifyScanStation"
  },
  shopify: {
    store: normalizeShopifyStore(process.env.SHOPIFY_STORE),
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || "",
    apiVersion: process.env.SHOPIFY_API_VERSION || "2024-10",
    locationId: process.env.SHOPIFY_LOCATION_ID,
    trackingCompany: process.env.TRACKING_COMPANY || "SWE Couriers"
  },
  printNode: {
    apiKey: process.env.PRINTNODE_API_KEY || "",
    printerId: process.env.PRINTNODE_PRINTER_ID || ""
  }
};

export const hasShopifyConfig =
  Boolean(config.shopify.store) && Boolean(config.shopify.accessToken);

export const hasPrintNodeConfig =
  Boolean(config.printNode.apiKey) && Boolean(config.printNode.printerId);

export const hasParcelPerfectConfig = Boolean(config.parcelPerfect.baseUrl);
