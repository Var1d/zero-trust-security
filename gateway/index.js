require("dotenv").config();
const jwt = require("jsonwebtoken");

const express = require("express");
const {
    createProxyMiddleware,
    fixRequestBody
} = require("http-proxy-middleware");

const authRoutes = require("./routes/auth");
const verifyUser = require("./middleware/verify-user");
const { evaluatePolicy } = require("./policy");
const db = require("../database/db");

const app = express();
const PORT = 3000;

const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const SERVICE_CLIENT_ID = process.env.SERVICE_CLIENT_ID || "service-nilai";
const SERVICE_CLIENT_SECRET =
    process.env.SERVICE_CLIENT_SECRET || process.env.SERVICE_TO_SERVICE_SECRET;
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

if (
    !GATEWAY_SECRET ||
    !SERVICE_CLIENT_SECRET ||
    SERVICE_CLIENT_SECRET.trim().toLowerCase().startsWith("ganti_dengan_") ||
    !ACCESS_SECRET
) {
    throw new Error(
        "GATEWAY_SECRET, JWT_ACCESS_SECRET, dan kredensial service wajib diatur di .env"
    );
}

function recordAudit(subject, endpoint, deviceId, decision, reason) {
    db.prepare(`
        INSERT INTO audit_logs (subject, endpoint, device_id, decision, reason)
        VALUES (?, ?, ?, ?, ?)
    `).run(subject || "unknown", endpoint, deviceId || null, decision, reason);
}

function auditDownstream(req, decision, reason) {
    const identity = req.user || req.service;
    recordAudit(
        identity?.username || identity?.id,
        req.originalUrl.split("?")[0],
        req.deviceId,
        decision,
        reason
    );
}

function verifyServiceToken(req, res, next) {
    const authorization = req.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
        recordAudit("unknown-service", req.originalUrl, null, "deny", "Missing service bearer token");
        return res.status(401).json({ error: "Service token wajib disertakan." });
    }

    try {
        const payload = jwt.verify(authorization.slice(7), ACCESS_SECRET, {
            algorithms: ["HS256"],
            issuer: "zero-trust-gateway",
            audience: "zero-trust-services"
        });
        if (payload.role !== "service" || payload.sub !== SERVICE_CLIENT_ID) {
            recordAudit("unknown-service", req.originalUrl, null, "deny", "Invalid service token claims");
            return res.status(403).json({ error: "Service token tidak diizinkan." });
        }
        req.service = { id: payload.sub, role: payload.role };
        return next();
    } catch {
        recordAudit("unknown-service", req.originalUrl, null, "deny", "Invalid or expired service token");
        return res.status(401).json({ error: "Service token tidak valid atau kedaluwarsa." });
    }
}

function enforcePolicy(req, res, next) {
    const identity = req.user || req.service;
    const endpoint = req.originalUrl.split("?")[0];
    const attributes = {};

    if (req.method === "PUT" && /^\/nilai\/\d+$/.test(endpoint)) {
        const grade = db.prepare(`
            SELECT c.lecturer_id AS lecturerId
            FROM grades g JOIN classes c ON c.id = g.class_id
            WHERE g.id = ?
        `).get(Number(endpoint.split("/")[2]));
        attributes.lecturerId = grade?.lecturerId;
    } else if (req.method === "POST" && /^\/kelas\/\d+\/finalisasi$/.test(endpoint)) {
        const kelas = db.prepare("SELECT lecturer_id AS lecturerId FROM classes WHERE id = ?")
            .get(Number(endpoint.split("/")[2]));
        attributes.lecturerId = kelas?.lecturerId;
    } else if (req.method === "GET" && /^\/transkrip\/[^/]+$/.test(endpoint)) {
        const nim = endpoint.slice("/transkrip/".length);
        const student = db.prepare("SELECT id FROM users WHERE nim = ? AND role = 'mahasiswa'")
            .get(nim);
        attributes.studentId = student?.id;
    }

    const result = evaluatePolicy({
        method: req.method,
        path: endpoint,
        role: identity?.role,
        userId: identity?.id,
        attributes
    });
    recordAudit(
        identity?.username || identity?.id,
        endpoint,
        req.deviceId,
        result.allowed ? "allow" : "deny",
        result.reason
    );

    if (!result.allowed) {
        return res.status(result.status || 403).json({
            error: result.status === 404 ? "Resource tidak ditemukan." : "Akses ditolak."
        });
    }
    return next();
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
app.get("/me", verifyUser, enforcePolicy, (req, res) => {
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
        proxyRes: (proxyRes, req) => {
            if (proxyRes.statusCode >= 400) {
                auditDownstream(
                    req,
                    "deny",
                    `Service Nilai rejected request (HTTP ${proxyRes.statusCode})`
                );
            }
        },

        proxyReq: (proxyReq, req) => {
            // Gateway selalu mengganti secret dari sisi client.
            proxyReq.setHeader("X-Gateway-Secret", GATEWAY_SECRET);

            // Meneruskan body JSON yang sudah dibaca Express.
            fixRequestBody(proxyReq, req);
        },

        error: (err, req, res) => {
            console.error("Proxy Service Nilai gagal:", err.message);
            auditDownstream(req, "deny", "Service Nilai unavailable");

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
        proxyRes: (proxyRes, req) => {
            if (proxyRes.statusCode >= 400) {
                auditDownstream(
                    req,
                    "deny",
                    `Service Transkrip rejected request (HTTP ${proxyRes.statusCode})`
                );
            }
        },

        proxyReq: (proxyReq, req) => {
            proxyReq.setHeader("X-Gateway-Secret", GATEWAY_SECRET);

            fixRequestBody(proxyReq, req);
        },

        error: (err, req, res) => {
            auditDownstream(req, "deny", "Service Transkrip unavailable");
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
    enforcePolicy,
    nilaiProxy
);

app.get(
    "/transkrip/:nim",
    verifyUser,
    enforcePolicy,
    transkripProxy
);

app.post("/transkrip/sinkron", verifyServiceToken, enforcePolicy, transkripProxy);


app.use((req, res) => {
    recordAudit(
        "unknown",
        req.originalUrl,
        req.get("X-Device-ID"),
        "deny",
        "No matching gateway route"
    );
    res.status(404).json({
        error: "Endpoint tidak ditemukan."
    });
});

app.listen(PORT, "127.0.0.1", () => {
    console.log(
        `API Gateway berjalan di http://127.0.0.1:${PORT}`
    );
});
