import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5500";
const DB_PATH = process.env.DB_PATH || "./videoss.sqlite";
const MAX_VIDEO_SECONDS = Number(process.env.MAX_VIDEO_SECONDS || 3600);
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "");

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random secret of at least 32 characters in .env");
  process.exit(1);
}

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: FRONTEND_ORIGIN.split(",").map(s => s.trim()), methods: ["GET","POST","PUT"], allowedHeaders: ["Content-Type","Authorization"] }));
app.use(express.json({ limit: "20kb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
`);
const findUser = db.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ?");
const createUser = db.prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)");
const publicUser = u => ({ id: u.id, name: u.name, email: u.email });

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!token) throw new Error("missing");
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Please log in to continue." });
  }
}

function adminRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    if (!token) throw new Error("missing");
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") throw new Error("not admin");
    req.admin = payload;
    next();
  } catch { return res.status(401).json({ error: "Admin login required." }); }
}

function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}
function saveSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP").run(key, JSON.stringify(value));
}

function ytdlpCommand() {
  // Set YTDLP_MODE=python on hosts where yt-dlp was installed using pip.
  return process.env.YTDLP_MODE === "python"
    ? { command: process.env.PYTHON_BIN || "python3", prefix: ["-m", "yt_dlp"] }
    : { command: process.env.YTDLP_BIN || "yt-dlp", prefix: [] };
}

function cleanUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a valid video URL.");
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("Enter a valid video URL."); }
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS video links are accepted.");
  if (parsed.username || parsed.password) throw new Error("URLs containing credentials are not accepted.");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  // Public, well-known video hosts only. Add hosts after reviewing their policies.
  const allowed = [
    "youtube.com","m.youtube.com","youtu.be","youtube-nocookie.com",
    "instagram.com","facebook.com","fb.watch","tiktok.com","vm.tiktok.com",
    "x.com","twitter.com","vimeo.com","dailymotion.com"
  ];
  if (!allowed.some(domain => host === domain || host.endsWith("." + domain))) {
    throw new Error("This platform is not enabled yet.");
  }
  // Avoid local/private network destinations and non-standard ports.
  if (parsed.port && parsed.port !== "443") throw new Error("Non-standard URL ports are not accepted.");
  return parsed.toString();
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const runner = ytdlpCommand();
    const child = spawn(runner.command, [...runner.prefix, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d.toString(); if (stdout.length > 2_000_000) child.kill(); });
    child.stderr.on("data", d => { stderr += d.toString(); if (stderr.length > 30_000) stderr = stderr.slice(-30_000); });
    child.on("error", () => reject(new Error("Video engine is not installed. Install yt-dlp on the server.")));
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim().split("\n").slice(-3).join(" ") || "Could not process this video.")));
  });
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "Videoss API", videoEngineMode: process.env.YTDLP_MODE === "python" ? "python-module" : "binary" }));

// Admin account is provisioned through Render environment variables, never through public signup.
app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60_000, limit: 8 }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return res.status(503).json({ error: "Admin credentials are not configured on the server." });
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Email or password is incorrect." });
  const token = jwt.sign({ sub: "admin", email, role: "admin" }, JWT_SECRET, { expiresIn: "4h", issuer: "videoss-api" });
  res.json({ token, admin: { email, role: "admin" }, expiresIn: "4h" });
});

const defaultAdminSettings = {
  siteName: "Videoss", maintenanceMode: false,
  ads: { enabled: false, provider: "adsense", publisherId: "", autoAds: false, placements: { homeTop: false, resultsTop: false, resultsBottom: false, footer: false }, slots: { homeTop: "", resultsTop: "", resultsBottom: "", footer: "" } },
  contactEmail: "", announcement: ""
};
app.get("/api/site-config", (_req, res) => {
  const cfg = getSetting("siteConfig", defaultAdminSettings);
  // Only return public configuration; never return secrets or admin credentials.
  res.json({ siteName: cfg.siteName, maintenanceMode: Boolean(cfg.maintenanceMode), announcement: cfg.announcement || "", ads: { enabled: Boolean(cfg.ads?.enabled), provider: cfg.ads?.provider || "adsense", publisherId: cfg.ads?.publisherId || "", autoAds: Boolean(cfg.ads?.autoAds), placements: cfg.ads?.placements || {}, slots: cfg.ads?.slots || {} } });
});
app.get("/api/admin/settings", adminRequired, (_req, res) => res.json({ settings: getSetting("siteConfig", defaultAdminSettings) }));
app.put("/api/admin/settings", adminRequired, (req, res) => {
  const body = req.body || {};
  const clean = {
    siteName: String(body.siteName || "Videoss").trim().slice(0, 80),
    maintenanceMode: Boolean(body.maintenanceMode),
    contactEmail: String(body.contactEmail || "").trim().slice(0, 254),
    announcement: String(body.announcement || "").trim().slice(0, 500),
    ads: {
      enabled: Boolean(body.ads?.enabled), provider: ["adsense", "manual", "other"].includes(body.ads?.provider) ? body.ads.provider : "adsense",
      publisherId: String(body.ads?.publisherId || "").trim().slice(0, 120), autoAds: Boolean(body.ads?.autoAds),
      placements: Object.fromEntries(["homeTop", "resultsTop", "resultsBottom", "footer"].map(k => [k, Boolean(body.ads?.placements?.[k])])),
      slots: Object.fromEntries(["homeTop", "resultsTop", "resultsBottom", "footer"].map(k => [k, String(body.ads?.slots?.[k] || "").trim().slice(0, 120)]))
    }
  };
  if (clean.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.contactEmail)) return res.status(400).json({ error: "Enter a valid contact email." });
  saveSetting("siteConfig", clean);
  res.json({ ok: true, settings: clean, note: "Saved in the configured database. Verify persistent database storage before production use." });
});
app.get("/api/admin/overview", adminRequired, (_req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const cfg = getSetting("siteConfig", defaultAdminSettings);
  res.json({ users, adsEnabled: Boolean(cfg.ads?.enabled), maintenanceMode: Boolean(cfg.maintenanceMode), uptimeSeconds: Math.round(process.uptime()), note: "Ad revenue and impressions must be read from the ad network reporting API; they are not guessed here." });
});

app.post("/api/auth/signup", rateLimit({ windowMs: 15 * 60_000, limit: 10 }), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Name must be 2–80 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Password must be 10–128 characters." });
    if (findUser.get(email)) return res.status(409).json({ error: "An account with this email already exists." });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = createUser.run(name, email, passwordHash);
    const user = { id: Number(result.lastInsertRowid), name, email };
    const token = jwt.sign({ sub: user.id, email }, JWT_SECRET, { expiresIn: "7d", issuer: "videoss-api" });
    res.status(201).json({ user, token });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(409).json({ error: "An account with this email already exists." });
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60_000, limit: 15 }), async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = findUser.get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  const token = jwt.sign({ sub: user.id, email }, JWT_SECRET, { expiresIn: "7d", issuer: "videoss-api" });
  res.json({ user: publicUser(user), token });
});

app.get("/api/auth/me", authRequired, (req, res) => {
  const user = db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(Number(req.auth.sub));
  if (!user) return res.status(401).json({ error: "Account not found." });
  res.json({ user });
});

// Optional Cloudflare Turnstile verification. Configure TURNSTILE_SECRET and send turnstileToken
// from the frontend in production. Never trust a client-side checkbox as proof.
async function verifyTurnstile(token, remoteIp) {
  if (!process.env.TURNSTILE_SECRET) return process.env.NODE_ENV !== "production";
  if (!token) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const data = await response.json();
  return Boolean(data.success);
}

app.post("/api/video/info", rateLimit({ windowMs: 60_000, limit: 12 }), async (req, res) => {
  try {
    const url = cleanUrl(req.body?.url);
    const captchaOk = await verifyTurnstile(req.body?.turnstileToken, req.ip);
    if (!captchaOk) return res.status(400).json({ error: "Please complete the security check." });
    const raw = await runYtDlp(["--dump-single-json", "--no-playlist", "--no-warnings", "--socket-timeout", "15", "--", url]);
    const info = JSON.parse(raw);
    if (info.is_live) return res.status(400).json({ error: "Live streams are not supported." });
    if (info.duration && info.duration > MAX_VIDEO_SECONDS) return res.status(400).json({ error: `Videos longer than ${Math.round(MAX_VIDEO_SECONDS / 60)} minutes are not supported.` });
    const formats = (info.formats || [])
      .filter(f => f.url && f.vcodec !== "none" && ["mp4","webm","m4v"].includes((f.ext || "").toLowerCase()))
      .filter(f => f.height && f.height <= 1080)
      .sort((a,b) => (b.height || 0) - (a.height || 0))
      .slice(0, 8)
      .map(f => ({ formatId: f.format_id, quality: `${f.height}p ${f.ext.toUpperCase()}`, ext: f.ext, height: f.height, filesize: f.filesize || f.filesize_approx || null }));
    const audio = (info.formats || []).find(f => f.url && f.vcodec === "none" && f.acodec !== "none" && f.ext === "m4a");
    if (audio) formats.push({ formatId: audio.format_id, quality: "Audio only (M4A)", ext: "m4a", height: null, filesize: audio.filesize || audio.filesize_approx || null });
    res.json({
      id: crypto.randomUUID(),
      title: String(info.title || "Video").slice(0, 300),
      thumbnail: info.thumbnail || null,
      duration: Number(info.duration || 0),
      platform: info.extractor_key || info.extractor || "Video",
      uploader: info.uploader || null,
      formats
    });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not retrieve this video." });
  }
});

// Download requests require a verified metadata URL again. This intentionally does not bypass
// DRM, private/login-only content, or access restrictions. Use only content you own or may download.
app.post("/api/video/download", rateLimit({ windowMs: 60_000, limit: 6 }), async (req, res) => {
  let tempDir;
  try {
    const url = cleanUrl(req.body?.url);
    const formatId = String(req.body?.formatId || "");
    if (!/^[\w.-]{1,40}$/.test(formatId)) return res.status(400).json({ error: "Invalid format selection." });
    const captchaOk = await verifyTurnstile(req.body?.turnstileToken, req.ip);
    if (!captchaOk) return res.status(400).json({ error: "Please complete the security check." });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "videoss-"));
    const out = path.join(tempDir, "video.%(ext)s");
    const runner = ytdlpCommand();
    const child = spawn(runner.command, [...runner.prefix,
      "--no-playlist", "--no-warnings", "--socket-timeout", "20",
      "-f", formatId, "-o", out, "--max-filesize", "500M", "--", url
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let errorText = "";
    child.stderr.on("data", d => { errorText += d.toString(); if (errorText.length > 12000) errorText = errorText.slice(-12000); });
    child.on("error", () => { if (!res.headersSent) res.status(500).json({ error: "Video engine is not installed on this server." }); });
    child.on("close", code => {
      try {
        if (code !== 0) {
          if (!res.headersSent) res.status(400).json({ error: errorText.trim().split("\n").slice(-2).join(" ") || "Download failed." });
          return;
        }
        const file = fs.readdirSync(tempDir).map(n => path.join(tempDir, n)).find(p => fs.statSync(p).isFile());
        if (!file) { if (!res.headersSent) res.status(500).json({ error: "No output file was created." }); return; }
        const ext = path.extname(file) || ".mp4";
        res.download(file, `videoss-${Date.now()}${ext}`, () => {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        });
      } catch {
        if (!res.headersSent) res.status(500).json({ error: "Could not prepare the download." });
      }
    });
  } catch (err) {
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
    if (!res.headersSent) res.status(400).json({ error: err.message || "Download failed." });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => console.log(`Videoss API listening on http://localhost:${PORT}`));
