import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import { config } from "./config.js";
import { parcelPerfectRouter } from "./routes/parcelPerfect.js";
import { shopifyRouter } from "./routes/shopify.js";
import { printNodeRouter } from "./routes/printnode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
  maxAge: 86400
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cors(corsOptions));
  app.options("*", (_, res) => res.sendStatus(204));

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

  // Feature routes
  app.use("/pp", parcelPerfectRouter);
  app.use("/shopify", shopifyRouter);
  app.use("/printnode", printNodeRouter);

  // Health check
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // Friendly error handler for middleware issues (e.g. CORS)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.message?.includes("not allowed by CORS")) {
      return res.status(403).json({
        error: "CORS_ERROR",
        message: err.message,
        allowedOrigins: [...config.allowedOrigins]
      });
    }

    console.error("Unhandled error:", err);
    return res
      .status(500)
      .json({ error: "SERVER_ERROR", message: err?.message || "Unknown error" });
  });

  // Static assets and SPA fallbacks
  app.use(express.static(publicDir));
  app.get("/flops", (_req, res) => {
    res.sendFile(path.join(publicDir, "flops.html"));
  });
  app.get("/flocs", (_req, res) => {
    res.sendFile(path.join(publicDir, "flocs.html"));
  });
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
};
