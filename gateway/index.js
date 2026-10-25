require("dotenv").config();
const crypto = require("node:crypto");

const express = require("express");
const {
    createProxyMiddleware,
    fixRequestBody
} = require("http-proxy-middleware");

const authRoutes = require("./routes/auth");
const verifyUser = require("./middleware/verify-user");

const app = express();
const PORT = 3000;

const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const SERVICE_TO_SERVICE_SECRET =
    process.env.SERVICE_TO_SERVICE_SECRET;

if (!GATEWAY_SECRET || !SERVICE_TO_SERVICE_SECRET) {
    throw new Error(
        "GATEWAY_SECRET dan SERVICE_TO_SERVICE_SECRET wajib diatur di .env"
    );
}

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        service: "zero-trust-api-gateway"
    });
});

// Endpoint autentikasi tetap ditangani gateway.
app.use("/auth", authRoutes);

// Endpoint pemeriksaan identitas.
app.get("/me", verifyUser, (req, res) => {
    res.json({
        message: "Token dan device valid.",
        user: req.user
    });
});

// Proxy ke Service Nilai.
// Hanya request yang lolos verifikasi user yang diteruskan.
const nilaiProxy = createProxyMiddleware({
    target: "http://127.0.0.1:3001",
    changeOrigin: true,

    // Mengembalikan path asli setelah Express melakukan mount.
    pathRewrite: (path, req) => req.originalUrl,

    on: {
        proxyReq: (proxyReq, req) => {
            // Gateway selalu mengganti secret dari sisi client.
            proxyReq.setHeader(
                "X-Gateway-Secret",
                GATEWAY_SECRET
            );

            // Meneruskan body JSON yang sudah dibaca Express.
            fixRequestBody(proxyReq, req);
        },

        error: (err, req, res) => {
            console.error("Proxy Service Nilai gagal:", err.message);

            if (!res.headersSent) {
                res.status(502).json({
                    error: "Service Nilai tidak dapat dihubungi."
                });
            }
        }
    }
});

const transkripProxy = createProxyMiddleware({
    target: "http://127.0.0.1:3002",
    changeOrigin: true,

    pathRewrite: (path, req) => req.originalUrl,

    on: {
        proxyReq: (proxyReq, req) => {
            proxyReq.setHeader(
                "X-Gateway-Secret",
                GATEWAY_SECRET
            );

            fixRequestBody(proxyReq, req);
        },

        error: (err, req, res) => {
            console.error(
                "Proxy Service Transkrip gagal:",
                err.message
            );

            if (!res.headersSent) {
                res.status(502).json({
                    error: "Service Transkrip tidak dapat dihubungi."
                });
            }
        }
    }
});

// Route ini harus berada sebelum handler 404.
app.use(
    ["/nilai", "/kelas"],
    verifyUser,
    nilaiProxy
);

app.use(
    "/transkrip",
    verifyUser,
    transkripProxy
);


app.post("/internal/transkrip/sync", async (req, res) => {
    const supplied = req.get("X-Service-Secret") || "";
    const expected = SERVICE_TO_SERVICE_SECRET;

    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);

    if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
        return res.status(403).json({
            error: "Autentikasi antarlayanan gagal."
        });
    }

    try {
        const response = await fetch(
            "http://127.0.0.1:3002/internal/sync",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Gateway-Secret": GATEWAY_SECRET,
                    "X-Service-Secret": SERVICE_TO_SERVICE_SECRET
                },
                body: JSON.stringify(req.body || {}),
                signal: AbortSignal.timeout(5000)
            }
        );

        const result = await response.json().catch(() => ({}));

        return res.status(response.status).json(result);
    } catch (err) {
        console.error(
            "Proxy sinkronisasi transkrip gagal:",
            err.message
        );

        return res.status(502).json({
            error: "Service Transkrip tidak dapat dihubungi."
        });
    }
});


app.use((req, res) => {
    res.status(404).json({
        error: "Endpoint tidak ditemukan."
    });
});

app.listen(PORT, "127.0.0.1", () => {
    console.log(
        `API Gateway berjalan di http://127.0.0.1:${PORT}`
    );
});
