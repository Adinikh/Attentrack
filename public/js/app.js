const state = {
  role: "student",
  user: null,
  facultySubjects: [],
  students: [],
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
    { key: "faculty-manage", label: "Manage Data" },
    { key: "account", label: "Account" }
  ],
  admin: [
    { key: "admin-overview", label: "Admin Control" },
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
  on("subject-create-form", "submit", saveSubject);
  on("faculty-create-form", "submit", saveFaculty);
  on("clear-student-form", "click", () => clearForm("student-create-form"));
  on("clear-subject-form", "click", () => clearForm("subject-create-form"));
  on("clear-faculty-form", "click", () => clearForm("faculty-create-form"));
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
    await loadFacultyManageData();
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
    "faculty-manage": "Manage Students and Subjects",
    "admin-overview": "Admin Control Center",
    account: "Account Security"
  };
  document.getElementById("page-title").textContent = titles[pageKey] || "Dashboard";
}

async function loadStudentDashboard() {
  const data = await api("/api/student/dashboard");
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

  renderChart("student-chart", data.chart, "%");
  await loadStudentHistory();
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
  document.getElementById("assignment-subject-select").innerHTML = subjectOptions;
  document.getElementById("faculty-date").value = new Date().toISOString().slice(0, 10);

  renderChart("faculty-chart", data.chart, "%");
  await loadFacultyAttendance();
  await loadFacultyReport();
  await loadAssignmentPanel();
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

async function loadFacultyManageData() {
  const studentsData = await api("/api/faculty/students");
  const subjectsData = await api("/api/faculty/subjects");
  state.students = studentsData.students;
  state.facultySubjects = subjectsData.subjects;

  document.getElementById("faculty-students-table").innerHTML = state.students
    .map(
      (student) => `
        <tr>
          <td>${student.roll_number}</td>
          <td>${student.full_name}</td>
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

  document.getElementById("faculty-subjects-table").innerHTML = state.facultySubjects
    .map(
      (subject) => `
        <tr>
          <td>${subject.code}</td>
          <td>${subject.name}</td>
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

  document.getElementById("assignment-subject-select").innerHTML = state.facultySubjects
    .map((subject) => `<option value="${subject.id}">${subject.code} - ${subject.name}</option>`)
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
    await loadFacultyManageData();
    await loadFacultyDashboard();
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
    await loadFacultyManageData();
    await loadFacultyDashboard();
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
  switchPage("faculty-manage", document.querySelector('.nav-item[data-page="faculty-manage"]'));
};

window.deleteStudent = async function deleteStudent(studentId) {
  if (!confirm("Delete this student account?")) return;
  try {
    await api(`/api/faculty/students/${studentId}`, { method: "DELETE" });
    toast("Student deleted.");
    await loadFacultyManageData();
  } catch (error) {
    toast(error.message);
  }
};

window.editSubject = function editSubject(subjectId) {
  const subject = state.facultySubjects.find((item) => item.id === subjectId);
  if (!subject) return;
  fillForm("subject-create-form", {
    subjectId: subject.id,
    code: subject.code,
    name: subject.name,
    semester: subject.semester,
    section: subject.section,
    attendanceThreshold: subject.attendance_threshold
  });
  switchPage("faculty-manage", document.querySelector('.nav-item[data-page="faculty-manage"]'));
};

window.deleteSubject = async function deleteSubject(subjectId) {
  if (!confirm("Delete this subject and all attendance records for it?")) return;
  try {
    await api(`/api/faculty/subjects/${subjectId}`, { method: "DELETE" });
    toast("Subject deleted.");
    await loadFacultyManageData();
    await loadFacultyDashboard();
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

  document.getElementById("admin-students-table").innerHTML = data.students
    .map(
      (student) => `
        <tr>
          <td>${student.roll_number}</td>
          <td>${student.full_name}</td>
          <td>${student.program}</td>
          <td>${student.semester} / ${student.section}</td>
        </tr>
      `
    )
    .join("");

  document.getElementById("admin-subjects-table").innerHTML = data.subjects
    .map(
      (subject) => `
        <tr>
          <td>${subject.code}</td>
          <td>${subject.name}</td>
          <td>${subject.faculty_name}</td>
          <td>${subject.attendance_threshold}%</td>
        </tr>
      `
    )
    .join("");
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
  switchPage("admin-overview", document.querySelector('.nav-item[data-page="admin-overview"]'));
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
