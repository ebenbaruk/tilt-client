// Tilt for DeepSeek Harness: the plugin entry dsh loads (package.json `main`). Installed dsh runs
// plain Node, which strips the types of the TypeScript plugin and the table it shares with the
// other harnesses; the hook below lets their extensionless relative imports find their `.ts` files.
import { registerHooks } from "node:module";

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

const plugin = await import("./tilt.ts");

export const name = plugin.name;
export const inject = plugin.inject;
export const apply = plugin.apply;
