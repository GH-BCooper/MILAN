"use client";

import { useActionState, useMemo, useState } from "react";

import { registerAction, type RegisterState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HEI_PROOF_TYPES, INDUSTRY_PROOF_TYPES } from "@/lib/auth/proof-types";

export interface Option {
  value: string;
  label: string;
  orgType?: string | null;
}

const ROLES = [
  { value: "CITIZEN", label: "Citizen" },
  { value: "HEI_MEMBER", label: "University Relation" },
  { value: "INDUSTRY", label: "Industry Relation" },
  { value: "ADMIN", label: "Platform administrator" },
] as const;

/** A plain <select>: it is the one control that works identically on every
 *  cheap Android browser, and this form has to work at 320px on 3G. */
function Field({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors?: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
      {errors?.length ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function RegisterForm({ districts, organisations }: { districts: Option[]; organisations: Option[] }) {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(registerAction, {});
  const [role, setRole] = useState<string>("CITIZEN");

  const needsOrg = role === "HEI_MEMBER" || role === "INDUSTRY";
  const needsDistrict = role === "GOVERNMENT";
  const isAdmin = role === "ADMIN";
  const fe = state.fieldErrors ?? {};

  const orgOptions = useMemo(() => {
    const wantedType = role === "HEI_MEMBER" ? "HEI" : role === "INDUSTRY" ? "INDUSTRY" : null;
    return wantedType ? organisations.filter((o) => o.orgType === wantedType) : organisations;
  }, [organisations, role]);

  const proofTypes = role === "HEI_MEMBER" ? HEI_PROOF_TYPES : role === "INDUSTRY" ? INDUSTRY_PROOF_TYPES : [];

  const selectClass =
    "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <Field id="role" label="I am a…" errors={fe.role}>
        <select
          id="role"
          name="role"
          className={selectClass}
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>

      {isAdmin ? (
        <Field
          id="adminCode"
          label="Administrator security code"
          hint="A platform administrator account can only be created with the code held by the platform owner."
          errors={fe.adminCode}
        >
          <Input id="adminCode" name="adminCode" type="password" autoComplete="off" required className="h-11" />
        </Field>
      ) : null}

      <Field id="fullName" label="Full name" errors={fe.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required className="h-11" />
      </Field>

      <Field id="email" label="Email address" hint="A verification code is sent here before your account unlocks." errors={fe.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required className="h-11" />
      </Field>

      <Field id="password" label="Password" hint="At least 8 characters." errors={fe.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="h-11"
        />
      </Field>

      <Field
        id="phone"
        label="Phone number"
        hint="Required. A verification code is sent here too — Milan uses this for status updates and to confirm outcomes."
        errors={fe.phone}
      >
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="h-11" />
      </Field>

      <Field id="preferredLang" label="Preferred language / पसंदीदा भाषा" errors={fe.preferredLang}>
        <select id="preferredLang" name="preferredLang" className={selectClass} defaultValue="en">
          <option value="en">English</option>
          <option value="hi">हिन्दी (Hindi)</option>
        </select>
      </Field>

      <Field
        id="districtCode"
        label={needsDistrict ? "District you are responsible for" : "District (optional)"}
        hint={needsDistrict ? "A government account can only act inside its own district." : undefined}
        errors={fe.districtCode}
      >
        <select id="districtCode" name="districtCode" className={selectClass} defaultValue="">
          <option value="">
            {districts.length ? "Select a district" : "No districts seeded yet"}
          </option>
          {districts.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>

      {needsOrg ? (
        <>
          <Field
            id="orgId"
            label={role === "HEI_MEMBER" ? "Your institution" : "Your organisation"}
            hint="Pick from the registered list. New institutions are onboarded by the platform team."
            errors={fe.orgId}
          >
            <select id="orgId" name="orgId" className={selectClass} defaultValue="">
              <option value="">
                {orgOptions.length ? "Select an organisation" : "No organisations seeded yet"}
              </option>
              {orgOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <div className="space-y-2 rounded-lg border border-dashed border-border p-4">
            <p className="text-sm font-medium">Proof of affiliation</p>
            <p className="text-xs text-muted-foreground">
              An admin reviews this before your account can claim challenges or see industry
              tools. You can still browse while it is pending.
            </p>

            <Field id="proofType" label="What can you show?" errors={fe.proofType}>
              <select id="proofType" name="proofType" className={selectClass} defaultValue="">
                <option value="">Select one</option>
                {proofTypes.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="designation"
              label={role === "HEI_MEMBER" ? "Your designation" : "Your designation at the company"}
              hint={role === "HEI_MEMBER" ? "e.g. Assistant Professor, Civil Engineering" : "e.g. CSR Manager"}
              errors={fe.designation}
            >
              <Input id="designation" name="designation" required className="h-11" />
            </Field>

            <Field
              id="idNumber"
              label={role === "HEI_MEMBER" ? "Employee / student ID (optional)" : "GSTIN or CIN (optional)"}
              errors={fe.idNumber}
            >
              <Input id="idNumber" name="idNumber" className="h-11" />
            </Field>

            <Field
              id="orgEmail"
              label={role === "HEI_MEMBER" ? "Institutional email (optional)" : "Company email (optional)"}
              hint="Used to cross-check your email's domain against the organisation's website."
              errors={fe.orgEmail}
            >
              <Input id="orgEmail" name="orgEmail" type="email" className="h-11" />
            </Field>

            <Field
              id="proofDocument"
              label="Upload your ID card, appointment letter or registration document"
              hint="PDF, JPG or PNG, up to 5MB."
              errors={fe.proofDocument}
            >
              <input
                id="proofDocument"
                name="proofDocument"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                required
                className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium"
              />
            </Field>
          </div>
        </>
      ) : (
        <input type="hidden" name="orgId" value="" />
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
