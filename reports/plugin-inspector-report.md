# OpenClaw Plugin Compatibility Report

Generated: deterministic
Status: PASS

## Summary

| Metric                    | Value |
| ------------------------- | ----- |
| Fixtures                  | 1     |
| High-priority fixtures    | 1     |
| Hard breakages            | 0     |
| Warnings                  | 1     |
| Compatibility suggestions | 4     |
| Issue findings            | 5     |
| P0 issues                 | 0     |
| P1 issues                 | 1     |
| Live issues               | 0     |
| Live P0 issues            | 0     |
| Compat gaps               | 0     |
| Deprecation warnings      | 1     |
| Inspector gaps            | 4     |
| Upstream metadata         | 0     |
| Contract probes           | 5     |
| Decision rows             | 5     |

## Triage Overview

| Class               | Count | P0 | Meaning                                                                                                         |
| ------------------- | ----- | -- | --------------------------------------------------------------------------------------------------------------- |
| live-issue          | 0     | 0  | Potential runtime breakage in the target OpenClaw/plugin pair. P0 only when it is not a deprecated compat seam. |
| compat-gap          | 0     | -  | Compatibility behavior is needed but missing from the target OpenClaw compat registry.                          |
| deprecation-warning | 1     | -  | Plugin uses a supported but deprecated compatibility seam; keep it wired while migration exists.                |
| inspector-gap       | 4     | -  | Plugin Inspector needs stronger capture/probe evidence before making contract judgments.                        |
| upstream-metadata   | 0     | -  | Plugin package or manifest metadata should improve upstream; not a target OpenClaw live break by itself.        |
| fixture-regression  | 0     | -  | Fixture no longer exposes an expected seam; investigate fixture pin or scanner drift.                           |

## P0 Live Issues

_none_

## Live Issues

_none_

## Compat Gaps

_none_

## Deprecation Warnings

- P2 **dingtalk-connector** `deprecation-warning` `core-compat-adapter`
  - **legacy-root-sdk-import**: dingtalk-connector: root plugin SDK barrel is still used by fixtures
  - state: open · compat:deprecated · deprecated
  - evidence:
    - openclaw/plugin-sdk @ index.ts:17
    - openclaw/plugin-sdk @ src/channel.ts:5
    - openclaw/plugin-sdk @ src/config/accounts.ts:2
    - openclaw/plugin-sdk @ src/core/connection.ts:16
    - openclaw/plugin-sdk @ src/core/provider.ts:14
    - openclaw/plugin-sdk @ src/directory.ts:1
    - openclaw/plugin-sdk @ src/gateway-methods.ts:7
    - openclaw/plugin-sdk @ src/onboarding.ts:5
    - openclaw/plugin-sdk @ src/runtime.ts:1
    - openclaw/plugin-sdk @ src/utils/agent.ts:8

## Inspector Proof Gaps

- P1 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **registration-capture-gap**: dingtalk-connector: runtime registrations need capture before contract judgment
  - state: open · compat:none
  - evidence:
    - registerChannel @ index.ts:75
    - registerGatewayMethod @ src/gateway-methods.ts:130
    - registerGatewayMethod @ src/gateway-methods.ts:190
    - registerGatewayMethod @ src/gateway-methods.ts:258
    - registerGatewayMethod @ src/gateway-methods.ts:311
    - registerGatewayMethod @ src/gateway-methods.ts:351
    - registerGatewayMethod @ src/gateway-methods.ts:388
    - registerGatewayMethod @ src/gateway-methods.ts:425
    - registerGatewayMethod @ src/gateway-methods.ts:452
    - registerGatewayMethod @ src/gateway-methods.ts:506
    - registerGatewayMethod @ src/gateway-methods.ts:593
    - registerGatewayMethod @ src/gateway-methods.ts:60
    - registerGatewayMethod @ src/gateway-methods.ts:652
    - registerGatewayMethod @ src/gateway-methods.ts:719

- P2 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **channel-contract-probe**: dingtalk-connector: channel runtime needs envelope/config probes
  - state: open · compat:none
  - evidence:
    - registerChannel @ index.ts:75

- P2 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **package-build-artifact-entrypoint**: dingtalk-connector: cold import requires package build output
  - state: open · compat:none
  - evidence:
    - extension:./dist/index.mjs -> dist/index.mjs

- P2 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **package-dependency-install-required**: dingtalk-connector: cold import requires isolated dependency installation
  - state: open · compat:none
  - evidence:
    - axios @ package.json
    - dingtalk-stream @ package.json
    - form-data @ package.json
    - qrcode-terminal @ package.json
    - zod @ package.json
    - openclaw @ package.json
    - mammoth @ package.json

## Upstream Metadata Issues

_none_

## Hard Breakages

_none_

## Target OpenClaw Compat Records

| Metric                   | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configured path          | /Users/vincentkoc/GIT/_Perso/openclaw                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Status                   | ok                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Compat registry          | ../../openclaw/src/plugins/compat/registry.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Compat records           | 56                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Compat status counts     | active:13, deprecated:43                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Record ids               | activation-agent-harness-hint, activation-capability-hint, activation-channel-hint, activation-command-hint, activation-config-path-hint, activation-provider-hint, activation-route-hint, agent-harness-id-alias, agent-harness-sdk-alias, agent-tool-result-harness-alias, approval-capability-approvals-alias, bundled-channel-config-schema-legacy, bundled-plugin-allowlist, bundled-plugin-enablement, bundled-plugin-load-path-aliases, bundled-plugin-vitest-defaults, channel-env-vars, channel-exposure-legacy-aliases, channel-mention-gating-legacy-helpers, channel-native-message-schema-helpers, channel-route-key-aliases, channel-runtime-sdk-alias, channel-target-comparable-aliases, clawdbot-config-type-alias, command-auth-status-builders, disable-persisted-plugin-registry-env, embedded-harness-config-alias, generated-bundled-channel-config-fallback, hook-only-plugin-shape, legacy-before-agent-start, legacy-extension-api-import, legacy-implicit-startup-sidecar, legacy-root-sdk-import, memory-split-registration, openclaw-schema-type-alias, plugin-activate-entrypoint-alias, plugin-install-config-ledger, plugin-owned-web-fetch-config, plugin-owned-web-search-config, plugin-owned-x-search-config, plugin-registry-install-migration-env, plugin-sdk-test-utils-alias, plugin-sdk-testing-barrel, provider-auth-env-vars, provider-discovery-hook-alias, provider-discovery-type-aliases, provider-external-oauth-profiles-hook, provider-static-capabilities-bag, provider-thinking-policy-hooks, provider-web-search-core-wrapper, runtime-config-load-write, runtime-inbound-envelope-alias, runtime-stt-alias, runtime-subagent-get-session-alias, runtime-taskflow-legacy-alias, setup-runtime-fallback |
| Hook registry            | ../../openclaw/src/plugins/hook-types.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Hook names               | 35                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| API builder              | ../../openclaw/src/plugins/api-builder.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| API registrars           | 48                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Captured registration    | ../../openclaw/src/plugins/captured-registration.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Captured registrars      | 26                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Package metadata         | ../../openclaw/package.json                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Plugin SDK exports       | 292                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Manifest types           | ../../openclaw/src/plugins/manifest.ts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Manifest fields          | 35                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Manifest contract fields | 17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Warnings

| Fixture            | Code                   | Level   | Message                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                           | Compat record          |
| ------------------ | ---------------------- | ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| dingtalk-connector | legacy-root-sdk-import | warning | fixture imports the root plugin SDK barrel | openclaw/plugin-sdk @ index.ts:17, openclaw/plugin-sdk @ src/channel.ts:5, openclaw/plugin-sdk @ src/config/accounts.ts:2, openclaw/plugin-sdk @ src/core/connection.ts:16, openclaw/plugin-sdk @ src/core/provider.ts:14, openclaw/plugin-sdk @ src/directory.ts:1, openclaw/plugin-sdk @ src/gateway-methods.ts:7, openclaw/plugin-sdk @ src/onboarding.ts:5, openclaw/plugin-sdk @ src/runtime.ts:1, openclaw/plugin-sdk @ src/utils/agent.ts:8 | legacy-root-sdk-import |

## Suggestions To OpenClaw Compat Layer

| Fixture            | Code                                | Level      | Message                                                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Compat record |
| ------------------ | ----------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| dingtalk-connector | package-build-artifact-entrypoint   | suggestion | package OpenClaw entrypoint points at build output that is not present in the source fixture checkout        | extension:./dist/index.mjs -> dist/index.mjs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -             |
| dingtalk-connector | package-dependency-install-required | suggestion | package declares runtime dependencies that must be installed before cold import                              | axios @ package.json, dingtalk-stream @ package.json, form-data @ package.json, qrcode-terminal @ package.json, zod @ package.json, openclaw @ package.json, mammoth @ package.json                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -             |
| dingtalk-connector | registration-capture-gap            | suggestion | future inspector capture API should record lifecycle, route, gateway, command, and interactive registrations | registerChannel @ index.ts:75, registerGatewayMethod @ src/gateway-methods.ts:130, registerGatewayMethod @ src/gateway-methods.ts:190, registerGatewayMethod @ src/gateway-methods.ts:258, registerGatewayMethod @ src/gateway-methods.ts:311, registerGatewayMethod @ src/gateway-methods.ts:351, registerGatewayMethod @ src/gateway-methods.ts:388, registerGatewayMethod @ src/gateway-methods.ts:425, registerGatewayMethod @ src/gateway-methods.ts:452, registerGatewayMethod @ src/gateway-methods.ts:506, registerGatewayMethod @ src/gateway-methods.ts:593, registerGatewayMethod @ src/gateway-methods.ts:60, registerGatewayMethod @ src/gateway-methods.ts:652, registerGatewayMethod @ src/gateway-methods.ts:719 | -             |
| dingtalk-connector | channel-contract-probe              | suggestion | add channel envelope, config-schema, and runtime metadata probes                                             | registerChannel @ index.ts:75                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -             |

## Issue Findings

- P1 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **registration-capture-gap**: dingtalk-connector: runtime registrations need capture before contract judgment
  - state: open · compat:none
  - evidence:
    - registerChannel @ index.ts:75
    - registerGatewayMethod @ src/gateway-methods.ts:130
    - registerGatewayMethod @ src/gateway-methods.ts:190
    - registerGatewayMethod @ src/gateway-methods.ts:258
    - registerGatewayMethod @ src/gateway-methods.ts:311
    - registerGatewayMethod @ src/gateway-methods.ts:351
    - registerGatewayMethod @ src/gateway-methods.ts:388
    - registerGatewayMethod @ src/gateway-methods.ts:425
    - registerGatewayMethod @ src/gateway-methods.ts:452
    - registerGatewayMethod @ src/gateway-methods.ts:506
    - registerGatewayMethod @ src/gateway-methods.ts:593
    - registerGatewayMethod @ src/gateway-methods.ts:60
    - registerGatewayMethod @ src/gateway-methods.ts:652
    - registerGatewayMethod @ src/gateway-methods.ts:719

- P2 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **channel-contract-probe**: dingtalk-connector: channel runtime needs envelope/config probes
  - state: open · compat:none
  - evidence:
    - registerChannel @ index.ts:75

- P2 **dingtalk-connector** `deprecation-warning` `core-compat-adapter`
  - **legacy-root-sdk-import**: dingtalk-connector: root plugin SDK barrel is still used by fixtures
  - state: open · compat:deprecated · deprecated
  - evidence:
    - openclaw/plugin-sdk @ index.ts:17
    - openclaw/plugin-sdk @ src/channel.ts:5
    - openclaw/plugin-sdk @ src/config/accounts.ts:2
    - openclaw/plugin-sdk @ src/core/connection.ts:16
    - openclaw/plugin-sdk @ src/core/provider.ts:14
    - openclaw/plugin-sdk @ src/directory.ts:1
    - openclaw/plugin-sdk @ src/gateway-methods.ts:7
    - openclaw/plugin-sdk @ src/onboarding.ts:5
    - openclaw/plugin-sdk @ src/runtime.ts:1
    - openclaw/plugin-sdk @ src/utils/agent.ts:8

- P2 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **package-build-artifact-entrypoint**: dingtalk-connector: cold import requires package build output
  - state: open · compat:none
  - evidence:
    - extension:./dist/index.mjs -> dist/index.mjs

- P2 **dingtalk-connector** `inspector-gap` `inspector-follow-up`
  - **package-dependency-install-required**: dingtalk-connector: cold import requires isolated dependency installation
  - state: open · compat:none
  - evidence:
    - axios @ package.json
    - dingtalk-stream @ package.json
    - form-data @ package.json
    - qrcode-terminal @ package.json
    - zod @ package.json
    - openclaw @ package.json
    - mammoth @ package.json

## Contract Probe Backlog

- P1 **dingtalk-connector** `inspector-capture-api`
  - contract: External inspector capture records service, route, gateway, command, and interactive registrations.
  - id: `api.capture.runtime-registrars:dingtalk-connector`
  - evidence:
    - registerChannel @ index.ts:75
    - registerGatewayMethod @ src/gateway-methods.ts:130
    - registerGatewayMethod @ src/gateway-methods.ts:190
    - registerGatewayMethod @ src/gateway-methods.ts:258
    - registerGatewayMethod @ src/gateway-methods.ts:311
    - registerGatewayMethod @ src/gateway-methods.ts:351
    - registerGatewayMethod @ src/gateway-methods.ts:388
    - registerGatewayMethod @ src/gateway-methods.ts:425
    - registerGatewayMethod @ src/gateway-methods.ts:452
    - registerGatewayMethod @ src/gateway-methods.ts:506
    - registerGatewayMethod @ src/gateway-methods.ts:593
    - registerGatewayMethod @ src/gateway-methods.ts:60
    - registerGatewayMethod @ src/gateway-methods.ts:652
    - registerGatewayMethod @ src/gateway-methods.ts:719

- P2 **dingtalk-connector** `channel-runtime`
  - contract: Channel setup, message envelope, sender metadata, and config schema remain stable.
  - id: `channel.runtime.envelope-config-metadata:dingtalk-connector`
  - evidence:
    - registerChannel @ index.ts:75

- P2 **dingtalk-connector** `package-loader`
  - contract: Inspector can build or resolve source aliases before cold importing package entrypoints.
  - id: `package.entrypoint.build-before-cold-import:dingtalk-connector`
  - evidence:
    - extension:./dist/index.mjs -> dist/index.mjs

- P2 **dingtalk-connector** `package-loader`
  - contract: Inspector installs package dependencies in an isolated workspace before cold import.
  - id: `package.entrypoint.isolated-dependency-install:dingtalk-connector`
  - evidence:
    - axios @ package.json
    - dingtalk-stream @ package.json
    - form-data @ package.json
    - qrcode-terminal @ package.json
    - zod @ package.json
    - openclaw @ package.json
    - mammoth @ package.json

- P2 **dingtalk-connector** `sdk-alias`
  - contract: Root plugin SDK barrel remains importable or has a machine-readable migration path.
  - id: `sdk.import.root-barrel-cold-import:dingtalk-connector`
  - evidence:
    - openclaw/plugin-sdk @ index.ts:17
    - openclaw/plugin-sdk @ src/channel.ts:5
    - openclaw/plugin-sdk @ src/config/accounts.ts:2
    - openclaw/plugin-sdk @ src/core/connection.ts:16
    - openclaw/plugin-sdk @ src/core/provider.ts:14
    - openclaw/plugin-sdk @ src/directory.ts:1
    - openclaw/plugin-sdk @ src/gateway-methods.ts:7
    - openclaw/plugin-sdk @ src/onboarding.ts:5
    - openclaw/plugin-sdk @ src/runtime.ts:1
    - openclaw/plugin-sdk @ src/utils/agent.ts:8

## Fixture Seam Inventory

| Fixture            | Priority | Seams          | Hooks | Registrations                          | Manifest contracts |
| ------------------ | -------- | -------------- | ----- | -------------------------------------- | ------------------ |
| dingtalk-connector | high     | plugin-runtime | -     | registerChannel, registerGatewayMethod | -                  |

## Decision Matrix

| Fixture            | Decision            | Seam                 | Action                                                                                               | Evidence                                                                   |
| ------------------ | ------------------- | -------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| dingtalk-connector | inspector-follow-up | cold-import          | Run the plugin build or resolve source entrypoint aliases before cold-importing this fixture.        | ./dist/index.mjs                                                           |
| dingtalk-connector | inspector-follow-up | cold-import          | Install runtime dependencies in an isolated workspace before executing this fixture entrypoint.      | axios, dingtalk-stream, form-data, qrcode-terminal, zod, openclaw, mammoth |
| dingtalk-connector | core-compat-adapter | sdk-import           | Keep the root SDK barrel stable or expose a machine-readable migration map before removing aliases.  | openclaw/plugin-sdk                                                        |
| dingtalk-connector | inspector-follow-up | registration-capture | Expose or mirror a full public API capture shim before treating these runtime-only seams as covered. | registerChannel, registerGatewayMethod                                     |
| dingtalk-connector | inspector-follow-up | channel-runtime      | Probe channel setup and message envelope contracts before changing channel runtime payloads.         | registerChannel                                                            |

## Raw Logs

| Fixture            | Code                    | Level | Message                                                                          | Evidence                                                                                                                                                            | Compat record          |
| ------------------ | ----------------------- | ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| dingtalk-connector | seam-inventory          | log   | observed 0 hooks, 2 registrations, and 0 manifest contracts                      | registration:registerChannel, registration:registerGatewayMethod                                                                                                    | -                      |
| dingtalk-connector | hook-names-present      | log   | all observed hooks exist in the target OpenClaw hook registry                    | -                                                                                                                                                                   | -                      |
| dingtalk-connector | api-registrars-present  | log   | all observed api.register* calls exist in the target OpenClaw plugin API builder | registerChannel, registerGatewayMethod                                                                                                                              | -                      |
| dingtalk-connector | sdk-exports-present     | log   | all observed plugin SDK imports exist in target OpenClaw package exports         | openclaw/plugin-sdk, openclaw/plugin-sdk/channel-entry-contract, openclaw/plugin-sdk/channel-runtime, openclaw/plugin-sdk/config-runtime, openclaw/plugin-sdk/setup | -                      |
| dingtalk-connector | manifest-fields-checked | log   | plugin manifest fields were compared with target OpenClaw manifest types         | openclaw.plugin.json                                                                                                                                                | -                      |
| dingtalk-connector | package-metadata        | log   | selected package metadata for plugin contract checks                             | package.json, @dingtalk-real-ai/dingtalk-connector, version:0.8.20                                                                                                  | -                      |
| dingtalk-connector | compat-record-present   | log   | target OpenClaw checkout has a matching compat registry record                   | legacy-root-sdk-import, status:deprecated                                                                                                                           | legacy-root-sdk-import |
