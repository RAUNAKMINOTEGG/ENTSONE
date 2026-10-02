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
  res.json({
    success: true,
    app: "ENTSONE",
    message: "ENTSONE backend is running"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "ENTSONE API"
  });
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

    res.status(500).json({
      success: false,
      api: "online",
      database: "connection_failed"
    });
  }
});
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
    res.status(500).json({
      success: false,
      api: "online",
      database: "connection_failed"
    });
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
      return res.status(400).json({
        success: false,
        message: "Email or phone is required"
      });
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
      const user = existing.rows[0];

      if (cleanName && cleanName !== user.name) {
        const updated = await pool.query(
          `UPDATE users
           SET name = $1
           WHERE id = $2
           RETURNING id, name, email, phone, created_at`,
          [cleanName, user.id]
        );

        return res.json({
          success: true,
          user: updated.rows[0],
          existing: true
        });
      }

      return res.json({
        success: true,
        user,
        existing: true
      });
    }

    const result = await pool.query(
      `INSERT INTO users (name, email, phone)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, phone, created_at`,
      [cleanName, cleanEmail, cleanPhone]
    );

    res.json({
      success: true,
      user: result.rows[0],
      existing: false
    });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create user"
    });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const cleanName = req.body.name
      ? String(req.body.name).trim()
      : null;

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name)
       WHERE id = $2
       RETURNING id, name, email, phone, created_at`,
      [cleanName, userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user"
    });
  }
});

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit mobile number"
      });
    }

    if (!VONAGE_API_KEY || !VONAGE_API_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Vonage OTP is not configured"
      });
    }

    const requestId = await requestVonageVerification(phone);

    await pool.query(
      `INSERT INTO otp_requests
       (channel, destination, otp_hash, provider, provider_request_id, expires_at)
       VALUES ($1, $2, NULL, $3, $4, NOW() + INTERVAL '5 minutes')`,
      ["sms", phone, "vonage", requestId]
    );

    res.json({
      success: true,
      message: "OTP sent to your mobile number"
    });
  } catch (error) {
    console.error("Request OTP error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Failed to send OTP"
    });
  }
});

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = String(req.body.code || "").trim();

    if (!phone || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit mobile number"
      });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message: "Enter the 6-digit OTP"
      });
    }

    const otpResult = await pool.query(
      `SELECT id, provider_request_id, expires_at, attempts, verified
       FROM otp_requests
       WHERE destination = $1
       ORDER BY id DESC
       LIMIT 1`,
      [phone]
    );

    if (!otpResult.rows.length) {
      return res.status(400).json({
        success: false,
        message: "OTP request not found"
      });
    }

    const otp = otpResult.rows[0];

    if (otp.verified) {
      return res.status(400).json({
        success: false,
        message: "OTP already used"
      });
    }

    if (new Date(otp.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    if (otp.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts"
      });
    }

    await pool.query(
      "UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1",
      [otp.id]
    );

    await verifyVonageCode(
      otp.provider_request_id,
      code
    );

    await pool.query(
      "UPDATE otp_requests SET verified = TRUE WHERE id = $1",
      [otp.id]
    );

    let userResult = await pool.query(
      `SELECT id, name, email, phone, created_at
       FROM users
       WHERE phone = $1
       LIMIT 1`,
      [phone]
    );

    if (!userResult.rows.length) {
      userResult = await pool.query(
        `INSERT INTO users (phone)
         VALUES ($1)
         RETURNING id, name, email, phone, created_at`,
        [phone]
      );
    }

    const user = userResult.rows[0];

    const rawToken = randomToken();
    const tokenHash = hashSecret(rawToken);

    await pool.query(
      `INSERT INTO sessions
       (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, tokenHash]
    );

    res.json({
      success: true,
      message: "OTP verified successfully",
      token: rawToken,
      user
    });
  } catch (error) {
    console.error("Verify OTP error:", error);

    res.status(400).json({
      success: false,
      message: error.message || "OTP verification failed"
    });
  }
}); 
 /* =========================
   TOURNAMENT APIs
========================= */

app.get("/api/tournaments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM tournaments
      ORDER BY start_time ASC NULLS LAST, id DESC
    `);

    res.json({
      success: true,
      tournaments: result.rows
    });
  } catch (error) {
    console.error("Get tournaments error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load tournaments"
    });
  }
});

app.get("/api/tournaments/:id", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    const result = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1 LIMIT 1",
      [tournamentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    res.json({
      success: true,
      tournament: result.rows[0]
    });
  } catch (error) {
    console.error("Get tournament error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load tournament"
    });
  }
});

app.post("/api/tournaments", async (req, res) => {
  try {
    const {
      name,
      game,
      mode,
      entry_fee = 0,
      prize_pool = 0,
      slots = 0,
      start_time = null,
      start_label = null,
      status = "UPCOMING",
      room_id = null,
      room_password = null
    } = req.body;

    if (!name || !game) {
      return res.status(400).json({
        success: false,
        message: "Tournament name and game are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO tournaments
       (name, game, mode, entry_fee, prize_pool, slots,
        start_time, start_label, status, room_id, room_password)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        String(name).trim(),
        String(game).trim(),
        mode || null,
        Number(entry_fee) || 0,
        Number(prize_pool) || 0,
        Number(slots) || 0,
        start_time || null,
        start_label || null,
        status || "UPCOMING",
        room_id || null,
        room_password || null
      ]
    );

    res.json({
      success: true,
      tournament: result.rows[0]
    });
  } catch (error) {
    console.error("Create tournament error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create tournament"
    });
  }
});

app.put("/api/tournaments/:id", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    const {
      name,
      game,
      mode,
      entry_fee,
      prize_pool,
      slots,
      start_time,
      start_label,
      status,
      room_id,
      room_password
    } = req.body;

    const result = await pool.query(
      `UPDATE tournaments
       SET
         name = COALESCE($1, name),
         game = COALESCE($2, game),
         mode = COALESCE($3, mode),
         entry_fee = COALESCE($4, entry_fee),
         prize_pool = COALESCE($5, prize_pool),
         slots = COALESCE($6, slots),
         start_time = COALESCE($7, start_time),
         start_label = COALESCE($8, start_label),
         status = COALESCE($9, status),
         room_id = COALESCE($10, room_id),
         room_password = COALESCE($11, room_password)
       WHERE id = $12
       RETURNING *`,
      [
        name ?? null,
        game ?? null,
        mode ?? null,
        entry_fee !== undefined ? Number(entry_fee) || 0 : null,
        prize_pool !== undefined ? Number(prize_pool) || 0 : null,
        slots !== undefined ? Number(slots) || 0 : null,
        start_time ?? null,
        start_label ?? null,
        status ?? null,
        room_id ?? null,
        room_password ?? null,
        tournamentId
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    res.json({
      success: true,
      tournament: result.rows[0]
    });
  } catch (error) {
    console.error("Update tournament error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update tournament"
    });
  }
});

app.delete("/api/tournaments/:id", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    const result = await pool.query(
      "DELETE FROM tournaments WHERE id = $1 RETURNING id",
      [tournamentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    res.json({
      success: true,
      message: "Tournament deleted"
    });
  } catch (error) {
    console.error("Delete tournament error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete tournament"
    });
  }
});

/* =========================
   TOURNAMENT REGISTRATION
========================= */

app.post("/api/tournament-registrations", async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);
    const userId = Number(req.body.user_id);
    const teamName = req.body.team_name
      ? String(req.body.team_name).trim()
      : null;
    const mode = req.body.mode
      ? String(req.body.mode).trim()
      : null;

    if (!Number.isInteger(tournamentId) || !Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid tournament and user are required"
      });
    }

    const tournament = await pool.query(
      `SELECT *
       FROM tournaments
       WHERE id = $1
       LIMIT 1`,
      [tournamentId]
    );

    if (!tournament.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    if (Number(tournament.rows[0].entry_fee) > 0) {
      return res.status(400).json({
        success: false,
        message: "Real-money tournament entry is not enabled"
      });
    }

    const user = await pool.query(
      `SELECT id, name, phone
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    if (!user.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const existing = await pool.query(
      `SELECT *
       FROM tournament_registrations
       WHERE tournament_id = $1
       AND user_id = $2
       LIMIT 1`,
      [tournamentId, userId]
    );

    if (existing.rows.length) {
      return res.json({
        success: true,
        already_registered: true,
        registration: existing.rows[0]
      });
    }

    const result = await pool.query(
      `INSERT INTO tournament_registrations
       (tournament_id, user_id, team_name, mode)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [tournamentId, userId, teamName, mode]
    );

    res.json({
      success: true,
      already_registered: false,
      registration: result.rows[0]
    });
  } catch (error) {
    console.error("Tournament registration error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to register for tournament"
    });
  }
});

app.get("/api/users/:id/registrations", async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const result = await pool.query(
      `SELECT
         tr.*,
         t.name AS tournament_name,
         t.game,
         t.mode AS tournament_mode,
         t.entry_fee,
         t.prize_pool,
         t.start_time,
         t.start_label,
         t.status,
         t.slots
       FROM tournament_registrations tr
       JOIN tournaments t
         ON t.id = tr.tournament_id
       WHERE tr.user_id = $1
       ORDER BY tr.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      registrations: result.rows
    });
  } catch (error) {
    console.error("User registrations error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load registrations"
    });
  }
}); 
  /* =========================
   RESULTS APIs
========================= */

app.post("/api/results", async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);
    const userId = req.body.user_id ? Number(req.body.user_id) : null;
    const playerName = String(req.body.player_name || "").trim();
    const teamName = req.body.team_name
      ? String(req.body.team_name).trim()
      : null;
    const position = Number(req.body.position);
    const kills = Number(req.body.kills) || 0;
    const points = Number(req.body.points) || 0;

    if (
      !Number.isInteger(tournamentId) ||
      !playerName ||
      !Number.isInteger(position)
    ) {
      return res.status(400).json({
        success: false,
        message: "Tournament, player name and position are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO results
       (tournament_id, user_id, player_name, team_name, position, kills, points)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        tournamentId,
        Number.isInteger(userId) ? userId : null,
        playerName,
        teamName,
        position,
        kills,
        points
      ]
    );

    res.json({
      success: true,
      result: result.rows[0]
    });
  } catch (error) {
    console.error("Create result error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to save result"
    });
  }
});

app.get("/api/results/:tournamentId", async (req, res) => {
  try {
    const tournamentId = Number(req.params.tournamentId);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM results
       WHERE tournament_id = $1
       ORDER BY points DESC, position ASC, kills DESC, id ASC`,
      [tournamentId]
    );

    res.json({
      success: true,
      results: result.rows
    });
  } catch (error) {
    console.error("Get results error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load results"
    });
  }
});

app.delete("/api/results/:id", async (req, res) => {
  try {
    const resultId = Number(req.params.id);

    if (!Number.isInteger(resultId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid result ID"
      });
    }

    const result = await pool.query(
      `DELETE FROM results
       WHERE id = $1
       RETURNING id`,
      [resultId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Result not found"
      });
    }

    res.json({
      success: true,
      message: "Result deleted"
    });
  } catch (error) {
    console.error("Delete result error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete result"
    });
  }
});

app.post("/api/tournaments/:id/publish-results", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    const tournament = await pool.query(
      `SELECT id, name
       FROM tournaments
       WHERE id = $1
       LIMIT 1`,
      [tournamentId]
    );

    if (!tournament.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    await pool.query(
      `UPDATE tournaments
       SET status = 'COMPLETED'
       WHERE id = $1`,
      [tournamentId]
    );

    const registrations = await pool.query(
      `SELECT user_id
       FROM tournament_registrations
       WHERE tournament_id = $1`,
      [tournamentId]
    );

    for (const row of registrations.rows) {
      await pool.query(
        `INSERT INTO notifications
         (user_id, title, message, type, is_read)
         VALUES ($1,$2,$3,$4,FALSE)`,
        [
          row.user_id,
          "Results Published",
          `Results for ${tournament.rows[0].name} are now available.`,
          "RESULT"
        ]
      );
    }

    res.json({
      success: true,
      message: "Results published",
      notified_users: registrations.rows.length
    });
  } catch (error) {
    console.error("Publish results error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to publish results"
    });
  }
});

app.get("/api/leaderboard/:tournamentId", async (req, res) => {
  try {
    const tournamentId = Number(req.params.tournamentId);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    const result = await pool.query(
      `SELECT
         player_name,
         team_name,
         SUM(kills)::int AS kills,
         SUM(points)::int AS points,
         MIN(position)::int AS best_position
       FROM results
       WHERE tournament_id = $1
       GROUP BY player_name, team_name
       ORDER BY points DESC, kills DESC, best_position ASC`,
      [tournamentId]
    );

    res.json({
      success: true,
      leaderboard: result.rows
    });
  } catch (error) {
    console.error("Leaderboard error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load leaderboard"
    });
  }
});

app.get("/api/users/:id/results", async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const result = await pool.query(
      `SELECT
         r.*,
         t.name AS tournament_name,
         t.game,
         t.status AS tournament_status
       FROM results r
       LEFT JOIN tournaments t
         ON t.id = r.tournament_id
       WHERE r.user_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      results: result.rows
    });
  } catch (error) {
    console.error("User results error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load user results"
    });
  }
});


/* =========================
   NOTIFICATIONS APIs
========================= */

async function ensureNotificationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) DEFAULT 'GENERAL',
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

ensureNotificationsTable().catch((error) => {
  console.error("Notifications table error:", error);
});

app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC, id DESC`,
      [userId]
    );

    res.json({
      success: true,
      notifications: result.rows
    });
  } catch (error) {
    console.error("Get notifications error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to load notifications"
    });
  }
});

app.post("/api/notifications", async (req, res) => {
  try {
    const userId = Number(req.body.user_id);
    const title = String(req.body.title || "").trim();
    const message = String(req.body.message || "").trim();
    const type = String(req.body.type || "GENERAL").trim();

    if (!Number.isInteger(userId) || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "User, title and message are required"
      });
    }

    const result = await pool.query(
      `INSERT INTO notifications
       (user_id, title, message, type, is_read)
       VALUES ($1,$2,$3,$4,FALSE)
       RETURNING *`,
      [userId, title, message, type]
    );

    res.json({
      success: true,
      notification: result.rows[0]
    });
  } catch (error) {
    console.error("Create notification error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to create notification"
    });
  }
});

app.patch("/api/notifications/:id/read", async (req, res) => {
  try {
    const notificationId = Number(req.params.id);

    if (!Number.isInteger(notificationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID"
      });
    }

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1
       RETURNING *`,
      [notificationId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.json({
      success: true,
      notification: result.rows[0]
    });
  } catch (error) {
    console.error("Mark notification error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to mark notification"
    });
  }
});

app.patch("/api/notifications/user/:userId/read-all", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID"
      });
    }

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1
       AND is_read = FALSE`,
      [userId]
    );

    res.json({
      success: true,
      updated: result.rowCount
    });
  } catch (error) {
    console.error("Mark all notifications error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to mark all notifications"
    });
  }
});

app.delete("/api/notifications/:id", async (req, res) => {
  try {
    const notificationId = Number(req.params.id);

    if (!Number.isInteger(notificationId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID"
      });
    }

    const result = await pool.query(
      `DELETE FROM notifications
       WHERE id = $1
       RETURNING id`,
      [notificationId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.json({
      success: true,
      message: "Notification deleted"
    });
  } catch (error) {
    console.error("Delete notification error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete notification"
    });
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

    if (
      !Number.isInteger(tournamentId) ||
      tournamentId < 1 ||
      !roomId ||
      !roomPassword
    ) {
      return res.status(400).json({
        success: false,
        message: "Tournament, room ID and password are required"
      });
    }

    const result = await pool.query(`
      UPDATE tournaments
      SET room_id = $1, room_password = $2
      WHERE id = $3
      RETURNING id, name, status, room_id, room_password
    `, [roomId, roomPassword, tournamentId]);

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    res.json({
      success: true,
      tournament: result.rows[0]
    });
  } catch (error) {
    console.error("Save room error:", error);

    res.status(500).json({
      success: false,
      message: "Could not save room credentials"
    });
  }
});

app.get("/api/tournaments/:id/room", async (req, res) => {
  try {
    const tournamentId = Number(req.params.id);
    const userId = Number(req.query.user_id);

    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({
        success: false,
        message: "Valid user ID is required"
      });
    }

    const result = await pool.query(
      `SELECT id, name, status, room_id, room_password
       FROM tournaments
       WHERE id = $1`,
      [tournamentId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    const registration = await pool.query(
      `SELECT id
       FROM tournament_registrations
       WHERE tournament_id = $1
       AND user_id = $2
       LIMIT 1`,
      [tournamentId, userId]
    );

    if (!registration.rows.length) {
      return res.status(403).json({
        success: false,
        message: "Join the tournament before viewing the room"
      });
    }

    if (
      !result.rows[0].room_id ||
      !result.rows[0].room_password
    ) {
      return res.status(404).json({
        success: false,
        message: "Room credentials are not published yet"
      });
    }

    res.json({
      success: true,
      room: result.rows[0]
    });
  } catch (error) {
    console.error("Get room error:", error);

    res.status(500).json({
      success: false,
      message: "Could not get room credentials"
    });
  }
});


/* =========================
   CLEANUP
========================= */

setInterval(async () => {
  try {
    await pool.query(
      `DELETE FROM otp_requests
       WHERE expires_at < NOW() - INTERVAL '1 day'`
    );

    await pool.query(
      `DELETE FROM sessions
       WHERE expires_at < NOW() - INTERVAL '1 day'`
    );
  } catch (error) {
    console.error("Cleanup error:", error.message);
  }
}, 60 * 60 * 1000);


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`ENTSONE backend running on port ${PORT}`);
}); 
