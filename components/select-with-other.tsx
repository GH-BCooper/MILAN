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
 * Shared trigger styling for the *native* `<select>` elements scattered
 * through admin/gov/hei/industry pages that don't go through SelectWithOther
 * (small inline filter or override controls). Kept here, next to the styled
 * Select trigger default below, so every dropdown in the app — Radix-backed
 * or plain HTML — reads as the same rounded, softly-shadowed control in both
 * themes. `text-muted-foreground` matches the placeholder colour Radix Select
 * uses for `data-[placeholder]`, so an unselected "Every district" / "Any"
 * first option looks the same as a real Select placeholder.
 */
export const nativeSelectClassName =
  "h-11 w-full rounded-xl border border-input bg-transparent px-3 text-sm shadow-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/** Default trigger styling for SelectWithOther and any direct `<Select>`
 *  usage that wants to match it without repeating the class string. */
export const selectTriggerClassName = "h-11 w-full";

/**
 * The one dropdown pattern used everywhere a citizen or partner picks from a
 * fixed list that cannot possibly cover every real case: a styled Select,
 * always with an "Other" item at the end that reveals a free-text box when
 * chosen. Two form fields are submitted — `name` carries the picked value (or
 * "OTHER"), `${name}Other` carries the typed text — so a handler can tell
 * "picked from the list" from "wrote their own" without guessing.
 *
 * Optional fields start on no selection (`defaultValue` omitted → the Select
 * shows `placeholder` via Radix's `data-[placeholder]` state, nothing is
 * pre-picked). Required fields must never default to an arbitrary option
 * either — pass `required` to mark the field (submits `aria-required` /
 * `required` on the underlying control and on the "Other" text box, for
 * native browser validation and screen readers) and show the asterisk on
 * your own `<Label>`, since the visible label is owned by the caller here.
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
  required = false,
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
  /** Marks the field required for a11y/native validation. Does not change
   *  the starting value — a required field still starts unselected and
   *  shows `placeholder`, it just can't be submitted empty. */
  required?: boolean;
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
      <Select name={name} value={value} onValueChange={setValue} required={required}>
        <SelectTrigger
          aria-label={label ? `${label}${required ? " (required)" : ""}` : undefined}
          aria-required={required}
          className={triggerClassName ?? selectTriggerClassName}
        >
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
          required={required}
          className="h-11"
          aria-label={`${label ?? name}, other`}
        />
      ) : null}
    </div>
  );
}
