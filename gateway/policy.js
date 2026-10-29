const policies = [
    { method: "GET", path: /^\/me$/, roles: ["admin", "dosen", "mahasiswa"] },
    { method: "GET", path: /^\/nilai$/, roles: ["mahasiswa", "dosen"] },
    { method: "PUT", path: /^\/nilai\/\d+$/, roles: ["dosen"], attribute: "gradeOwner" },
    { method: "POST", path: /^\/kelas\/\d+\/finalisasi$/, roles: ["dosen"], attribute: "classOwner" },
    { method: "GET", path: /^\/transkrip\/[^/]+$/, roles: ["mahasiswa", "admin"], attribute: "transcriptOwner" },
    { method: "POST", path: /^\/transkrip\/sinkron$/, roles: ["service"] }
];

function evaluatePolicy({ method, path, role, userId, attributes = {} }) {
    const policy = policies.find(
        item => item.method === method && item.path.test(path)
    );

    if (!policy) {
        return { allowed: false, status: 404, reason: "No matching access policy" };
    }

    if (!policy.roles.includes(role)) {
        return { allowed: false, status: 403, reason: "Role not permitted" };
    }

    if (policy.attribute === "gradeOwner" && attributes.lecturerId == null) {
        return { allowed: false, status: 404, reason: "Grade not found" };
    }
    if (policy.attribute === "gradeOwner" && attributes.lecturerId !== userId) {
        return { allowed: false, status: 403, reason: "Grade is not in lecturer's class" };
    }

    if (policy.attribute === "classOwner" && attributes.lecturerId == null) {
        return { allowed: false, status: 404, reason: "Class not found" };
    }
    if (policy.attribute === "classOwner" && attributes.lecturerId !== userId) {
        return { allowed: false, status: 403, reason: "Class is not assigned to lecturer" };
    }

    if (policy.attribute === "transcriptOwner") {
        if (!attributes.studentId) {
            return { allowed: false, status: 404, reason: "Student NIM not found" };
        }
        if (role === "mahasiswa" && attributes.studentId !== userId) {
            return { allowed: false, status: 403, reason: "Student may only read own transcript" };
        }
    }

    return { allowed: true, status: 200, reason: "Policy permitted request" };
}

module.exports = { evaluatePolicy };
