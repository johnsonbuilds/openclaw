import { test, expect } from "vitest";
import { createServer } from "node:http";
import {
  getFreePort,
  installGatewayTestHooks,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

test("sends GET to AGENT_GATEWAY_READY_NOTIFY_URL after startup", async () => {
  const notifyPort = await getFreePort();

  let received = false;
  const srv = createServer((req, res) => {
    if (req.method === "GET") {
      received = true;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(405);
      res.end();
    }
  });

  await new Promise<void>((resolve) => srv.listen(notifyPort, "127.0.0.1", resolve));
  try {
    process.env.AGENT_GATEWAY_READY_NOTIFY_URL = `http://127.0.0.1:${notifyPort}/ready`;
    const port = await getFreePort();
    const server = await startGatewayServer(port, { bind: "loopback" });
    try {
      // wait up to 3s for the notification to arrive
      const start = Date.now();
      while (!received && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(received).toBe(true);
    } finally {
      await server.close();
    }
  } finally {
    srv.close();
    delete process.env.AGENT_GATEWAY_READY_NOTIFY_URL;
  }
});
