const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");

const { initializeDatabase } = require("./server/db");
const { seed } = require("./server/seed");
const { attachUser } = require("./server/auth");
const { registerRoutes } = require("./server/routes");

const PORT = process.env.PORT || 3000;
const app = express();

initializeDatabase();
seed();

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

registerRoutes(app);

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`AttendTrack Pro running on http://localhost:${PORT}`);
});
