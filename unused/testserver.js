const express = require("express");

const app = express();
const PORT = 4545;

// ===== MIDDLEWARE =====
app.use(express.json());

// ===== STORAGE SEMENTARA =====
let receivedData = [];

// ===== ENDPOINT TERIMA DATA =====
app.post("/data", (req, res) => {
  const data = req.body;

  // validasi sederhana
  if (!data || !data.ID) {
    return res.status(400).json({
      success: false,
      message: "Data tidak valid"
    });
  }

  console.log("DATA MASUK:", data);

  // simpan ke memory (sementara)
  receivedData.push(data);

  res.json({
    success: true,
    message: "Data diterima"
  });
});

// ===== CEK DATA =====
app.get("/data", (req, res) => {
  res.json(receivedData);
});

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("Server jalan ");
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server jalan di http://localhost:${PORT}`);
});