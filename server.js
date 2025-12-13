// server.js – Flippen Lekka Scan Station backend (modularized)
import { createApp } from "./src/app.js";
import { config } from "./src/config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Scan Station server listening on http://localhost:${config.port}`);
  console.log(`Allowed origins: ${[...config.allowedOrigins].join(", ")}`);
  console.log("PP_BASE_URL:", config.parcelPerfect.baseUrl || "(NOT SET)");
});
