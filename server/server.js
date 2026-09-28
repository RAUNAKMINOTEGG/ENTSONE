const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;

const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEMO_OTP_ENABLED = process.env.DEMO_OTP_ENABLED !== "false";

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

function randomOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

/* =========================
   DATABASE SETUP
========================= */

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
        otp_hash VARCHAR(64) NOT NULL,
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
      ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS slots INTEGER DEFAULT 0;

      ALTER TABLE tournaments
      ADD COLUMN IF NOT EXISTS start_label VARCHAR(255);
    `);

    console.log("ENTSONE database tables ready");

  } catch (error) {
    console.error("Database table error:", error);
  }
}

createTables();

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "ENTSONE",
    message: "ENTSONE backend is running"
  });
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "ENTSONE API"
  });
});

/* =========================
   DATABASE TEST
========================= */

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      database: "connected",
      time: result.rows[0].now
    });

  } catch (error) {
    console.error("DB test error:", error);

    res.status(500).json({
      success: false,
      database: "connection_failed"
    });
  }
});

/* =========================
   SYSTEM STATUS
========================= */

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
      demo_otp: DEMO_OTP_ENABLED,
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

/* =========================================================
   STEP 7 — USERS
========================================================= */

app.post("/api/users", async (req, res) => {
  try {
    const cleanName = req.body.name
      ? String(req.body.name).trim()
      : null;

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
        `
        SELECT id, name, email, phone, created_at
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [cleanEmail]
      );
    }

    if ((!existing || !existing.rows.length) && cleanPhone) {
      existing = await pool.query(
        `
        SELECT id, name, email, phone, created_at
        FROM users
        WHERE phone = $1
        LIMIT 1
        `,
        [cleanPhone]
      );
    }

    if (existing && existing.rows.length) {
      const current = existing.rows[0];

      if (
        cleanName &&
        (!current.name || current.name === "ENTSONE Player")
      ) {
        const updated = await pool.query(
          `
          UPDATE users
          SET name = $1
          WHERE id = $2
          RETURNING id, name, email, phone, created_at
          `,
          [cleanName, current.id]
        );

        return res.json({
          success: true,
          existing: true,
          user: updated.rows[0]
        });
      }

      return res.json({
        success: true,
        existing: true,
        user: current
      });
    }

    const result = await pool.query(
      `
      INSERT INTO users
      (name, email, phone)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, phone, created_at
      `,
      [
        cleanName || "ENTSONE Player",
        cleanEmail,
        cleanPhone
      ]
    );

    res.status(201).json({
      success: true,
      existing: false,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Create/find user error:", error);

    res.status(500).json({
      success: false,
      message: "Could not create/find user"
    });
  }
});

/* =========================
   GET USER
========================= */

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT id, name, email, phone, created_at
      FROM users
      WHERE id = $1
      `,
      [req.params.id]
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
    console.error("Get user error:", error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

/* =========================================================
   STEP 7 — OTP REQUEST
========================================================= */

app.post("/api/auth/request-otp", async (req, res) => {
  try {
    const channel =
      req.body.channel === "email"
        ? "email"
        : "phone";

    const destination =
      channel === "email"
        ? normalizeEmail(req.body.destination)
        : normalizePhone(req.body.destination);

    if (!destination) {
      return res.status(400).json({
        success: false,
        message: "Destination is required"
      });
    }

    if (
      channel === "phone" &&
      destination.length !== 10
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 10-digit mobile number"
      });
    }

    if (
      channel === "email" &&
      !/^\S+@\S+\.\S+$/.test(destination)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address"
      });
    }

    const otp = randomOtp();

    const expires = new Date(
      Date.now() + OTP_TTL_MS
    );

    await pool.query(
      `
      INSERT INTO otp_requests
      (
        channel,
        destination,
        otp_hash,
        expires_at
      )
      VALUES ($1, $2, $3, $4)
      `,
      [
        channel,
        destination,
        hashSecret(otp),
        expires
      ]
    );

    const response = {
      success: true,
      message: DEMO_OTP_ENABLED
        ? "Development OTP created"
        : "OTP request created",
      expires_in_seconds:
        Math.floor(OTP_TTL_MS / 1000)
    };

    /*
      DEVELOPMENT ONLY.
      Real SMS/email provider can be connected later.
    */

    if (DEMO_OTP_ENABLED) {
      response.demo_code = otp;
    }

    res.json(response);

  } catch (error) {
    console.error("Request OTP error:", error);

    res.status(500).json({
      success: false,
      message: "Could not create OTP request"
    });
  }
});

/* =========================================================
   STEP 7 — OTP VERIFY
========================================================= */

app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const channel =
      req.body.channel === "email"
        ? "email"
        : "phone";

    const destination =
      channel === "email"
        ? normalizeEmail(req.body.destination)
        : normalizePhone(req.body.destination);

    const otp = String(
      req.body.otp || ""
    ).trim();

    if (
      !destination ||
      !/^\d{6}$/.test(otp)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid OTP is required"
      });
    }

    const requestResult = await pool.query(
      `
      SELECT
        id,
        otp_hash,
        expires_at,
        attempts
      FROM otp_requests
      WHERE
        channel = $1
        AND destination = $2
        AND verified = FALSE
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        channel,
        destination
      ]
    );

    if (!requestResult.rows.length) {
      return res.status(400).json({
        success: false,
        message: "OTP request not found or already used"
      });
    }

    const request = requestResult.rows[0];

    if (
      new Date(request.expires_at).getTime()
      < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "OTP expired"
      });
    }

    if (Number(request.attempts) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP attempts"
      });
    }

    await pool.query(
      `
      UPDATE otp_requests
      SET attempts = attempts + 1
      WHERE id = $1
      `,
      [request.id]
    );

    if (
      hashSecret(otp) !== request.otp_hash
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    await pool.query(
      `
      UPDATE otp_requests
      SET verified = TRUE
      WHERE id = $1
      `,
      [request.id]
    );

    let userResult;

    if (channel === "email") {
      userResult = await pool.query(
        `
        SELECT id, name, email, phone, created_at
        FROM users
        WHERE email = $1
        LIMIT 1
        `,
        [destination]
      );

    } else {
      userResult = await pool.query(
        `
        SELECT id, name, email, phone, created_at
        FROM users
        WHERE phone = $1
        LIMIT 1
        `,
        [destination]
      );
    }

    let user;

    if (userResult.rows.length) {

      user = userResult.rows[0];

    } else {

      const created = await pool.query(
        channel === "email"
          ? `
            INSERT INTO users
            (name, email)
            VALUES ('ENTSONE Player', $1)
            RETURNING id, name, email, phone, created_at
            `
          : `
            INSERT INTO users
            (name, phone)
            VALUES ('ENTSONE Player', $1)
            RETURNING id, name, email, phone, created_at
            `,
        [destination]
      );

      user = created.rows[0];
    }

    const rawToken = randomToken();

    await pool.query(
      `
      INSERT INTO sessions
      (
        user_id,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, $3)
      `,
      [
        user.id,
        hashSecret(rawToken),
        new Date(
          Date.now() + SESSION_TTL_MS
        )
      ]
    );

    res.json({
      success: true,
      user,
      session_token: rawToken,
      expires_in_seconds:
        SESSION_TTL_MS / 1000
    });

  } catch (error) {
    console.error("Verify OTP error:", error);

    res.status(500).json({
      success: false,
      message: "Could not verify OTP"
    });
  }
});

/* =========================================================
   STEP 7 — SESSION
========================================================= */

app.get("/api/auth/session", async (req, res) => {
  try {
    const token = String(
      req.headers.authorization || ""
    )
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Session token required"
      });
    }

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.created_at
      FROM sessions s
      JOIN users u
        ON u.id = s.user_id
      WHERE
        s.token_hash = $1
        AND s.expires_at > NOW()
      LIMIT 1
      `,
      [hashSecret(token)]
    );

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        message: "Session expired or invalid"
      });
    }

    res.json({
      success: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Session check error:", error);

    res.status(500).json({
      success: false,
      message: "Session check failed"
    });
  }
});

/* =========================
   LOGOUT
========================= */

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = String(
      req.headers.authorization || ""
    )
      .replace(/^Bearer\s+/i, "")
      .trim();

    if (token) {
      await pool.query(
        `
        DELETE FROM sessions
        WHERE token_hash = $1
        `,
        [hashSecret(token)]
      );
    }

    res.json({
      success: true,
      message: "Logged out"
    });

  } catch (error) {
    console.error("Logout error:", error);

    res.status(500).json({
      success: false,
      message: "Logout failed"
    });
  }
});

/* =========================================================
   TOURNAMENTS
========================================================= */

app.get("/api/tournaments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        name,
        game,
        mode,
        entry_fee,
        prize_pool,
        start_time,
        start_label,
        slots,
        status,
        created_at
      FROM tournaments
      ORDER BY id DESC
    `);

    res.json({
      success: true,
      tournaments: result.rows
    });

  } catch (error) {
    console.error("Get tournaments error:", error);

    res.status(500).json({
      success: false,
      tournaments: []
    });
  }
});

app.get("/api/tournaments/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        game,
        mode,
        entry_fee,
        prize_pool,
        start_time,
        start_label,
        slots,
        status,
        created_at
      FROM tournaments
      WHERE id = $1
      `,
      [req.params.id]
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
      message: "Server error"
    });
  }
});

/* =========================
   CREATE TOURNAMENT
========================= */

app.post("/api/tournaments", async (req, res) => {
  try {
    const {
      name,
      game,
      mode,
      entry_fee = 0,
      prize_pool = 0,
      start_time = null,
      start_label = "Scheduled",
      slots = 0,
      status = "UPCOMING"
    } = req.body;

    if (!name || !game) {
      return res.status(400).json({
        success: false,
        message: "Tournament name and game are required"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO tournaments
      (
        name,
        game,
        mode,
        entry_fee,
        prize_pool,
        start_time,
        start_label,
        slots,
        status
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        name,
        game,
        mode || null,
        Number(entry_fee) || 0,
        Number(prize_pool) || 0,
        start_time || null,
        start_label || "Scheduled",
        Math.max(0, Number(slots) || 0),
        status || "UPCOMING"
      ]
    );

    res.status(201).json({
      success: true,
      tournament: result.rows[0]
    });

  } catch (error) {
    console.error("Create tournament error:", error);

    res.status(500).json({
      success: false,
      message: "Could not create tournament"
    });
  }
});

/* =========================
   UPDATE TOURNAMENT
========================= */

app.put("/api/tournaments/:id", async (req, res) => {
  try {
    const {
      name,
      game,
      mode,
      entry_fee = 0,
      prize_pool = 0,
      start_time = null,
      start_label = "Scheduled",
      slots = 0,
      status = "UPCOMING"
    } = req.body;

    if (!name || !game) {
      return res.status(400).json({
        success: false,
        message: "Tournament name and game are required"
      });
    }

    const result = await pool.query(
      `
      UPDATE tournaments
      SET
        name=$1,
        game=$2,
        mode=$3,
        entry_fee=$4,
        prize_pool=$5,
        start_time=$6,
        start_label=$7,
        slots=$8,
        status=$9
      WHERE id=$10
      RETURNING *
      `,
      [
        name,
        game,
        mode || null,
        Number(entry_fee) || 0,
        Number(prize_pool) || 0,
        start_time || null,
        start_label || "Scheduled",
        Math.max(0, Number(slots) || 0),
        status || "UPCOMING",
        req.params.id
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
      message: "Could not update tournament"
    });
  }
});

/* =========================
   DELETE TOURNAMENT
========================= */

app.delete("/api/tournaments/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM tournaments
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    res.json({
      success: true,
      message: "Tournament deleted",
      tournament: result.rows[0]
    });

  } catch (error) {
    console.error("Delete tournament error:", error);

    res.status(500).json({
      success: false,
      message: "Could not delete tournament"
    });
  }
});

/* =========================================================
   STEP 7 — TOURNAMENT REGISTRATIONS
========================================================= */

app.post("/api/tournament-registrations", async (req, res) => {
  try {
    const tournamentId = Number(
      req.body.tournament_id
    );

    const userId = Number(
      req.body.user_id
    );

    const mode = req.body.mode
      ? String(req.body.mode).trim()
      : "Solo";

    const teamName = req.body.team_name
      ? String(req.body.team_name).trim()
      : null;

    if (
      !Number.isInteger(tournamentId) ||
      !Number.isInteger(userId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Tournament and user are required"
      });
    }

    const tournament = await pool.query(
      `
      SELECT
        id,
        name,
        game,
        mode,
        entry_fee,
        prize_pool,
        slots,
        status
      FROM tournaments
      WHERE id = $1
      `,
      [tournamentId]
    );

    if (!tournament.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    if (
      ["COMPLETED", "ONGOING"].includes(
        String(tournament.rows[0].status).toUpperCase()
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Registration is closed for this tournament"
      });
    }

    const user = await pool.query(
      `
      SELECT id, name
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (!user.rows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const count = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM tournament_registrations
      WHERE tournament_id = $1
      `,
      [tournamentId]
    );

    if (
      Number(tournament.rows[0].slots) > 0 &&
      Number(count.rows[0].count) >=
      Number(tournament.rows[0].slots)
    ) {
      return res.status(400).json({
        success: false,
        message: "Tournament slots are full"
      });
    }

    const duplicate = await pool.query(
      `
      SELECT id
      FROM tournament_registrations
      WHERE tournament_id = $1
      AND user_id = $2
      `,
      [
        tournamentId,
        userId
      ]
    );

    if (duplicate.rows.length) {
      return res.status(409).json({
        success: false,
        message: "You already joined this tournament"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO tournament_registrations
      (
        tournament_id,
        user_id,
        team_name,
        mode
      )
      VALUES
      ($1,$2,$3,$4)
      RETURNING
        id,
        tournament_id,
        user_id,
        team_name,
        mode,
        created_at
      `,
      [
        tournamentId,
        userId,
        teamName ||
          user.rows[0].name ||
          "Player",
        mode
      ]
    );

    res.status(201).json({
      success: true,
      registration: {
        ...result.rows[0],
        tournament: tournament.rows[0]
      }
    });

  } catch (error) {
    console.error("Registration error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "You already joined this tournament"
      });
    }

    res.status(500).json({
      success: false,
      message: "Could not register for tournament"
    });
  }
});

/* =========================
   USER REGISTRATIONS
========================= */

app.get(
  "/api/users/:id/registrations",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          r.id,
          r.tournament_id,
          r.user_id,
          r.team_name,
          r.mode,
          r.created_at,
          t.name,
          t.game,
          t.entry_fee,
          t.prize_pool,
          t.status,
          t.start_label
        FROM tournament_registrations r
        JOIN tournaments t
          ON t.id = r.tournament_id
        WHERE r.user_id = $1
        ORDER BY r.id DESC
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        registrations: result.rows
      });

    } catch (error) {
      console.error(
        "Get registrations error:",
        error
      );

      res.status(500).json({
        success: false,
        registrations: []
      });
    }
  }
);

/* =========================================================
   STEP 8 — RESULTS
========================================================= */

function placementPoints(position) {
  return (
    {
      1: 12,
      2: 9,
      3: 7,
      4: 5,
      5: 4,
      6: 3,
      7: 2,
      8: 1
    }[Number(position)] || 0
  );
}

/* =========================
   ADD RESULT
========================= */

app.post("/api/results", async (req, res) => {
  try {
    const tournamentId = Number(req.body.tournament_id);

    const userId = req.body.user_id
      ? Number(req.body.user_id)
      : null;

    const playerName = String(
      req.body.player_name ||
      req.body.team_name ||
      ""
    ).trim();

    const teamName = String(
      req.body.team_name ||
      playerName
    ).trim();

    const position = Number(req.body.position);

    const kills = Math.max(
      0,
      Number(req.body.kills) || 0
    );

    if (
      !Number.isInteger(tournamentId) ||
      !playerName ||
      !Number.isInteger(position) ||
      position < 1
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Tournament, player, and valid placement are required"
      });
    }

    /* =========================
       ENSURE RESULTS COLUMNS
    ========================= */

    await pool.query(`
      ALTER TABLE results
      ADD COLUMN IF NOT EXISTS player_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS team_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS position INTEGER,
      ADD COLUMN IF NOT EXISTS kills INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0
    `);

    /* =========================
       CHECK TOURNAMENT
    ========================= */

    const tournament = await pool.query(
      `
      SELECT id, status
      FROM tournaments
      WHERE id = $1
      `,
      [tournamentId]
    );

    if (!tournament.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }

    if (
      String(tournament.rows[0].status).toUpperCase() ===
      "COMPLETED"
    ) {
      return res.status(400).json({
        success: false,
        message: "Results are already published"
      });
    }

    /* =========================
       CHECK USER
    ========================= */

    if (userId) {
      const user = await pool.query(
        `
        SELECT id
        FROM users
        WHERE id = $1
        `,
        [userId]
      );

      if (!user.rows.length) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }
    }

    /* =========================
       CALCULATE POINTS
    ========================= */

    const points =
      placementPoints(position) + kills;

    /* =========================
       SAVE RESULT
    ========================= */

    const result = await pool.query(
      `
      INSERT INTO results
      (
        tournament_id,
        user_id,
        player_name,
        team_name,
        position,
        kills,
        points
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [
        tournamentId,
        userId,
        playerName,
        teamName,
        position,
        kills,
        points
      ]
    );

    return res.status(201).json({
      success: true,
      result: result.rows[0]
    });

  } catch (error) {
    console.error(
      "Add result error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Could not save result",
      error: error.message
    });
  }
});

/* =========================
   GET RESULTS BY TOURNAMENT
========================= */

app.get("/api/results/:tournamentId", async (req, res) => {
  try {
    const tournamentId = Number(req.params.tournamentId);

    if (!Number.isInteger(tournamentId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid tournament ID"
      });
    }

    // Existing database columns ko directly assume nahi karenge.
    // Pehle complete row lenge.
    const result = await pool.query(
      `
      SELECT *
      FROM results
      WHERE tournament_id = $1
      ORDER BY id DESC
      `,
      [tournamentId]
    );

    // Frontend ke liye result fields normalize kar rahe hain.
    const results = result.rows.map((row) => ({
      ...row,

      player_name:
        row.player_name ??
        row.player ??
        row.name ??
        row.username ??
        "Player",

      team_name:
        row.team_name ??
        row.team ??
        null,

      placement:
        row.placement != null
          ? Number(row.placement)
          : 0,

      kills:
        row.kills != null
          ? Number(row.kills)
          : 0,

      points:
        row.points != null
          ? Number(row.points)
          : 0
    }));

    return res.json({
      success: true,
      results
    });

  } catch (error) {
    console.error("Get results error:", error);

    return res.status(500).json({
      success: false,
      results: [],
      message: "Could not get tournament results"
    });
  }
});

/* =========================
   LEADERBOARD
========================= */

app.get(
  "/api/leaderboard/:tournamentId",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          id,
          tournament_id,
          user_id,
          player_name,
          team_name,
          position,
          kills,
          points,
          created_at,
          ROW_NUMBER() OVER (
            ORDER BY
              points DESC,
              position ASC,
              kills DESC,
              id ASC
          ) AS rank
        FROM results
        WHERE tournament_id = $1
        ORDER BY
          points DESC,
          position ASC,
          kills DESC,
          id ASC
        `,
        [req.params.tournamentId]
      );

      res.json({
        success: true,
        leaderboard: result.rows
      });

    } catch (error) {
      console.error(
        "Leaderboard error:",
        error
      );

      res.status(500).json({
        success: false,
        leaderboard: []
      });
    }
  }
);

/* =========================
   DELETE RESULT
========================= */

app.delete(
  "/api/results/:id",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        DELETE FROM results
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Result not found"
        });
      }

      res.json({
        success: true,
        message: "Result deleted",
        result: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Delete result error:",
        error
      );

      res.status(500).json({
        success: false,
        message: "Could not delete result"
      });
    }
  }
);

/* =========================================================
   PUBLISH RESULTS
========================================================= */

app.post(
  "/api/tournaments/:id/publish-results",
  async (req, res) => {
    try {
      const tournamentId =
        Number(req.params.id);

      const count = await pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM results
        WHERE tournament_id = $1
        `,
        [tournamentId]
      );

      if (
        Number(count.rows[0].count) === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Add at least one result first"
        });
      }

      const result = await pool.query(
        `
        UPDATE tournaments
        SET status = 'COMPLETED'
        WHERE id = $1
        RETURNING id, name, status
        `,
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
        tournament: result.rows[0],
        results_count:
          Number(count.rows[0].count)
      });

    } catch (error) {
      console.error(
        "Publish results error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Could not publish results"
      });
    }
  }
);

/* =========================
   USER RESULTS / HISTORY
========================= */

app.get(
  "/api/users/:id/results",
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          r.id,
          r.tournament_id,
          r.player_name,
          r.team_name,
          r.position,
          r.kills,
          r.points,
          r.created_at,
          t.name AS tournament_name,
          t.game
        FROM results r
        JOIN tournaments t
          ON t.id = r.tournament_id
        WHERE r.user_id = $1
        ORDER BY r.id DESC
        `,
        [req.params.id]
      );

      res.json({
        success: true,
        results: result.rows
      });

    } catch (error) {
      console.error(
        "User results error:",
        error
      );

      res.status(500).json({
        success: false,
        results: []
      });
    }
  }
);

/* =========================
   CLEANUP
========================= */

setInterval(async () => {
  try {
    await pool.query(`
      DELETE FROM otp_requests
      WHERE expires_at <
      NOW() - INTERVAL '1 day'
    `);

    await pool.query(`
      DELETE FROM sessions
      WHERE expires_at <
      NOW() - INTERVAL '1 day'
    `);

  } catch (error) {
    console.error(
      "Cleanup error:",
      error.message
    );
  }
}, 60 * 60 * 1000);

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(
    `ENTSONE backend running on port ${PORT}`
  );
});
