const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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

app.get("/api/tournaments", (req, res) => {
  res.json({
    success: true,
    tournaments: []
  });
});

app.listen(PORT, () => {
  console.log(`ENTSONE backend running on port ${PORT}`);
});
