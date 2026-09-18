# 0002 · Web first, no native app

- **Status**: accepted
- **Date**: 2026-09-18, recorded retrospectively. The decision dates from the
  start of the platform (August 2026).

## Context

Students will use the product mostly on a phone. A native app would give
better audio APIs and push notifications, but costs two store submissions,
two builds, and review cycles, for a product whose shape is still changing
weekly. The developer also works in Flutter, so the option was real, not
hypothetical.

## Decision

A responsive web app only. Audio recording goes through the browser
(`MediaRecorder` behind a small recorder interface, so a Safari-specific
implementation can be swapped in without touching callers). Notifications
start in-app; e-mail and WhatsApp are later channels behind the same
notification table.

## Consequences

- One codebase, one deploy, instant iteration.
- iOS Safari audio is the known risk and is tracked as an open item until
  tested on a real device. Android and desktop are tested first.
- No push notifications until a channel that does not need a native app
  (WhatsApp) is built.
- If the tutor ever needs always-on audio or background behaviour, this
  record gets superseded rather than worked around.
