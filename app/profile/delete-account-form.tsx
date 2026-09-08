"use client";

import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { deleteAccountAction } from "./actions";

/** Item 9: a real way to remove an account, not just a stub button. Requires
 *  typing "DELETE" so a stray click cannot take down an account. */
export function DeleteAccountForm() {
  const [confirming, setConfirming] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
        Delete my account
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm">
        This removes your login, profile, phone and photo permanently. A report you filed or a
        credit you earned stays on the record — the ledger cannot erase a contribution — but it
        will no longer be linked to a live account of yours.
      </p>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <label className="block text-sm font-medium" htmlFor="confirm-delete">
        Type DELETE to confirm
      </label>
      <input
        id="confirm-delete"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        className="h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        autoComplete="off"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={phrase !== "DELETE" || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteAccountAction();
              if (result?.error) setError(result.error);
            })
          }
        >
          {pending ? "Deleting…" : "Permanently delete my account"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
