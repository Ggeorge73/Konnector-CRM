import { env } from "@/config/app";
import { sign } from "./signing";

export interface TransportResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/** Sends one signed event to Konnect Hub. */
export type Transport = (event: string, body: string, signature: string) => Promise<TransportResult>;

export const httpTransport: Transport = async (event, body, signature) => {
  const res = await fetch(`${env.konnectHubBaseUrl.replace(/\/$/, "")}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Konnector-Signature": signature, "X-Konnector-Event": event },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON error bodies are fine — status carries the outcome
  }
  return { ok: res.ok, status: res.status, body: json };
};

/** In-process mock (dev flag): same signing/verification, no network hop. */
export const mockTransport: Transport = async (event, body, signature) => {
  const { mockKonnectHub } = await import("./mock-konnect-hub");
  return mockKonnectHub.receive(event, body, signature);
};

export function defaultTransport(): Transport {
  return env.mockKonnectHub && !env.konnectHubBaseUrl ? mockTransport : httpTransport;
}

export function signBody(body: string, t?: number) {
  return sign(body, env.integrationSecret, t);
}
