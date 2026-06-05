# Release Checklist

Use this before creating a public template release.

## Git State

- `git status --short` is clean.
- The release commit is on the intended branch.
- Tags point to the intended commit.
- No private branch is pushed to a public repository by mistake.

## Secrets

Search for:

```text
service_role
sb_secret
realtimeTopic
pairCode
postgres://
postgresql://
SUPABASE_SERVICE
JWT_SECRET
```

Expected results should be only variable names, placeholders, or security documentation.

## Ignored Files

Confirm these are not tracked:

```text
.env
sender-web/.env
remote-message-config.json
app-settings.json
app-usage.json
remote-message.log
system-status.log
dist
dist-sender
node_modules
out
```

## Build Checks

Run:

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run sender:build
```

For Windows release builds:

```text
npm.cmd run build:win
```

## Manual Tests

- Desktop pet launches with transparent background.
- `idle`, `hover`, `click`, `unread`, and drag states render.
- Dragging left mirrors `drag_right.gif`.
- Quote bubble displays near the pet.
- Sender web can send a message through Supabase.
- Desktop pet receives realtime messages.
- Offline catch-up adds missed messages to inbox.
- Inbox and unread badge work.
- Settings panel opens and saves local settings.
- System status panel opens and closes without stopping the pet.

## Public Repository

- README explains template setup.
- `ASSETS.md`, `SETUP.md`, and `SECURITY.md` are present.
- Example config files use placeholders only.
- No private artwork or private text remains.
