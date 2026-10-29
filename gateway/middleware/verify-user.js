const jwt = require("jsonwebtoken");
const db = require("../../database/db");

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

function audit(subject, endpoint, deviceId, decision, reason) {
    db.prepare(`
    INSERT INTO audit_logs
      (subject, endpoint, device_id, decision, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(
        subject || "unknown",
        endpoint,
        deviceId || null,
        decision,
        reason
    );
}

function verifyUser(req, res, next) {
    const authorization = req.get("Authorization");
    const deviceId = req.get("X-Device-ID");

    const deny = (status, reason, subject = "unknown") => {
        audit(
            subject,
            req.originalUrl,
            deviceId,
            "deny",
            reason
        );

        return res.status(status).json({
            error: status === 401
                ? "Token tidak valid atau tidak tersedia."
                : "Akses ditolak."
        });
    };

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return deny(401, "Missing bearer token");
    }

    if (!ACCESS_SECRET) {
        console.error("JWT_ACCESS_SECRET belum dikonfigurasi.");
        audit("unknown", req.originalUrl, deviceId, "deny", "Access token verification is not configured");
        return res.status(500).json({
            error: "Konfigurasi autentikasi server bermasalah."
        });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
        return deny(401, "Empty bearer token");
    }

    let payload;

    try {
        payload = jwt.verify(token, ACCESS_SECRET, {
            algorithms: ["HS256"]
        });
    } catch {
        return deny(401, "Invalid or expired access token");
    }

    if (
        !payload.sub ||
        !["admin", "dosen", "mahasiswa"].includes(payload.role)
    ) {
        return deny(401, "Invalid token claims");
    }

    if (!deviceId) {
        return deny(403, "Missing device ID");
    }

    const user = db.prepare(`
    SELECT id, username, role
    FROM users
    WHERE id = ?
  `).get(Number(payload.sub));

    if (!user || user.role !== payload.role) {
        return deny(401, "User not found or role changed", user?.username);
    }

    if (!deviceId) {
        return deny(403, "Missing device ID", user.username);
    }

    const device = db.prepare(`
    SELECT 1
    FROM devices
    WHERE user_id = ?
      AND device_id = ?
      AND is_active = 1
  `).get(user.id, deviceId);

    if (!device) {
        audit(
            user.username,
            req.originalUrl,
            deviceId,
            "deny",
            "Device not registered or inactive"
        );

        return res.status(403).json({
            error: "Device tidak terdaftar atau tidak aktif."
        });
    }

    req.user = {
        id: user.id,
        username: user.username,
        role: user.role
    };

    req.deviceId = deviceId;

    return next();
}

module.exports = verifyUser;
