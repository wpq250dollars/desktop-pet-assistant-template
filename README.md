# Desktop Pet Assistant Template

一个基于 Electron + React + TypeScript 的 Windows 桌面宠物模板。它提供透明桌宠窗口、人物拖拽、状态图片切换、远程小纸条、离线补收、本地收件箱、设置中心、电脑状态面板和 sender-web 网页发送端。

这个分支是 public template 版本，适合二次开发自己的桌宠。仓库不包含私人配置、真实 Supabase key、真实配对码或私有素材。

## 功能列表

- 透明、无边框、可拖拽桌宠窗口。
- `idle / hover / click / unread / drag` 状态素材。
- 点击桌宠显示本地 quote bubble。
- Supabase Realtime 远程小纸条。
- 桌宠启动时离线补收最近 5 天消息。
- 本地收件箱、未读红点、未读状态图。
- 设置中心和右键菜单入口。
- 电脑状态面板。
- sender-web 手机友好的发送网页。
- Windows 打包配置。

## 快速开始

```text
npm install
npm.cmd run dev
```

构建检查：

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Windows 打包：

```text
npm.cmd run build:win
```

## 素材替换

桌宠主素材位于：

```text
src/renderer/src/assets/
```

模板素材文件：

- `idle.png`
- `hover.png`
- `click.png`
- `unread.png`
- `drag_right.gif`

当前左右拖拽使用单张 `drag_right.gif`：向右正常显示，向左通过 CSS `scaleX(-1)` 镜像显示。不要添加 `drag_left.gif`，除非你准备改代码支持双 GIF。

图标素材：

- `build/icon.ico`
- `build/icon.png`
- `resources/icon.png`

更多素材规范见 [ASSETS.md](./ASSETS.md)。

## Supabase 配置

远程小纸条是可选能力。需要时在 Supabase SQL Editor 运行：

```text
supabase/remote-message-mvp.sql
```

SQL 包含：

- `send_pet_message(pair_code, content, sender_name)`
- `get_recent_pet_messages(realtime_topic_input text)`
- private Realtime Broadcast 的 RLS 策略

当前限制：

- 配对码最少 4 位。
- 消息内容 1 到 200 字。
- sender-web 和 SQL 限制必须保持一致。

详细流程见 [SETUP.md](./SETUP.md) 和 [SECURITY.md](./SECURITY.md)。

## sender-web 部署

本地运行：

```text
npm.cmd run sender:dev
```

构建：

```text
npm.cmd run sender:build
```

Netlify 推荐配置：

```text
Build Command: npm run sender:build
Publish directory: dist-sender
```

只配置：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

不要配置 pairCode、realtimeTopic、service_role、sb_secret 或数据库密码。

## AppData 配置

接收端配置文件放在本机：

```text
C:\Users\<用户>\AppData\Roaming\desktop-q-assistant\remote-message-config.json
```

示例见：

```text
remote-message-config.example.json
```

设置中心会自动生成：

```text
C:\Users\<用户>\AppData\Roaming\desktop-q-assistant\app-settings.json
```

应用使用时间数据会保存在：

```text
C:\Users\<用户>\AppData\Roaming\desktop-q-assistant\app-usage.json
```

这些文件只属于本机，不要提交到 Git。

## 安全说明

不要提交：

- `.env`
- `sender-web/.env`
- `remote-message-config.json`
- `app-settings.json`
- `app-usage.json`
- 日志文件
- `dist`
- `dist-sender`
- `node_modules`
- `out`

不要公开：

- pairCode
- realtimeTopic
- service_role
- sb_secret
- database password
- Postgres connection string
- JWT secret

更多细节见 [SECURITY.md](./SECURITY.md)。

## FAQ

**为什么打包后图片要放在 `src/renderer/src/assets/`？**  
这些图片通过 Vite import 进入 renderer 构建链路，打包后路径更稳定。

**为什么没有 `drag_left.gif`？**  
模板使用 `drag_right.gif` 镜像显示左拖，能避免左右素材尺寸不一致。

**可以不使用 Supabase 吗？**  
可以。桌宠本地功能、quote bubble、设置中心和电脑状态面板不依赖 Supabase。

**Windows 出现未知发布者怎么办？**  
这是未签名应用的常见提示。公开发布前建议购买或配置代码签名证书。

## 二次开发建议

- 先替换素材，再调整窗口尺寸。
- 先保持 Supabase SQL 原样跑通，再改配对逻辑。
- 不要把服务端密钥放进 Electron 或 sender-web。
- 新增功能前先保留一个稳定 tag，方便回滚。
- 发布前按 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) 检查。
