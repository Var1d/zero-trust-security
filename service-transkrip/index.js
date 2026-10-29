require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const db = require("../database/db");

const app = express();
const PORT = 3002;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const SERVICE_CLIENT_ID = process.env.SERVICE_CLIENT_ID || "service-nilai";

if (!ACCESS_SECRET || !GATEWAY_SECRET) {
    throw new Error(
        "JWT_ACCESS_SECRET dan GATEWAY_SECRET wajib diatur di .env"
    );
}

function verifyGateway(req, res, next) {
    const supplied = req.get("X-Gateway-Secret") || "";
    const expected = GATEWAY_SECRET;

    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);

    if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
        return res.status(403).json({
            error: "Gateway tidak terverifikasi."
        });
    }

    next();
}

function verifyUser(req, res, next) {
    const authorization = req.get("Authorization") || "";

    if (!authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Access token wajib disertakan."
        });
    }

    let payload;

    try {
        payload = jwt.verify(
            authorization.slice(7),
            ACCESS_SECRET,
            { algorithms: ["HS256"] }
        );
    } catch {
        return res.status(401).json({
            error: "Access token tidak valid atau kedaluwarsa."
        });
    }

    const user = db.prepare(`
    SELECT id, username, role, nim
    FROM users
    WHERE id = ?
  `).get(Number(payload.sub));

    if (!user || user.role !== payload.role) {
        return res.status(401).json({
            error: "Identitas pengguna tidak valid."
        });
    }

    const deviceId = req.get("X-Device-ID");
    const device = deviceId && db.prepare(`
        SELECT 1 FROM devices
        WHERE user_id = ? AND device_id = ? AND is_active = 1
    `).get(user.id, deviceId);
    if (!device) {
        return res.status(403).json({
            error: "Device tidak terdaftar atau tidak aktif."
        });
    }

    req.user = user;
    req.deviceId = deviceId;
    next();
}

function verifyServiceToken(req, res, next) {
    const authorization = req.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Service token wajib disertakan." });
    }
    try {
        const payload = jwt.verify(authorization.slice(7), ACCESS_SECRET, {
            algorithms: ["HS256"],
            issuer: "zero-trust-gateway",
            audience: "zero-trust-services"
        });
        if (payload.role !== "service" || payload.sub !== SERVICE_CLIENT_ID) {
            return res.status(403).json({ error: "Service token tidak diizinkan." });
        }
        req.service = { id: payload.sub, role: payload.role };
        return next();
    } catch {
        return res.status(401).json({ error: "Service token tidak valid atau kedaluwarsa." });
    }
}

/*
 * Endpoint transkrip:
 * harus berasal dari Gateway dan membawa access token pengguna.
 */
app.use(verifyGateway);

app.get("/transkrip/:nim", verifyUser, (req, res) => {
    if (!["mahasiswa", "admin"].includes(req.user.role)) {
        return res.status(403).json({
            error: "Role tidak diizinkan melihat transkrip."
        });
    }

    const student = db.prepare(`
        SELECT id, username, nim
        FROM users
        WHERE nim = ? AND role = 'mahasiswa'
    `).get(req.params.nim);
    if (!student) {
        return res.status(404).json({ error: "NIM mahasiswa tidak ditemukan." });
    }
    if (req.user.role === "mahasiswa" && student.id !== req.user.id) {
        return res.status(403).json({ error: "Mahasiswa hanya dapat melihat transkrip miliknya." });
    }

    const transcripts = db.prepare(`
        SELECT
            c.class_code,
            c.class_name,
            t.score,
            t.synced_at
        FROM transcripts t
        JOIN classes c ON c.id = t.class_id
        WHERE t.student_id = ?
        ORDER BY c.class_code
    `).all(student.id);

    return res.json({
        student: {
            username: student.username,
            nim: student.nim
        },
        transcripts
    });
});

/*
 * Endpoint internal: service token wajib dan gateway secret sudah diverifikasi
 * oleh middleware global di atas.
 */
app.post(
    "/transkrip/sinkron",
    verifyServiceToken,
    (req, res) => {
        const { classId } = req.body || {};

        if (!Number.isInteger(classId) || classId <= 0) {
            return res.status(400).json({
                error: "classId harus berupa bilangan bulat positif."
            });
        }

        const sync = db.transaction(() => {
            const finalGrades = db.prepare(`
                SELECT student_id, class_id, score
                FROM grades
                WHERE class_id = ? AND is_final = 1
            `).all(classId);

            const upsertTranscript = db.prepare(`
                INSERT INTO transcripts
                    (student_id, class_id, score, synced_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(student_id, class_id)
                DO UPDATE SET
                    score = excluded.score,
                    synced_at = CURRENT_TIMESTAMP
            `);

            for (const grade of finalGrades) {
                upsertTranscript.run(
                    grade.student_id,
                    grade.class_id,
                    grade.score
                );
            }

            return finalGrades.length;
        });

        const syncedCount = sync();

        return res.json({
            message: "Sinkronisasi transkrip berhasil.",
            classId,
            syncedCount
        });
    }
);

app.listen(PORT, "127.0.0.1", () => {
    console.log(
        `Service Transkrip berjalan di http://127.0.0.1:${PORT}`
    );
});
