"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitQuestionAction } from "./actions";

const TAGS = [
  "EDUCATION",
  "HEALTHCARE",
  "AGRICULTURE",
  "WATER",
  "SANITATION",
  "ENVIRONMENT",
  "LIVELIHOODS",
  "ACCESSIBILITY",
  "URBAN_INFRA",
  "PUBLIC_SERVICE",
] as const;

export function QuestionForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const [tag, setTag] = useState<string>(TAGS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="max-w-xl space-y-5"
      action={async (formData) => {
        setSubmitting(true);
        setError(null);
        const result = await submitQuestionAction({
          name: formData.get("name"),
          tag,
          qualification: formData.get("qualification"),
          question: formData.get("question"),
        });
        setSubmitting(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/c/${result.trackingId}`);
      }}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={defaultName} required minLength={2} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="tag">Tag</Label>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger id="tag" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAGS.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replaceAll("_", " ").toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="qualification">Qualification</Label>
        <Textarea
          id="qualification"
          name="qualification"
          required
          minLength={10}
          rows={3}
          placeholder="Department, equipment, or prior work that makes your team placed to take this on."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="question">The question</Label>
        <Textarea
          id="question"
          name="question"
          required
          minLength={40}
          rows={6}
          placeholder="What is unresolved, and what would 'done' look like?"
        />
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
        Submit
      </Button>
    </form>
  );
}
