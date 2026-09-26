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

// Database connection test
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

    res.json({
      success: true,
      tournaments: []
    });
  }
});

app.listen(PORT, () => {
  console.log(`ENTSONE backend running on port ${PORT}`);
});
