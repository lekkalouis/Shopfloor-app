import fetch from "node-fetch";

/**
 * node-fetch v3 removed the built-in timeout option. This helper replicates a
 * simple timeout by wiring an AbortController to the request and aborting it
 * after the provided timeout window.
 *
 * @param {string|URL} url
 * @param {import('node-fetch').RequestInit} options
 * @param {number} timeoutMs
 */
export const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      err.message = `Request to ${url} timed out after ${timeoutMs}ms`;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
};
