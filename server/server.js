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

// Create database tables
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

    console.log("ENTSONE database tables ready");
  } catch (error) {
    console.error("Database table error:", error);
  }
}

createTables();

// Home
app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "ENTSONE",
    message: "ENTSONE backend is running"
  });
});

// Health
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "ENTSONE API"
  });
});

// Database test
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      database: "connected",
      time: result.rows[0].now
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      database: "connection_failed"
    });
  }
});

// GET all tournaments
app.get("/api/tournaments", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tournaments ORDER BY id DESC"
    );

    res.json({
      success: true,
      tournaments: result.rows
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      tournaments: []
    });
  }
});

// GET single tournament
app.get("/api/tournaments/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
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
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// CREATE tournament
app.post("/api/tournaments", async (req, res) => {
  try {
    const {
      name,
      game,
      mode,
      entry_fee = 0,
      prize_pool = 0,
      start_time,
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
      (name, game, mode, entry_fee, prize_pool, start_time, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        name,
        game,
        mode || null,
        entry_fee,
        prize_pool,
        start_time || null,
        status
      ]
    );

    res.status(201).json({
      success: true,
      tournament: result.rows[0]
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Could not create tournament"
    });
  }
});

// DELETE tournament
app.delete("/api/tournaments/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM tournaments WHERE id = $1 RETURNING *",
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
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Could not delete tournament"
    });
  }
});
// UPDATE tournament
app.put("/api/tournaments/:id", async (req, res) => {
  try {
    const {
      name,
      game,
      mode,
      entry_fee = 0,
      prize_pool = 0,
      start_time,
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
        name = $1,
        game = $2,
        mode = $3,
        entry_fee = $4,
        prize_pool = $5,
        start_time = $6,
        status = $7
      WHERE id = $8
      RETURNING *
      `,
      [
        name,
        game,
        mode || null,
        entry_fee,
        prize_pool,
        start_time || null,
        status,
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
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Could not update tournament"
    });
  }
});
app.listen(PORT, () => {
  console.log(`ENTSONE backend running on port ${PORT}`);
});
