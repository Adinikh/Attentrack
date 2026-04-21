const bcrypt = require("bcryptjs");

const { getDb, initializeDatabase } = require("./db");

initializeDatabase();

const db = getDb();

function seed() {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount > 0) {
    console.log("Database already seeded.");
    return;
  }

  const password = bcrypt.hashSync("password123", 10);

  const createUser = db.prepare(
    "INSERT INTO users (role, full_name, email, password_hash) VALUES (?, ?, ?, ?)"
  );
  const createFaculty = db.prepare(
    "INSERT INTO faculty (user_id, employee_id, department) VALUES (?, ?, ?)"
  );
  const createStudent = db.prepare(
    "INSERT INTO students (user_id, roll_number, program, semester, section, guardian_name, guardian_phone) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const createSubject = db.prepare(
    "INSERT INTO subjects (code, name, faculty_id, semester, section, attendance_threshold) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const mapSubjectStudent = db.prepare(
    "INSERT INTO subject_students (subject_id, student_id) VALUES (?, ?)"
  );
  const createAnnouncement = db.prepare(
    "INSERT INTO announcements (title, body, audience, created_by) VALUES (?, ?, ?, ?)"
  );
  const createSession = db.prepare(
    "INSERT INTO attendance_sessions (subject_id, session_date, taken_by, notes) VALUES (?, ?, ?, ?)"
  );
  const createRecord = db.prepare(
    "INSERT INTO attendance_records (session_id, student_id, status) VALUES (?, ?, ?)"
  );

  const tx = db.transaction(() => {
    const adminUserId = createUser.run("admin", "System Admin", "admin@attendtrack.edu", password)
      .lastInsertRowid;

    const facultyEntries = [
      { name: "Dr. Priya Sharma", email: "priya.sharma@attendtrack.edu", employeeId: "FAC1001", department: "Computer Science" },
      { name: "Prof. Rohan Mehta", email: "rohan.mehta@attendtrack.edu", employeeId: "FAC1002", department: "Information Technology" }
    ].map((entry) => {
      const userId = createUser.run("faculty", entry.name, entry.email, password).lastInsertRowid;
      const facultyId = createFaculty.run(userId, entry.employeeId, entry.department).lastInsertRowid;
      return { ...entry, userId: Number(userId), id: Number(facultyId) };
    });

    const studentEntries = [
      ["Aarav Patel", "aarav.patel@attendtrack.edu", "IT2301", "B.Tech IT", 6, "A"],
      ["Diya Nair", "diya.nair@attendtrack.edu", "IT2302", "B.Tech IT", 6, "A"],
      ["Kabir Singh", "kabir.singh@attendtrack.edu", "IT2303", "B.Tech IT", 6, "A"],
      ["Meera Iyer", "meera.iyer@attendtrack.edu", "IT2304", "B.Tech IT", 6, "A"],
      ["Riya Verma", "riya.verma@attendtrack.edu", "IT2305", "B.Tech IT", 6, "A"],
      ["Vihaan Gupta", "vihaan.gupta@attendtrack.edu", "IT2306", "B.Tech IT", 6, "A"]
    ].map(([name, email, roll, program, semester, section], index) => {
      const userId = createUser.run("student", name, email, password).lastInsertRowid;
      const studentId = createStudent.run(
        userId,
        roll,
        program,
        semester,
        section,
        `Guardian ${index + 1}`,
        `99999999${index + 1}`
      ).lastInsertRowid;
      return { id: Number(studentId), userId: Number(userId), name, email, roll };
    });

    const subjectEntries = [
      ["CS601", "Data Structures", facultyEntries[0].id, 6, "A", 75],
      ["CS602", "Database Management Systems", facultyEntries[0].id, 6, "A", 75],
      ["IT603", "Operating Systems", facultyEntries[1].id, 6, "A", 75],
      ["IT604", "Computer Networks", facultyEntries[1].id, 6, "A", 80]
    ].map(([code, name, facultyId, semester, section, threshold]) => {
      const subjectId = createSubject.run(code, name, facultyId, semester, section, threshold).lastInsertRowid;
      return { id: Number(subjectId), code, name, facultyId: Number(facultyId), threshold };
    });

    for (const subject of subjectEntries) {
      for (const student of studentEntries) {
        mapSubjectStudent.run(subject.id, student.id);
      }
    }

    createAnnouncement.run(
      "Attendance policy reminder",
      "Students must maintain subject attendance above the minimum threshold to stay exam eligible.",
      "all",
      adminUserId
    );
    createAnnouncement.run(
      "Faculty update",
      "Please publish attendance for each class before 6 PM so shortage alerts stay current.",
      "faculty",
      adminUserId
    );

    const attendanceTemplates = [
      { date: "2026-04-01", statuses: ["present", "present", "absent", "present", "present", "absent"] },
      { date: "2026-04-03", statuses: ["present", "absent", "absent", "present", "present", "present"] },
      { date: "2026-04-05", statuses: ["present", "present", "present", "present", "absent", "present"] },
      { date: "2026-04-08", statuses: ["absent", "present", "absent", "present", "present", "present"] },
      { date: "2026-04-10", statuses: ["present", "present", "present", "absent", "present", "present"] },
      { date: "2026-04-12", statuses: ["present", "absent", "absent", "present", "absent", "present"] },
      { date: "2026-04-15", statuses: ["present", "present", "present", "present", "present", "present"] },
      { date: "2026-04-17", statuses: ["present", "absent", "absent", "present", "present", "present"] }
    ];

    subjectEntries.forEach((subject, subjectIndex) => {
      attendanceTemplates.forEach((template, templateIndex) => {
        const sessionId = createSession.run(
          subject.id,
          template.date,
          subject.facultyId,
          templateIndex % 2 === 0 ? "Regular lecture" : "Problem solving session"
        ).lastInsertRowid;

        studentEntries.forEach((student, studentIndex) => {
          const rawStatus = template.statuses[(studentIndex + subjectIndex) % template.statuses.length];
          createRecord.run(sessionId, student.id, rawStatus);
        });
      });
    });
  });

  tx();
  console.log("Database seeded with demo data.");
}

if (require.main === module) {
  seed();
}

module.exports = {
  seed
};
