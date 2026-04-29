const bcrypt = require("bcryptjs");
const XLSX = require("xlsx");

const { getDb } = require("./db");
const { clearAuthCookie, requireAuth, requireRole, setAuthCookie, signAuthToken } = require("./auth");
const { buildPdfBuffer, buildWorkbookBuffer } = require("./reports");
const {
  assignmentSchema,
  bulkStudentImportSchema,
  attendanceSchema,
  changePasswordSchema,
  facultySchema,
  loginSchema,
  parseSchema,
  studentSchema,
  subjectSchema
} = require("./validation");
const {
  roundPercentage,
  classesNeededToReachThreshold,
  statusFromPercentage
} = require("./utils");

const loginAttempts = new Map();

function serializeUser(user) {
  return {
    id: user.id,
    role: user.role,
    fullName: user.full_name || user.fullName,
    email: user.email
  };
}

function incrementLoginAttempt(key) {
  const now = Date.now();
  const current = loginAttempts.get(key) || { count: 0, until: 0 };
  if (current.until && current.until > now) {
    return current;
  }

  const updated = { count: current.count + 1, until: current.count + 1 >= 5 ? now + 15 * 60 * 1000 : 0 };
  loginAttempts.set(key, updated);
  return updated;
}

function clearLoginAttempt(key) {
  loginAttempts.delete(key);
}

function checkLoginAttempt(key) {
  const current = loginAttempts.get(key);
  if (current && current.until > Date.now()) {
    const minutes = Math.ceil((current.until - Date.now()) / 60000);
    const error = new Error(`Too many failed login attempts. Try again in ${minutes} minute(s).`);
    error.status = 429;
    throw error;
  }
}

function getAnnouncementsForRole(role) {
  const db = getDb();
  if (role === "admin") {
    return db
      .prepare(
        `SELECT title, body, audience, created_at
         FROM announcements
         ORDER BY created_at DESC
         LIMIT 5`
      )
      .all();
  }

  return db
    .prepare(
      `SELECT title, body, audience, created_at
       FROM announcements
       WHERE audience = 'all' OR audience = ?
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(role);
}

function getStudentRecordByUserId(userId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.*, u.full_name, u.email
       FROM students s
       JOIN users u ON u.id = s.user_id
       WHERE s.user_id = ?`
    )
    .get(userId);
}

function getFacultyIdByUserId(userId) {
  const db = getDb();
  return db.prepare("SELECT id FROM faculty WHERE user_id = ?").get(userId)?.id || null;
}

function getStudentAttendanceSummary(studentUserId) {
  const db = getDb();
  const student = getStudentRecordByUserId(studentUserId);

  const subjects = db
    .prepare(
      `SELECT
         sub.id,
         sub.code,
         sub.name,
         sub.attendance_threshold,
         fu.full_name AS faculty_name,
         COUNT(ar.id) AS total_classes,
         SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS attended_classes
       FROM subject_students ss
       JOIN subjects sub ON sub.id = ss.subject_id
       JOIN faculty f ON f.id = sub.faculty_id
       JOIN users fu ON fu.id = f.user_id
       LEFT JOIN attendance_sessions ats ON ats.subject_id = sub.id
       LEFT JOIN attendance_records ar ON ar.session_id = ats.id AND ar.student_id = ss.student_id
       WHERE ss.student_id = ?
       GROUP BY sub.id
       ORDER BY sub.name`
    )
    .all(student.id)
    .map((row) => {
      const attended = row.attended_classes || 0;
      const total = row.total_classes || 0;
      const percentage = roundPercentage(attended, total);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        facultyName: row.faculty_name,
        attendedClasses: attended,
        totalClasses: total,
        percentage,
        threshold: row.attendance_threshold,
        shortageBy: classesNeededToReachThreshold(attended, total, row.attendance_threshold),
        status: statusFromPercentage(percentage, row.attendance_threshold)
      };
    });

  const totalClasses = subjects.reduce((sum, subject) => sum + subject.totalClasses, 0);
  const totalAttended = subjects.reduce((sum, subject) => sum + subject.attendedClasses, 0);
  const overallPercentage = roundPercentage(totalAttended, totalClasses);

  return {
    student,
    subjects,
    stats: {
      totalSubjects: subjects.length,
      totalClasses,
      totalAttended,
      overallPercentage,
      shortages: subjects.filter((subject) => subject.percentage < subject.threshold).length
    }
  };
}

function getFacultyOwnedSubjects(facultyUserId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT sub.id, sub.code, sub.name, sub.semester, sub.section, sub.attendance_threshold
       FROM subjects sub
       JOIN faculty f ON f.id = sub.faculty_id
       WHERE f.user_id = ?
       ORDER BY sub.name`
    )
    .all(facultyUserId);
}

function getSubjectStudentBreakdown(subjectId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         s.id,
         s.roll_number,
         u.full_name,
         COUNT(ar.id) AS total_classes,
         SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS attended_classes,
         sub.attendance_threshold AS threshold
       FROM subject_students ss
       JOIN students s ON s.id = ss.student_id
       JOIN users u ON u.id = s.user_id
       JOIN subjects sub ON sub.id = ss.subject_id
       LEFT JOIN attendance_sessions ats ON ats.subject_id = sub.id
       LEFT JOIN attendance_records ar ON ar.session_id = ats.id AND ar.student_id = s.id
       WHERE ss.subject_id = ?
       GROUP BY s.id
       ORDER BY s.roll_number`
    )
    .all(subjectId)
    .map((row) => {
      const attended = row.attended_classes || 0;
      const total = row.total_classes || 0;
      const percentage = roundPercentage(attended, total);
      return {
        id: row.id,
        rollNumber: row.roll_number,
        fullName: row.full_name,
        attendedClasses: attended,
        totalClasses: total,
        percentage,
        threshold: row.threshold,
        status: statusFromPercentage(percentage, row.threshold)
      };
    });
}

function getSubjectById(subjectId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT sub.*, u.full_name AS faculty_name
       FROM subjects sub
       JOIN faculty f ON f.id = sub.faculty_id
       JOIN users u ON u.id = f.user_id
       WHERE sub.id = ?`
    )
    .get(subjectId);
}

function ensureFacultyOwnsSubject(req, subjectId) {
  if (req.user.role === "admin") {
    return getSubjectById(subjectId);
  }

  const db = getDb();
  const facultyId = getFacultyIdByUserId(req.user.id);
  const subject = db.prepare("SELECT * FROM subjects WHERE id = ? AND faculty_id = ?").get(subjectId, facultyId);
  if (!subject) {
    const error = new Error("Subject not found for this faculty member.");
    error.status = 404;
    throw error;
  }

  return subject;
}

function parsePositiveIntegerParam(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`Invalid ${label}.`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function buildStudentExportRows(summary) {
  return summary.subjects.map((subject) => ({
    SubjectCode: subject.code,
    SubjectName: subject.name,
    Faculty: subject.facultyName,
    Attended: subject.attendedClasses,
    Total: subject.totalClasses,
    AttendancePercentage: `${subject.percentage}%`,
    Threshold: `${subject.threshold}%`,
    ClassesNeeded: subject.shortageBy
  }));
}

function buildFacultyExportRows(subjectId) {
  const subject = getSubjectById(subjectId);
  const roster = getSubjectStudentBreakdown(subjectId);
  return {
    subject,
    rows: roster.map((student) => ({
      RollNumber: student.rollNumber,
      StudentName: student.fullName,
      Attended: student.attendedClasses,
      Total: student.totalClasses,
      AttendancePercentage: `${student.percentage}%`,
      Threshold: `${student.threshold}%`,
      Status: student.status
    }))
  };
}

function createStudentAccount(db, payload) {
  const userId = db
    .prepare("INSERT INTO users (role, full_name, email, password_hash) VALUES ('student', ?, ?, ?)")
    .run(payload.fullName, payload.email, bcrypt.hashSync("password123", 10)).lastInsertRowid;

  db.prepare(
    `INSERT INTO students
     (user_id, roll_number, program, semester, section, guardian_name, guardian_phone)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    payload.rollNumber,
    payload.program,
    payload.semester,
    payload.section,
    payload.guardianName,
    payload.guardianPhone
  );
}

function sendWorkbook(res, filename, sheetName, rows) {
  const buffer = buildWorkbookBuffer(sheetName, rows);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function sendPdf(res, filename, title, subtitle, rows) {
  const buffer = await buildPdfBuffer(title, subtitle, rows);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

function registerRoutes(app) {
  const db = getDb();

  app.post("/api/auth/login", (req, res, next) => {
    try {
      const payload = parseSchema(loginSchema, req.body);
      const limiterKey = `${payload.email}:${payload.role}`;
      checkLoginAttempt(limiterKey);

      const user = db
        .prepare("SELECT id, role, full_name, email, password_hash, status FROM users WHERE email = ?")
        .get(payload.email);

      if (!user || user.role !== payload.role || user.status !== "active") {
        incrementLoginAttempt(limiterKey);
        const error = new Error("Invalid credentials for the selected role.");
        error.status = 401;
        throw error;
      }

      const isValid = bcrypt.compareSync(payload.password, user.password_hash);
      if (!isValid) {
        incrementLoginAttempt(limiterKey);
        const error = new Error("Incorrect email or password.");
        error.status = 401;
        throw error;
      }

      clearLoginAttempt(limiterKey);
      setAuthCookie(res, signAuthToken(user));
      res.json({ user: serializeUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ user: req.user ? serializeUser(req.user) : null });
  });

  app.post("/api/auth/change-password", requireAuth, (req, res, next) => {
    try {
      const payload = parseSchema(changePasswordSchema, req.body);
      const user = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(req.user.id);
      const valid = bcrypt.compareSync(payload.currentPassword, user.password_hash);
      if (!valid) {
        const error = new Error("Current password is incorrect.");
        error.status = 400;
        throw error;
      }

      const hash = bcrypt.hashSync(payload.newPassword, 10);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.user.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/student/dashboard", requireRole("student"), (req, res) => {
    const summary = getStudentAttendanceSummary(req.user.id);
    res.json({
      user: serializeUser(req.user),
      summary,
      announcements: getAnnouncementsForRole("students"),
      chart: summary.subjects.map((subject) => ({
        label: subject.code,
        value: subject.percentage,
        threshold: subject.threshold
      }))
    });
  });

  app.get("/api/student/subject/:subjectId", requireRole("student"), (req, res) => {
    const summary = getStudentAttendanceSummary(req.user.id);
    const subject = summary.subjects.find((item) => item.id === Number(req.params.subjectId));
    if (!subject) {
      return res.status(404).json({ error: "Subject not found." });
    }

    const student = db.prepare("SELECT id FROM students WHERE user_id = ?").get(req.user.id);
    const attendance = db
      .prepare(
        `SELECT ats.session_date, ar.status, ats.notes
         FROM attendance_records ar
         JOIN attendance_sessions ats ON ats.id = ar.session_id
         WHERE ar.student_id = ? AND ats.subject_id = ?
         ORDER BY ats.session_date DESC`
      )
      .all(student.id, subject.id);

    res.json({ subject, attendance });
  });

  app.get("/api/student/report.xlsx", requireRole("student"), (req, res) => {
    const summary = getStudentAttendanceSummary(req.user.id);
    sendWorkbook(res, "student-attendance-report.xlsx", "Attendance", buildStudentExportRows(summary));
  });

  app.get("/api/student/report.pdf", requireRole("student"), async (req, res) => {
    const summary = getStudentAttendanceSummary(req.user.id);
    await sendPdf(
      res,
      "student-attendance-report.pdf",
      `${summary.student.full_name} Attendance Report`,
      `${summary.student.program} | Semester ${summary.student.semester} | Overall ${summary.stats.overallPercentage}%`,
      buildStudentExportRows(summary)
    );
  });

  app.get("/api/faculty/dashboard", requireRole("faculty"), (req, res) => {
    const subjects = getFacultyOwnedSubjects(req.user.id);
    const subjectSummaries = subjects.map((subject) => {
      const breakdown = getSubjectStudentBreakdown(subject.id);
      const riskCount = breakdown.filter((student) => student.percentage < subject.attendance_threshold).length;
      const averageAttendance = breakdown.length
        ? Math.round(breakdown.reduce((sum, student) => sum + student.percentage, 0) / breakdown.length)
        : 0;
      return {
        ...subject,
        averageAttendance,
        riskCount,
        studentCount: breakdown.length
      };
    });

    res.json({
      user: serializeUser(req.user),
      subjects: subjectSummaries,
      announcements: getAnnouncementsForRole("faculty"),
      chart: subjectSummaries.map((subject) => ({
        label: subject.code,
        value: subject.averageAttendance,
        threshold: subject.attendance_threshold
      })),
      stats: {
        totalSubjects: subjects.length,
        totalStudents: subjectSummaries.reduce((sum, subject) => sum + subject.studentCount, 0),
        riskStudents: subjectSummaries.reduce((sum, subject) => sum + subject.riskCount, 0)
      }
    });
  });

  app.get("/api/faculty/marking-data", requireRole("faculty"), (req, res, next) => {
    try {
      const subjectId = Number(req.query.subjectId);
      const date = req.query.date;
      ensureFacultyOwnsSubject(req, subjectId);

      const roster = getSubjectStudentBreakdown(subjectId);
      const existingSession = db
        .prepare("SELECT id, notes FROM attendance_sessions WHERE subject_id = ? AND session_date = ?")
        .get(subjectId, date);

      let existingStatuses = {};
      if (existingSession) {
        existingStatuses = db
          .prepare("SELECT student_id, status FROM attendance_records WHERE session_id = ?")
          .all(existingSession.id)
          .reduce((acc, row) => {
            acc[row.student_id] = row.status;
            return acc;
          }, {});
      }

      res.json({
        date,
        notes: existingSession?.notes || "",
        roster: roster.map((student) => ({
          ...student,
          todayStatus: existingStatuses[student.id] || "present"
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/faculty/attendance", requireRole("faculty"), (req, res, next) => {
    try {
      const payload = parseSchema(attendanceSchema, req.body);
      ensureFacultyOwnsSubject(req, payload.subjectId);
      const facultyId = getFacultyIdByUserId(req.user.id);

      const sessionRow = db
        .prepare("SELECT id FROM attendance_sessions WHERE subject_id = ? AND session_date = ?")
        .get(payload.subjectId, payload.date);

      db.transaction(() => {
        let sessionId = sessionRow ? sessionRow.id : null;
        if (!sessionId) {
          sessionId = db
            .prepare(
              "INSERT INTO attendance_sessions (subject_id, session_date, taken_by, notes) VALUES (?, ?, ?, ?)"
            )
            .run(payload.subjectId, payload.date, facultyId, payload.notes)
            .lastInsertRowid;
        } else {
          db.prepare("UPDATE attendance_sessions SET notes = ? WHERE id = ?").run(payload.notes, sessionId);
          db.prepare("DELETE FROM attendance_records WHERE session_id = ?").run(sessionId);
        }

        const insertRecord = db.prepare(
          "INSERT INTO attendance_records (session_id, student_id, status) VALUES (?, ?, ?)"
        );

        payload.records.forEach((record) => {
          insertRecord.run(sessionId, record.studentId, record.status);
        });
      })();

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/faculty/report/:subjectId.xlsx", requireRole("faculty", "admin"), (req, res, next) => {
    try {
      const subjectId = parsePositiveIntegerParam(req.params.subjectId, "subject id");
      ensureFacultyOwnsSubject(req, subjectId);
      const report = buildFacultyExportRows(subjectId);
      sendWorkbook(res, `${report.subject.code}-attendance-report.xlsx`, report.subject.code, report.rows);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/faculty/report/:subjectId.pdf", requireRole("faculty", "admin"), async (req, res, next) => {
    try {
      const subjectId = parsePositiveIntegerParam(req.params.subjectId, "subject id");
      ensureFacultyOwnsSubject(req, subjectId);
      const report = buildFacultyExportRows(subjectId);
      await sendPdf(
        res,
        `${report.subject.code}-attendance-report.pdf`,
        `${report.subject.code} ${report.subject.name}`,
        `Faculty: ${report.subject.faculty_name || "Assigned"} | Threshold ${report.subject.attendance_threshold}%`,
        report.rows
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/faculty/report/:subjectId", requireRole("faculty", "admin"), (req, res, next) => {
    try {
      const subjectId = parsePositiveIntegerParam(req.params.subjectId, "subject id");
      ensureFacultyOwnsSubject(req, subjectId);
      const report = buildFacultyExportRows(subjectId);
      res.json({
        subject: report.subject,
        rows: report.rows,
        chart: report.rows.map((row) => ({
          label: row.RollNumber,
          value: Number(row.AttendancePercentage.replace("%", "")),
          threshold: Number(row.Threshold.replace("%", "")),
          status: row.Status
        }))
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/faculty/students", requireRole("admin"), (req, res) => {
    const students = db
      .prepare(
        `SELECT s.id, s.user_id, s.roll_number, s.program, s.semester, s.section, s.guardian_name, s.guardian_phone,
                u.full_name, u.email
         FROM students s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.roll_number`
      )
      .all();
    res.json({ students });
  });

  app.get("/api/admin/students/template.xlsx", requireRole("admin"), (req, res) => {
    sendWorkbook(res, "student-import-template.xlsx", "Students", [
      {
        fullName: "Aarav Patel",
        email: "aarav.patel@example.edu",
        rollNumber: "IT2401",
        program: "B.Tech IT",
        semester: 6,
        section: "A",
        guardianName: "Ramesh Patel",
        guardianPhone: "9876543210"
      }
    ]);
  });

  app.post("/api/admin/students/import", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(bulkStudentImportSchema, req.body);
      const workbook = XLSX.read(Buffer.from(payload.fileBase64, "base64"), { type: "buffer" });
      const sheetName = workbook.SheetNames[0];

      if (!sheetName) {
        const error = new Error("The uploaded Excel file does not contain any sheet.");
        error.status = 400;
        throw error;
      }

      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        defval: "",
        raw: false
      });

      if (!rows.length) {
        const error = new Error("The uploaded Excel file is empty.");
        error.status = 400;
        throw error;
      }

      const seenEmails = new Set();
      const seenRollNumbers = new Set();
      const students = rows.map((row, index) => {
        let parsed;
        try {
          parsed = parseSchema(studentSchema, row);
        } catch (error) {
          error.message = `Excel row ${index + 2}: ${error.message}`;
          throw error;
        }

        const emailKey = parsed.email.toLowerCase();
        const rollKey = parsed.rollNumber.toLowerCase();

        if (seenEmails.has(emailKey)) {
          const error = new Error(`Duplicate email found in Excel at row ${index + 2}.`);
          error.status = 400;
          throw error;
        }

        if (seenRollNumbers.has(rollKey)) {
          const error = new Error(`Duplicate roll number found in Excel at row ${index + 2}.`);
          error.status = 400;
          throw error;
        }

        seenEmails.add(emailKey);
        seenRollNumbers.add(rollKey);
        return parsed;
      });

      const existingUserByEmail = db.prepare("SELECT email FROM users WHERE email = ?");
      const existingStudentByRoll = db.prepare("SELECT roll_number FROM students WHERE roll_number = ?");

      students.forEach((student, index) => {
        if (existingUserByEmail.get(student.email)) {
          const error = new Error(`Excel row ${index + 2}: email already exists in the system.`);
          error.status = 400;
          throw error;
        }

        if (existingStudentByRoll.get(student.rollNumber)) {
          const error = new Error(`Excel row ${index + 2}: roll number already exists in the system.`);
          error.status = 400;
          throw error;
        }
      });

      db.transaction(() => {
        students.forEach((student) => createStudentAccount(db, student));
      })();

      res.json({ ok: true, importedCount: students.length });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/faculty/students", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(studentSchema, req.body);
      db.transaction(() => {
        createStudentAccount(db, payload);
      })();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/faculty/students/:studentId", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(studentSchema, req.body);
      const studentId = Number(req.params.studentId);
      const student = db.prepare("SELECT user_id FROM students WHERE id = ?").get(studentId);
      if (!student) {
        const error = new Error("Student not found.");
        error.status = 404;
        throw error;
      }

      db.transaction(() => {
        db.prepare("UPDATE users SET full_name = ?, email = ? WHERE id = ?").run(
          payload.fullName,
          payload.email,
          student.user_id
        );
        db.prepare(
          `UPDATE students
           SET roll_number = ?, program = ?, semester = ?, section = ?, guardian_name = ?, guardian_phone = ?
           WHERE id = ?`
        ).run(
          payload.rollNumber,
          payload.program,
          payload.semester,
          payload.section,
          payload.guardianName,
          payload.guardianPhone,
          studentId
        );
      })();

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/faculty/students/:studentId", requireRole("admin"), (req, res, next) => {
    try {
      const studentId = Number(req.params.studentId);
      const student = db.prepare("SELECT user_id FROM students WHERE id = ?").get(studentId);
      if (!student) {
        const error = new Error("Student not found.");
        error.status = 404;
        throw error;
      }

      db.prepare("DELETE FROM users WHERE id = ?").run(student.user_id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/faculty/subjects", requireRole("admin"), (req, res) => {
    const subjects = db
      .prepare(
        `SELECT sub.id, sub.code, sub.name, sub.semester, sub.section, sub.attendance_threshold,
                sub.faculty_id, u.full_name AS faculty_name
         FROM subjects sub
         JOIN faculty f ON f.id = sub.faculty_id
         JOIN users u ON u.id = f.user_id
         ORDER BY sub.name`
      )
      .all();
    res.json({ subjects });
  });

  app.post("/api/faculty/subjects", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(subjectSchema, req.body);
      db.prepare(
        `INSERT INTO subjects (code, name, faculty_id, semester, section, attendance_threshold)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(payload.code, payload.name, payload.facultyId, payload.semester, payload.section, payload.attendanceThreshold);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/faculty/subjects/:subjectId", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(subjectSchema, req.body);
      const subjectId = Number(req.params.subjectId);
      ensureFacultyOwnsSubject(req, subjectId);
      db.prepare(
        `UPDATE subjects
         SET code = ?, name = ?, faculty_id = ?, semester = ?, section = ?, attendance_threshold = ?
         WHERE id = ?`
      ).run(
        payload.code,
        payload.name,
        payload.facultyId,
        payload.semester,
        payload.section,
        payload.attendanceThreshold,
        subjectId
      );
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/faculty/subjects/:subjectId", requireRole("admin"), (req, res, next) => {
    try {
      const subjectId = Number(req.params.subjectId);
      ensureFacultyOwnsSubject(req, subjectId);
      db.prepare("DELETE FROM subjects WHERE id = ?").run(subjectId);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/faculty/subjects/:subjectId/assignment", requireRole("admin"), (req, res, next) => {
    try {
      const subjectId = Number(req.params.subjectId);
      ensureFacultyOwnsSubject(req, subjectId);

      const assigned = db
        .prepare(
          `SELECT s.id, s.roll_number, u.full_name
           FROM subject_students ss
           JOIN students s ON s.id = ss.student_id
           JOIN users u ON u.id = s.user_id
           WHERE ss.subject_id = ?
           ORDER BY s.roll_number`
        )
        .all(subjectId);

      const unassigned = db
        .prepare(
          `SELECT s.id, s.roll_number, u.full_name
           FROM students s
           JOIN users u ON u.id = s.user_id
           WHERE s.id NOT IN (
             SELECT student_id FROM subject_students WHERE subject_id = ?
           )
           ORDER BY s.roll_number`
        )
        .all(subjectId);

      res.json({ assigned, unassigned });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/faculty/subjects/:subjectId/assign-students", requireRole("admin"), (req, res, next) => {
    try {
      const subjectId = Number(req.params.subjectId);
      ensureFacultyOwnsSubject(req, subjectId);
      const payload = parseSchema(assignmentSchema, req.body);
      const insert = db.prepare("INSERT OR IGNORE INTO subject_students (subject_id, student_id) VALUES (?, ?)");
      db.transaction(() => {
        payload.studentIds.forEach((studentId) => insert.run(subjectId, studentId));
      })();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete(
    "/api/faculty/subjects/:subjectId/students/:studentId",
    requireRole("admin"),
    (req, res, next) => {
      try {
        const subjectId = Number(req.params.subjectId);
        const studentId = Number(req.params.studentId);
        ensureFacultyOwnsSubject(req, subjectId);
        db.prepare("DELETE FROM subject_students WHERE subject_id = ? AND student_id = ?").run(subjectId, studentId);
        res.json({ ok: true });
      } catch (error) {
        next(error);
      }
    }
  );

  app.get("/api/admin/dashboard", requireRole("admin"), (req, res) => {
    const totalStudents = db.prepare("SELECT COUNT(*) AS count FROM students").get().count;
    const totalFaculty = db.prepare("SELECT COUNT(*) AS count FROM faculty").get().count;
    const totalSubjects = db.prepare("SELECT COUNT(*) AS count FROM subjects").get().count;
    const riskStudents = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM (
           SELECT
             ss.student_id,
             sub.id AS subject_id,
             sub.attendance_threshold,
             ROUND(100.0 * SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) / NULLIF(COUNT(ar.id), 0)) AS pct
           FROM subject_students ss
           JOIN subjects sub ON sub.id = ss.subject_id
           LEFT JOIN attendance_sessions ats ON ats.subject_id = sub.id
           LEFT JOIN attendance_records ar ON ar.session_id = ats.id AND ar.student_id = ss.student_id
           GROUP BY ss.student_id, sub.id
           HAVING pct < sub.attendance_threshold
         )`
      )
      .get().count;

    const faculty = db
      .prepare(
        `SELECT f.id, f.user_id, f.employee_id, f.department, u.full_name, u.email
         FROM faculty f
         JOIN users u ON u.id = f.user_id
         ORDER BY u.full_name`
      )
      .all();

    const students = db
      .prepare(
        `SELECT s.id, s.user_id, s.roll_number, s.program, s.semester, s.section, u.full_name, u.email
         FROM students s
         JOIN users u ON u.id = s.user_id
         ORDER BY s.roll_number`
      )
      .all();

    const subjects = db
      .prepare(
        `SELECT sub.id, sub.code, sub.name, sub.semester, sub.section, sub.attendance_threshold,
                sub.faculty_id, u.full_name AS faculty_name
         FROM subjects sub
         JOIN faculty f ON f.id = sub.faculty_id
         JOIN users u ON u.id = f.user_id
         ORDER BY sub.name`
      )
      .all();

    res.json({
      user: serializeUser(req.user),
      stats: { totalStudents, totalFaculty, totalSubjects, riskStudents },
      faculty,
      students,
      subjects,
      announcements: getAnnouncementsForRole("admin"),
      chart: [
        { label: "Students", value: totalStudents, threshold: totalStudents },
        { label: "Faculty", value: totalFaculty, threshold: totalFaculty },
        { label: "Subjects", value: totalSubjects, threshold: totalSubjects },
        { label: "Risk", value: riskStudents, threshold: totalStudents || 1 }
      ]
    });
  });

  app.get("/api/admin/faculty", requireRole("admin"), (req, res) => {
    const faculty = db
      .prepare(
        `SELECT f.id, f.user_id, f.employee_id, f.department, u.full_name, u.email
         FROM faculty f
         JOIN users u ON u.id = f.user_id
         ORDER BY u.full_name`
      )
      .all();
    res.json({ faculty });
  });

  app.post("/api/admin/faculty", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(facultySchema, req.body);
      db.transaction(() => {
        const userId = db
          .prepare("INSERT INTO users (role, full_name, email, password_hash) VALUES ('faculty', ?, ?, ?)")
          .run(payload.fullName, payload.email, bcrypt.hashSync("password123", 10)).lastInsertRowid;
        db.prepare("INSERT INTO faculty (user_id, employee_id, department) VALUES (?, ?, ?)").run(
          userId,
          payload.employeeId,
          payload.department
        );
      })();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/faculty/:facultyId", requireRole("admin"), (req, res, next) => {
    try {
      const payload = parseSchema(facultySchema, req.body);
      const facultyId = Number(req.params.facultyId);
      const faculty = db.prepare("SELECT user_id FROM faculty WHERE id = ?").get(facultyId);
      if (!faculty) {
        const error = new Error("Faculty member not found.");
        error.status = 404;
        throw error;
      }

      db.transaction(() => {
        db.prepare("UPDATE users SET full_name = ?, email = ? WHERE id = ?").run(
          payload.fullName,
          payload.email,
          faculty.user_id
        );
        db.prepare("UPDATE faculty SET employee_id = ?, department = ? WHERE id = ?").run(
          payload.employeeId,
          payload.department,
          facultyId
        );
      })();

      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/faculty/:facultyId", requireRole("admin"), (req, res, next) => {
    try {
      const facultyId = Number(req.params.facultyId);
      const faculty = db.prepare("SELECT user_id FROM faculty WHERE id = ?").get(facultyId);
      if (!faculty) {
        const error = new Error("Faculty member not found.");
        error.status = 404;
        throw error;
      }

      db.prepare("DELETE FROM users WHERE id = ?").run(faculty.user_id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const status = error.status || 500;
    res.status(status).json({ error: error.message || "Unexpected server error." });
  });
}

module.exports = {
  registerRoutes
};
