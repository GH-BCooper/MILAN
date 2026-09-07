/** What counts as proof of affiliation, per role. Shown as a <select> on the
 *  registration form (app/(auth)/register/register-form.tsx) and stored
 *  verbatim on user_profiles.org_proof_type by registerAction
 *  (app/(auth)/actions.ts). Kept out of that "use server" file because such
 *  files may only export async functions. */
export const HEI_PROOF_TYPES = [
  ["INSTITUTIONAL_ID", "Institutional ID card (staff or student)"],
  ["APPOINTMENT_LETTER", "Appointment or offer letter"],
  ["DEPARTMENT_AUTH_LETTER", "Department authorisation letter"],
  ["INSTITUTIONAL_EMAIL", "Institutional email domain match"],
] as const;

export const INDUSTRY_PROOF_TYPES = [
  ["GST_CIN", "GST or CIN registration certificate"],
  ["CSR1_REGISTRATION", "CSR-1 registration (Form CSR-1)"],
  ["COMPANY_AUTH_LETTER", "Company authorisation letter"],
  ["COMPANY_EMAIL", "Company email domain match"],
] as const;
