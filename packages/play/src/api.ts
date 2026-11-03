// The session's only way to the outside world: `apps/api`, over the global `fetch`. Endpoints,
// request shapes, failure kinds and response checks mirror apps/mod/hooks/api.ts.
import {
  errorOf,
  isDeviceStart,
  isDeviceToken,
  isIntentResponse,
  isStateResponse,
} from "../../../apps/mod/hooks/guards";
import type {
  DeviceStartResponse,
  DeviceTokenResponse,
  ImpressionRequest,
  IntentResponse,
  PlayRequest,
  StateResponse,
} from "../../../apps/mod/hooks/protocol";

export type Fetch = typeof fetch;

export interface ApiFailure {
  /** `network`: no answer (retry the same request); `http`: the api refused; `invalid`: an answer of the wrong shape. */
  kind: "network" | "http" | "invalid";
  status: number | null;
  code: string;
  message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; failure: ApiFailure };

/** A request with no answer by then counts as a network failure: a move is resent with the same id, never lost in a hang. */
const REQUEST_TIMEOUT_MS = 15_000;

// The same rules as the mod, from the same module.
export { apiBase, trustedVerifyUrl } from "../../../apps/mod/hooks/urls";

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

const UNKNOWN_ERROR = "unknown error";

/** A thrown value as text; never throws itself (a proxy, a throwing getter or `toString`, a prototype-less object). */
function errorMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return typeof message === "string" && message !== "" ? message : UNKNOWN_ERROR;
  } catch {
    return UNKNOWN_ERROR;
  }
}

async function send(
  fetch: Fetch,
  url: string,
  init: RequestInit,
): Promise<{ ok: true; status: number; isOk: boolean; text: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

    return { ok: true, status: response.status, isOk: response.ok, text: await response.text() };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
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

  const response = await send(fetch, `${base}${request.path}`, {
    method: request.method,
    headers,
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });

  if (!response.ok) {
    return failure("network", null, "NETWORK_ERROR", response.message);
  }

  const parsed = response.text === "" ? { ok: true as const, value: null } : parseJson(response.text);

  if (!response.isOk) {
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
