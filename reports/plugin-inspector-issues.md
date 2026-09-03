# OpenClaw Plugin Issue Findings

Generated: deterministic
Status: PASS

## Triage Summary

| Metric               | Value |
| -------------------- | ----- |
| Issue findings       | 5     |
| P0                   | 0     |
| P1                   | 1     |
| Live issues          | 0     |
| Live P0 issues       | 0     |
| Compat gaps          | 0     |
| Deprecation warnings | 1     |
| Inspector gaps       | 4     |
| Upstream metadata    | 0     |
| Contract probes      | 5     |

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

## Issues

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
