const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePolicy } = require("../gateway/policy");

test("student and lecturer roles can request the grades endpoint", () => {
    for (const role of ["mahasiswa", "dosen"]) {
        assert.equal(
            evaluatePolicy({ method: "GET", path: "/nilai", role }).allowed,
            true
        );
    }
    assert.equal(
        evaluatePolicy({ method: "GET", path: "/nilai", role: "admin" }).allowed,
        false
    );
});

test("grade changes require the lecturer assigned to the grade's class", () => {
    assert.equal(evaluatePolicy({
        method: "PUT",
        path: "/nilai/12",
        role: "dosen",
        userId: 7,
        attributes: { lecturerId: 7 }
    }).allowed, true);

    assert.equal(evaluatePolicy({
        method: "PUT",
        path: "/nilai/12",
        role: "dosen",
        userId: 8,
        attributes: { lecturerId: 7 }
    }).allowed, false);
});

test("finalization requires class ownership", () => {
    assert.equal(evaluatePolicy({
        method: "POST",
        path: "/kelas/2/finalisasi",
        role: "dosen",
        userId: 7,
        attributes: { lecturerId: 7 }
    }).allowed, true);
});

test("students can only read their own transcript while admins can read any found student", () => {
    assert.equal(evaluatePolicy({
        method: "GET",
        path: "/transkrip/227001001",
        role: "mahasiswa",
        userId: 4,
        attributes: { studentId: 4 }
    }).allowed, true);

    assert.equal(evaluatePolicy({
        method: "GET",
        path: "/transkrip/227001002",
        role: "mahasiswa",
        userId: 4,
        attributes: { studentId: 5 }
    }).allowed, false);

    assert.equal(evaluatePolicy({
        method: "GET",
        path: "/transkrip/227001002",
        role: "admin",
        userId: 1,
        attributes: { studentId: 5 }
    }).allowed, true);
});

test("sync endpoint only accepts service-role policy decisions and exact paths", () => {
    assert.equal(evaluatePolicy({
        method: "POST",
        path: "/transkrip/sinkron",
        role: "service"
    }).allowed, true);
    assert.equal(evaluatePolicy({
        method: "POST",
        path: "/transkrip/sinkron",
        role: "mahasiswa"
    }).allowed, false);
    assert.equal(evaluatePolicy({
        method: "GET",
        path: "/transkrip",
        role: "mahasiswa"
    }).allowed, false);
});
