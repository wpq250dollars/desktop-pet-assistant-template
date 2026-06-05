# Setup Guide

This guide starts from a fresh clone and ends with a running desktop pet plus optional remote messages.

## 1. Install Dependencies

```text
npm install
```

## 2. Run Desktop Pet

```text
npm.cmd run dev
```

## 3. Optional Supabase Remote Messages

Create a Supabase project, then run this file in the Supabase SQL Editor:

```text
supabase/remote-message-mvp.sql
```

The SQL creates:

- `pet_pairs`
- `pet_messages`
- `send_pet_message`
- `get_recent_pet_messages`
- private Realtime Broadcast policy

Enable anonymous sign-ins in Supabase Auth. The Electron main process uses anonymous sign-in before subscribing to private Realtime and fetching recent history.

## 4. Create A Pair Record

At the bottom of the SQL file there is a commented example. Replace `YOUR_STRONG_PAIR_CODE` with your own pair code, run the insert, and copy the returned `realtime_topic`.

Do not commit the pair code or returned topic.

## 5. Configure Receiver

Create:

```text
C:\Users\<user>\AppData\Roaming\desktop-q-assistant\remote-message-config.json
```

Example:

```json
{
  "supabaseUrl": "https://YOUR_PROJECT_REF.supabase.co",
  "supabaseAnonKey": "YOUR_ANON_OR_PUBLISHABLE_KEY",
  "realtimeTopic": "RETURNED_REALTIME_TOPIC"
}
```

Do not use `service_role`, `sb_secret`, database passwords, or Postgres URLs.

## 6. Run Sender Web

Create `sender-web/.env`:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
```

Run:

```text
npm.cmd run sender:dev
```

## 7. Deploy Sender Web To Netlify

Recommended Netlify settings:

```text
Build Command: npm run sender:build
Publish directory: dist-sender
```

Environment variables:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Never add receiver topic, pair code, service role key, or database password to Netlify.

## 8. Build Windows App

```text
npm.cmd run build:win
```

Output:

```text
dist/win-unpacked/桌面小助手.exe
dist/桌面小助手-1.0.0-setup.exe
```

The default product name can be changed in `electron-builder.yml`.
