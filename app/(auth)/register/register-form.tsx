"use client";

import { useActionState, useMemo, useState } from "react";

import { registerAction, type RegisterState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectWithOther } from "@/components/select-with-other";
import { cn } from "@/lib/utils";
import { HEI_PROOF_TYPES, INDUSTRY_PROOF_TYPES } from "@/lib/auth/proof-types";

export interface Option {
  value: string;
  label: string;
  orgType?: string | null;
}

// Platform administrator is deliberately not an option here — ADMIN accounts
// are created out of band (seed data / a DB script), never through public
// registration. app/(auth)/actions.ts's RegisterSchema enforces this
// server-side too: it does not even accept role=ADMIN, so a raw POST that
// tried to add it back here would still be rejected.
const ROLES = [
  {
    value: "CITIZEN",
    label: "Citizen",
    description: "Report a problem in your area and track what happens to it.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.02-7-11.5A7 7 0 0 1 19 9.5C19 14.98 12 21 12 21Z" />
        <circle cx="12" cy="9.5" r="2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    value: "HEI_MEMBER",
    label: "University Relation",
    description: "Claim and work on research challenges routed to your institution.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 2 8l10 5 10-5-10-5Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 10.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-5.5" />
      </svg>
    ),
  },
  {
    value: "INDUSTRY",
    label: "Industry Relation",
    description: "Discover challenges, sponsor solutions, and manage CSR.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-5" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M6 21V9l6-4 6 4v12M10 21v-5h4v5M9 12h.01M9 15h.01M15 12h.01M15 15h.01" />
      </svg>
    ),
  },
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

/**
 * React resets every uncontrolled field in a <form action={...}> once the
 * action call completes — including when it returns a field error. Without
 * controlled inputs here, one missing document wipes name/email/password/etc
 * that the citizen already typed. So every field below is controlled from
 * state, seeded once and never overwritten by the action result.
 */
export function RegisterForm({ districts, organisations }: { districts: Option[]; organisations: Option[] }) {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(registerAction, {});
  const [role, setRole] = useState<string>("CITIZEN");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredLang, setPreferredLang] = useState("en");
  const [districtCode, setDistrictCode] = useState("");
  const [orgId, setOrgId] = useState("");
  const [proofType, setProofType] = useState("");
  const [designation, setDesignation] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [orgEmail, setOrgEmail] = useState("");

  const needsOrg = role === "HEI_MEMBER" || role === "INDUSTRY";
  const needsDistrict = role === "GOVERNMENT";
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

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">I am a…</legend>
        {/* Native <input type="radio"> under the hood: free arrow-key
         *  navigation within the group, free Tab stop count, free screen
         *  reader semantics — the card is just a styled <label>, using the
         *  same peer-checked pattern shadcn/ui components rely on elsewhere. */}
        <div role="radiogroup" aria-label="I am a…" className="grid gap-3 sm:grid-cols-3">
          {ROLES.map((r) => {
            const selected = role === r.value;
            return (
              <label
                key={r.value}
                className={cn(
                  "flex cursor-pointer flex-col items-start gap-2 rounded-xl border p-4 shadow-xs transition-colors",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  selected
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-input bg-background hover:bg-accent/50",
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={selected}
                  onChange={() => setRole(r.value)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border",
                    selected ? "border-primary bg-primary/15 text-primary" : "border-input text-muted-foreground",
                  )}
                >
                  {r.icon}
                </span>
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="text-xs text-muted-foreground">{r.description}</span>
              </label>
            );
          })}
        </div>
        {fe.role?.length ? (
          <p className="text-xs font-medium text-destructive" role="alert">
            {fe.role.join(" ")}
          </p>
        ) : null}
      </fieldset>

      <Field id="fullName" label="Full name" errors={fe.fullName}>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          className="h-11"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </Field>

      <Field id="email" label="Email address" hint="A verification code is sent here before your account unlocks." errors={fe.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="h-11"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <Field id="password" label="Password" hint="At least 8 characters." errors={fe.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="h-11"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Field
        id="phone"
        label="Phone number"
        hint="Required. A verification code is sent here too — Milan uses this for status updates and to confirm outcomes."
        errors={fe.phone}
      >
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          className="h-11"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </Field>

      <Field id="preferredLang" label="Preferred language / पसंदीदा भाषा" errors={fe.preferredLang}>
        <select
          id="preferredLang"
          name="preferredLang"
          className={selectClass}
          value={preferredLang}
          onChange={(e) => setPreferredLang(e.target.value)}
        >
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
        <SelectWithOther
          name="districtCode"
          label="District"
          placeholder={districts.length ? "Select a district" : "No districts seeded yet"}
          allowOther={false}
          value={districtCode}
          onValueChange={setDistrictCode}
          options={districts}
        />
      </Field>

      {needsOrg ? (
        <>
          <Field
            id="orgId"
            label={role === "HEI_MEMBER" ? "Your institution" : "Your organisation"}
            hint="Pick from the registered list. New institutions are onboarded by the platform team."
            errors={fe.orgId}
          >
            <select
              id="orgId"
              name="orgId"
              className={selectClass}
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
            >
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
              <SelectWithOther
                name="proofType"
                label="Proof type"
                placeholder="Select one"
                otherPlaceholder="Describe what you can show"
                value={proofType}
                onValueChange={setProofType}
                options={proofTypes.map(([value, label]) => ({ value, label }))}
              />
            </Field>

            <Field
              id="designation"
              label={role === "HEI_MEMBER" ? "Your designation" : "Your designation at the company"}
              hint={role === "HEI_MEMBER" ? "e.g. Assistant Professor, Civil Engineering" : "e.g. CSR Manager"}
              errors={fe.designation}
            >
              <Input
                id="designation"
                name="designation"
                required
                className="h-11"
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
              />
            </Field>

            <Field
              id="idNumber"
              label={role === "HEI_MEMBER" ? "Employee / student ID (optional)" : "GSTIN or CIN (optional)"}
              errors={fe.idNumber}
            >
              <Input
                id="idNumber"
                name="idNumber"
                className="h-11"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
              />
            </Field>

            <Field
              id="orgEmail"
              label={role === "HEI_MEMBER" ? "Institutional email (optional)" : "Company email (optional)"}
              hint="Used to cross-check your email's domain against the organisation's website."
              errors={fe.orgEmail}
            >
              <Input
                id="orgEmail"
                name="orgEmail"
                type="email"
                className="h-11"
                value={orgEmail}
                onChange={(e) => setOrgEmail(e.target.value)}
              />
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
