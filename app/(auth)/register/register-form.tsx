"use client";

import { useActionState, useState } from "react";

import { registerAction, type RegisterState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface Option {
  value: string;
  label: string;
}

const ROLES = [
  { value: "CITIZEN", label: "Citizen — I want to report problems where I live" },
  { value: "HEI_MEMBER", label: "University — student, faculty or lab" },
  { value: "INDUSTRY", label: "Industry — CSR, R&D or a foundation" },
  { value: "GOVERNMENT", label: "Government — district or department official" },
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
  const fe = state.fieldErrors ?? {};

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

      <Field id="fullName" label="Full name" errors={fe.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required className="h-11" />
      </Field>

      <Field id="email" label="Email address" errors={fe.email}>
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

      <Field id="phone" label="Phone number" hint="Optional. Used only for status updates." errors={fe.phone}>
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" className="h-11" />
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
        <Field
          id="orgId"
          label={role === "HEI_MEMBER" ? "Your institution" : "Your organisation"}
          hint="Pick from the registered list. New institutions are onboarded by the platform team."
          errors={fe.orgId}
        >
          <select id="orgId" name="orgId" className={selectClass} defaultValue="">
            <option value="">
              {organisations.length ? "Select an organisation" : "No organisations seeded yet"}
            </option>
            {organisations.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <input type="hidden" name="orgId" value="" />
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating your account…" : "Create account"}
      </Button>
    </form>
  );
}
