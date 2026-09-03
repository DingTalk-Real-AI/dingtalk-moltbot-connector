import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";

describe("OpenClaw 2 Windows loader compatibility", () => {
  it("shares the injected runtime across cache-busted module instances", async () => {
    const first = await import("../src/runtime.ts?instance=first");
    const second = await import("../src/runtime.ts?instance=second");
    const runtime = { marker: "shared-runtime" } as unknown as PluginRuntime;

    first.setDingtalkRuntime(runtime);

    expect(second.getDingtalkRuntime()).toBe(runtime);
  });

  it("keeps the plugin entry source free of executable import.meta", () => {
    const entrySource = readFileSync(join(process.cwd(), "index.ts"), "utf8");
    const executableSource = entrySource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(executableSource).not.toContain("import.meta");
  });
});

describe("OpenClaw 2 single-agent routing compatibility", () => {
  it("routes a sole main agent without requiring an explicit binding", () => {
    const route = resolveAgentRoute({
      cfg: { agents: { entries: { main: {} } } },
      channel: "dingtalk-connector",
      accountId: "default",
      peer: { kind: "direct", id: "user-1" },
    });

    expect(route).toMatchObject({ agentId: "main", matchedBy: "default" });
  });
});
