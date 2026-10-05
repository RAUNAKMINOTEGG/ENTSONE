const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;
const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VONAGE_API_KEY = process.env.VONAGE_API_KEY || "";
const VONAGE_API_SECRET = process.env.VONAGE_API_SECRET || "";
const VONAGE_BRAND = process.env.VONAGE_BRAND || "ENTSONE";
const OTP_MODE = "demo"; // OTP intentionally demo-only. Payment remains demo-only in the user app.
const ENTSONE_ADMIN_KEY = process.env.ENTSONE_ADMIN_KEY || "";

const allowedOrigins = String(process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  credentials: false
}));
app.use(express.json({ limit: "200kb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function normalizePhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits.length === 10 ? digits : digits;
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getBearerToken(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

async function getSessionUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.created_at, s.id AS session_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1`,
    [hashSecret(token)]
  );
  return result.rows[0] || null;
}

async function requireUser(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return res.status(401).json({ success: false, message: "Valid login session required" });
    req.user = user;
    next();
  } catch (error) {
    console.error("User authentication error:", error);
    res.status(500).json({ success: false, message: "Authentication check failed" });
  }
}

function requireUserId(req, res, next) {
  const requested = Number(req.params.id || req.params.userId);
  if (!Number.isInteger(requested) || requested < 1 || requested !== Number(req.user.id)) {
    return res.status(403).json({ success: false, message: "You can only access your own account" });
  }
  next();
}

const otpRate = new Map();
function allowOtpRequest(key, limit = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const recent = (otpRate.get(key) || []).filter(ts => now - ts < windowMs);
  if (recent.length >= limit) { otpRate.set(key, recent); return false; }
  recent.push(now); otpRate.set(key, recent); return true;
}

function requireAdmin(req, res, next) {
  const provided = String(req.headers["x-admin-key"] || "");
  if (!ENTSONE_ADMIN_KEY || !provided) {
    return res.status(401).json({ success: false, message: "Admin authentication required" });
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(ENTSONE_ADMIN_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ success: false, message: "Invalid admin key" });
  }
  next();
}

function vonageAuthHeader() {
  if (!VONAGE_API_KEY || !VONAGE_API_SECRET) {
    throw new Error("Vonage API credentials are missing");
  }
  return "Basic " + Buffer.from(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`).toString("base64");
}

function makeDemoOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function verifyDemoOtpHash(code, hash) {
  return hashSecret(code) === String(hash || "");
}

async function requestVonageVerification(phone) {
  const response = await fetch("https://api.nexmo.com/v2/verify", {
    method: "POST",
    headers: {
      "Authorization": vonageAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      brand: VONAGE_BRAND,
      code_length: 6,
      workflow: [{ channel: "sms", to: `+91${phone}` }]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.request_id) {
    console.error("Vonage Verify start error:", response.status, data);
    const err = new Error(data.title || data.detail || data.message || "Vonage OTP request failed");
    err.status = response.status;
    throw err;
  }
  return data.request_id;
}

async function verifyVonageCode(requestId, code) {
  const response = await fetch(`https://api.nexmo.com/v2/verify/${encodeURIComponent(requestId)}`, {
    method: "POST",
    headers: {
      "Authorization": vonageAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ code })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || String(data.status || "").toLowerCase() !== "completed") {
    console.error("Vonage Verify code error:", response.status, data);
    const err = new Error(data.title || data.detail || data.message || "Invalid or expired OTP");
    err.status = response.status;
    throw err;
  }
  return data;
}

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        game VARCHAR(100) NOT NULL,
        mode VARCHAR(50),
        entry_fee NUMERIC DEFAULT 0,
        prize_pool NUMERIC DEFAULT 0,
        start_time TIMESTAMP,
        status VARCHAR(50) DEFAULT 'UPCOMING',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        phone VARCHAR(30) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tournament_registrations (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        team_name VARCHAR(255),
        mode VARCHAR(50),
        payment_status VARCHAR(20) DEFAULT 'DEMO',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournament_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        player_name VARCHAR(255) NOT NULL,
        team_name VARCHAR(255),
        position INTEGER NOT NULL,
        kills INTEGER DEFAULT 0,
        points INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS otp_requests (
        id SERIAL PRIMARY KEY,
        channel VARCHAR(20) NOT NULL,
        destination VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(64),
        provider VARCHAR(30) DEFAULT 'local',
        provider_request_id VARCHAR(255),
        expires_at TIMESTAMP NOT NULL,
        attempts INTEGER DEFAULT 0,
        mode VARCHAR(20) DEFAULT 'login',
        verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS slots INTEGER DEFAULT 0;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS start_label VARCHAR(255);
      ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS provider VARCHAR(30) DEFAULT 'local';
      ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS provider_request_id VARCHAR(255);
      ALTER TABLE otp_requests ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'login';
      ALTER TABLE otp_requests ALTER COLUMN otp_hash DROP NOT NULL;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS room_id VARCHAR(255);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS room_password VARCHAR(255);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS map VARCHAR(100);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS rules TEXT;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS countdown_enabled BOOLEAN DEFAULT TRUE;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS countdown_hours INTEGER DEFAULT 24;
      ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'DEMO';
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS registration_deadline TIMESTAMP;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS share_slug VARCHAR(120);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS checkin_enabled BOOLEAN DEFAULT FALSE;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS results_published BOOLEAN DEFAULT FALSE;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30) DEFAULT 'PENDING';
      ALTER TABLE results ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
      ALTER TABLE results ADD COLUMN IF NOT EXISTS verified_by VARCHAR(120);
      ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT FALSE;
      ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS team_members TEXT;
      CREATE TABLE IF NOT EXISTS audit_logs (id SERIAL PRIMARY KEY, admin_action VARCHAR(80) NOT NULL, entity_type VARCHAR(80), entity_id INTEGER, details TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS support_tickets (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, subject VARCHAR(200) NOT NULL, message TEXT NOT NULL, status VARCHAR(30) DEFAULT 'OPEN', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

    `);

    console.log("ENTSONE database tables ready");
  } catch (error) {
    console.error("Database table error:", error);
  }
}

createTables();

async function syncTournamentStatuses() {
  try {
    await pool.query(`UPDATE tournaments SET status='ONGOING' WHERE start_time IS NOT NULL AND start_time <= NOW() AND status IN ('UPCOMING','OPEN')`);
    await pool.query(`UPDATE tournaments SET status='COMPLETED' WHERE results_published=TRUE AND status <> 'COMPLETED'`);
  } catch (e) { console.error('Status sync error:', e.message); }
}
setInterval(syncTournamentStatuses, 30000);
syncTournamentStatuses();

async function audit(action, entityType, entityId, details='') {
  try { await pool.query('INSERT INTO audit_logs (admin_action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4)', [action, entityType, entityId || null, details]); } catch(e) { console.error('Audit log error:', e.message); }
}

app.get("/", (req, res) => {
  res.json({ success: true, app: "ENTSONE", message: "ENTSONE backend is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "online", service: "ENTSONE API" });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, database: "connected", time: result.rows[0].now });
  } catch (error) {
    console.error("DB test error:", error);
    res.status(500).json({ success: false, database: "connection_failed" });
  }
});

app.post("/api/admin/check", requireAdmin, async (req, res) => {
  res.json({ success: true, message: "Admin authenticated" });
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, phone, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 500");
    res.json({ success: true, users: result.rows });
  } catch (error) {
    console.error("Admin users error:", error);
    res.status(500).json({ success: false, message: "Could not load users" });
  }
});

app.get("/api/admin/registrations", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.user_id, r.tournament_id, r.team_name, r.mode, r.created_at,
             u.name AS user_name, u.phone, t.name AS tournament_name
      FROM tournament_registrations r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN tournaments t ON t.id = r.tournament_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 500
    `);
    res.json({ success: true, registrations: result.rows });
  } catch (error) {
    console.error("Admin registrations error:", error);
    res.status(500).json({ success: false, message: "Could not load registrations" });
  }
});

app.get("/api/system-status", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM tournaments) AS tournaments,
        (SELECT COUNT(*)::int FROM tournament_registrations) AS registrations,
        (SELECT COUNT(*)::int FROM results) AS results
    `);
    res.json({
      success: true,
      api: "online",
      database: "connected",
      otp_provider: OTP_MODE === "vonage" ? "Vonage Verify v2" : "Demo OTP",
      otp_mode: OTP_MODE,
      vonage_configured: Boolean(VONAGE_API_KEY && VONAGE_API_SECRET),
      counts: result.rows[0]
    });
  } catch (error) {
    console.error("System status error:", error);
    res.status(500).json({ success: false, api: "online", database: "connection_failed" });
  }
});

/* =========================
   STEP 7 — USERS + OTP + SESSION
========================= */

app.post("/api/users", async (req, res) => {
  try {
    const cleanName = req.body.name ? String(req.body.name).trim() : null;
    const cleanEmail = normalizeEmail(req.body.email);
    const cleanPhone = normalizePhone(req.body.phone);

    if (!cleanEmail && !cleanPhone) {
      return res.status(400).json({ success: false, message: "Email or phone is required" });
    }

    let existing;
    if (cleanEmail) {
      existing = await pool.query(
        "SELECT id, name, email, phone, created_at FROM users WHERE email = $1 LIMIT 1",
        [cleanEmail]
      );
    }
    if ((!existing || !existing.rows.length) && cleanPhone) {
      existing = await pool.query(
        "SELECT id, name, email, phone, created_at FROM users WHERE phone = $1 LIMIT 1",
        [cleanPhone]
      );
    }

    if (existing && existing.rows.length) {
      const current = existing.rows[0];
      if (cleanName && (!current.name || current.name === "ENTSONE Player")) {
        const updated = await pool.query(
          "UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, phone, created_at",
          [cleanName, current.id]
        );
        return res.json({ success: true, existing: true, user: updated.rows[0] });
      }
      return res.json({ success: true, existing: true, user: current });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, phone) VALUES ($1, $2, $3)
       RETURNING id, name, email, phone, created_at`,
      [cleanName || "ENTSONE Player", cleanEmail, cleanPhone]
    );

    res.status(201).json({ success: true, existing: false, user: result.rows[0] });
  } catch (error) {
    console.error("Create/find user error:", error);
    res.status(500).json({ success: false, message: "Could not create/find user" });
  }
});

app.get("/api/users/:id", requireUser, requireUserId, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.put("/api/users/:id", requireUser, requireUserId, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 80) {
      return res.status(400).json({ success: false, message: "Valid username is required" });
    }
    const result = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2
       RETURNING id, name, email, phone, created_at`,
      [name, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ success: false, message: "Could not update user" });
  }
});

app.put("/api/me", requireUser, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 80) return res.status(400).json({ success: false, message: "Valid username is required" });
    const result = await pool.query(
      "UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, email, phone, created_at",
      [name, req.user.id]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Could not update profile" });
  }
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const channel = "phone";
    const destination = normalizePhone(req.body.destination);
    const mode = String(req.body.mode || "login").toLowerCase() === "signup" ? "signup" : "login";

    if (!destination || destination.length !== 10 || !/^[6-9]\d{9}$/.test(destination)) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit Indian mobile number" });
    }
    if (!allowOtpRequest(`phone:${destination}`, 5, 15 * 60 * 1000)) {
      return res.status(429).json({ success: false, message: "Too many OTP requests. Try again later." });
    }

    const existing = await pool.query("SELECT id, name, phone FROM users WHERE phone = $1 LIMIT 1", [destination]);
    if (mode === "login" && !existing.rows.length) {
      return res.status(404).json({ success: false, message: "Account not found. Create an account first." });
    }
    if (mode === "signup" && existing.rows.length) {
      return res.status(409).json({ success: false, message: "Account already exists. Use Sign In." });
    }

    await pool.query(
      "UPDATE otp_requests SET verified = TRUE WHERE channel = $1 AND destination = $2 AND verified = FALSE",
      [channel, destination]
    );

    const expires = new Date(Date.now() + OTP_TTL_MS);
    if (OTP_MODE !== "vonage") {
      const demoCode = makeDemoOtp();
      await pool.query(
        `INSERT INTO otp_requests (channel, destination, otp_hash, provider, mode, expires_at)
         VALUES ($1, $2, $3, 'demo', $4, $5)`,
        [channel, destination, hashSecret(demoCode), mode, expires]
      );
      return res.status(202).json({
        success: true,
        demo: true,
        demo_code: demoCode,
        mode,
        message: "Demo OTP generated. No SMS was sent.",
        expires_in_seconds: Math.floor(OTP_TTL_MS / 1000)
      });
    }

    if (!VONAGE_API_KEY || !VONAGE_API_SECRET) {
      return res.status(503).json({ success: false, message: "Vonage is not configured. Set OTP_MODE=vonage and add Vonage credentials in Render." });
    }

    const requestId = await requestVonageVerification(destination);
    await pool.query(
      `INSERT INTO otp_requests (channel, destination, provider, provider_request_id, mode, expires_at)
       VALUES ($1, $2, 'vonage', $3, $4, $5)`,
      [channel, destination, requestId, mode, expires]
    );

    res.status(202).json({ success: true, demo: false, mode, message: "OTP sent to your mobile number", expires_in_seconds: Math.floor(OTP_TTL_MS / 1000) });
  } catch (error) {
    console.error("Request OTP error:", error);
    const code = error.status === 409 ? 409 : (error.status >= 400 && error.status < 500 ? 400 : 500);
    res.status(code).json({ success: false, message: error.message || "Could not send OTP" });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const channel = "phone";
    const destination = normalizePhone(req.body.destination);
    const otp = String(req.body.otp || "").trim();
    const mode = String(req.body.mode || "login").toLowerCase() === "signup" ? "signup" : "login";

    if (!destination || destination.length !== 10 || !/^[6-9]\d{9}$/.test(destination) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: "Enter the 6-digit OTP sent to your mobile" });
    }

    const requestResult = await pool.query(
      `SELECT id, otp_hash, provider, provider_request_id, mode, expires_at, attempts
       FROM otp_requests WHERE channel = $1 AND destination = $2 AND verified = FALSE
       ORDER BY id DESC LIMIT 1`, [channel, destination]
    );
    if (!requestResult.rows.length) return res.status(400).json({ success: false, message: "OTP request not found or already used" });

    const request = requestResult.rows[0];
    if (new Date(request.expires_at).getTime() < Date.now()) return res.status(400).json({ success: false, message: "OTP expired. Request a new OTP." });
    if (Number(request.attempts) >= 3) return res.status(429).json({ success: false, message: "Too many OTP attempts. Request a new OTP." });
    await pool.query("UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1", [request.id]);

    if (request.provider === "demo") {
      if (!verifyDemoOtpHash(otp, request.otp_hash)) return res.status(400).json({ success: false, message: "Invalid demo OTP" });
    } else {
      if (!request.provider_request_id) return res.status(500).json({ success: false, message: "OTP provider request is missing" });
      try { await verifyVonageCode(request.provider_request_id, otp); }
      catch (error) { return res.status(error.status === 410 ? 429 : 400).json({ success: false, message: error.message || "Invalid or expired OTP" }); }
    }

    if (request.mode && request.mode !== mode) return res.status(400).json({ success: false, message: "OTP mode mismatch. Request a new OTP." });
    const userResult = await pool.query("SELECT id, name, email, phone, created_at FROM users WHERE phone = $1 LIMIT 1", [destination]);

    if (mode === "login" && !userResult.rows.length) return res.status(404).json({ success: false, message: "Account not found. Create an account first." });
    if (mode === "signup" && userResult.rows.length) return res.status(409).json({ success: false, message: "Account already exists. Use Sign In." });
    await pool.query("UPDATE otp_requests SET verified = TRUE WHERE id = $1", [request.id]);

    let user;
    if (userResult.rows.length) user = userResult.rows[0];
    else {
      const created = await pool.query(`INSERT INTO users (name, phone) VALUES ('ENTSONE Player', $1) RETURNING id, name, email, phone, created_at`, [destination]);
      user = created.rows[0];
    }

    const rawToken = randomToken();
    await pool.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, [user.id, hashSecret(rawToken), new Date(Date.now() + SESSION_TTL_MS)]);
    res.json({ success: true, user, session_token: rawToken, expires_in_seconds: SESSION_TTL_MS / 1000, demo: request.provider === "demo" });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ success: false, message: "Could not verify OTP" });
  }
});

app.get("/api/auth/session", requireUser, async (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashSecret(token)]);
    res.json({ success: true, message: "Logged out" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ success: false, message: "Logout failed" });
  }
});

/* =========================
   TOURNAMENTS — STEPS 5/6
========================= */

app.get("/api/tournaments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, game, mode, entry_fee, prize_pool, start_time, start_label,
             slots, status, map, rules, countdown_enabled, countdown_hours, registration_deadline, share_slug, checkin_enabled, results_published, created_at
      FROM tournaments ORDER BY id DESC
    `);
    res.json({ success: true, tournaments: result.rows });
  } catch (error) {
    console.error("Get tournaments error:", error);
    res.status(500).json({ success: false, tournaments: [] });
  }
});

app.get("/api/tournaments/:id", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, game, mode, entry_fee, prize_pool, start_time, start_label,
             slots, status, map, rules, countdown_enabled, countdown_hours, registration_deadline, share_slug, checkin_enabled, results_published, created_at
      FROM tournaments WHERE id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    res.json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Get tournament error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

async function uniqueShareSlug(name, existingId=null) {
  const base=String(name||'tournament').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)||'tournament';
  let slug=base, i=1;
  while(true){ const q=existingId?await pool.query('SELECT id FROM tournaments WHERE share_slug=$1 AND id<>$2',[slug,existingId]):await pool.query('SELECT id FROM tournaments WHERE share_slug=$1',[slug]); if(!q.rows.length)return slug; slug=`${base}-${i++}`; }
}

app.post("/api/tournaments", requireAdmin, async (req, res) => {
  try {
    const { name, game, mode, entry_fee = 0, prize_pool = 0, start_time = null,
      start_label = "Scheduled", slots = 0, status = "UPCOMING", map = null, rules = null,
      countdown_enabled = true, countdown_hours = 24, registration_deadline = null, share_slug = null, checkin_enabled = false } = req.body;
    if (!name || !game) return res.status(400).json({ success: false, message: "Tournament name and game are required" });
    const result = await pool.query(`
      INSERT INTO tournaments (name, game, mode, entry_fee, prize_pool, start_time, start_label, slots, status, map, rules, countdown_enabled, countdown_hours, registration_deadline, share_slug, checkin_enabled)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
    `, [name, game, mode || null, Number(entry_fee) || 0, Number(prize_pool) || 0,
        start_time || null, start_label || "Scheduled", Math.max(0, Number(slots) || 0), status || "UPCOMING",
        map || null, rules || null, Boolean(countdown_enabled), Math.max(1, Math.min(168, Number(countdown_hours) || 24)), registration_deadline || null, (share_slug || await uniqueShareSlug(name)), Boolean(checkin_enabled)]);
    await audit('CREATE_TOURNAMENT','tournament',result.rows[0].id, result.rows[0].name);
    res.status(201).json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Create tournament error:", error);
    res.status(500).json({ success: false, message: "Could not create tournament" });
  }
});

app.put("/api/tournaments/:id", requireAdmin, async (req, res) => {
  try {
    const { name, game, mode, entry_fee = 0, prize_pool = 0, start_time = null,
      start_label = "Scheduled", slots = 0, status = "UPCOMING", map = null, rules = null,
      countdown_enabled = true, countdown_hours = 24, registration_deadline = null, share_slug = null, checkin_enabled = false } = req.body;
    if (!name || !game) return res.status(400).json({ success: false, message: "Tournament name and game are required" });
    const result = await pool.query(`
      UPDATE tournaments SET name=$1, game=$2, mode=$3, entry_fee=$4, prize_pool=$5,
      start_time=$6, start_label=$7, slots=$8, status=$9, map=$10, rules=$11, countdown_enabled=$12, countdown_hours=$13, registration_deadline=$14, share_slug=$15, checkin_enabled=$16 WHERE id=$17 RETURNING *
    `, [name, game, mode || null, Number(entry_fee) || 0, Number(prize_pool) || 0,
        start_time || null, start_label || "Scheduled", Math.max(0, Number(slots) || 0), status || "UPCOMING",
        map || null, rules || null, Boolean(countdown_enabled), Math.max(1, Math.min(168, Number(countdown_hours) || 24)), registration_deadline || null, (share_slug || await uniqueShareSlug(name, Number(req.params.id))), Boolean(checkin_enabled), req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    await audit('UPDATE_TOURNAMENT','tournament',result.rows[0].id,result.rows[0].name);
    res.json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Update tournament error:", error);
    res.status(500).json({ success: false, message: "Could not update tournament" });
  }
});

app.delete("/api/tournaments/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM tournaments WHERE id = $1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    await audit('DELETE_TOURNAMENT','tournament',result.rows[0].id,result.rows[0].name);
    res.json({ success: true, message: "Tournament deleted", tournament: result.rows[0] });
  } catch (error) {
    console.error("Delete tournament error:", error);
    res.status(500).json({ success: false, message: "Could not delete tournament" });
  }
});

/* =========================
   STEP 7 — REGISTRATIONS
========================= */

app.post("/api/tournament-registrations", requireUser, async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);
    const userId = Number(req.user.id);
    const mode = req.body.mode ? String(req.body.mode).trim() : "Solo";
    const teamName = req.body.team_name ? String(req.body.team_name).trim() : null;
    const allowedModes = new Set(["Solo", "Duo", "Squad"]);
    if (!allowedModes.has(mode)) return res.status(400).json({ success: false, message: "Mode must be Solo, Duo, or Squad" });
    if (!Number.isInteger(tournamentId) || tournamentId < 1) {
      return res.status(400).json({ success: false, message: "Valid tournament is required" });
    }

    const tournament = await pool.query(
      "SELECT id, name, game, mode, entry_fee, prize_pool, slots, status, registration_deadline, checkin_enabled FROM tournaments WHERE id = $1",
      [tournamentId]
    );
    if (!tournament.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    if (["COMPLETED", "ONGOING"].includes(String(tournament.rows[0].status).toUpperCase()) || (tournament.rows[0].registration_deadline && new Date(tournament.rows[0].registration_deadline).getTime() <= Date.now())) {
      return res.status(400).json({ success: false, message: "Registration is closed for this tournament" });
    }
    // Payment intentionally remains DEMO in this release. Registration is stored in PostgreSQL,
    // but no real money is collected and payment_status is always DEMO.

    const user = await pool.query("SELECT id, name FROM users WHERE id = $1", [userId]);
    if (!user.rows.length) return res.status(404).json({ success: false, message: "User not found" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT id, slots FROM tournaments WHERE id = $1 FOR UPDATE",
        [tournamentId]
      );
      if (!locked.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Tournament not found" }); }
      const count = await client.query("SELECT COUNT(*)::int AS count FROM tournament_registrations WHERE tournament_id = $1", [tournamentId]);
      if (Number(locked.rows[0].slots) > 0 && Number(count.rows[0].count) >= Number(locked.rows[0].slots)) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: "Tournament slots are full" });
      }

      const duplicate = await client.query(
        "SELECT id FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2",
        [tournamentId, userId]
      );
      if (duplicate.rows.length) {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "You already joined this tournament" });
      }

      const result = await client.query(`
        INSERT INTO tournament_registrations (tournament_id, user_id, team_name, mode, payment_status)
        VALUES ($1,$2,$3,$4,'DEMO')
        RETURNING id, tournament_id, user_id, team_name, mode, payment_status, created_at
      `, [tournamentId, userId, teamName || user.rows[0].name || "Player", mode]);
      await client.query("COMMIT");
      return res.status(201).json({ success: true, registration: { ...result.rows[0], tournament: tournament.rows[0], payment_demo: true } });
    } catch (txError) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      throw txError;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error("Registration error:", error);
    if (error.code === "23505") return res.status(409).json({ success: false, message: "You already joined this tournament" });
    res.status(500).json({ success: false, message: "Could not register for tournament" });
  }
});

app.get("/api/users/:id/registrations", requireUser, requireUserId, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.tournament_id, r.user_id, r.team_name, r.mode, r.payment_status, r.checked_in, r.team_members, r.created_at,
             t.name, t.game, t.entry_fee, t.prize_pool, t.status, t.start_label, t.start_time, t.countdown_enabled, t.countdown_hours, t.map, t.rules, t.registration_deadline, t.checkin_enabled
      FROM tournament_registrations r
      JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.user_id = $1 AND r.verification_status='VERIFIED'
      ORDER BY r.id DESC
    `, [req.params.id]);
    res.json({ success: true, registrations: result.rows });
  } catch (error) {
    console.error("Get registrations error:", error);
    res.status(500).json({ success: false, registrations: [] });
  }
});

/* =========================
   STEP 8 — RESULTS / LEADERBOARD
========================= */

function placementPoints(position) {
  return ({ 1: 12, 2: 9, 3: 7, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 })[Number(position)] || 0;
}

app.post("/api/results", requireAdmin, async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);
    let userId = req.body.user_id ? Number(req.body.user_id) : null;
    const playerName = String(req.body.player_name || req.body.team_name || "").trim();
    const teamName = String(req.body.team_name || playerName).trim();
    if (!userId && playerName) {
      const linked = await pool.query(`
        SELECT user_id FROM tournament_registrations
        WHERE tournament_id=$1 AND (LOWER(team_name)=LOWER($2) OR user_id IN (SELECT id FROM users WHERE LOWER(name)=LOWER($2)))
        ORDER BY id DESC LIMIT 1
      `,[tournamentId, playerName]);
      if (linked.rows.length) userId = Number(linked.rows[0].user_id);
    }
    const position = Number(req.body.position);
    const kills = Math.max(0, Number(req.body.kills) || 0);
    if (!Number.isInteger(tournamentId) || !playerName || !Number.isInteger(position) || position < 1) {
      return res.status(400).json({ success: false, message: "Tournament, player, and valid placement are required" });
    }

    const tournament = await pool.query("SELECT id, status FROM tournaments WHERE id = $1", [tournamentId]);
    if (!tournament.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    if (String(tournament.rows[0].status).toUpperCase() === "COMPLETED") {
      return res.status(400).json({ success: false, message: "Results are already published" });
    }

    if (userId) {
      const user = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
      if (!user.rows.length) return res.status(404).json({ success: false, message: "User not found" });
    }

    const points = placementPoints(position) + kills;
    const result = await pool.query(`
      INSERT INTO results (tournament_id, user_id, player_name, team_name, position, kills, points, verification_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
      RETURNING *
    `, [tournamentId, userId, playerName, teamName, position, kills, points]);

    res.status(201).json({ success: true, result: result.rows[0] });
  } catch (error) {
    console.error("Add result error:", error);
    res.status(500).json({ success: false, message: "Could not save result" });
  }
});

app.get("/api/results/:tournamentId", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, tournament_id, user_id, player_name, team_name, position, kills, points, verification_status, verified_at, created_at
      FROM results WHERE tournament_id = $1 ORDER BY points DESC, position ASC, kills DESC, id ASC
    `, [req.params.tournamentId]);
    res.json({ success: true, results: result.rows });
  } catch (error) {
    console.error("Get results error:", error);
    res.status(500).json({ success: false, results: [] });
  }
});

app.get("/api/leaderboard/:tournamentId", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, tournament_id, user_id, player_name, team_name, position, kills, points, verification_status, verified_at, created_at,
             ROW_NUMBER() OVER (ORDER BY points DESC, position ASC, kills DESC, id ASC) AS rank
      FROM results
      WHERE tournament_id = $1 AND verification_status = 'VERIFIED'
      ORDER BY points DESC, position ASC, kills DESC, id ASC
    `, [req.params.tournamentId]);
    res.json({ success: true, leaderboard: result.rows });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ success: false, leaderboard: [] });
  }
});

app.delete("/api/results/:id", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM results WHERE id = $1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Result not found" });
    res.json({ success: true, message: "Result deleted", result: result.rows[0] });
  } catch (error) {
    console.error("Delete result error:", error);
    res.status(500).json({ success: false, message: "Could not delete result" });
  }
});

app.patch('/api/results/:id/verify', requireAdmin, async(req,res)=>{try{const status=String(req.body.status||'VERIFIED').toUpperCase();if(!['VERIFIED','REJECTED','PENDING'].includes(status))return res.status(400).json({success:false,message:'Invalid verification status'});const r=await pool.query(`UPDATE results SET verification_status=$1, verified_at=CASE WHEN $1='PENDING' THEN NULL ELSE NOW() END, verified_by=CASE WHEN $1='PENDING' THEN NULL ELSE 'ADMIN' END WHERE id=$2 RETURNING *`,[status,req.params.id]);if(!r.rows.length)return res.status(404).json({success:false,message:'Result not found'});await audit('VERIFY_RESULT','result',r.rows[0].id,status);res.json({success:true,result:r.rows[0]})}catch(e){res.status(500).json({success:false,message:'Could not verify result'})}});

app.post("/api/tournaments/:id/publish-results", requireAdmin, async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM results WHERE tournament_id = $1 AND verification_status='VERIFIED'", [tournamentId]);
    if (Number(count.rows[0].count) === 0) return res.status(400).json({ success: false, message: "Verify at least one result before publishing" });

    const result = await pool.query(
      "UPDATE tournaments SET status = 'COMPLETED', results_published = TRUE WHERE id = $1 RETURNING id, name, status, results_published",
      [tournamentId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    await audit('PUBLISH_RESULTS','tournament',tournamentId,`results=${Number(count.rows[0].count)}`);
    res.json({ success: true, tournament: result.rows[0], results_count: Number(count.rows[0].count) });
  } catch (error) {
    console.error("Publish results error:", error);
    res.status(500).json({ success: false, message: "Could not publish results" });
  }
});

app.get("/api/users/:id/results", requireUser, requireUserId, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.tournament_id, r.player_name, r.team_name, r.position, r.kills, r.points,
             r.created_at, t.name AS tournament_name, t.game
      FROM results r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.user_id = $1 AND r.verification_status='VERIFIED'
      ORDER BY r.id DESC
    `, [req.params.id]);
    res.json({ success: true, results: result.rows });
  } catch (error) {
    console.error("User results error:", error);
    res.status(500).json({ success: false, results: [] });
  }
});

app.get('/api/users/:id/stats', requireUser, requireUserId, async(req,res)=>{try{const uid=Number(req.params.id);const r=await pool.query(`SELECT COUNT(*)::int AS tournaments, COUNT(*) FILTER(WHERE position=1)::int AS wins, COALESCE(SUM(kills),0)::int AS kills, COALESCE(SUM(points),0)::int AS points, COALESCE(AVG(position),0)::numeric(10,2) AS avg_position FROM results WHERE user_id=$1 AND verification_status='VERIFIED'`,[uid]);const reg=await pool.query('SELECT COUNT(*)::int AS joined FROM tournament_registrations WHERE user_id=$1',[uid]);res.json({success:true,stats:{...r.rows[0],joined:Number(reg.rows[0].joined)}})}catch(e){res.status(500).json({success:false,message:'Stats unavailable'})}});
app.get('/api/users/:id/team-profile', requireUser, requireUserId, async(req,res)=>{try{const r=await pool.query(`SELECT team_name, mode, team_members, COUNT(*) OVER(PARTITION BY team_name)::int AS tournaments FROM tournament_registrations WHERE user_id=$1 AND team_name IS NOT NULL AND team_name<>'' ORDER BY id DESC LIMIT 1`,[req.params.id]);res.json({success:true,team:r.rows[0]||null})}catch(e){res.status(500).json({success:false,message:'Team profile unavailable'})}});

/* =========================
   NOTIFICATIONS
========================= */

async function ensureNotificationTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL DEFAULT 'general',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (error) {
    console.error("Notifications table setup error:", error);
  }
}
ensureNotificationTable();

app.get("/api/notifications/:userId", requireUser, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1 || userId !== Number(req.user.id)) return res.status(403).json({ success: false, message: "You can only access your own notifications" });
    const result = await pool.query(`
      SELECT id, user_id, type, title, message, is_read, created_at
      FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC
    `, [userId]);
    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ success: false, notifications: [] });
  }
});

app.post("/api/notifications", requireAdmin, async (req, res) => {
  try {
    const userId = Number(req.body.user_id);
    const type = String(req.body.type || "general").trim();
    const title = String(req.body.title || "").trim();
    const message = String(req.body.message || "").trim();
    if (!Number.isInteger(userId) || userId < 1 || !title || !message) return res.status(400).json({ success: false, message: "user_id, title and message are required" });
    const user = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (!user.rows.length) return res.status(404).json({ success: false, message: "User not found" });
    const result = await pool.query(`
      INSERT INTO notifications (user_id, type, title, message) VALUES ($1,$2,$3,$4)
      RETURNING *
    `, [userId, type, title, message]);
    res.status(201).json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error("Create notification error:", error);
    res.status(500).json({ success: false, message: "Could not create notification" });
  }
});

app.patch("/api/notifications/:id/read", requireUser, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ success: false, message: "Invalid notification ID" });
    const result = await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *", [id, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error("Mark notification read error:", error);
    res.status(500).json({ success: false, message: "Could not update notification" });
  }
});

app.patch("/api/notifications/user/:userId/read-all", requireUser, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1 || userId !== Number(req.user.id)) return res.status(403).json({ success: false, message: "You can only update your own notifications" });
    const result = await pool.query("UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE RETURNING id", [userId]);
    res.json({ success: true, updated_count: result.rows.length });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    res.status(500).json({ success: false, message: "Could not update notifications" });
  }
});

app.delete("/api/notifications/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ success: false, message: "Invalid notification ID" });
    const result = await pool.query("DELETE FROM notifications WHERE id = $1 RETURNING *", [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({ success: false, message: "Could not delete notification" });
  }
});

/* =========================
   ROOM CREDENTIALS
========================= */

app.post("/api/tournaments/:id/room", requireAdmin, async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const roomId = String(req.body.room_id || "").trim();
    const roomPassword = String(req.body.room_password || "").trim();
    if (!Number.isInteger(tournamentId) || tournamentId < 1 || !roomId || !roomPassword) return res.status(400).json({ success: false, message: "Tournament, room ID and password are required" });
    const result = await pool.query(`
      UPDATE tournaments SET room_id = $1, room_password = $2
      WHERE id = $3 RETURNING id, name, status, room_id, room_password
    `, [roomId, roomPassword, tournamentId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    res.json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Save room error:", error);
    res.status(500).json({ success: false, message: "Could not save room credentials" });
  }
});

app.get("/api/tournaments/:id/room", requireUser, async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const userId = Number(req.user.id);
    const result = await pool.query(`SELECT id, name, status, room_id, room_password FROM tournaments WHERE id = $1`, [tournamentId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    const registration = await pool.query(
      "SELECT id FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2 LIMIT 1",
      [tournamentId, userId]
    );
    if (!registration.rows.length) return res.status(403).json({ success: false, message: "Join the tournament before viewing the room" });
    if (!result.rows[0].room_id || !result.rows[0].room_password) return res.status(404).json({ success: false, message: "Room credentials are not published yet" });
    res.json({ success: true, room: result.rows[0] });
  } catch (error) {
    console.error("Get room error:", error);
    res.status(500).json({ success: false, message: "Could not get room credentials" });
  }
});

/* Keep the process alive and clean old temporary data occasionally. */

app.patch('/api/registrations/:id', requireUser, async (req,res)=>{try{const team=String(req.body.team_name||'').trim();const members=String(req.body.team_members||'').trim();if(!team||team.length>80)return res.status(400).json({success:false,message:'Valid team name required'});const r=await pool.query(`UPDATE tournament_registrations SET team_name=$1, team_members=$2 WHERE id=$3 AND user_id=$4 RETURNING *`,[team,members||null,req.params.id,req.user.id]);if(!r.rows.length)return res.status(404).json({success:false,message:'Registration not found'});res.json({success:true,registration:r.rows[0]})}catch(e){res.status(500).json({success:false,message:'Could not update team'})}});
app.post('/api/registrations/:id/checkin', requireUser, async (req,res)=>{try{const r=await pool.query(`UPDATE tournament_registrations r SET checked_in=TRUE FROM tournaments t WHERE r.id=$1 AND r.user_id=$2 AND r.tournament_id=t.id AND t.checkin_enabled=TRUE RETURNING r.*`,[req.params.id,req.user.id]);if(!r.rows.length)return res.status(400).json({success:false,message:'Check-in is not enabled or registration not found'});res.json({success:true,registration:r.rows[0]})}catch(e){res.status(500).json({success:false,message:'Check-in failed'})}});
app.get('/api/share/tournaments/:slug', async(req,res)=>{try{const r=await pool.query('SELECT id,name,game,mode,entry_fee,prize_pool,start_time,status,slots FROM tournaments WHERE share_slug=$1 LIMIT 1',[req.params.slug]);if(!r.rows.length)return res.status(404).json({success:false,message:'Tournament not found'});res.json({success:true,tournament:r.rows[0]})}catch(e){res.status(500).json({success:false,message:'Share lookup failed'})}});
app.post('/api/support', requireUser, async(req,res)=>{try{const subject=String(req.body.subject||'').trim(),message=String(req.body.message||'').trim();if(!subject||!message)return res.status(400).json({success:false,message:'Subject and message are required'});const r=await pool.query('INSERT INTO support_tickets(user_id,subject,message) VALUES($1,$2,$3) RETURNING *',[req.user.id,subject,message]);res.status(201).json({success:true,ticket:r.rows[0]})}catch(e){res.status(500).json({success:false,message:'Could not create support ticket'})}});
app.get('/api/admin/audit', requireAdmin, async(req,res)=>{try{const r=await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200');res.json({success:true,logs:r.rows})}catch(e){res.status(500).json({success:false,logs:[]})}});
app.get('/api/admin/support', requireAdmin, async(req,res)=>{try{const r=await pool.query('SELECT s.*,u.name,u.phone FROM support_tickets s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200');res.json({success:true,tickets:r.rows})}catch(e){res.status(500).json({success:false,tickets:[]})}});
app.get('/api/admin/backup', requireAdmin, async(req,res)=>{try{const [u,t,r,rs]=await Promise.all([pool.query('SELECT * FROM users ORDER BY id'),pool.query('SELECT * FROM tournaments ORDER BY id'),pool.query('SELECT * FROM tournament_registrations ORDER BY id'),pool.query('SELECT * FROM results ORDER BY id')]);res.json({success:true,exported_at:new Date().toISOString(),users:u.rows,tournaments:t.rows,registrations:r.rows,results:rs.rows})}catch(e){res.status(500).json({success:false,message:'Backup export failed'})}});

app.use((error, req, res, next) => {
  if (error && error.message === "CORS origin not allowed") return res.status(403).json({ success: false, message: "Origin not allowed" });
  console.error("Unhandled API error:", error);
  res.status(500).json({ success: false, message: "Internal server error" });
});

setInterval(async () => {
  try {
    await pool.query("DELETE FROM otp_requests WHERE expires_at < NOW() - INTERVAL '1 day'");
    await pool.query("DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day'");
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`ENTSONE backend running on port ${PORT}`);
});
