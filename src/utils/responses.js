export const badRequest = (res, message, detail) =>
  res.status(400).json({ error: "BAD_REQUEST", message, detail });

export const configError = (res, message) =>
  res.status(501).json({ error: "CONFIG_ERROR", message });

export const upstreamError = (res, status, statusText, body) =>
  res.status(status).json({
    error: "UPSTREAM_ERROR",
    status,
    statusText,
    body
  });
