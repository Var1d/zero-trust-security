const policies = [
    {
        method: "GET",
        path: /^\/nilai$/,
        roles: ["mahasiswa", "dosen"],
        reason: "Role diizinkan melihat nilai"
    },
    {
        method: "PUT",
        path: /^\/nilai\/[^/]+$/,
        roles: ["dosen"],
        reason: "Role diizinkan mengubah nilai"
    },
    {
        method: "POST",
        path: /^\/kelas\/[^/]+\/finalisasi$/,
        roles: ["dosen"],
        reason: "Role diizinkan mengajukan finalisasi"
    },
    {
        method: "GET",
        path: /^\/transkrip\/[^/]+$/,
        roles: ["mahasiswa", "admin"],
        reason: "Role diizinkan melihat transkrip"
    },
    {
        method: "POST",
        path: /^\/transkrip\/sinkron$/,
        roles: ["service"],
        reason: "Hanya service yang boleh menyinkronkan transkrip"
    }
];

function evaluatePolicy({ method, path, role }) {
    const policy = policies.find(
        item => item.method === method && item.path.test(path)
    );

    if (!policy) {
        return {
            allowed: false,
            reason: "No matching access policy"
        };
    }

    if (!policy.roles.includes(role)) {
        return {
            allowed: false,
            reason: "Role not permitted"
        };
    }

    return {
        allowed: true,
        reason: policy.reason
    };
}

module.exports = { evaluatePolicy };
