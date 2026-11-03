// The only way the mod reaches the outside world: `apps/api`, through `$.http.fetch`.
import type { HttpInit, HttpResponse } from "claude-code";

import { errorOf, isDeviceStart, isDeviceToken, isIntentResponse, isStateResponse } from "./guards";
import type {
  DeviceStartResponse,
  DeviceTokenResponse,
  ImpressionRequest,
  IntentResponse,
  PlayRequest,
  StateResponse,
} from "./protocol";

/** `$.http.fetch`, bound by the hooks module (the engine follows `$` only through that file). */
export type Fetch = (url: string, init: HttpInit) => Promise<HttpResponse>;

export interface ApiFailure {
  /** `network`: no answer (retry the same request); `http`: the api refused; `invalid`: an answer of the wrong shape. */
  kind: "network" | "http" | "invalid";
  status: number | null;
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

export { apiBase, trustedVerifyUrl } from "./urls";

interface Call<T> {
  method: "GET" | "POST";
  path: string;
  token?: string;
  body?: unknown;
  /** Checks a 2xx body; an empty body reads as null. */
  guard: (value: unknown) => value is T;
}

// JSON.parse never yields undefined, so this accepts any body.
const acceptAny = (value: unknown): value is unknown => value !== undefined;

const failure = (kind: ApiFailure["kind"], status: number | null, code: string, message: string): ApiResult<never> => ({
  ok: false,
  failure: { kind, status, code, message },
});

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function call<T>(fetch: Fetch, base: string, request: Call<T>): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: "application/json" };

  if (request.token !== undefined) {
    headers.authorization = `Bearer ${request.token}`;
  }

  if (request.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response;

  try {
    response = await fetch(`${base}${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
  } catch (error) {
    return failure("network", null, "NETWORK_ERROR", error instanceof Error ? error.message : String(error));
  }

  const parsed = response.text === "" ? { ok: true as const, value: null } : parseJson(response.text);

  if (!response.ok) {
    const body = parsed.ok ? errorOf(parsed.value) : null;

    return failure("http", response.status, body?.code ?? `HTTP_${response.status}`, body?.message ?? "request failed");
  }

  if (!parsed.ok || !request.guard(parsed.value)) {
    return failure("invalid", response.status, "INVALID_RESPONSE", `unexpected answer from ${request.path}`);
  }

  return { ok: true, value: parsed.value };
}

export const startDevice = (fetch: Fetch, base: string): Promise<ApiResult<DeviceStartResponse>> =>
  call(fetch, base, { method: "POST", path: "/v1/auth/device", body: {}, guard: isDeviceStart });

export const pollDevice = (fetch: Fetch, base: string, deviceCode: string): Promise<ApiResult<DeviceTokenResponse>> =>
  call(fetch, base, { method: "POST", path: "/v1/auth/device/token", body: { deviceCode }, guard: isDeviceToken });

export const fetchState = (fetch: Fetch, base: string, token: string): Promise<ApiResult<StateResponse>> =>
  call(fetch, base, { method: "GET", path: "/v1/state", token, guard: isStateResponse });

export const play = (
  fetch: Fetch,
  base: string,
  token: string,
  request: PlayRequest,
): Promise<ApiResult<IntentResponse>> =>
  call(fetch, base, { method: "POST", path: "/v1/play", token, body: request, guard: isIntentResponse });

export const fetchIntent = (
  fetch: Fetch,
  base: string,
  token: string,
  intentId: string,
): Promise<ApiResult<IntentResponse>> =>
  call(fetch, base, {
    method: "GET",
    path: `/v1/intents/${encodeURIComponent(intentId)}`,
    token,
    guard: isIntentResponse,
  });

export const reportImpression = (
  fetch: Fetch,
  base: string,
  token: string,
  request: ImpressionRequest,
): Promise<ApiResult<unknown>> =>
  call(fetch, base, { method: "POST", path: "/v1/impressions", token, body: request, guard: acceptAny });
