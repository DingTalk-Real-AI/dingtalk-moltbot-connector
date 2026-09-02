import {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
  normalizeSecretInputString,
} from "./sdk/helpers.ts";
import { z } from "zod";

export { hasConfiguredSecretInput, normalizeResolvedSecretInputString, normalizeSecretInputString };

export function buildSecretInputSchema() {
  const provider = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
  return z.union([
    z.string(),
    z.discriminatedUnion("source", [
      z.object({ source: z.literal("env"), provider, id: z.string().min(1) }).strict(),
      z.object({ source: z.literal("file"), provider, id: z.string().min(1) }).strict(),
      z.object({ source: z.literal("exec"), provider, id: z.string().min(1) }).strict(),
      z.object({
        source: z.literal("store"),
        provider,
        id: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
      }).strict(),
    ]),
  ]);
}
