const state = {
  role: "student",
  user: null,
  studentSubjects: [],
  facultySubjects: [],
  students: [],
  subjects: [],
  adminFaculty: [],
  selectedAttendanceRecords: [],
  assignmentSubjectId: null
};

const navConfig = {
  student: [
    { key: "student-overview", label: "Overview" },
    { key: "student-history", label: "History" },
    { key: "student-reports", label: "Reports" },
    { key: "account", label: "Account" }
  ],
  faculty: [
    { key: "faculty-overview", label: "Overview" },
    { key: "faculty-attendance", label: "Mark Attendance" },
    { key: "faculty-reports", label: "Reports" },
    { key: "account", label: "Account" }
  ],
  admin: [
    { key: "admin-overview", label: "Overview" },
    { key: "admin-faculty", label: "Add Faculty" },
    { key: "admin-students", label: "Add Student" },
    { key: "admin-subjects", label: "Add Subject" },
    { key: "account", label: "Account" }
  ]
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  hydrateSession();
});

function bindEvents() {
  document.querySelectorAll(".role-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".role-tab").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      state.role = button.dataset.role;
      document.getElementById("login-error").textContent = "";
    });
  });

  on("login-form", "submit", onLogin);
  on("toggle-password", "click", togglePasswordVisibility);
  on("logout-btn", "click", onLogout);
  on("change-password-form", "submit", changePassword);

  on("student-history-select", "change", loadStudentHistory);
  on("student-export-pdf", "click", () => downloadFile("/api/student/report.pdf"));
  on("student-export-xlsx", "click", () => downloadFile("/api/student/report.xlsx"));
  on("whatif-subject", "change", renderWhatIfProjection);
  on("whatif-upcoming", "input", renderWhatIfProjection);

  on("load-attendance-btn", "click", loadFacultyAttendance);
  on("save-attendance-btn", "click", saveAttendance);
  on("faculty-report-subject", "change", loadFacultyReport);
  on("faculty-export-pdf", "click", () => {
    const subjectId = document.getElementById("faculty-report-subject").value;
    if (subjectId) downloadFile(`/api/faculty/report/${subjectId}.pdf`);
  });
  on("faculty-export-xlsx", "click", () => {
    const subjectId = document.getElementById("faculty-report-subject").value;
    if (subjectId) downloadFile(`/api/faculty/report/${subjectId}.xlsx`);
  });

  on("student-create-form", "submit", saveStudent);
  on("student-import-form", "submit", importStudentsFromExcel);
  on("subject-create-form", "submit", saveSubject);
  on("faculty-create-form", "submit", saveFaculty);
  on("clear-student-form", "click", () => clearForm("student-create-form"));
  on("clear-subject-form", "click", () => clearForm("subject-create-form"));
  on("clear-faculty-form", "click", () => clearForm("faculty-create-form"));
  on("student-template-download", "click", () => downloadFile("/api/admin/students/template.xlsx"));
  on("assignment-subject-select", "change", loadAssignmentPanel);
  on("assign-students-btn", "click", assignStudentsToSubject);
}

function on(id, eventName, handler) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

function togglePasswordVisibility() {
  const passwordInput = document.getElementById("password");
  const toggleButton = document.getElementById("toggle-password");
  if (!passwordInput || !toggleButton) return;

  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  toggleButton.textContent = isHidden ? "Hide" : "Show";
}

async function hydrateSession() {
  const data = await api("/api/auth/me");
  if (data.user) {
    state.user = data.user;
    state.role = data.user.role;
    await loadRoleDashboard();
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : null;
  if (!response.ok) {
    throw new Error(data?.error || "Request failed.");
  }

  return data;
}

async function onLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, role: state.role })
    });
    state.user = data.user;
    await loadRoleDashboard();
  } catch (error) {
    document.getElementById("login-error").textContent = error.message;
  }
}

async function onLogout() {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  toast("Logged out.");
}

async function changePassword(event) {
  event.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(event.target).entries());
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    event.target.reset();
    toast("Password changed successfully.");
  } catch (error) {
    toast(error.message);
  }
}

async function loadRoleDashboard() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
  document.getElementById("user-name").textContent = state.user.fullName;
  document.getElementById("user-email").textContent = state.user.email;
  document.getElementById("user-avatar").textContent = state.user.fullName.charAt(0).toUpperCase();
  document.getElementById("sidebar-role").textContent = `${capitalize(state.role)} Portal`;
  renderNav();

  if (state.role === "student") {
    await loadStudentDashboard();
  } else if (state.role === "faculty") {
    await loadFacultyDashboard();
  } else {
    await loadAdminDashboard();
  }
}

function renderNav() {
  const navList = document.getElementById("nav-list");
  navList.innerHTML = "";
  navConfig[state.role].forEach((item, index) => {
    const button = document.createElement("button");
    button.className = `nav-item ${index === 0 ? "active" : ""}`;
    button.textContent = item.label;
    button.dataset.page = item.key;
    button.addEventListener("click", () => switchPage(item.key, button));
    navList.appendChild(button);
  });
  switchPage(navConfig[state.role][0].key, navList.firstElementChild);
}

function switchPage(pageKey, trigger) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  if (trigger) trigger.classList.add("active");

  document.querySelectorAll(".page").forEach((page) => page.classList.remove("active"));
  const page = document.querySelector(`.page[data-page="${pageKey}"]`);
  if (page) page.classList.add("active");

  const titles = {
    "student-overview": "Student Overview",
    "student-history": "Attendance History",
    "student-reports": "Report Exports",
    "faculty-overview": "Faculty Overview",
    "faculty-attendance": "Mark Attendance",
    "faculty-reports": "Faculty Reports",
    "admin-overview": "Admin Overview",
    "admin-faculty": "Faculty Management",
    "admin-students": "Student Management",
    "admin-subjects": "Subject Management",
    account: "Account Security"
  };
  document.getElementById("page-title").textContent = titles[pageKey] || "Dashboard";
}

async function loadStudentDashboard() {
  const data = await api("/api/student/dashboard");
  state.studentSubjects = data.summary.subjects;
  renderAnnouncements("student-announcements", data.announcements);
  renderStats("student-stats", [
    { label: "Overall Attendance", value: `${data.summary.stats.overallPercentage}%`, note: "Across all enrolled subjects" },
    { label: "Classes Attended", value: data.summary.stats.totalAttended, note: `${data.summary.stats.totalClasses} total classes` },
    { label: "Subjects", value: data.summary.stats.totalSubjects, note: `${data.summary.student.program} semester ${data.summary.student.semester}` },
    { label: "Shortage Alerts", value: data.summary.stats.shortages, note: "Subjects below threshold" }
  ]);

  document.getElementById("student-subject-table").innerHTML = data.summary.subjects
    .map(
      (subject) => `
        <tr>
          <td>${subject.code} - ${subject.name}</td>
          <td>${subject.facultyName}</td>
          <td>${subject.attendedClasses}</td>
          <td>${subject.totalClasses}</td>
          <td><span class="pill ${subject.status}">${subject.percentage}%</span></td>
          <td>${subject.shortageBy === 0 ? "Safe" : `${subject.shortageBy} more classes needed`}</td>
        </tr>
      `
    )
    .join("");

  document.getElementById("student-history-select").innerHTML = data.summary.subjects
    .map((subject) => `<option value="${subject.id}">${subject.code} - ${subject.name}</option>`)
    .join("");
  document.getElementById("whatif-subject").innerHTML = data.summary.subjects
    .map((subject) => `<option value="${subject.id}">${subject.code} - ${subject.name}</option>`)
    .join("");

  renderChart("student-chart", data.chart, "%");
  renderWhatIfProjection();
  await loadStudentHistory();
}

function renderWhatIfProjection() {
  const subjectSelect = document.getElementById("whatif-subject");
  const classesInput = document.getElementById("whatif-upcoming");
  const result = document.getElementById("whatif-result");
  if (!subjectSelect || !classesInput || !result) return;

  if (!state.studentSubjects.length) {
    result.innerHTML = `<p class="help-text">No subjects found for projection.</p>`;
    return;
  }

  const subjectId = Number(subjectSelect.value);
  const subject = state.studentSubjects.find((item) => item.id === subjectId) || state.studentSubjects[0];
  const planned = Math.max(0, Number(classesInput.value) || 0);

  if (!planned) {
    result.innerHTML = `<p class="help-text">Enter how many upcoming classes you plan to attend.</p>`;
    return;
  }

  const projectedAttended = subject.attendedClasses + planned;
  const projectedTotal = subject.totalClasses + planned;
  const projectedPercentage = Math.round((projectedAttended * 100) / projectedTotal);
  const projectedStatus = getStatusForThreshold(projectedPercentage, subject.threshold);
  const requiredAfterPlan = classesNeededToReachThreshold(projectedAttended, projectedTotal, subject.threshold);

  result.innerHTML = `
    <h4>${subject.code} Projection</h4>
    <p>
      If you attend the next <strong>${planned}</strong> classes, your attendance becomes
      <strong>${projectedAttended}/${projectedTotal}</strong>.
    </p>
    <p class="whatif-meta">
      Projected: <span class="pill ${projectedStatus}">${projectedPercentage}%</span>
      Threshold: <strong>${subject.threshold}%</strong>
    </p>
    <p>
      ${
        requiredAfterPlan === 0
          ? "You will be above the threshold. Keep this pace."
          : `Still short by threshold. You need ${requiredAfterPlan} more fully attended classes after this plan.`
      }
    </p>
  `;
}

async function loadStudentHistory() {
  const subjectId = document.getElementById("student-history-select").value;
  if (!subjectId) return;
  const data = await api(`/api/student/subject/${subjectId}`);
  document.getElementById("student-history-list").innerHTML = data.attendance
    .map(
      (item) => `
        <article class="timeline-item">
          <strong>${formatDate(item.session_date)} · ${capitalize(item.status)}</strong>
          <p>${item.notes || "Attendance recorded for this session."}</p>
        </article>
      `
    )
    .join("");
}

async function loadFacultyDashboard() {
  const data = await api("/api/faculty/dashboard");
  state.facultySubjects = data.subjects;

  renderAnnouncements("faculty-announcements", data.announcements);
  renderStats("faculty-stats", [
    { label: "Subjects", value: data.stats.totalSubjects, note: "Active subjects owned by you" },
    { label: "Students Covered", value: data.stats.totalStudents, note: "Across your classes" },
    { label: "Risk Students", value: data.stats.riskStudents, note: "Currently below threshold" },
    { label: "Action Focus", value: "Review", note: "Use Mark Attendance to update records" }
  ]);

  document.getElementById("faculty-subject-cards").innerHTML = data.subjects
    .map(
      (subject) => `
        <article class="list-card">
          <strong>${subject.code} - ${subject.name}</strong>
          <p>${subject.studentCount} students · Avg attendance ${subject.averageAttendance}% · ${subject.riskCount} at risk</p>
        </article>
      `
    )
    .join("");

  const subjectOptions = data.subjects.map((subject) => `<option value="${subject.id}">${subject.code} - ${subject.name}</option>`).join("");
  document.getElementById("faculty-subject-select").innerHTML = subjectOptions;
  document.getElementById("faculty-report-subject").innerHTML = subjectOptions;
  document.getElementById("faculty-date").value = new Date().toISOString().slice(0, 10);

  renderChart("faculty-chart", data.chart, "%");
  await loadFacultyAttendance();
  await loadFacultyReport();
}

async function loadFacultyAttendance(event) {
  if (event) event.preventDefault();
  const subjectId = document.getElementById("faculty-subject-select").value;
  const date = document.getElementById("faculty-date").value;
  if (!subjectId || !date) return;

  const data = await api(`/api/faculty/marking-data?subjectId=${subjectId}&date=${date}`);
  state.selectedAttendanceRecords = data.roster.map((student) => ({
    studentId: student.id,
    rollNumber: student.rollNumber,
    fullName: student.fullName,
    percentage: student.percentage,
    overallStatus: student.status,
    status: student.todayStatus
  }));
  document.getElementById("attendance-notes").value = data.notes || "";
  renderFacultyAttendanceTable();
}

function renderFacultyAttendanceTable() {
  document.getElementById("faculty-attendance-table").innerHTML = state.selectedAttendanceRecords
    .map(
      (student) => `
        <tr>
          <td>${student.rollNumber}</td>
          <td>${student.fullName}</td>
          <td>${student.percentage}%</td>
          <td><span class="pill ${student.overallStatus}">${student.overallStatus}</span></td>
          <td>
            <div class="attendance-toggle">
              <button class="status-btn ${student.status === "present" ? "active-present" : ""}" onclick="setAttendance(${student.studentId}, 'present')">Present</button>
              <button class="status-btn ${student.status === "absent" ? "active-absent" : ""}" onclick="setAttendance(${student.studentId}, 'absent')">Absent</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

window.setAttendance = function setAttendance(studentId, status) {
  state.selectedAttendanceRecords = state.selectedAttendanceRecords.map((record) =>
    record.studentId === studentId ? { ...record, status } : record
  );
  renderFacultyAttendanceTable();
};

async function saveAttendance() {
  try {
    await api("/api/faculty/attendance", {
      method: "POST",
      body: JSON.stringify({
        subjectId: Number(document.getElementById("faculty-subject-select").value),
        date: document.getElementById("faculty-date").value,
        notes: document.getElementById("attendance-notes").value,
        records: state.selectedAttendanceRecords.map(({ studentId, status }) => ({ studentId, status }))
      })
    });
    toast("Attendance saved successfully.");
    await loadFacultyDashboard();
    switchPage("faculty-attendance", document.querySelector('.nav-item[data-page="faculty-attendance"]'));
  } catch (error) {
    toast(error.message);
  }
}

async function loadFacultyReport() {
  const subjectId = document.getElementById("faculty-report-subject").value;
  if (!subjectId) return;
  const data = await api(`/api/faculty/report/${subjectId}`);
  renderChart("faculty-report-chart", data.chart, "%");
  document.getElementById("faculty-report-table").innerHTML = data.rows
    .map(
      (row) => `
        <tr>
          <td>${row.RollNumber}</td>
          <td>${row.StudentName}</td>
          <td>${row.AttendancePercentage}</td>
          <td><span class="pill ${row.Status}">${row.Status}</span></td>
        </tr>
      `
    )
    .join("");
}

async function saveStudent(event) {
  event.preventDefault();
  try {
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    const studentId = payload.studentId;
    delete payload.studentId;
    const url = studentId ? `/api/faculty/students/${studentId}` : "/api/faculty/students";
    await api(url, {
      method: studentId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    clearForm("student-create-form");
    toast(studentId ? "Student updated." : "Student created. Default password is password123.");
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
}

async function importStudentsFromExcel(event) {
  event.preventDefault();

  try {
    const fileInput = document.getElementById("student-import-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      toast("Choose an Excel file first.");
      return;
    }

    const fileBase64 = await readFileAsBase64(file);
    const data = await api("/api/admin/students/import", {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        fileBase64
      })
    });

    event.target.reset();
    toast(`${data.importedCount} students imported successfully.`);
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
}

async function saveSubject(event) {
  event.preventDefault();
  try {
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    const subjectId = payload.subjectId;
    delete payload.subjectId;
    const url = subjectId ? `/api/faculty/subjects/${subjectId}` : "/api/faculty/subjects";
    await api(url, {
      method: subjectId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    clearForm("subject-create-form");
    toast(subjectId ? "Subject updated." : "Subject created.");
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
}

async function loadAssignmentPanel() {
  const subjectId = document.getElementById("assignment-subject-select").value;
  if (!subjectId) return;
  state.assignmentSubjectId = subjectId;
  const data = await api(`/api/faculty/subjects/${subjectId}/assignment`);

  document.getElementById("unassigned-students").innerHTML = data.unassigned.length
    ? data.unassigned
        .map(
          (student) => `
            <label class="check-item">
              <input type="checkbox" value="${student.id}" />
              <span>${student.roll_number} - ${student.full_name}</span>
            </label>
          `
        )
        .join("")
    : `<p class="help-text">No unassigned students available.</p>`;

  document.getElementById("assigned-students").innerHTML = data.assigned.length
    ? data.assigned
        .map(
          (student) => `
            <article class="list-card slim-card">
              <strong>${student.roll_number} - ${student.full_name}</strong>
              <button class="danger-btn mini" onclick="removeAssignedStudent(${student.id})">Remove</button>
            </article>
          `
        )
        .join("")
    : `<p class="help-text">No students assigned yet.</p>`;
}

async function assignStudentsToSubject() {
  const subjectId = state.assignmentSubjectId;
  const studentIds = Array.from(document.querySelectorAll("#unassigned-students input:checked")).map((input) =>
    Number(input.value)
  );
  if (!subjectId || !studentIds.length) {
    toast("Select at least one student to assign.");
    return;
  }

  try {
    await api(`/api/faculty/subjects/${subjectId}/assign-students`, {
      method: "POST",
      body: JSON.stringify({ studentIds })
    });
    toast("Students assigned.");
    await loadAssignmentPanel();
  } catch (error) {
    toast(error.message);
  }
}

window.removeAssignedStudent = async function removeAssignedStudent(studentId) {
  if (!confirm("Remove this student from the subject?")) return;
  try {
    await api(`/api/faculty/subjects/${state.assignmentSubjectId}/students/${studentId}`, {
      method: "DELETE"
    });
    toast("Student removed from subject.");
    await loadAssignmentPanel();
  } catch (error) {
    toast(error.message);
  }
};

window.editStudent = function editStudent(studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;
  fillForm("student-create-form", {
    studentId: student.id,
    fullName: student.full_name,
    email: student.email,
    rollNumber: student.roll_number,
    program: student.program,
    semester: student.semester,
    section: student.section,
    guardianName: student.guardian_name || "",
    guardianPhone: student.guardian_phone || ""
  });
  switchPage("admin-students", document.querySelector('.nav-item[data-page="admin-students"]'));
};

window.deleteStudent = async function deleteStudent(studentId) {
  if (!confirm("Delete this student account?")) return;
  try {
    await api(`/api/faculty/students/${studentId}`, { method: "DELETE" });
    toast("Student deleted.");
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
};

window.editSubject = function editSubject(subjectId) {
  const subject = state.subjects.find((item) => item.id === subjectId);
  if (!subject) return;
  fillForm("subject-create-form", {
    subjectId: subject.id,
    code: subject.code,
    name: subject.name,
    facultyId: subject.faculty_id,
    semester: subject.semester,
    section: subject.section,
    attendanceThreshold: subject.attendance_threshold
  });
  switchPage("admin-subjects", document.querySelector('.nav-item[data-page="admin-subjects"]'));
};

window.deleteSubject = async function deleteSubject(subjectId) {
  if (!confirm("Delete this subject and all attendance records for it?")) return;
  try {
    await api(`/api/faculty/subjects/${subjectId}`, { method: "DELETE" });
    toast("Subject deleted.");
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
};

async function loadAdminDashboard() {
  const data = await api("/api/admin/dashboard");
  renderAnnouncements("admin-announcements", data.announcements);
  renderStats("admin-stats", [
    { label: "Students", value: data.stats.totalStudents, note: "Registered in the system" },
    { label: "Faculty", value: data.stats.totalFaculty, note: "Managed by admin" },
    { label: "Subjects", value: data.stats.totalSubjects, note: "Current academic offerings" },
    { label: "Risk Cases", value: data.stats.riskStudents, note: "Student-subject shortage cases" }
  ]);

  state.students = data.students;
  state.subjects = data.subjects;
  state.adminFaculty = data.faculty;
  renderChart("admin-chart", data.chart, "");

  document.getElementById("admin-faculty-table").innerHTML = data.faculty
    .map(
      (faculty) => `
        <tr>
          <td>${faculty.full_name}</td>
          <td>${faculty.employee_id}</td>
          <td>${faculty.department}</td>
          <td>
            <div class="action-buttons">
              <button class="ghost-btn mini" onclick="editFaculty(${faculty.id})">Edit</button>
              <button class="danger-btn mini" onclick="deleteFaculty(${faculty.id})">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  document.getElementById("students-table").innerHTML = data.students
    .map(
      (student) => `
        <tr>
          <td>${student.roll_number}</td>
          <td>${student.full_name}</td>
          <td>${student.program}</td>
          <td>${student.semester} / ${student.section}</td>
          <td>
            <div class="action-buttons">
              <button class="ghost-btn mini" onclick="editStudent(${student.id})">Edit</button>
              <button class="danger-btn mini" onclick="deleteStudent(${student.id})">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  document.getElementById("subjects-table").innerHTML = data.subjects
    .map(
      (subject) => `
        <tr>
          <td>${subject.code}</td>
          <td>${subject.name}</td>
          <td>${subject.faculty_name}</td>
          <td>${subject.attendance_threshold}%</td>
          <td>
            <div class="action-buttons">
              <button class="ghost-btn mini" onclick="editSubject(${subject.id})">Edit</button>
              <button class="danger-btn mini" onclick="deleteSubject(${subject.id})">Delete</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  document.getElementById("subject-faculty-select").innerHTML = data.faculty.length
    ? data.faculty.map((faculty) => `<option value="${faculty.id}">${faculty.full_name}</option>`).join("")
    : '<option value="">No faculty available</option>';

  document.getElementById("assignment-subject-select").innerHTML = data.subjects.length
    ? data.subjects.map((subject) => `<option value="${subject.id}">${subject.code} - ${subject.name}</option>`).join("")
    : '<option value="">No subjects available</option>';

  await loadAssignmentPanel();
}

async function saveFaculty(event) {
  event.preventDefault();
  try {
    const form = event.target;
    const payload = Object.fromEntries(new FormData(form).entries());
    const facultyId = payload.facultyId;
    delete payload.facultyId;
    const url = facultyId ? `/api/admin/faculty/${facultyId}` : "/api/admin/faculty";
    await api(url, {
      method: facultyId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    clearForm("faculty-create-form");
    toast(facultyId ? "Faculty updated." : "Faculty created. Default password is password123.");
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
}

window.editFaculty = function editFaculty(facultyId) {
  const faculty = state.adminFaculty.find((item) => item.id === facultyId);
  if (!faculty) return;
  fillForm("faculty-create-form", {
    facultyId: faculty.id,
    fullName: faculty.full_name,
    email: faculty.email,
    employeeId: faculty.employee_id,
    department: faculty.department
  });
  switchPage("admin-faculty", document.querySelector('.nav-item[data-page="admin-faculty"]'));
};

window.deleteFaculty = async function deleteFaculty(facultyId) {
  if (!confirm("Delete this faculty account?")) return;
  try {
    await api(`/api/admin/faculty/${facultyId}`, { method: "DELETE" });
    toast("Faculty deleted.");
    await loadAdminDashboard();
  } catch (error) {
    toast(error.message);
  }
};

function renderStats(targetId, stats) {
  document.getElementById(targetId).innerHTML = stats
    .map(
      (item) => `
        <article class="stat-card">
          <p>${item.label}</p>
          <strong>${item.value}</strong>
          <span>${item.note}</span>
        </article>
      `
    )
    .join("");
}

function renderAnnouncements(targetId, announcements) {
  document.getElementById(targetId).innerHTML = announcements
    .map(
      (item) => `
        <article class="announcement">
          <strong>${item.title}</strong>
          <p>${item.body}</p>
        </article>
      `
    )
    .join("");
}

function renderChart(targetId, rows, suffix) {
  document.getElementById(targetId).innerHTML = rows
    .map((row) => {
      const width = Math.min(100, Number(row.value) || 0);
      const threshold = Math.min(100, Number(row.threshold) || 0);
      return `
        <div class="chart-row">
          <div class="chart-label">
            <strong>${row.label}</strong>
            <span>${row.value}${suffix}</span>
          </div>
          <div class="chart-bar">
            <div class="chart-threshold" style="left:${threshold}%"></div>
            <div class="chart-fill" style="width:${width}%"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function downloadFile(url) {
  const response = await fetch(url);
  if (!response.ok) {
    toast("Could not download the file.");
    return;
  }
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  const header = response.headers.get("content-disposition");
  const fileName = header?.match(/filename="(.+)"/)?.[1] || "report";
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(downloadUrl);
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function clearForm(formId) {
  const form = document.getElementById(formId);
  form.reset();
  form.querySelectorAll('input[type="hidden"]').forEach((input) => {
    input.value = "";
  });
}

function fillForm(formId, values) {
  const form = document.getElementById(formId);
  Object.entries(values).forEach(([key, value]) => {
    const field = form.elements.namedItem(key);
    if (field) field.value = value;
  });
}

function toast(message) {
  const toastEl = document.getElementById("toast");
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2800);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getStatusForThreshold(percentage, threshold) {
  if (percentage < threshold - 10) return "critical";
  if (percentage < threshold) return "warning";
  return "healthy";
}

function classesNeededToReachThreshold(attended, total, threshold) {
  if (total === 0) {
    const needed = Math.ceil((threshold / 100) * 1);
    return Math.max(0, needed);
  }

  if ((attended / total) * 100 >= threshold) return 0;

  let extra = 0;
  while (((attended + extra) / (total + extra)) * 100 < threshold) {
    extra += 1;
    if (extra > 1000) break;
  }
  return extra;
}
