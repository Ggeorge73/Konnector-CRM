"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/services/action";
import { useToast } from "./Toast";

/** Calls a server action, shows a toast, refreshes server data, exposes pending + field errors. */
export function useAction<A extends unknown[], T>(
  action: (...args: A) => Promise<ActionResult<T>>,
  opts: { success?: string; onSuccess?: (data: T) => void } = {},
) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const exec = (...args: A) =>
    new Promise<ActionResult<T>>((resolve) =>
      start(async () => {
        const r = await action(...args);
        if (r.ok) {
          setFieldErrors({});
          setError(null);
          if (opts.success) toast(opts.success, "success");
          opts.onSuccess?.(r.data);
          router.refresh();
        } else {
          setFieldErrors(r.fieldErrors ?? {});
          setError(r.error);
          toast(r.error, "error");
        }
        resolve(r);
      }),
    );
  return { exec, pending, fieldErrors, error };
}
