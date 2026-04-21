const { z } = require("zod");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/\d/, "Password must include at least one number.");

const emailSchema = z.string().trim().email("Enter a valid email address.").transform((value) => value.toLowerCase());

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
  role: z.enum(["student", "faculty", "admin"])
});

const studentSchema = z.object({
  fullName: z.string().trim().min(2, "Student name is required."),
  email: emailSchema,
  rollNumber: z.string().trim().min(2, "Roll number is required."),
  program: z.string().trim().min(2, "Program is required."),
  semester: z.coerce.number().int().min(1).max(8),
  section: z.string().trim().min(1, "Section is required."),
  guardianName: z.string().trim().optional().default(""),
  guardianPhone: z.string().trim().optional().default("")
});

const facultySchema = z.object({
  fullName: z.string().trim().min(2, "Faculty name is required."),
  email: emailSchema,
  employeeId: z.string().trim().min(2, "Employee ID is required."),
  department: z.string().trim().min(2, "Department is required.")
});

const subjectSchema = z.object({
  code: z.string().trim().min(2, "Subject code is required."),
  name: z.string().trim().min(2, "Subject name is required."),
  semester: z.coerce.number().int().min(1).max(8),
  section: z.string().trim().min(1, "Section is required."),
  attendanceThreshold: z.coerce.number().int().min(50).max(100),
  facultyId: z.coerce.number().int().positive().optional()
});

const attendanceSchema = z.object({
  subjectId: z.coerce.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional().default(""),
  records: z
    .array(
      z.object({
        studentId: z.coerce.number().int().positive(),
        status: z.enum(["present", "absent"])
      })
    )
    .min(1, "At least one attendance record is required.")
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: passwordSchema
});

const assignmentSchema = z.object({
  studentIds: z.array(z.coerce.number().int().positive()).default([])
});

function parseSchema(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const message = result.error.issues[0]?.message || "Invalid request.";
    const error = new Error(message);
    error.status = 400;
    throw error;
  }

  return result.data;
}

module.exports = {
  assignmentSchema,
  attendanceSchema,
  changePasswordSchema,
  facultySchema,
  loginSchema,
  parseSchema,
  studentSchema,
  subjectSchema
};
