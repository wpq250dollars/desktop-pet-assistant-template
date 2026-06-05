# Sender Web

`sender-web` 是一个轻量发送网页，用于向桌宠发送小纸条。它只调用 Supabase RPC：

```text
send_pet_message(pair_code, content, sender_name)
```

模板版默认 `sender_name` 固定为 `TA`。网页不知道也不保存接收端 `realtimeTopic`。

浏览器 localStorage 只保存：

- pair code
- 今日本地发送条数

不会保存消息内容。

## 本地开发

创建 `sender-web/.env`：

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_OR_PUBLISHABLE_KEY
```

运行：

```text
npm run sender:dev
```

打开终端显示的本地地址，输入配对码和消息。保持桌宠运行，才能实时收到 Supabase Realtime Broadcast。

## 构建

```text
npm run sender:build
```

静态产物生成到：

```text
dist-sender
```

## Netlify

推荐配置：

```text
Base directory: project root
Build Command: npm run sender:build
Publish directory: dist-sender
```

只添加这些环境变量：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

不要添加：

```text
service_role
sb_secret_*
database password
Postgres connection string
realtimeTopic
pairCode
```

部署后打开 Netlify URL，发送一条消息。成功时页面显示 `已经发送到桌宠啦`，桌宠会弹出同一条消息。
