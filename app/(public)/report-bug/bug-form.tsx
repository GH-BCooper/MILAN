"use client";

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitBugReportAction } from "./actions";

const TYPE_LABEL: Record<string, string> = {
  UI_VISUAL: "Visual / layout",
  CRASH_ERROR: "Crash or error",
  INCORRECT_DATA: "Incorrect data",
  PERFORMANCE: "Slow / performance",
  OTHER: "Other",
};

export function BugForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState("UI_VISUAL");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Alert>
        <AlertDescription>
          Thanks — the report is logged and an administrator can review it at /admin/bugs.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form
      ref={formRef}
      className="space-y-5"
      action={async (formData) => {
        setSubmitting(true);
        setError(null);
        formData.set("type", type);
        formData.set("pageUrl", typeof window !== "undefined" ? window.location.href : "");
        const result = await submitBugReportAction(formData);
        setSubmitting(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(true);
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger id="type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="issue">Issue</Label>
        <Textarea
          id="issue"
          name="issue"
          required
          minLength={10}
          rows={5}
          placeholder="What went wrong, and what did you expect instead?"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="file">Screenshot (optional)</Label>
        <input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm text-muted-foreground file:mr-3 file:h-9 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:text-sm file:font-medium"
        />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
        Submit bug report
      </Button>
    </form>
  );
}
