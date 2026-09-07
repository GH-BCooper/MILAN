"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { setBugStatusAction } from "./actions";

export function BugStatusButton({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const next = status === "OPEN" ? "RESOLVED" : "OPEN";

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => setBugStatusAction(id, next))}
    >
      {status === "OPEN" ? "Mark resolved" : "Reopen"}
    </Button>
  );
}
