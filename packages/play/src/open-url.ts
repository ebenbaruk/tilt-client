import { spawn } from "node:child_process";

/**
 * Opens an http(s) URL with the platform opener, never through a shell; resolves whether the
 * opener launched. Never throws: anything else than http(s), or any spawn failure, resolves false.
 */
export function openInBrowser(url: string): Promise<boolean> {
  if (!URL.canParse(url)) return Promise.resolve(false);
  const { href, protocol } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") return Promise.resolve(false);
  const [command, args] = opener(href);
  // Executor form: the package targets ES2022, whose lib has no Promise.withResolvers.
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

function opener(href: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [href]];
  // rundll32 takes the URL as one plain argument, so no cmd (where `&` separates commands) is involved.
  if (process.platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", href]];
  return ["xdg-open", [href]];
}
