require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../database/db");

const app = express();
const PORT = 3001;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const SERVICE_TO_SERVICE_SECRET =
    process.env.SERVICE_TO_SERVICE_SECRET;

if (!ACCESS_SECRET || !GATEWAY_SECRET || !SERVICE_TO_SERVICE_SECRET) {
    throw new Error("JWT_ACCESS_SECRET, GATEWAY_SECRET, dan SERVICE_TO_SERVICE_SECRET wajib diatur.");
}

// Verifikasi ulang di sisi service.
function verifyGatewayAndToken(req, res, next) {
    const gatewaySecret = req.get("X-Gateway-Secret");
    const authorization = req.get("Authorization");

    if (
        !gatewaySecret ||
        gatewaySecret.length !== GATEWAY_SECRET.length ||
        !require("node:crypto").timingSafeEqual(
            Buffer.from(gatewaySecret),
            Buffer.from(GATEWAY_SECRET)
        )
    ) {
        return res.status(403).json({
            error: "Gateway secret tidak valid."
        });
    }

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Bearer token wajib disertakan."
        });
    }

    try {
        const payload = jwt.verify(
            authorization.slice(7),
            ACCESS_SECRET,
            { algorithms: ["HS256"] }
        );

        if (!payload.sub || !payload.role) {
            return res.status(401).json({
                error: "Klaim token tidak valid."
            });
        }

        const user = db.prepare(`
      SELECT id, username, role
      FROM users
      WHERE id = ?
    `).get(Number(payload.sub));

        if (!user || user.role !== payload.role) {
            return res.status(401).json({
                error: "Identitas token tidak valid."
            });
        }

        req.user = user;
        next();
    } catch {
        return res.status(401).json({
            error: "Token tidak valid atau kedaluwarsa."
        });
    }
}

// Memastikan perubahan/finalisasi hanya pukul 07.00–21.00.
// Zona waktu mengikuti konfigurasi TZ proses server.
function withinAccessHours() {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 21;
}


async function syncTranskrip(classId) {
    const response = await fetch(
        "http://127.0.0.1:3000/internal/transkrip/sync",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Service-Secret": SERVICE_TO_SERVICE_SECRET
            },
            body: JSON.stringify({ classId }),
            signal: AbortSignal.timeout(5000)
        }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            result.error || `Sinkronisasi gagal (${response.status})`
        );
    }

    return result;
}


// GET /nilai
app.get("/nilai", verifyGatewayAndToken, (req, res) => {
    const { id, role } = req.user;

    if (role === "mahasiswa") {
        const grades = db.prepare(`
      SELECT c.class_code, c.class_name, g.score, g.is_final
      FROM grades g
      JOIN classes c ON c.id = g.class_id
      WHERE g.student_id = ?
    `).all(id);

        return res.json({ grades });
    }

    if (role === "dosen") {
        const grades = db.prepare(`
      SELECT c.class_code, c.class_name,
             u.nim, u.full_name, g.score, g.is_final
      FROM grades g
      JOIN classes c ON c.id = g.class_id
      JOIN users u ON u.id = g.student_id
      WHERE c.lecturer_id = ?
    `).all(id);

        return res.json({ grades });
    }

    return res.status(403).json({
        error: "Role tidak diizinkan melihat nilai."
    });
});

// PUT /nilai/:id
app.put("/nilai/:id", verifyGatewayAndToken, (req, res) => {
    if (req.user.role !== "dosen") {
        return res.status(403).json({
            error: "Hanya dosen yang boleh mengubah nilai."
        });
    }

    if (!withinAccessHours()) {
        return res.status(403).json({
            error: "Perubahan nilai hanya diizinkan pukul 07.00–21.00."
        });
    }

    const score = req.body?.score;

    if (
        typeof score !== "number" ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100
    ) {
        return res.status(400).json({
            error: "Nilai harus berupa angka antara 0 dan 100."
        });
    }

    const grade = db.prepare(`
    SELECT g.id, g.is_final, c.lecturer_id
    FROM grades g
    JOIN classes c ON c.id = g.class_id
    WHERE g.id = ?
  `).get(req.params.id);

    if (!grade) {
        return res.status(404).json({
            error: "Data nilai tidak ditemukan."
        });
    }

    if (grade.lecturer_id !== req.user.id) {
        return res.status(403).json({
            error: "Kelas ini bukan kelas yang kamu ampu."
        });
    }

    if (grade.is_final) {
        return res.status(409).json({
            error: "Nilai sudah final dan tidak dapat diubah."
        });
    }

    db.prepare(`
    UPDATE grades
    SET score = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(score, grade.id);

    return res.json({
        message: "Nilai berhasil diperbarui.",
        gradeId: grade.id,
        score
    });
});

// POST /kelas/:id/finalisasi

app.post(
    "/kelas/:id/finalisasi",
    verifyGatewayAndToken,
    async (req, res) => {
        if (req.user.role !== "dosen") {
            return res.status(403).json({
                error: "Hanya dosen yang boleh memfinalisasi nilai."
            });
        }

        if (!withinAccessHours()) {
            return res.status(403).json({
                error: "Finalisasi hanya diizinkan pukul 07.00–21.00."
            });
        }

        const classId = Number(req.params.id);

        if (!Number.isInteger(classId) || classId <= 0) {
            return res.status(400).json({
                error: "ID kelas tidak valid."
            });
        }

        const kelas = db.prepare(`
            SELECT id, lecturer_id
            FROM classes
            WHERE id = ?
        `).get(classId);

        if (!kelas) {
            return res.status(404).json({
                error: "Kelas tidak ditemukan."
            });
        }

        if (kelas.lecturer_id !== req.user.id) {
            return res.status(403).json({
                error: "Kelas ini bukan kelas yang kamu ampu."
            });
        }

        const result = db.prepare(`
            UPDATE grades
            SET is_final = 1, updated_at = CURRENT_TIMESTAMP
            WHERE class_id = ? AND is_final = 0
        `).run(classId);

        try {
            const syncResult = await syncTranskrip(classId);

            return res.json({
                message: "Nilai berhasil difinalisasi dan transkrip disinkronkan.",
                classId,
                finalizedGrades: result.changes,
                syncedCount: syncResult.syncedCount
            });
        } catch (err) {
            console.error(
                `Sinkronisasi transkrip kelas ${classId} gagal:`,
                err.message
            );

            return res.status(502).json({
                error: "Nilai sudah difinalisasi, tetapi sinkronisasi transkrip gagal.",
                classId,
                finalizedGrades: result.changes,
                transcriptSynced: false
            });
        }
    }
);


app.listen(PORT, "127.0.0.1", () => {
    console.log(`Service Nilai berjalan di http://127.0.0.1:${PORT}`);
});
