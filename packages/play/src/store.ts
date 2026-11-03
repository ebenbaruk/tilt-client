// The session's token and table choices on disk, readable by the person only: the token plays
// with their money.
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Saved, Store } from "./types";

export const SESSION_PATH = join(homedir(), ".tilt", "session.json");

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

/**
 * Writes `value` as JSON to `path` through a temporary file renamed over it, so a reader never
 * sees half a file; the directory is the person's own (0700), the file too (0600).
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const dir = dirname(path);

  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  // mkdir leaves an existing directory's mode as it was.
  await chmod(dir, PRIVATE_DIR_MODE);

  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;

  try {
    await writeFile(temp, JSON.stringify(value), { mode: PRIVATE_FILE_MODE });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const EMPTY: Saved = { token: null, apiBase: null, prefs: null };

function savedOf(text: string): Saved {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return EMPTY;
  }

  if (typeof value !== "object" || value === null || !("token" in value)) {
    return EMPTY;
  }

  const token = typeof value.token === "string" && value.token !== "" ? value.token : null;
  const apiBase = "apiBase" in value && typeof value.apiBase === "string" ? value.apiBase : null;

  return { token, apiBase, prefs: "prefs" in value ? value.prefs : null };
}

/** A Store in one JSON file; a missing or corrupt file reads as logged out with no choices. */
export function fileStore(path: string = SESSION_PATH): Store {
  return {
    async read() {
      try {
        return savedOf(await readFile(path, "utf8"));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          return EMPTY;
        }

        throw error;
      }
    },
    write: (saved) => writeJsonAtomic(path, saved),
  };
}
