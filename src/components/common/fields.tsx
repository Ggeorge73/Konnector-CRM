"use client";
import MenuItem from "@mui/material/MenuItem";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import { humanize } from "@/lib/format";

type Base = Omit<TextFieldProps, "onChange" | "value" | "error"> & { error?: string };

export function Text({ value, onChange, error, ...rest }: Base & { value: string | null | undefined; onChange: (v: string) => void }) {
  return (
    <TextField
      fullWidth
      size="small"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      error={!!error}
      helperText={error ?? rest.helperText}
      {...rest}
    />
  );
}

export function NumberField({
  value,
  onChange,
  error,
  ...rest
}: Base & { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      error={!!error}
      helperText={error ?? rest.helperText}
      {...rest}
    />
  );
}

export function Select<V extends string>({
  value,
  onChange,
  options,
  error,
  labels,
  allowEmpty,
  ...rest
}: Base & {
  value: V | null | undefined;
  onChange: (v: V) => void;
  options: readonly V[] | Array<{ value: V; label: string }>;
  labels?: Record<string, string>;
  allowEmpty?: string;
}) {
  const opts = (options as Array<V | { value: V; label: string }>).map((o) =>
    typeof o === "string" ? { value: o, label: labels?.[o] ?? humanize(o) } : o,
  );
  return (
    <TextField
      select
      fullWidth
      size="small"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value as V)}
      error={!!error}
      helperText={error ?? rest.helperText}
      {...rest}
    >
      {allowEmpty !== undefined && <MenuItem value="">{allowEmpty}</MenuItem>}
      {opts.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function DateField({
  value,
  onChange,
  error,
  ...rest
}: Base & { value: string | null | undefined; onChange: (v: string | null) => void }) {
  return (
    <TextField
      fullWidth
      size="small"
      type="date"
      value={value?.slice(0, 10) ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      error={!!error}
      helperText={error ?? rest.helperText}
      slotProps={{ inputLabel: { shrink: true } }}
      {...rest}
    />
  );
}
