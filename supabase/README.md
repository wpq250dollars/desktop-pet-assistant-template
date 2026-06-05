# Supabase Remote Message MVP

This folder contains the SQL setup for the remote message bubble MVP.

## 1. Run the SQL

Run `remote-message-mvp.sql` in the Supabase SQL Editor.

After running the script, create one pair record using the example at the bottom of the SQL file.

Use a random pair code with at least 4 characters, for example:

```text
7K2m
```

Do not use weak codes such as `5200`, `1234`, birthdays, or anniversaries.

The sender webpage and SQL RPC limits must stay consistent:

- Pair code minimum length: 4 characters.
- Message content length: 1 to 200 characters.
- If you change the sender-web validation later, update `send_pet_message` and the `pet_messages_content_length` SQL constraint at the same time.

## 2. Enable anonymous sign-ins

The desktop pet subscribes to a private Realtime Broadcast channel. Enable anonymous sign-ins in Supabase Auth so the Electron main process can obtain an authenticated JWT without a visible login flow.

This is required because the `realtime.messages` select policy is granted `to authenticated`. The Electron main process must:

1. create the Supabase client with the anon or publishable key
2. call anonymous sign-in
3. set the Realtime auth token
4. subscribe to the private channel

If anonymous sign-in fails, the app should log a clear message and skip remote message listening. It must not block the desktop pet from starting.

The sender webpage does not need login. It only calls the `send_pet_message` RPC.

## 3. Offline message catch-up

The SQL also creates:

```text
get_recent_pet_messages(realtime_topic_input text)
```

This RPC is used by the desktop pet when it starts. If the pet was offline while messages were sent, the Electron main process can fetch recent history after anonymous sign-in.

Rules:

- The RPC is granted to `authenticated`, not directly to `anon`.
- The Electron main process must call anonymous sign-in first, then call this RPC with the local `realtimeTopic`.
- It returns only the latest 50 messages from the last 5 days.
- Returned fields are limited to `id`, `content`, `sender_name`, and `created_at`.
- It does not return `pair_code_hash` or `realtime_topic`.
- It does not require the pair code.
- It must not use or expose `service_role`, `sb_secret_*`, database passwords, Postgres URLs, or JWT secrets.
- The renderer merges the returned rows into `localStorage.remoteMessageInbox`, where local deduplication and unread badge logic happen.

## 4. Keep the receiver topic local

After inserting the pair, Supabase returns `realtime_topic`.

Store it only on your own PC:

```text
C:\Users\<you>\AppData\Roaming\desktop-q-assistant\remote-message-config.json
```

Example:

```json
{
  "supabaseUrl": "https://YOUR_PROJECT_REF.supabase.co",
  "supabaseAnonKey": "YOUR_ANON_OR_PUBLISHABLE_KEY",
  "realtimeTopic": "RETURNED_REALTIME_TOPIC"
}
```

Do not put `realtimeTopic` in:

- the sender webpage
- Netlify or other frontend environment variables
- public Git repositories

## 5. Allowed and forbidden keys

Allowed in the sender webpage and Electron config:

- Supabase project URL
- Supabase anon key or publishable key

Forbidden everywhere in clients:

- `service_role`
- `sb_secret_*`
- database password
- Postgres connection string
- JWT secret

The Electron main process refuses obvious Supabase secret or service role keys.
