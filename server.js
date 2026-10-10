require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAIL_DOMAIN = String(process.env.MAIL_DOMAIN || "").trim().toLowerCase();
const TTL_MINUTES = Math.max(5, Math.min(1440, Number(process.env.INBOX_TTL_MINUTES || 60)));
const WEBHOOK_KEY = String(process.env.MAILGUN_WEBHOOK_SIGNING_KEY || "");
const DATA_DIR = path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, "quickinbox.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS inboxes (
  address TEXT PRIMARY KEY, token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, recipient TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL,
  body TEXT NOT NULL, received_at INTEGER NOT NULL,
  FOREIGN KEY(recipient) REFERENCES inboxes(address) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient, received_at DESC);
`);
db.pragma("foreign_keys = ON");

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    scriptSrc: ["'self'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"],
    objectSrc: ["'none'"], frameAncestors: ["'none'"]
  }
}}));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
const upload = multer({ limits: { fieldSize: 200000, fields: 30, files: 0 } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString("base64url"); }
function cleanExpired() {
  const now = Date.now();
  db.prepare("DELETE FROM messages WHERE recipient IN (SELECT address FROM inboxes WHERE expires_at <= ?)").run(now);
  db.prepare("DELETE FROM inboxes WHERE expires_at <= ?").run(now);
}
setInterval(cleanExpired, 60_000).unref();
cleanExpired();

function requireInbox(req, res, next) {
  cleanExpired();
  const address = String(req.params.address || "").toLowerCase();
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address)) {
    return res.status(401).json({ error: "Inbox authorization required." });
  }
  const inbox = db.prepare("SELECT address, expires_at FROM inboxes WHERE address=? AND token_hash=?")
    .get(address, sha(token));
  if (!inbox || inbox.expires_at <= Date.now()) return res.status(401).json({ error: "Inbox expired or access token is invalid." });
  req.inbox = inbox;
  next();
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "QuickInbox" }));

app.post("/api/inboxes", (req, res) => {
  cleanExpired();
  if (!MAIL_DOMAIN || MAIL_DOMAIN === "yourdomain.com") {
    return res.status(503).json({ error: "Set MAIL_DOMAIN to your verified receiving domain in the environment settings first." });
  }
  if (!/^[a-z0-9.-]+$/.test(MAIL_DOMAIN) || !MAIL_DOMAIN.includes(".")) {
    return res.status(500).json({ error: "MAIL_DOMAIN configuration is invalid." });
  }
  const token = randomToken();
  let address;
  for (let i = 0; i < 5; i++) {
    address = `${randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12)}@${MAIL_DOMAIN}`;
    try {
      const now = Date.now();
      db.prepare("INSERT INTO inboxes(address,token_hash,created_at,expires_at) VALUES(?,?,?,?)")
        .run(address, sha(token), now, now + TTL_MINUTES * 60_000);
      return res.status(201).json({ address, token, expiresAt: now + TTL_MINUTES * 60_000, ttlMinutes: TTL_MINUTES });
    } catch (e) {
      if (i === 4) return res.status(500).json({ error: "Could not create an inbox. Please try again." });
    }
  }
});

app.get("/api/inboxes/:address/messages", requireInbox, (req, res) => {
  const rows = db.prepare("SELECT id, sender, subject, body, received_at AS receivedAt FROM messages WHERE recipient=? ORDER BY received_at DESC LIMIT 100")
    .all(req.inbox.address);
  res.json({ messages: rows, expiresAt: req.inbox.expires_at });
});

app.get("/api/inboxes/:address/messages/:id", requireInbox, (req, res) => {
  const message = db.prepare("SELECT id, sender, subject, body, received_at AS receivedAt FROM messages WHERE recipient=? AND id=?")
    .get(req.inbox.address, req.params.id);
  if (!message) return res.status(404).json({ error: "Message not found." });
  res.json({ message, expiresAt: req.inbox.expires_at });
});

app.delete("/api/inboxes/:address", requireInbox, (req, res) => {
  db.prepare("DELETE FROM messages WHERE recipient=?").run(req.inbox.address);
  db.prepare("DELETE FROM inboxes WHERE address=?").run(req.inbox.address);
  res.json({ ok: true });
});

// Mailgun inbound route: POST parsed email fields to https://YOUR-APP/mailgun/inbound
// Mailgun signs requests using HMAC-SHA256(timestamp + token).
app.post("/mailgun/inbound", upload.none(), (req, res) => {
  if (!WEBHOOK_KEY) return res.status(503).send("Webhook signing key is not configured.");
  const signature = req.body.signature;
  const timestamp = req.body.timestamp;
  const token = req.body.token;
  if (!signature || !timestamp || !token || !/^\d+$/.test(String(timestamp))) {
    return res.status(403).send("Missing webhook signature fields.");
  }
  // Reject old webhook requests to reduce replay risk (allow 5 minutes of clock drift).
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.status(403).send("Webhook timestamp expired.");
  const expected = crypto.createHmac("sha256", WEBHOOK_KEY).update(String(timestamp) + String(token)).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(String(signature), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).send("Invalid webhook signature.");

  const recipients = String(req.body.recipient || req.body.To || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  const inboxes = recipients.map(x => db.prepare("SELECT address FROM inboxes WHERE address=? AND expires_at>?").get(x, Date.now())).filter(Boolean);
  if (!inboxes.length) return res.status(200).send("No active QuickInbox recipient.");
  const sender = String(req.body.sender || req.body.From || "Unknown sender").slice(0, 320);
  const subject = String(req.body.subject || "(No subject)").slice(0, 500);
  const body = String(req.body["stripped-text"] || req.body["body-plain"] || req.body["body-html"] || "This message has no readable body.").slice(0, 100000);
  const insert = db.prepare("INSERT OR IGNORE INTO messages(id,recipient,sender,subject,body,received_at) VALUES(?,?,?,?,?,?)");
  const now = Date.now();
  const transaction = db.transaction(() => {
    for (const item of inboxes) insert.run(randomToken(12), item.address, sender, subject, body, now);
  });
  transaction();
  res.status(200).send("Accepted");
});

app.use((err, req, res, next) => {
  console.error("Request error:", err.message);
  if (res.headersSent) return next(err);
  res.status(400).json({ error: "Invalid request." });
});

app.listen(PORT, () => {
  console.log(`QuickInbox running on port ${PORT}`);
  console.log(`Mail domain configured: ${MAIL_DOMAIN || "(not set)"}`);
});
