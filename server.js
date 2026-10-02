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

app.use(cors());
app.use(express.json());

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

function vonageAuthHeader() {
  if (!VONAGE_API_KEY || !VONAGE_API_SECRET) {
    throw new Error("Vonage API credentials are missing");
  }
  return "Basic " + Buffer.from(`${VONAGE_API_KEY}:${VONAGE_API_SECRET}`).toString("base64");
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
      ALTER TABLE otp_requests ALTER COLUMN otp_hash DROP NOT NULL;
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS room_id VARCHAR(255);
      ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS room_password VARCHAR(255);
    `);

    console.log("ENTSONE database tables ready");
  } catch (error) {
    console.error("Database table error:", error);
  }
}

createTables();

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

app.get("/api/system-status", async (req, res) => {
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
      otp_provider: "Vonage Verify v2",
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

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, phone, created_at FROM users WHERE id = $1",
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const name = String(req.body.name || "").trim();
    if (!Number.isInteger(userId) || userId < 1 || !name) {
      return res.status(400).json({ success: false, message: "Valid user ID and name are required" });
    }
    const result = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2
       RETURNING id, name, email, phone, created_at`,
      [name, userId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({ success: false, message: "Could not update user" });
  }
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const channel = "phone";
    const destination = normalizePhone(req.body.destination);

    if (!destination || destination.length !== 10) {
      return res.status(400).json({ success: false, message: "Enter a valid 10-digit mobile number" });
    }

    if (!VONAGE_API_KEY || !VONAGE_API_SECRET) {
      return res.status(503).json({ success: false, message: "Vonage API key pending. Add VONAGE_API_KEY and VONAGE_API_SECRET in Render." });
    }

    await pool.query(
      "UPDATE otp_requests SET verified = TRUE WHERE channel = $1 AND destination = $2 AND verified = FALSE",
      [channel, destination]
    );

    const requestId = await requestVonageVerification(destination);
    const expires = new Date(Date.now() + OTP_TTL_MS);

    await pool.query(
      `INSERT INTO otp_requests (channel, destination, provider, provider_request_id, expires_at)
       VALUES ($1, $2, 'vonage', $3, $4)`,
      [channel, destination, requestId, expires]
    );

    res.status(202).json({
      success: true,
      message: "OTP sent to your mobile number",
      expires_in_seconds: Math.floor(OTP_TTL_MS / 1000)
    });
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

    if (!destination || destination.length !== 10 || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: "Enter the 6-digit OTP sent to your mobile" });
    }

    const requestResult = await pool.query(
      `SELECT id, provider_request_id, expires_at, attempts
       FROM otp_requests
       WHERE channel = $1 AND destination = $2 AND verified = FALSE
       ORDER BY id DESC LIMIT 1`,
      [channel, destination]
    );

    if (!requestResult.rows.length) {
      return res.status(400).json({ success: false, message: "OTP request not found or already used" });
    }

    const request = requestResult.rows[0];
    if (!request.provider_request_id) {
      return res.status(500).json({ success: false, message: "OTP provider request is missing" });
    }
    if (new Date(request.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "OTP expired" });
    }
    if (Number(request.attempts) >= 3) {
      return res.status(429).json({ success: false, message: "Too many OTP attempts. Request a new OTP." });
    }

    await pool.query("UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1", [request.id]);

    try {
      await verifyVonageCode(request.provider_request_id, otp);
    } catch (error) {
      const status = error.status === 410 ? 429 : (error.status === 404 ? 400 : 400);
      return res.status(status).json({ success: false, message: error.message || "Invalid or expired OTP" });
    }

    await pool.query("UPDATE otp_requests SET verified = TRUE WHERE id = $1", [request.id]);

    const userResult = await pool.query(
      "SELECT id, name, email, phone, created_at FROM users WHERE phone = $1 LIMIT 1",
      [destination]
    );

    let user;
    if (userResult.rows.length) {
      user = userResult.rows[0];
    } else {
      const created = await pool.query(
        `INSERT INTO users (name, phone) VALUES ('ENTSONE Player', $1)
         RETURNING id, name, email, phone, created_at`,
        [destination]
      );
      user = created.rows[0];
    }

    const rawToken = randomToken();
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, hashSecret(rawToken), new Date(Date.now() + SESSION_TTL_MS)]
    );

    res.json({ success: true, user, session_token: rawToken, expires_in_seconds: SESSION_TTL_MS / 1000 });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ success: false, message: "Could not verify OTP" });
  }
});

app.get("/api/auth/session", async (req, res) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ success: false, message: "Session token required" });
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [hashSecret(token)]
    );
    if (!result.rows.length) return res.status(401).json({ success: false, message: "Session expired or invalid" });
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    console.error("Session check error:", error);
    res.status(500).json({ success: false, message: "Session check failed" });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
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
             slots, status, created_at
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
             slots, status, created_at
      FROM tournaments WHERE id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    res.json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Get tournament error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/tournaments", async (req, res) => {
  try {
    const { name, game, mode, entry_fee = 0, prize_pool = 0, start_time = null,
      start_label = "Scheduled", slots = 0, status = "UPCOMING" } = req.body;
    if (!name || !game) return res.status(400).json({ success: false, message: "Tournament name and game are required" });
    const result = await pool.query(`
      INSERT INTO tournaments (name, game, mode, entry_fee, prize_pool, start_time, start_label, slots, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [name, game, mode || null, Number(entry_fee) || 0, Number(prize_pool) || 0,
        start_time || null, start_label || "Scheduled", Math.max(0, Number(slots) || 0), status || "UPCOMING"]);
    res.status(201).json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Create tournament error:", error);
    res.status(500).json({ success: false, message: "Could not create tournament" });
  }
});

app.put("/api/tournaments/:id", async (req, res) => {
  try {
    const { name, game, mode, entry_fee = 0, prize_pool = 0, start_time = null,
      start_label = "Scheduled", slots = 0, status = "UPCOMING" } = req.body;
    if (!name || !game) return res.status(400).json({ success: false, message: "Tournament name and game are required" });
    const result = await pool.query(`
      UPDATE tournaments SET name=$1, game=$2, mode=$3, entry_fee=$4, prize_pool=$5,
      start_time=$6, start_label=$7, slots=$8, status=$9 WHERE id=$10 RETURNING *
    `, [name, game, mode || null, Number(entry_fee) || 0, Number(prize_pool) || 0,
        start_time || null, start_label || "Scheduled", Math.max(0, Number(slots) || 0), status || "UPCOMING", req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    res.json({ success: true, tournament: result.rows[0] });
  } catch (error) {
    console.error("Update tournament error:", error);
    res.status(500).json({ success: false, message: "Could not update tournament" });
  }
});

app.delete("/api/tournaments/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM tournaments WHERE id = $1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    res.json({ success: true, message: "Tournament deleted", tournament: result.rows[0] });
  } catch (error) {
    console.error("Delete tournament error:", error);
    res.status(500).json({ success: false, message: "Could not delete tournament" });
  }
});

/* =========================
   STEP 7 — REGISTRATIONS
========================= */

app.post("/api/tournament-registrations", async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);
    const userId = Number(req.body.user_id);
    const mode = req.body.mode ? String(req.body.mode).trim() : "Solo";
    const teamName = req.body.team_name ? String(req.body.team_name).trim() : null;
    const allowedModes = new Set(["Solo", "Duo", "Squad"]);
    if (!allowedModes.has(mode)) return res.status(400).json({ success: false, message: "Mode must be Solo, Duo, or Squad" });
    if (!Number.isInteger(tournamentId) || !Number.isInteger(userId)) {
      return res.status(400).json({ success: false, message: "Tournament and user are required" });
    }

    const tournament = await pool.query(
      "SELECT id, name, game, mode, entry_fee, prize_pool, slots, status FROM tournaments WHERE id = $1",
      [tournamentId]
    );
    if (!tournament.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });
    if (["COMPLETED", "ONGOING"].includes(String(tournament.rows[0].status).toUpperCase())) {
      return res.status(400).json({ success: false, message: "Registration is closed for this tournament" });
    }
    if (Number(tournament.rows[0].entry_fee) > 0) {
      return res.status(400).json({ success: false, message: "Real-money tournament entry is not enabled" });
    }

    const user = await pool.query("SELECT id, name FROM users WHERE id = $1", [userId]);
    if (!user.rows.length) return res.status(404).json({ success: false, message: "User not found" });

    const count = await pool.query("SELECT COUNT(*)::int AS count FROM tournament_registrations WHERE tournament_id = $1", [tournamentId]);
    if (Number(tournament.rows[0].slots) > 0 && Number(count.rows[0].count) >= Number(tournament.rows[0].slots)) {
      return res.status(400).json({ success: false, message: "Tournament slots are full" });
    }

    const duplicate = await pool.query(
      "SELECT id FROM tournament_registrations WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, userId]
    );
    if (duplicate.rows.length) return res.status(409).json({ success: false, message: "You already joined this tournament" });

    const result = await pool.query(`
      INSERT INTO tournament_registrations (tournament_id, user_id, team_name, mode)
      VALUES ($1,$2,$3,$4)
      RETURNING id, tournament_id, user_id, team_name, mode, created_at
    `, [tournamentId, userId, teamName || user.rows[0].name || "Player", mode]);

    await pool.query(`
      INSERT INTO notifications (user_id, type, title, message)
      VALUES ($1, 'tournament', 'Tournament joined', $2)
    `, [userId, `You joined ${tournament.rows[0].name}.`]);

    res.status(201).json({ success: true, registration: { ...result.rows[0], tournament: tournament.rows[0] } });
  } catch (error) {
    console.error("Registration error:", error);
    if (error.code === "23505") return res.status(409).json({ success: false, message: "You already joined this tournament" });
    res.status(500).json({ success: false, message: "Could not register for tournament" });
  }
});

app.get("/api/users/:id/registrations", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.tournament_id, r.user_id, r.team_name, r.mode, r.created_at,
             t.name, t.game, t.entry_fee, t.prize_pool, t.status, t.start_label
      FROM tournament_registrations r
      JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.user_id = $1
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

app.post("/api/results", async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);
    const userId = req.body.user_id ? Number(req.body.user_id) : null;
    const playerName = String(req.body.player_name || req.body.team_name || "").trim();
    const teamName = String(req.body.team_name || playerName).trim();
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
      INSERT INTO results (tournament_id, user_id, player_name, team_name, position, kills, points)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
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
      SELECT id, tournament_id, user_id, player_name, team_name, position, kills, points, created_at
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
      SELECT id, tournament_id, user_id, player_name, team_name, position, kills, points, created_at,
             ROW_NUMBER() OVER (ORDER BY points DESC, position ASC, kills DESC, id ASC) AS rank
      FROM results
      WHERE tournament_id = $1
      ORDER BY points DESC, position ASC, kills DESC, id ASC
    `, [req.params.tournamentId]);
    res.json({ success: true, leaderboard: result.rows });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ success: false, leaderboard: [] });
  }
});

app.delete("/api/results/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM results WHERE id = $1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Result not found" });
    res.json({ success: true, message: "Result deleted", result: result.rows[0] });
  } catch (error) {
    console.error("Delete result error:", error);
    res.status(500).json({ success: false, message: "Could not delete result" });
  }
});

app.post("/api/tournaments/:id/publish-results", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM results WHERE tournament_id = $1", [tournamentId]);
    if (Number(count.rows[0].count) === 0) return res.status(400).json({ success: false, message: "Add at least one result first" });

    const result = await pool.query(
      "UPDATE tournaments SET status = 'COMPLETED' WHERE id = $1 RETURNING id, name, status",
      [tournamentId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Tournament not found" });

    await pool.query(`
      INSERT INTO notifications (user_id, type, title, message)
      SELECT DISTINCT r.user_id, 'result', 'Results published', $2
      FROM tournament_registrations r
      WHERE r.tournament_id = $1
    `, [tournamentId, `Results are now published for ${result.rows[0].name}.`]);

    res.json({ success: true, tournament: result.rows[0], results_count: Number(count.rows[0].count) });
  } catch (error) {
    console.error("Publish results error:", error);
    res.status(500).json({ success: false, message: "Could not publish results" });
  }
});

app.get("/api/users/:id/results", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.tournament_id, r.player_name, r.team_name, r.position, r.kills, r.points,
             r.created_at, t.name AS tournament_name, t.game
      FROM results r JOIN tournaments t ON t.id = r.tournament_id
      WHERE r.user_id = $1
      ORDER BY r.id DESC
    `, [req.params.id]);
    res.json({ success: true, results: result.rows });
  } catch (error) {
    console.error("User results error:", error);
    res.status(500).json({ success: false, results: [] });
  }
});

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

app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ success: false, message: "Invalid user ID" });
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

app.post("/api/notifications", async (req, res) => {
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

app.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ success: false, message: "Invalid notification ID" });
    const result = await pool.query("UPDATE notifications SET is_read = TRUE WHERE id = $1 RETURNING *", [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    console.error("Mark notification read error:", error);
    res.status(500).json({ success: false, message: "Could not update notification" });
  }
});

app.patch("/api/notifications/user/:userId/read-all", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ success: false, message: "Invalid user ID" });
    const result = await pool.query("UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE RETURNING id", [userId]);
    res.json({ success: true, updated_count: result.rows.length });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    res.status(500).json({ success: false, message: "Could not update notifications" });
  }
});

app.delete("/api/notifications/:id", async (req, res) => {
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

app.post("/api/tournaments/:id/room", async (req, res) => {
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

app.get("/api/tournaments/:id/room", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const userId = Number(req.query.user_id);
    if (!Number.isInteger(userId) || userId < 1) return res.status(400).json({ success: false, message: "Valid user ID is required" });
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
