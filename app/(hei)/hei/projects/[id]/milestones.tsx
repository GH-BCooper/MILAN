"use client";

/**
 * Milestones, and the sentence that explains why they matter.
 *
 * Every write resets `last_activity_at`, which is the only input to Phase 3's
 * inactivity ladder. The UI says that out loud rather than letting a team
 * discover it when their project is escalated out from under them.
 */
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addMilestoneAction, setMilestoneDoneAction } from "./actions";

export interface MilestoneRow {
  id: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export function Milestones({
  projectId,
  rows,
}: {
  projectId: string;
  rows: MilestoneRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const result = await addMilestoneAction({
        projectId,
        title: title.trim(),
        dueAt: dueAt || null,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        toast.success(result.message);
        setTitle("");
        setDueAt("");
        setNotes("");
        setAdding(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function toggle(milestoneId: string, completed: boolean) {
    startTransition(async () => {
      const result = await setMilestoneDoneAction({ milestoneId, projectId, completed });
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <section aria-labelledby="milestones-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="milestones-heading" className="text-lg font-semibold">
          Milestones
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" aria-hidden /> Add a milestone
        </Button>
      </div>

      {adding ? (
        <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <Label htmlFor="milestone-title">What is the milestone</Label>
            <Input
              id="milestone-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Survey the embankment and log crack width at ten points"
              className="h-11"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="milestone-due">Due</Label>
            <Input
              id="milestone-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="h-11 max-w-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="milestone-notes">Notes</Label>
            <Textarea
              id="milestone-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending || title.trim().length < 4} onClick={add}>
              {pending ? "Saving…" : "Add"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No milestones yet. A project with no recorded activity for 30 days is flagged at risk
          automatically, and at 45 it is offered to another team — so this list is also how the
          platform knows you are still working.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 p-4">
              <input
                id={`done-${row.id}`}
                type="checkbox"
                className="mt-1 size-5 shrink-0"
                checked={Boolean(row.completedAt)}
                disabled={pending}
                onChange={(e) => toggle(row.id, e.target.checked)}
              />
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor={`done-${row.id}`}
                  className={`text-sm font-medium ${row.completedAt ? "line-through opacity-60" : ""}`}
                >
                  {row.title}
                </Label>
                {row.notes ? (
                  <p className="mt-0.5 text-sm text-muted-foreground">{row.notes}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {row.dueAt ? `due ${formatDate(row.dueAt)}` : "no due date"}
                  {row.completedAt ? ` · completed ${formatDate(row.completedAt)}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
