const express = require("express");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../../database/db");

const router = express.Router();

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const SERVICE_CLIENT_ID = process.env.SERVICE_CLIENT_ID || "service-nilai";
const SERVICE_CLIENT_SECRET =
    process.env.SERVICE_CLIENT_SECRET || process.env.SERVICE_TO_SERVICE_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
    throw new Error("JWT secrets belum dikonfigurasi di .env");
}

const ACCESS_TTL = "10m";
const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function safeEqual(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length &&
        crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function issueAccessToken(user) {
    return jwt.sign(
        {
            sub: String(user.id),
            role: user.role,
        },
        ACCESS_SECRET,
        {
            expiresIn: ACCESS_TTL,
            algorithm: "HS256",
        }
    );
}

function issueRefreshToken() {
    return crypto.randomBytes(48).toString("base64url");
}

function isRegisteredDevice(userId, deviceId) {
    if (typeof deviceId !== "string" || !deviceId.trim()) {
        return false;
    }

    return Boolean(
        db.prepare(`
      SELECT 1
      FROM devices
      WHERE user_id = ?
        AND device_id = ?
        AND is_active = 1
    `).get(userId, deviceId)
    );
}

function recordAudit(subject, endpoint, deviceId, decision, reason) {
    db.prepare(`
    INSERT INTO audit_logs
      (subject, endpoint, device_id, decision, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(
        subject,
        endpoint,
        deviceId || null,
        decision,
        reason
    );
}

// POST /auth/login
router.post("/login", (req, res) => {
    const { username, password } = req.body || {};
    const deviceId = req.get("X-Device-ID");

    if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        !deviceId
    ) {
        recordAudit(
            username || "unknown",
            "/auth/login",
            deviceId,
            "deny",
            "Missing credentials or device ID"
        );

        return res.status(400).json({
            error: "Username, password, dan X-Device-ID wajib diisi.",
        });
    }

    const user = db.prepare(`
    SELECT id, username, password_hash, role, full_name
    FROM users
    WHERE username = ?
  `).get(username);

    // Pesan dibuat sama agar tidak mengungkap keberadaan akun.
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        recordAudit(
            username,
            "/auth/login",
            deviceId,
            "deny",
            "Invalid credentials"
        );

        return res.status(401).json({
            error: "Kredensial tidak valid.",
        });
    }

    if (!isRegisteredDevice(user.id, deviceId)) {
        recordAudit(
            user.username,
            "/auth/login",
            deviceId,
            "deny",
            "Device not registered"
        );

        return res.status(403).json({
            error: "Device tidak terdaftar atau tidak aktif.",
        });
    }

    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();

    db.prepare(`
    INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(user.id, deviceId, hashToken(refreshToken), expiresAt);

    recordAudit(
        user.username,
        "/auth/login",
        deviceId,
        "allow",
        "Login successful"
    );

    return res.json({
        message: "Login berhasil.",
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            fullName: user.full_name,
        },
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        expiresIn: 600,
        refreshExpiresIn: 86400,
    });
});

// POST /auth/service
router.post("/service", (req, res) => {
    const { clientId, clientSecret } = req.body || {};
    const valid = SERVICE_CLIENT_SECRET &&
        safeEqual(clientId, SERVICE_CLIENT_ID) &&
        safeEqual(clientSecret, SERVICE_CLIENT_SECRET);

    if (!valid) {
        recordAudit(
            "unknown-service",
            "/auth/service",
            null,
            "deny",
            "Invalid service client credentials"
        );
        return res.status(401).json({ error: "Kredensial service tidak valid." });
    }

    const token = jwt.sign(
        { role: "service" },
        ACCESS_SECRET,
        {
            subject: SERVICE_CLIENT_ID,
            issuer: "zero-trust-gateway",
            audience: "zero-trust-services",
            expiresIn: "5m",
            algorithm: "HS256"
        }
    );

    recordAudit(
        SERVICE_CLIENT_ID,
        "/auth/service",
        null,
        "allow",
        "Service token issued"
    );

    return res.json({ token, tokenType: "Bearer", expiresIn: 300 });
});

// POST /auth/refresh
router.post("/refresh", (req, res) => {
    const { refreshToken } = req.body || {};
    const deviceId = req.get("X-Device-ID");

    if (
        typeof refreshToken !== "string" ||
        !refreshToken ||
        !deviceId
    ) {
        recordAudit(
            "unknown",
            "/auth/refresh",
            deviceId,
            "deny",
            "Missing refresh token or device ID"
        );
        return res.status(400).json({
            error: "Refresh token dan X-Device-ID wajib diisi.",
        });
    }

    const tokenHash = hashToken(refreshToken);

    const saved = db.prepare(`
    SELECT rt.id, rt.user_id, rt.device_id, rt.expires_at, u.username, u.role
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = ?
      AND rt.revoked_at IS NULL
  `).get(tokenHash);

    if (!saved || Date.parse(saved.expires_at) <= Date.now()) {
        recordAudit(
            "unknown",
            "/auth/refresh",
            deviceId,
            "deny",
            "Invalid, expired, or revoked refresh token"
        );

        return res.status(401).json({
            error: "Refresh token tidak valid atau sudah kedaluwarsa.",
        });
    }

    if (!isRegisteredDevice(saved.user_id, deviceId)) {
        recordAudit(
            saved.username,
            "/auth/refresh",
            deviceId,
            "deny",
            "Device not registered"
        );

        return res.status(403).json({
            error: "Device tidak terdaftar atau tidak aktif.",
        });
    }

    if (saved.device_id && saved.device_id !== deviceId) {
        recordAudit(
            saved.username,
            "/auth/refresh",
            deviceId,
            "deny",
            "Refresh token belongs to another device"
        );
        return res.status(403).json({
            error: "Refresh token tidak terikat ke device ini."
        });
    }

    const newRefreshToken = issueRefreshToken();
    const newExpiresAt = new Date(
        Date.now() + REFRESH_TTL_MS
    ).toISOString();

    // Rotasi token dilakukan secara atomik.
    const rotate = db.transaction(() => {
        const result = db.prepare(`
      UPDATE refresh_tokens
      SET device_id = COALESCE(device_id, ?), revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `).run(deviceId, saved.id);

        if (result.changes !== 1) {
            return false;
        }

        db.prepare(`
      INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
            saved.user_id,
            deviceId,
            hashToken(newRefreshToken),
            newExpiresAt
        );

        return true;
    });

    if (!rotate()) {
        recordAudit(
            saved.username,
            "/auth/refresh",
            deviceId,
            "deny",
            "Refresh token was concurrently used or revoked"
        );
        return res.status(401).json({
            error: "Refresh token sudah digunakan atau dicabut.",
        });
    }

    const accessToken = issueAccessToken({
        id: saved.user_id,
        role: saved.role,
    });

    recordAudit(
        saved.username,
        "/auth/refresh",
        deviceId,
        "allow",
        "Token refreshed"
    );

    return res.json({
        accessToken,
        refreshToken: newRefreshToken,
        tokenType: "Bearer",
        expiresIn: 600,
        refreshExpiresIn: 86400,
    });
});

// POST /auth/logout
router.post("/logout", (req, res) => {
    const { refreshToken } = req.body || {};
    const deviceId = req.get("X-Device-ID");

    if (typeof refreshToken !== "string" || !refreshToken || !deviceId) {
        recordAudit(
            "unknown",
            "/auth/logout",
            deviceId,
            "deny",
            "Missing refresh token or device ID"
        );
        return res.status(400).json({
            error: "Refresh token dan X-Device-ID wajib diisi.",
        });
    }

    const tokenHash = hashToken(refreshToken);

    const saved = db.prepare(`
    SELECT rt.id, rt.user_id, rt.device_id, rt.expires_at, u.username
    FROM refresh_tokens rt
    JOIN users u ON u.id = rt.user_id
    WHERE rt.token_hash = ?
      AND rt.revoked_at IS NULL
  `).get(tokenHash);

    if (!saved) {
        recordAudit(
            "unknown",
            "/auth/logout",
            deviceId,
            "deny",
            "Invalid or revoked refresh token"
        );
        return res.status(401).json({
            error: "Refresh token tidak valid atau sudah dicabut.",
        });
    }

    if (Date.parse(saved.expires_at) <= Date.now()) {
        recordAudit(
            saved.username,
            "/auth/logout",
            deviceId,
            "deny",
            "Expired refresh token"
        );
        return res.status(401).json({
            error: "Refresh token tidak valid atau sudah kedaluwarsa."
        });
    }

    if (!isRegisteredDevice(saved.user_id, deviceId)) {
        recordAudit(
            saved.username,
            "/auth/logout",
            deviceId,
            "deny",
            "Device not registered"
        );
        return res.status(403).json({
            error: "Device tidak terdaftar atau tidak aktif."
        });
    }

    if (saved.device_id && saved.device_id !== deviceId) {
        recordAudit(
            saved.username,
            "/auth/logout",
            deviceId,
            "deny",
            "Refresh token belongs to another device"
        );
        return res.status(403).json({
            error: "Refresh token tidak terikat ke device ini."
        });
    }

    db.prepare(`
    UPDATE refresh_tokens
    SET device_id = COALESCE(device_id, ?), revoked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revoked_at IS NULL
  `).run(deviceId, saved.id);

    recordAudit(
        saved.username,
        "/auth/logout",
        deviceId,
        "allow",
        "Refresh token revoked"
    );

    return res.json({
        message: "Logout berhasil. Refresh token telah dicabut.",
    });
});

module.exports = router;
