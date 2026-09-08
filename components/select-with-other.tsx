"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const OTHER_VALUE = "OTHER";

/**
 * The one dropdown pattern used everywhere a citizen or partner picks from a
 * fixed list that cannot possibly cover every real case: a styled Select,
 * always with an "Other" item at the end that reveals a free-text box when
 * chosen. Two form fields are submitted — `name` carries the picked value (or
 * "OTHER"), `${name}Other` carries the typed text — so a handler can tell
 * "picked from the list" from "wrote their own" without guessing.
 *
 * Not used on the sign-up role picker (Citizen/University/Industry/Admin):
 * that list is closed by design, not a category that can run out of options.
 */
export function SelectWithOther({
  name,
  label,
  placeholder,
  options,
  defaultValue,
  otherPlaceholder = "Please specify",
  triggerClassName,
  allowOther = true,
  value: controlledValue,
  onValueChange: setControlledValue,
}: {
  name: string;
  label?: string;
  placeholder: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  defaultValue?: string;
  otherPlaceholder?: string;
  triggerClassName?: string;
  /** Off for a genuinely closed list (e.g. a fixed set of districts). */
  allowOther?: boolean;
  /** Omit for an uncontrolled field (its own internal state, submitted by
   *  `name` on a plain form). Pass both to lift state to a parent instead —
   *  e.g. a form that must keep its own fields filled in across a failed
   *  server action, which resets everything uncontrolled once it returns. */
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const knownValues = new Set(options.map((o) => o.value));
  const startsOnOther = allowOther && defaultValue != null && defaultValue !== "" && !knownValues.has(defaultValue);
  const [internalValue, setInternalValue] = useState(startsOnOther ? OTHER_VALUE : defaultValue ?? "");
  const value = controlledValue ?? internalValue;
  const setValue = setControlledValue ?? setInternalValue;

  return (
    <div className="space-y-1.5">
      <Select name={name} value={value} onValueChange={setValue}>
        <SelectTrigger aria-label={label} className={triggerClassName ?? "h-11 w-full"}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          {allowOther ? <SelectItem value={OTHER_VALUE}>Other</SelectItem> : null}
        </SelectContent>
      </Select>
      {allowOther && value === OTHER_VALUE ? (
        <Input
          name={`${name}Other`}
          placeholder={otherPlaceholder}
          defaultValue={startsOnOther ? defaultValue : ""}
          className="h-11"
          aria-label={`${label ?? name}, other`}
        />
      ) : null}
    </div>
  );
}
