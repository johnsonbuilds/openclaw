import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import httpProxy from "http-proxy";

// Railway deployments sometimes inject PORT=3000 by default. We want the wrapper to
// reliably listen on 8080 unless explicitly overridden.
//
// Prefer OPENCLAW_PUBLIC_PORT (set in the Dockerfile / template) over PORT.
// Keep CLAWDBOT_PUBLIC_PORT as a backward-compat alias for older templates.
const PORT = Number.parseInt(
  process.env.OPENCLAW_PUBLIC_PORT ??
    process.env.CLAWDBOT_PUBLIC_PORT ??
    process.env.PORT ??
    "8080",
  10,
);

// State/workspace
// OpenClaw defaults to ~/.openclaw. Keep CLAWDBOT_* as backward-compat aliases.
const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR?.trim() ||
  process.env.CLAWDBOT_STATE_DIR?.trim() ||
  path.join(os.homedir(), ".openclaw");

const WORKSPACE_DIR =
  process.env.OPENCLAW_WORKSPACE_DIR?.trim() ||
  process.env.CLAWDBOT_WORKSPACE_DIR?.trim() ||
  path.join(STATE_DIR, "workspace");

// Protect /setup with a user-provided password.
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Gateway admin token (protects OpenClaw gateway + Control UI).
// Must be stable across restarts. If not provided via env, persist it in the state dir.
function resolveGatewayToken() {
  const envTok =
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || process.env.CLAWDBOT_GATEWAY_TOKEN?.trim();
  if (envTok) {
    return envTok;
  }

  try {
    const cfgPath = configPath();
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, "utf8");
      const parsed = JSON.parse(raw);
      const authToken = parsed?.gateway?.auth?.token;
      if (typeof authToken === "string" && authToken.trim()) {
        return authToken.trim();
      }
      const remoteToken = parsed?.gateway?.remote?.token;
      if (typeof remoteToken === "string" && remoteToken.trim()) {
        return remoteToken.trim();
      }
    }
  } catch {
    // ignore config read errors
  }

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) {
      return existing;
    }
  } catch {
    // ignore
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
  } catch {
    // best-effort
  }
  return generated;
}

const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;
// Backward-compat: some older flows expect CLAWDBOT_GATEWAY_TOKEN.
process.env.CLAWDBOT_GATEWAY_TOKEN = process.env.CLAWDBOT_GATEWAY_TOKEN || OPENCLAW_GATEWAY_TOKEN;

// Where the gateway will listen internally (we proxy to it).
// The wrapper always proxies requests to the gateway.
const INTERNAL_GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;
// Always bind the gateway to loopback so it's never directly exposed on the network.
// External access goes through this wrapper (reverse proxy) only.
const GATEWAY_BIND = "loopback";

// Always run the built-from-source CLI entry directly to avoid PATH/global-install mismatches.
const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY?.trim() || "/openclaw/dist/entry.js";
const OPENCLAW_NODE = process.env.OPENCLAW_NODE?.trim() || "node";

function clawArgs(args) {
  return [OPENCLAW_ENTRY, ...args];
}

function configPath() {
  return (
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    process.env.CLAWDBOT_CONFIG_PATH?.trim() ||
    path.join(STATE_DIR, "openclaw.json")
  );
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // Try the default Control UI base path, then fall back to legacy or root.
      const paths = ["/openclaw", "/clawdbot", "/"];
      for (const p of paths) {
        try {
          const res = await fetch(`${GATEWAY_TARGET}${p}`, { method: "GET" });
          // Any HTTP response means the port is open.
          if (res) {
            return true;
          }
        } catch {
          // try next
        }
      }
    } catch {
      // not ready
    }
    await sleep(250);
  }
  return false;
}

async function startGateway() {
  if (gatewayProc) {
    return;
  }
  if (!isConfigured()) {
    throw new Error("Gateway cannot start: not configured");
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const args = [
    "gateway",
    "run",
    "--bind",
    GATEWAY_BIND,
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    OPENCLAW_GATEWAY_TOKEN,
  ];

  gatewayProc = childProcess.spawn(OPENCLAW_NODE, clawArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      // Backward-compat aliases
      CLAWDBOT_STATE_DIR: process.env.CLAWDBOT_STATE_DIR || STATE_DIR,
      CLAWDBOT_WORKSPACE_DIR: process.env.CLAWDBOT_WORKSPACE_DIR || WORKSPACE_DIR,
    },
  });

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
  });
}

async function ensureGatewayRunning() {
  if (!isConfigured()) {
    return { ok: false, reason: "not configured" };
  }
  if (gatewayProc) {
    return { ok: true };
  }
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway();
      const ready = await waitForGatewayReady({ timeoutMs: 60_000 });
      if (!ready) {
        throw new Error("Gateway did not become ready in time");
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}

async function restartGateway() {
  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    // Give it a moment to exit and release the port.
    await sleep(750);
    gatewayProc = null;
  }
  return ensureGatewayRunning();
}

function notifyGatewayReady(port) {
  const readyNotifyUrl = process.env.AGENT_GATEWAY_READY_NOTIFY_URL?.trim() || "";
  if (!readyNotifyUrl) {
    return;
  }

  void (async () => {
    try {
      const parsed = new URL(readyNotifyUrl);
      const redacted = `${parsed.origin}${parsed.pathname}`;
      console.log(`[wrapper] sending gateway ready notification to ${redacted}`);
      const resp = await fetch(readyNotifyUrl, {
        method: "GET",
        headers: {
          "X-OpenClaw-Gateway-Port": String(port),
          "User-Agent": "OpenClaw/Gateway",
        },
      });
      if (!resp.ok) {
        console.warn(`[wrapper] gateway ready notification to ${redacted} returned ${resp.status}`);
      } else {
        console.log(
          `[wrapper] gateway ready notification to ${redacted} succeeded (${resp.status})`,
        );
      }
    } catch (err) {
      console.warn(`[wrapper] failed to send gateway ready notification: ${String(err)}`);
    }
  })();
}

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send("SETUP_PASSWORD is not set. Set it in Railway Variables before using /setup.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="OpenClaw Setup"');
    return res.status(401).send("Auth required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (password !== SETUP_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="OpenClaw Setup"');
    return res.status(401).send("Invalid password");
  }
  return next();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Minimal health endpoint for Railway.
app.get("/setup/healthz", (_req, res) => res.json({ ok: true }));

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
        // Backward-compat aliases
        CLAWDBOT_STATE_DIR: process.env.CLAWDBOT_STATE_DIR || STATE_DIR,
        CLAWDBOT_WORKSPACE_DIR: process.env.CLAWDBOT_WORKSPACE_DIR || WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

function redactSecrets(text) {
  if (!text) {
    return text;
  }
  // Very small best-effort redaction. (Config paths/values may still contain secrets.)
  return String(text)
    .replace(/(sk-[A-Za-z0-9_-]{10,})/g, "[REDACTED]")
    .replace(/(gho_[A-Za-z0-9_]{10,})/g, "[REDACTED]")
    .replace(/(xox[baprs]-[A-Za-z0-9-]{10,})/g, "[REDACTED]")
    .replace(/(AA[A-Za-z0-9_-]{10,}:\S{10,})/g, "[REDACTED]");
}

const ALLOWED_CONSOLE_COMMANDS = new Set([
  // Wrapper-managed lifecycle
  "gateway.restart",
  "gateway.stop",
  "gateway.start",

  // OpenClaw CLI helpers
  "openclaw.version",
  "openclaw.status",
  "openclaw.health",
  "openclaw.doctor",
  "openclaw.logs.tail",
  "openclaw.config.get",
]);

app.post("/setup/api/console/run", requireSetupAuth, async (req, res) => {
  const payload = req.body || {};
  const cmd = String(payload.cmd || "").trim();
  const arg = String(payload.arg || "").trim();

  if (!ALLOWED_CONSOLE_COMMANDS.has(cmd)) {
    return res.status(400).json({ ok: false, error: "Command not allowed" });
  }

  try {
    if (cmd === "gateway.restart") {
      await restartGateway();
      return res.json({
        ok: true,
        output: "Gateway restarted (wrapper-managed).\n",
      });
    }
    if (cmd === "gateway.stop") {
      if (gatewayProc) {
        try {
          gatewayProc.kill("SIGTERM");
        } catch {}
        await sleep(750);
        gatewayProc = null;
      }
      return res.json({
        ok: true,
        output: "Gateway stopped (wrapper-managed).\n",
      });
    }
    if (cmd === "gateway.start") {
      const r = await ensureGatewayRunning();
      return res.json({
        ok: Boolean(r.ok),
        output: r.ok ? "Gateway started.\n" : `Gateway not started: ${r.reason}\n`,
      });
    }

    if (cmd === "openclaw.version") {
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
      return res
        .status(r.code === 0 ? 200 : 500)
        .json({ ok: r.code === 0, output: redactSecrets(r.output) });
    }
    if (cmd === "openclaw.status") {
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["status"]));
      return res
        .status(r.code === 0 ? 200 : 500)
        .json({ ok: r.code === 0, output: redactSecrets(r.output) });
    }
    if (cmd === "openclaw.health") {
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["health"]));
      return res
        .status(r.code === 0 ? 200 : 500)
        .json({ ok: r.code === 0, output: redactSecrets(r.output) });
    }
    if (cmd === "openclaw.doctor") {
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["doctor"]));
      return res
        .status(r.code === 0 ? 200 : 500)
        .json({ ok: r.code === 0, output: redactSecrets(r.output) });
    }
    if (cmd === "openclaw.logs.tail") {
      const lines = Math.max(50, Math.min(1000, Number.parseInt(arg || "200", 10) || 200));
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["logs", "--tail", String(lines)]));
      return res
        .status(r.code === 0 ? 200 : 500)
        .json({ ok: r.code === 0, output: redactSecrets(r.output) });
    }
    if (cmd === "openclaw.config.get") {
      if (!arg) {
        return res.status(400).json({ ok: false, error: "Missing config path" });
      }
      const r = await runCmd(OPENCLAW_NODE, clawArgs(["config", "get", arg]));
      return res
        .status(r.code === 0 ? 200 : 500)
        .json({ ok: r.code === 0, output: redactSecrets(r.output) });
    }

    return res.status(400).json({ ok: false, error: "Unhandled command" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// Proxy everything else to the gateway.
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, _req, _res) => {
  console.error("[proxy]", err);
});

app.use(async (req, res) => {
  // If not configured, force users to /setup for any non-setup routes.
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    try {
      await ensureGatewayRunning();
    } catch (err) {
      return res
        .status(503)
        .type("text/plain")
        .send(`Gateway not ready: ${String(err)}`);
    }
  }

  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[wrapper] listening on :${PORT}`);
  console.log(`[wrapper] state dir: ${STATE_DIR}`);
  console.log(`[wrapper] workspace dir: ${WORKSPACE_DIR}`);
  console.log(`[wrapper] gateway token: ${OPENCLAW_GATEWAY_TOKEN ? "(set)" : "(missing)"}`);
  console.log(`[wrapper] gateway target: ${GATEWAY_TARGET}`);
  if (!SETUP_PASSWORD) {
    console.warn("[wrapper] WARNING: SETUP_PASSWORD is not set; /setup will error.");
  }
  // Don't start gateway unless configured; proxy will ensure it starts.
  console.log(`[wrapper] Checking if configured: ${isConfigured()}`);
  if (isConfigured()) {
    console.log(`[wrapper] Starting gateway immediately...`);
    ensureGatewayRunning()
      .then((result) => {
        console.log(`[wrapper] Gateway start result: ${JSON.stringify(result)}`);
        if (result?.ok === true) {
          notifyGatewayReady(INTERNAL_GATEWAY_PORT);
        }
      })
      .catch((err) => {
        console.error(`[wrapper] Failed to start gateway immediately: ${String(err)}`);
      });
  } else {
    console.log(`[wrapper] Gateway not configured, skipping immediate start`);
  }
});

server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

process.on("SIGTERM", () => {
  // Best-effort shutdown
  try {
    if (gatewayProc) {
      gatewayProc.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
  process.exit(0);
});
