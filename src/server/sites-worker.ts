import worker from "./worker";

// ChatGPT Sites currently invokes the HTTP fetch handler only.
// Queue and scheduled handlers remain available in src/server/worker.ts for
// Cloudflare deployments, while audit jobs fall back to waitUntil in Sites.
export default {
  fetch: worker.fetch,
};
