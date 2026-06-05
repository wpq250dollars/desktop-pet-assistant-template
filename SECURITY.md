# Security Guide

This template is designed so public frontend code never needs privileged secrets.

## Safe To Use In Frontend Or Electron Config

These can be used in sender-web or the local Electron receiver config:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
Supabase project URL
Supabase anon or publishable key
```

The anon or publishable key is not a database password. It still depends on RLS and RPC permissions being configured correctly.

## Never Commit Or Expose

Do not commit or publish:

```text
service_role
sb_secret
database password
Postgres connection string
JWT secret
pairCode
realtimeTopic
remote-message-config.json
sender-web/.env
.env
logs
```

## Receiver Topic Boundary

`realtimeTopic` identifies the private channel that the desktop pet subscribes to. In this template it is stored only on the receiver machine:

```text
C:\Users\<user>\AppData\Roaming\desktop-q-assistant\remote-message-config.json
```

Do not put it in sender-web, Netlify environment variables, public docs, screenshots, or issue reports.

## Supabase RPC Model

The sender webpage calls:

```text
send_pet_message(pair_code, content, sender_name)
```

The receiver calls:

```text
get_recent_pet_messages(realtime_topic_input)
```

The receiver must anonymous sign-in before subscribing to private Realtime and fetching recent history.

## Logs

Local logs may include received message content. Treat them as private:

```text
remote-message.log
system-status.log
```

Do not upload logs to a public issue unless you have reviewed and redacted them.

## Public Template Checklist

Before publishing a template repository:

- Confirm `.env` and `sender-web/.env` are ignored.
- Confirm `remote-message-config.json` is ignored.
- Confirm build output directories are ignored.
- Search for real Supabase URLs, pair codes, topics, and private usernames.
- Use example placeholders only.
