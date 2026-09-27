const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS results (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        position INTEGER,
        kills INTEGER DEFAULT 0,
        points INTEGER DEFAULT 0,
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

/* =========================================================
   STEP 7A
   USER SYSTEM - CREATE / FIND USER
========================================================= */

app.post("/api/users", async (req, res) => {
  try {
    const {
      name = null,
      email = null,
      phone = null
    } = req.body;

    const cleanName = name ? String(name).trim() : null;
    const cleanEmail = email
      ? String(email).trim().toLowerCase()
      : null;
    const cleanPhone = phone
      ? String(phone).trim()
      : null;

    if (!cleanEmail && !cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Email or phone is required"
      });
    }

    /* Find existing user by email */
    if (cleanEmail) {
      const emailUser = await pool.query(
        `
        SELECT id, name, email, phone, created_at
        FROM users
        WHERE email = $1
        `,
        [cleanEmail]
      );

      if (emailUser.rows.length > 0) {
        return res.json({
          success: true,
          existing: true,
          user: emailUser.rows[0]
        });
      }
    }

    /* Find existing user by phone */
    if (cleanPhone) {
      const phoneUser = await pool.query(
        `
        SELECT id, name, email, phone, created_at
        FROM users
        WHERE phone = $1
        `,
        [cleanPhone]
      );

      if (phoneUser.rows.length > 0) {
        return res.json({
          success: true,
          existing: true,
          user: phoneUser.rows[0]
        });
      }
    }

    /* Create new user */
    const result = await pool.query(
      `
      INSERT INTO users
      (
        name,
        email,
        phone
      )
      VALUES ($1, $2, $3)
      RETURNING id, name, email, phone, created_at
      `,
      [
        cleanName,
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
   GET USER BY ID
========================= */

app.get("/api/users/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        name,
        email,
        phone,
        created_at
      FROM users
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
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

/* =========================
   GET ALL TOURNAMENTS
========================= */

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

/* =========================
   GET SINGLE TOURNAMENT
========================= */

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

    if (result.rows.length === 0) {
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

    const safeEntryFee = Number(entry_fee) || 0;
    const safePrizePool = Number(prize_pool) || 0;
    const safeSlots = Math.max(0, Number(slots) || 0);

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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        name,
        game,
        mode || null,
        safeEntryFee,
        safePrizePool,
        start_time || null,
        start_label || "Scheduled",
        safeSlots,
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

    const safeEntryFee = Number(entry_fee) || 0;
    const safePrizePool = Number(prize_pool) || 0;
    const safeSlots = Math.max(0, Number(slots) || 0);

    const result = await pool.query(
      `
      UPDATE tournaments
      SET
        name = $1,
        game = $2,
        mode = $3,
        entry_fee = $4,
        prize_pool = $5,
        start_time = $6,
        start_label = $7,
        slots = $8,
        status = $9
      WHERE id = $10
      RETURNING *
      `,
      [
        name,
        game,
        mode || null,
        safeEntryFee,
        safePrizePool,
        start_time || null,
        start_label || "Scheduled",
        safeSlots,
        status || "UPCOMING",
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
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

    if (result.rows.length === 0) {
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

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`ENTSONE backend running on port ${PORT}`);
});
