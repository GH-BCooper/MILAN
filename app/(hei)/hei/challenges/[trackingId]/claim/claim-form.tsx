"use client";

/**
 * The claim form.
 *
 * Reached directly from the notification link — push, never browse — so it has
 * to carry the whole decision: what the problem is, why this department, and
 * what claiming it commits them to.
 *
 * Every team member is named with a declared role, because the credit chain is
 * the product. "Student 1, Student 2" is not a record anybody can stand behind
 * in five years; "Priya Kumari — field survey" is.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DECLARED_ROLES } from "../../../claim-constants";
import { claimChallengeAction } from "./actions";

const selectClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

interface Member {
  /** Shown on the public credit chain. */
  name: string;
  /** Used to link an account and to notify. Never published. */
  email: string;
  declaredRole: string;
}

export function ClaimForm({
  trackingId,
  challengeTitle,
  reporterName,
  capabilities,
  defaultCapabilityId,
  defaultMentorName,
  defaultMentorEmail,
}: {
  trackingId: string;
  challengeTitle: string;
  reporterName: string | null;
  capabilities: Array<{ id: string; label: string; declaredCapacity: number }>;
  defaultCapabilityId: string;
  defaultMentorName: string;
  defaultMentorEmail: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(challengeTitle.slice(0, 140));
  const [ipTrack, setIpTrack] = useState<"OPEN" | "RESTRICTED">("OPEN");
  const [capabilityId, setCapabilityId] = useState(defaultCapabilityId);
  const [members, setMembers] = useState<Member[]>([
    { name: "", email: "", declaredRole: "Team lead" },
  ]);
  const [mentorName, setMentorName] = useState(defaultMentorName);
  const [mentorEmail, setMentorEmail] = useState(defaultMentorEmail);
  const [creditCitizen, setCreditCitizen] = useState(true);
  const [citizenRole, setCitizenRole] = useState("Domain Informant");
  const [confirmCapacity, setConfirmCapacity] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = capabilities.find((c) => c.id === capabilityId);

  function patchMember(index: number, patch: Partial<Member>) {
    setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await claimChallengeAction({
        trackingId,
        capabilityId,
        title: title.trim(),
        ipTrack,
        members: members.filter((m) => m.email.trim() && m.name.trim()),
        mentorEmail: mentorEmail.trim(),
        mentorName: mentorName.trim(),
        citizenRole: citizenRole.trim(),
        creditCitizen,
        confirmCapacity,
      });

      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.push(`/hei/projects/${result.projectId}`);
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <Label htmlFor="project-title">Project title</Label>
        <p className="text-xs text-muted-foreground">
          What the team will put on the report. Change it to whatever they will actually call it.
        </p>
        <Input
          id="project-title"
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11 text-base"
        />
      </section>

      <section className="space-y-2">
        <Label htmlFor="capability">Which department is taking this on</Label>
        <select
          id="capability"
          className={selectClass}
          value={capabilityId}
          onChange={(e) => setCapabilityId(e.target.value)}
        >
          {capabilities.map((c) => (
            <option key={c.id} value={c.id} disabled={c.declaredCapacity <= 0}>
              {c.label} — {c.declaredCapacity} slot{c.declaredCapacity === 1 ? "" : "s"} declared
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Claiming uses one declared slot. That number is an input to future routing, so it stays
          honest by costing you something.
        </p>
      </section>

      <section className="space-y-2">
        <Label htmlFor="ip">How the result is published</Label>
        <select
          id="ip"
          className={selectClass}
          value={ipTrack}
          onChange={(e) => setIpTrack(e.target.value as "OPEN" | "RESTRICTED")}
        >
          <option value="OPEN">Open — published under CC-BY, anyone may read and reuse it</option>
          <option value="RESTRICTED">
            Restricted — readable on request, and every read is logged
          </option>
        </select>
        <p className="text-xs text-muted-foreground">
          We do not stop anyone sharing work. Restricted still means readable, never anonymous:
          the access log records who read it and why.
        </p>
      </section>

      <section className="space-y-3">
        <div>
          <Label>The team</Label>
          <p className="text-xs text-muted-foreground">
            Every person, with what they are actually doing. This is the credit record: it is
            permanent, and nobody can be removed from it later.
          </p>
        </div>

        <ul className="space-y-2">
          {members.map((member, index) => (
            <li key={index} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[11rem] flex-1 space-y-1">
                <Label htmlFor={`member-name-${index}`} className="text-xs">
                  Name
                </Label>
                <Input
                  id={`member-name-${index}`}
                  placeholder="Priya Kumari"
                  value={member.name}
                  onChange={(e) => patchMember(index, { name: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="min-w-[13rem] flex-1 space-y-1">
                <Label htmlFor={`member-email-${index}`} className="text-xs">
                  Email
                </Label>
                <Input
                  id={`member-email-${index}`}
                  type="email"
                  inputMode="email"
                  placeholder="student@college.ac.in"
                  value={member.email}
                  onChange={(e) => patchMember(index, { email: e.target.value })}
                  className="h-11"
                />
              </div>
              <div className="min-w-[11rem] flex-1 space-y-1">
                <Label htmlFor={`member-role-${index}`} className="text-xs">
                  Declared role
                </Label>
                <select
                  id={`member-role-${index}`}
                  className={selectClass}
                  value={member.declaredRole}
                  onChange={(e) => patchMember(index, { declaredRole: e.target.value })}
                >
                  {DECLARED_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={`Remove team member ${index + 1}`}
                disabled={members.length === 1}
                onClick={() => setMembers((prev) => prev.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={members.length >= 12}
          onClick={() =>
            setMembers((prev) => [...prev, { name: "", email: "", declaredRole: "Field survey" }])
          }
        >
          <Plus className="size-4" aria-hidden /> Add a team member
        </Button>
        <p className="text-xs text-muted-foreground">
          The name is what appears on the public credit record. The email is only used to link an
          account and send notifications, and is never published. A student without a Milan account
          is still credited by name and can attach an account later — not having registered yet
          never costs anybody their place on the record.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="mentor-name">Mentor</Label>
          <Input
            id="mentor-name"
            value={mentorName}
            onChange={(e) => setMentorName(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mentor-email">Mentor email</Label>
          <Input
            id="mentor-email"
            type="email"
            inputMode="email"
            value={mentorEmail}
            onChange={(e) => setMentorEmail(e.target.value)}
            className="h-11"
          />
        </div>
      </section>

      {/* The demo beat and the principle in one control. */}
      <section className="rounded-lg border border-border p-4">
        <div className="flex items-start gap-3">
          <input
            id="credit-citizen"
            type="checkbox"
            className="mt-1 size-5"
            checked={creditCitizen}
            onChange={(e) => setCreditCitizen(e.target.checked)}
          />
          <div className="min-w-0 flex-1">
            <Label htmlFor="credit-citizen" className="text-sm font-medium">
              Credit {reporterName ?? "the person who reported this"} on the team
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              They noticed the problem, they know the site, and they are the only person who can
              confirm it was actually solved. On by default.
            </p>
            {creditCitizen ? (
              <div className="mt-2 space-y-1">
                <Label htmlFor="citizen-role" className="text-xs">
                  Their declared role
                </Label>
                <Input
                  id="citizen-role"
                  value={citizenRole}
                  onChange={(e) => setCitizenRole(e.target.value)}
                  className="h-11 max-w-sm"
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex items-start gap-3 rounded-lg border border-border p-4">
        <input
          id="confirm-capacity"
          type="checkbox"
          className="mt-1 size-5"
          checked={confirmCapacity}
          onChange={(e) => setConfirmCapacity(e.target.checked)}
        />
        <Label htmlFor="confirm-capacity" className="text-sm font-normal leading-snug">
          I confirm {selected?.label ?? "this department"} has the capacity to take this on this
          semester, and that a team will start work on it.
          <span className="mt-0.5 block text-xs text-muted-foreground">
            A silent project is escalated automatically after 30 days. The clock starts when you
            claim.
          </span>
        </Label>
      </section>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="lg"
          disabled={
            pending ||
            !confirmCapacity ||
            !title.trim() ||
            !members.some((m) => m.email.trim() && m.name.trim())
          }
          onClick={submit}
        >
          {pending ? "Claiming…" : `Claim ${trackingId}`}
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => router.push("/hei/inbox")}>
          Back to the inbox
        </Button>
      </div>
    </div>
  );
}
