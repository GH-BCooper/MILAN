"use client";

/**
 * One editable capability row.
 *
 * The copy is deliberate: this form changes what gets routed here, and a head
 * of department who does not know that will treat it as a directory listing and
 * leave it stale. A stale capability graph is the single easiest way for this
 * whole product to stop working.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateCapabilityAction } from "./actions";

export interface CapabilityCardProps {
  id: string;
  department: string;
  labName: string | null;
  specialisationTags: string[];
  facultyName: string | null;
  facultyDesignation: string | null;
  declaredCapacity: number;
  capacityFrom: string | null;
  capacityTo: string | null;
  active: boolean;
  hasEmbedding: boolean;
}

export function CapabilityCard(props: CapabilityCardProps) {
  const [labName, setLabName] = useState(props.labName ?? "");
  const [tags, setTags] = useState(props.specialisationTags.join(", "));
  const [facultyName, setFacultyName] = useState(props.facultyName ?? "");
  const [facultyDesignation, setFacultyDesignation] = useState(props.facultyDesignation ?? "");
  const [capacity, setCapacity] = useState(String(props.declaredCapacity));
  const [from, setFrom] = useState(props.capacityFrom ?? "");
  const [to, setTo] = useState(props.capacityTo ?? "");
  const [active, setActive] = useState(props.active);
  const [pending, startTransition] = useTransition();

  const dirty =
    labName !== (props.labName ?? "") ||
    tags !== props.specialisationTags.join(", ") ||
    facultyName !== (props.facultyName ?? "") ||
    facultyDesignation !== (props.facultyDesignation ?? "") ||
    capacity !== String(props.declaredCapacity) ||
    from !== (props.capacityFrom ?? "") ||
    to !== (props.capacityTo ?? "") ||
    active !== props.active;

  function save() {
    startTransition(async () => {
      const result = await updateCapabilityAction({
        id: props.id,
        labName: labName.trim() || null,
        facultyName: facultyName.trim() || null,
        facultyDesignation: facultyDesignation.trim() || null,
        specialisationTags: tags,
        declaredCapacity: Number(capacity) || 0,
        capacityFrom: from || null,
        capacityTo: to || null,
        active,
      });
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{props.department}</h3>
        <span className="font-mono text-[11px] text-muted-foreground">
          {props.hasEmbedding ? "indexed for semantic matching" : "will be indexed on the next routing run"}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`lab-${props.id}`}>Laboratory</Label>
          <Input
            id={`lab-${props.id}`}
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`capacity-${props.id}`}>Capstone team slots declared</Label>
          <Input
            id={`capacity-${props.id}`}
            type="number"
            min={0}
            max={50}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`faculty-${props.id}`}>Faculty</Label>
          <Input
            id={`faculty-${props.id}`}
            value={facultyName}
            onChange={(e) => setFacultyName(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`designation-${props.id}`}>Designation</Label>
          <Input
            id={`designation-${props.id}`}
            value={facultyDesignation}
            onChange={(e) => setFacultyDesignation(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`from-${props.id}`}>Capacity window opens</Label>
          <Input
            id={`from-${props.id}`}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`to-${props.id}`}>Capacity window closes</Label>
          <Input
            id={`to-${props.id}`}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11"
          />
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <Label htmlFor={`tags-${props.id}`}>Specialisation tags</Label>
        <p className="text-xs text-muted-foreground">
          Comma separated. These are matched against the domain and hazard of every incoming
          problem — 20% of the match score — so write what the lab actually does, not what it
          would like to do.
        </p>
        <Textarea
          id={`tags-${props.id}`}
          rows={2}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="text-base"
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <input
          id={`active-${props.id}`}
          type="checkbox"
          className="size-5"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        <Label htmlFor={`active-${props.id}`} className="text-sm font-normal">
          Accepting routed problems
        </Label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={!dirty || pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {dirty ? (
          <p className="text-xs text-amber-700">
            Unsaved. Changing capacity or tags changes what Milan routes here from the next run.
          </p>
        ) : null}
      </div>
    </article>
  );
}
