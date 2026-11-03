// Tilt for GitHub Copilot CLI (experimental extensions:
// https://docs.github.com/en/copilot/tutorials/create-an-extension). The CLI runs this file with
// Node and resolves the SDK import itself. The table is TypeScript shared with the other
// harnesses: Node strips its types, and the hook below lets its extensionless relative imports
// find their `.ts` files. This process talks to the CLI over stdout: nothing here prints to it.
import { registerHooks } from "node:module";
import { joinSession } from "@github/copilot-sdk/extension";

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!RELATIVE.test(specifier) || HAS_EXTENSION.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

const { startTilt } = await import("./tilt.ts");
await startTilt(joinSession);
