/**
 * Matches Eluency web `rolePlanRules.ts` / DB check `teachers_role_plan_check`.
 * - admin     -> plan = 'Internal'
 * - principal -> plan = 'School'
 * - teacher   -> plan IN ('Free', 'Tutor', 'Standard', 'Pro')
 */
export const PLANS_BY_ROLE: Record<string, string[]> = {
  admin: ["Internal"],
  principal: ["School"],
  teacher: ["Free", "Tutor", "Standard", "Pro"],
};

export const DEFAULT_PLAN_FOR_ROLE: Record<string, string> = {
  admin: "Internal",
  principal: "School",
  teacher: "Free",
};

export function getValidPlansForRole(role: string): string[] {
  const r = (role ?? "teacher").toLowerCase().trim();
  return PLANS_BY_ROLE[r] ?? PLANS_BY_ROLE.teacher;
}

export function getDefaultPlanForRole(role: string): string {
  const r = (role ?? "teacher").toLowerCase().trim();
  return DEFAULT_PLAN_FOR_ROLE[r] ?? DEFAULT_PLAN_FOR_ROLE.teacher;
}

/** Ensure plan is valid for role (for submit/save). */
export function coercePlanForRole(role: string, plan: string): string {
  const valid = getValidPlansForRole(role);
  const p = (plan ?? "").trim();
  if (valid.includes(p)) return p;
  return getDefaultPlanForRole(role);
}

export const STUDENT_LIMIT_BY_PLAN: Record<string, number> = {
  Free: 5,
  Tutor: 10,
  Standard: 30,
  Pro: 60,
  School: 999,
  Internal: 999,
};

export function getStudentLimitForPlan(plan: string): number {
  const p = (plan ?? "Free").trim();
  return STUDENT_LIMIT_BY_PLAN[p] ?? STUDENT_LIMIT_BY_PLAN.Free ?? 5;
}

/** Map DB / display plan string to Title Case used in checks. */
export function normalizePlanUi(plan: string | null | undefined): string {
  const p = (plan ?? "").toLowerCase().trim();
  if (p === "tutor") return "Tutor";
  if (p === "standard") return "Standard";
  if (p === "pro") return "Pro";
  if (p === "school") return "School";
  if (p === "internal") return "Internal";
  return "Free";
}
