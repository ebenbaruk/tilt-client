// Which API the mod sends its token to, and which login links it may open. Pure: the play core
// (packages/play) imports it too, so every Tilt client applies the same rules.

/** Loopback hosts may use plain http (local dev); anything else must be https so the token never travels in clear. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The configured base URL without its trailing slash, or null when it is not one the mod will send a token to. */
export function apiBase(option: unknown): string | null {
  if (typeof option !== "string" || !URL.canParse(option)) {
    return null;
  }

  const url = new URL(option);
  const isAllowed = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));

  return isAllowed ? url.href.replace(/\/+$/, "") : null;
}

const isLoopback = (url: URL) => LOOPBACK_HOSTS.has(url.hostname);

/**
 * The login page link the API sent, as the mod may open and show it; null when it is not on the
 * API's site. Allowed: https (plain http only on loopback, like `apiBase`) on the API's own host
 * or on its parent domain (api.tilt.xyz -> tilt.xyz). Loopback hosts count as one site.
 */
export function trustedVerifyUrl(verifyUrl: string, base: string): string | null {
  if (!URL.canParse(verifyUrl) || !URL.canParse(base)) {
    return null;
  }

  const url = new URL(verifyUrl);
  const api = new URL(base);

  if (url.username !== "" || url.password !== "") {
    return null;
  }

  if (isLoopback(api)) {
    return isLoopback(url) && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
  }

  const apiParent = api.hostname.slice(api.hostname.indexOf(".") + 1);
  const onApiSite = url.hostname === api.hostname || (apiParent.includes(".") && url.hostname === apiParent);

  return url.protocol === "https:" && onApiSite ? url.href : null;
}
