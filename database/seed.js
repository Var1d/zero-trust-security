require("dotenv").config();

const bcrypt = require("bcryptjs");
const db = require("./db");

const accounts = [
    {
        username: "admin01",
        role: "admin",
        fullName: "Administrator",
        nim: null,
        passwordEnv: "SEED_ADMIN_PASSWORD",
        deviceId: "DEV-ADMIN-001",
    },
    {
        username: "dosen01",
        role: "dosen",
        fullName: "Dosen Informatika 1",
        nim: null,
        passwordEnv: "SEED_DOSEN01_PASSWORD",
        deviceId: "DEV-DOSEN-001",
    },
    {
        username: "dosen02",
        role: "dosen",
        fullName: "Dosen Informatika 2",
        nim: null,
        passwordEnv: "SEED_DOSEN02_PASSWORD",
        deviceId: "DEV-DOSEN-002",
    },
    {
        username: "mhs01",
        role: "mahasiswa",
        fullName: "Mahasiswa 1",
        nim: "227001001",
        passwordEnv: "SEED_MHS01_PASSWORD",
        deviceId: "DEV-MHS-001",
    },
    {
        username: "mhs02",
        role: "mahasiswa",
        fullName: "Mahasiswa 2",
        nim: "227001002",
        passwordEnv: "SEED_MHS02_PASSWORD",
        deviceId: "DEV-MHS-002",
    },
    {
        username: "mhs03",
        role: "mahasiswa",
        fullName: "Mahasiswa 3",
        nim: "227001003",
        passwordEnv: "SEED_MHS03_PASSWORD",
        deviceId: "DEV-MHS-003",
    },
];

function seedDatabase() {
    // Pastikan semua password sudah dikonfigurasi.
    for (const account of accounts) {
        const password = process.env[account.passwordEnv];

        if (!password || !password.trim() || password.trim().toLowerCase().startsWith("ganti_dengan_")) {
            throw new Error(
                `Password demo belum diatur: ${account.passwordEnv}`
            );
        }

        if (password.length < 12) {
            throw new Error(
                `Password ${account.username} harus minimal 12 karakter.`
            );
        }
    }

    const insertUser = db.prepare(`
    INSERT INTO users (username, password_hash, role, full_name, nim)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(username) DO NOTHING
  `);

    const insertDevice = db.prepare(`
    INSERT INTO devices (user_id, device_id, device_name)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, device_id) DO NOTHING
  `);

    const insertClass = db.prepare(`
    INSERT INTO classes (class_code, class_name, lecturer_id)
    VALUES (?, ?, ?)
    ON CONFLICT(class_code) DO NOTHING
  `);

    const insertGrade = db.prepare(`
    INSERT INTO grades (class_id, student_id, score)
    VALUES (?, ?, ?)
    ON CONFLICT(class_id, student_id) DO NOTHING
  `);

    const findUser = db.prepare(`
    SELECT id FROM users WHERE username = ?
  `);

    const findClass = db.prepare(`
    SELECT id FROM classes WHERE class_code = ?
  `);

    const transaction = db.transaction(() => {
        for (const account of accounts) {
            const existing = findUser.get(account.username);

            // Jangan mengubah password akun yang sudah ada.
            if (!existing) {
                const passwordHash = bcrypt.hashSync(
                    process.env[account.passwordEnv],
                    12
                );

                insertUser.run(
                    account.username,
                    passwordHash,
                    account.role,
                    account.fullName,
                    account.nim
                );
            }

            const user = findUser.get(account.username);

            insertDevice.run(
                user.id,
                account.deviceId,
                `Device ${account.username}`
            );
        }

        const lecturer1 = findUser.get("dosen01");
        const lecturer2 = findUser.get("dosen02");

        insertClass.run(
            "IF101",
            "Pemrograman Dasar",
            lecturer1.id
        );

        insertClass.run(
            "IF102",
            "Sistem Operasi",
            lecturer2.id
        );

        const class1 = findClass.get("IF101");
        const class2 = findClass.get("IF102");

        const students = ["mhs01", "mhs02", "mhs03"];

        for (let i = 0; i < students.length; i++) {
            const student = findUser.get(students[i]);

            insertGrade.run(class1.id, student.id, 80 + i);
            insertGrade.run(class2.id, student.id, 85 + i);
        }
    });

    transaction();

    console.log("Seed data berhasil dibuat atau sudah tersedia.");
    console.log("Jumlah user:", db.prepare(
        "SELECT COUNT(*) AS total FROM users"
    ).get().total);
    console.log("Jumlah device:", db.prepare(
        "SELECT COUNT(*) AS total FROM devices"
    ).get().total);
    console.log("Jumlah kelas:", db.prepare(
        "SELECT COUNT(*) AS total FROM classes"
    ).get().total);
    console.log("Jumlah nilai:", db.prepare(
        "SELECT COUNT(*) AS total FROM grades"
    ).get().total);
}

try {
    seedDatabase();
} finally {
    db.close();
}
