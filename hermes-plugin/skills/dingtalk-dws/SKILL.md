---
name: dingtalk-dws
description: |
  Use DingTalk product capabilities from a Hermes DingTalk conversation with
  the dws CLI: docs, AI tables, calendar, todo, reports, DING, chat, contacts,
  approvals, attendance, and workbench operations.
---

# DingTalk DWS

Use this skill when a Hermes DingTalk user asks for a DingTalk business
operation that is not ordinary chat reply delivery.

## Boundary

The Hermes platform adapter handles DingTalk chat transport: inbound messages,
session replies, DingTalk Markdown, media intake, allowlists, and AI Cards.
The `dingtalk_official_send` tool handles proactive user/group delivery and
local image/file upload when that is a robot-message transport task. Use the
`dws` CLI for DingTalk product APIs such as docs, calendars, tables, todos,
reports, DING messages, contacts, group operations, approvals, attendance,
and workbench administration.

## Before Running

1. Check `dws --version`; use a current `dingtalk-workspace-cli` version.
2. Check `dws auth status`; if it is not authorized, ask the user to run
   `dws auth login` and complete DingTalk authorization.
3. Use the Hermes terminal approval flow for any command that changes data or
   sends a high-impact notification.

Hermes does not copy the platform client secret into shell subprocesses. Do
not print or export DingTalk secrets to make a `dws` command work; use the
normal `dws` auth flow instead.

## Command Rules

- Prefer `dws` over ad hoc HTTP calls or browser automation for supported
  DingTalk business operations.
- Add `--format json` whenever the command supports it.
- Query first instead of guessing DingTalk IDs, UUIDs, field names, or record
  shapes.
- Keep a batch action to 30 records or fewer unless the user explicitly asks
  for a controlled larger batch.
- Summarize the intended target and impact before destructive actions such as
  deleting tables, records, calendar events, participants, group members, or
  todos.

## Routing Hints

| User intent | `dws` area |
| --- | --- |
| DingTalk docs and document search | `doc` |
| AI tables, records, fields, data rows | `aitable` |
| Calendar, meeting, busy/free, room | `calendar` |
| Todo and task reminders | `todo` |
| Daily report, weekly report, log history | `report` |
| DING and urgent reminders | `ding` |
| Contacts, colleagues, departments | `contact` |
| Chat groups and robot-sent messages | `chat` |
| Approval, attendance, workbench | matching product command |

When a `dws` command fails, retry once with its verbose/debug option if one is
available, then report the concrete error instead of inventing a fallback API.
