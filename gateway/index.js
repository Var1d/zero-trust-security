require("dotenv").config();

const express = require("express");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "zero-trust-api-gateway",
    });
});

app.use("/auth", authRoutes);

app.use((req, res) => {
    res.status(404).json({
        error: "Endpoint tidak ditemukan.",
    });
});

app.listen(PORT, "127.0.0.1", () => {
    console.log(`API Gateway berjalan di http://127.0.0.1:${PORT}`);
});
