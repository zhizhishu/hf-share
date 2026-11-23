# Claw Email Web 管理与收发系统实施方案

## 目标

新建一个独立项目，实现一个可 Docker 部署的前后端系统，用网页完成以下能力：

```text
1. 创建 Claw 子邮箱，例如 vercel.4@claw.163.com
2. 删除 Claw 子邮箱
3. 查看邮箱列表
4. 接收 Claw 邮箱的新邮件
5. 查看邮件详情和附件
6. 发送新邮件
7. 回复已有邮件
8. 将邮件存入本地数据库，供网页查询
```

适用范围：

```text
这是个人/内部工具方案，依赖 Claw 当前控制台接口和 @clawemail/node-sdk。
创建/删除邮箱使用 Claw 控制台内部接口，不保证长期稳定。
收信、发信、回复使用官方 Node SDK，稳定性相对更高。
```

不做的事情：

```text
不把 Claw 登录 Cookie 暴露到浏览器前端。
不把 ck_live API Key 暴露到浏览器前端。
不在 Cloudflare Worker 里长期监听 WebSocket。
不实现任意 claw.163.com 地址的 catch-all 收信，只管理当前 workspace 下创建出来的邮箱。
```

## 已确认的信息

当前 Claw workspace 信息：

```text
workspaceId: XnVvZknr
parentMailboxId: 3L85M1qk
主邮箱前缀: vercel
主邮箱: vercel@claw.163.com
子邮箱示例:
  vercel.1@claw.163.com
  vercel.2@claw.163.com
```

Claw 子邮箱创建请求示例：

```http
POST https://claw.163.com/mailserv-claw-dashboard/api/v1/mailboxes
Content-Type: application/json
Cookie: <CLAW_DASHBOARD_COOKIE>
```

```json
{
  "prefix": "3",
  "displayName": "3",
  "mailboxType": "sub",
  "workspaceId": "XnVvZknr",
  "parentMailboxId": "3L85M1qk"
}
```

创建成功响应示例：

```json
{
  "code": 200,
  "message": "DONE",
  "success": true,
  "result": {
    "id": "bqMrXmnz",
    "prefix": "vercel.3",
    "email": "vercel.3@claw.163.com",
    "displayName": "3",
    "mailboxType": "sub",
    "status": "active",
    "installCommand": "npx \"@clawemail/claw-setup@latest\" --auth-url \"t1/xxxx\"",
    "expiresInSeconds": 1800
  }
}
```

Claw 子邮箱删除请求示例：

```http
POST https://claw.163.com/mailserv-claw-dashboard/api/v1/mailboxes/delete?id=<mailboxId>
Cookie: <CLAW_DASHBOARD_COOKIE>
```

删除成功响应示例：

```json
{
  "code": 200,
  "message": "DONE",
  "success": true,
  "result": null
}
```

Claw 邮件 SDK：

```bash
npm install @clawemail/node-sdk
```

SDK 初始化：

```ts
import { MailClient } from "@clawemail/node-sdk";

const client = new MailClient({
  apiKey: process.env.CLAW_API_KEY!,
  user: "vercel.2@claw.163.com",
  logger: null
});
```

收信监听：

```ts
client.ws.onMessage(async ({ mailId }) => {
  const mail = await client.mail.read({ id: mailId, markRead: true });
  // 保存到数据库，推送给网页
});

await client.ws.connect();
```

发信：

```ts
await client.mail.send({
  to: ["target@example.com"],
  subject: "hello",
  body: "test"
});
```

回复：

```ts
await client.mail.reply({
  id: "mailId",
  body: "已收到"
});
```

## 总体架构

```text
browser frontend
  |
  | HTTP / SSE
  v
Node.js backend
  |
  | Claw Dashboard internal API
  | - create mailbox
  | - delete mailbox
  |
  | @clawemail/node-sdk
  | - listen new mails
  | - read mail detail
  | - send mail
  | - reply mail
  v
SQLite database
```

推荐技术栈：

```text
前端: React + Vite + TypeScript
后端: Node.js + Fastify 或 Express + TypeScript
数据库: SQLite
部署: Docker + docker compose
实时通知: Server-Sent Events, 简称 SSE
```

为什么用 SSE：

```text
1. 浏览器原生支持 EventSource。
2. 只需要服务端推送新邮件事件，不需要双向 WebSocket。
3. Docker 部署和反向代理配置更简单。
```

## 项目目录设计

建议新建文件夹：

```text
claw-email-webapp/
  docker-compose.yml
  Dockerfile
  .env.example
  package.json
  tsconfig.json
  data/
  src/
    server/
      index.ts
      config.ts
      db.ts
      claw-dashboard.ts
      claw-mail.ts
      listener-manager.ts
      routes/
        mailboxes.ts
        mails.ts
        send.ts
        events.ts
    web/
      index.html
      package.json
      vite.config.ts
      src/
        main.tsx
        api.ts
        App.tsx
        pages/
          MailboxesPage.tsx
          InboxPage.tsx
          MailDetailPage.tsx
        components/
          MailboxTable.tsx
          SendMailDialog.tsx
```

也可以先做单 package：

```text
claw-email-webapp/
  package.json
  src/server/*
  src/web/*
```

## 环境变量

`.env.example`：

```env
NODE_ENV=production
PORT=3000

# 管理网页登录密码，至少先做一个简单管理密码
ADMIN_PASSWORD=change-me

# Claw Email SDK API Key，不要放前端
CLAW_API_KEY=ck_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Claw Dashboard 登录 Cookie，不要放前端
CLAW_DASHBOARD_COOKIE=session=xxx; other=xxx

# Claw workspace 参数
CLAW_WORKSPACE_ID=XnVvZknr
CLAW_PARENT_MAILBOX_ID=3L85M1qk
CLAW_ROOT_PREFIX=vercel
CLAW_DOMAIN=claw.163.com

# SQLite
DATABASE_PATH=/app/data/app.db
```

安全要求：

```text
1. CLAW_API_KEY 只在后端使用。
2. CLAW_DASHBOARD_COOKIE 只在后端使用。
3. 前端所有管理请求必须带后台登录态或管理密码。
4. Docker 部署时通过 .env 注入，不提交真实 .env。
```

## 数据库设计

使用 SQLite。

```sql
CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  display_name TEXT,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  openclaw_status TEXT,
  install_command TEXT,
  auth_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mailboxes_email ON mailboxes(email);
```

```sql
CREATE TABLE IF NOT EXISTS mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_mail_id TEXT NOT NULL,
  mailbox_email TEXT NOT NULL,
  source TEXT,
  address TEXT,
  subject TEXT,
  text TEXT,
  html TEXT,
  raw_json TEXT NOT NULL,
  header_raw TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(mailbox_email, provider_mail_id)
);

CREATE INDEX IF NOT EXISTS idx_mails_mailbox_email ON mails(mailbox_email);
CREATE INDEX IF NOT EXISTS idx_mails_created_at ON mails(created_at);
```

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id INTEGER NOT NULL,
  provider_part_id TEXT NOT NULL,
  filename TEXT,
  content_type TEXT,
  size INTEGER,
  saved_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(mail_id) REFERENCES mails(id) ON DELETE CASCADE
);
```

第一版可以不落地附件内容，只保存附件元数据；下载附件时再通过 SDK 即时下载。

## 后端 API 设计

### 鉴权

简单版本：

```http
X-Admin-Password: <ADMIN_PASSWORD>
```

所有 `/api/*` 接口都检查该 header。

后续增强：

```text
1. 登录接口换 JWT。
2. 支持用户权限。
3. 支持 CSRF 防护。
```

### 健康检查

```http
GET /health
```

响应：

```json
{
  "ok": true
}
```

### 获取邮箱列表

```http
GET /api/mailboxes
X-Admin-Password: <ADMIN_PASSWORD>
```

响应：

```json
{
  "items": [
    {
      "id": "JOoWPzOo",
      "email": "vercel.2@claw.163.com",
      "prefix": "vercel.2",
      "displayName": "2",
      "status": "active",
      "createdAt": "2026-05-03T23:15:21"
    }
  ]
}
```

实现细节：

```text
1. 优先返回本地 DB 中的 mailboxes。
2. 可增加 sync=true 查询 Claw Dashboard 的 GET mailboxes 接口同步。
```

Claw Dashboard 邮箱列表接口：

```http
GET https://claw.163.com/mailserv-claw-dashboard/api/v1/mailboxes?workspaceId=XnVvZknr
Cookie: <CLAW_DASHBOARD_COOKIE>
```

### 创建邮箱

```http
POST /api/mailboxes
X-Admin-Password: <ADMIN_PASSWORD>
Content-Type: application/json
```

请求：

```json
{
  "suffix": "4"
}
```

后端调用 Claw：

```http
POST https://claw.163.com/mailserv-claw-dashboard/api/v1/mailboxes
Cookie: <CLAW_DASHBOARD_COOKIE>
Content-Type: application/json
```

```json
{
  "prefix": "4",
  "displayName": "4",
  "mailboxType": "sub",
  "workspaceId": "XnVvZknr",
  "parentMailboxId": "3L85M1qk"
}
```

响应：

```json
{
  "id": "xxxx",
  "email": "vercel.4@claw.163.com",
  "prefix": "vercel.4",
  "displayName": "4",
  "installCommand": "npx \"@clawemail/claw-setup@latest\" --auth-url \"t1/xxxx\"",
  "authUrl": "t1/xxxx"
}
```

校验规则：

```text
1. suffix 只允许小写字母和数字。
2. suffix 长度建议 1 到 32。
3. 本地 DB 已存在则拒绝。
4. Claw 返回非 success 时直接向前端返回错误。
```

### 删除邮箱

```http
DELETE /api/mailboxes/:id
X-Admin-Password: <ADMIN_PASSWORD>
```

后端调用 Claw：

```http
POST https://claw.163.com/mailserv-claw-dashboard/api/v1/mailboxes/delete?id=<mailboxId>
Cookie: <CLAW_DASHBOARD_COOKIE>
```

响应：

```json
{
  "success": true
}
```

实现细节：

```text
1. 先从 DB 查 id 对应 email。
2. 调 Claw 删除接口。
3. Claw 成功后本地 mailboxes 标记 deleted 或直接删除。
4. 第一版建议软删除，将 status 设置为 deleted，避免误删历史邮件关联。
```

### 获取邮件列表

```http
GET /api/mails?mailbox=vercel.2@claw.163.com&limit=50&offset=0
X-Admin-Password: <ADMIN_PASSWORD>
```

响应：

```json
{
  "items": [
    {
      "id": 1,
      "providerMailId": "coremail-id",
      "mailboxEmail": "vercel.2@claw.163.com",
      "from": "sender@example.com",
      "subject": "Hello",
      "text": "正文摘要",
      "hasAttachments": false,
      "createdAt": "2026-05-03T23:20:00Z"
    }
  ],
  "count": 1
}
```

### 获取邮件详情

```http
GET /api/mails/:id
X-Admin-Password: <ADMIN_PASSWORD>
```

响应：

```json
{
  "id": 1,
  "providerMailId": "coremail-id",
  "mailboxEmail": "vercel.2@claw.163.com",
  "from": ["sender@example.com"],
  "to": ["vercel.2@claw.163.com"],
  "subject": "Hello",
  "text": "纯文本正文",
  "html": "<p>HTML正文</p>",
  "attachments": []
}
```

### 发送邮件

```http
POST /api/send
X-Admin-Password: <ADMIN_PASSWORD>
Content-Type: application/json
```

请求：

```json
{
  "from": "vercel.2@claw.163.com",
  "to": ["target@example.com"],
  "subject": "测试",
  "body": "hello",
  "html": false
}
```

后端 SDK 调用：

```ts
const client = getMailClient(from);

await client.mail.send({
  to,
  subject,
  body,
  html
});
```

响应：

```json
{
  "status": "sent"
}
```

### 回复邮件

```http
POST /api/reply
X-Admin-Password: <ADMIN_PASSWORD>
Content-Type: application/json
```

请求：

```json
{
  "mailId": 1,
  "body": "已收到",
  "html": false,
  "toAll": false
}
```

实现细节：

```text
1. 从本地 mails 表查 provider_mail_id 和 mailbox_email。
2. 使用 mailbox_email 创建 MailClient。
3. 调 client.mail.reply({ id: provider_mail_id, body, html, toAll })。
```

响应：

```json
{
  "status": "sent"
}
```

### 实时事件

```http
GET /api/events
X-Admin-Password: <ADMIN_PASSWORD>
```

SSE 事件：

```text
event: mail
data: {"mailboxEmail":"vercel.2@claw.163.com","mailId":123}
```

前端：

```ts
const events = new EventSource("/api/events");

events.addEventListener("mail", (event) => {
  const data = JSON.parse(event.data);
  // 刷新邮件列表或展示通知
});
```

## 后端核心模块

### config.ts

职责：

```text
1. 读取环境变量。
2. 校验必填项。
3. 不允许启动时缺少 CLAW_API_KEY / CLAW_DASHBOARD_COOKIE。
```

### claw-dashboard.ts

职责：

```text
封装 Claw 控制台内部 API。
```

函数：

```ts
type CreateMailboxInput = {
  suffix: string;
};

type ClawMailbox = {
  id: string;
  email: string;
  prefix: string;
  displayName?: string;
  installCommand?: string;
  authUrl?: string;
};

async function createMailbox(input: CreateMailboxInput): Promise<ClawMailbox>;
async function deleteMailbox(id: string): Promise<void>;
async function listMailboxes(): Promise<ClawMailbox[]>;
```

### claw-mail.ts

职责：

```text
封装 @clawemail/node-sdk。
```

函数：

```ts
function getMailClient(email: string): MailClient;
async function sendMail(input: SendMailInput): Promise<void>;
async function replyMail(input: ReplyMailInput): Promise<void>;
async function readMail(email: string, providerMailId: string): Promise<MailDetail>;
```

### listener-manager.ts

职责：

```text
为每个 active 邮箱启动一个 Claw WebSocket 监听。
```

流程：

```text
1. 服务启动时读取 DB 中 active mailboxes。
2. 为每个邮箱创建 MailClient。
3. 注册 client.ws.onMessage。
4. 收到 mailId 后调用 client.mail.read。
5. 保存 mails 和 attachments。
6. 通过 SSE 广播给前端。
7. 断线后指数退避重连。
8. 新建邮箱后动态启动监听。
9. 删除邮箱后停止对应监听。
```

断线重连策略：

```text
1 秒 -> 2 秒 -> 4 秒 -> 8 秒 -> 16 秒 -> 30 秒循环
```

## 前端页面设计

### MailboxesPage

功能：

```text
1. 显示邮箱列表。
2. 输入 suffix 创建邮箱。
3. 删除邮箱前二次确认。
4. 显示 installCommand 和 auth-url。
```

控件：

```text
输入框: suffix
按钮: 创建
表格: email / status / createdAt / 操作
操作: 查看收件箱 / 删除
```

### InboxPage

功能：

```text
1. 选择邮箱。
2. 查看邮件列表。
3. 新邮件 SSE 自动刷新。
4. 点击进入详情。
```

### MailDetailPage

功能：

```text
1. 显示 from / to / subject / date。
2. 显示 text/html。
3. 显示附件列表。
4. 回复邮件。
```

### SendMailDialog

功能：

```text
1. 选择发件邮箱。
2. 填写收件人、主题、正文。
3. 提交到 POST /api/send。
```

## Docker 部署

Dockerfile：

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
```

docker-compose.yml：

```yaml
services:
  claw-email-webapp:
    build: .
    container_name: claw-email-webapp
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```

启动：

```bash
docker compose up -d --build
```

查看日志：

```bash
docker logs -f claw-email-webapp
```

停止：

```bash
docker compose down
```

## 实施步骤

### 第 1 步：初始化项目

```bash
mkdir claw-email-webapp
cd claw-email-webapp
npm init -y
npm install @clawemail/node-sdk fastify better-sqlite3 zod dotenv
npm install -D typescript tsx vite react react-dom @types/node @types/react @types/react-dom
```

产物：

```text
package.json
tsconfig.json
src/server/index.ts
src/web/*
```

### 第 2 步：实现配置和数据库

要做：

```text
1. 写 config.ts。
2. 写 db.ts。
3. 启动时自动执行 CREATE TABLE。
4. 写 mailboxes/mails/attachments 基础 DAO。
```

验收：

```text
npm run dev 启动后 data/app.db 自动生成。
GET /health 返回 ok。
```

### 第 3 步：封装 Claw Dashboard API

要做：

```text
1. createMailbox(suffix)。
2. deleteMailbox(id)。
3. listMailboxes()。
4. 统一错误处理。
```

重点：

```text
1. Cookie 从 CLAW_DASHBOARD_COOKIE 读取。
2. 不打印 Cookie。
3. 创建邮箱时只允许 /^[a-z0-9]+$/。
```

验收：

```text
POST /api/mailboxes {"suffix":"4"} 可以创建 vercel.4@claw.163.com。
DELETE /api/mailboxes/:id 可以删除。
```

### 第 4 步：实现邮箱管理接口

要做：

```text
1. GET /api/mailboxes。
2. POST /api/mailboxes。
3. DELETE /api/mailboxes/:id。
4. 写入/更新本地 DB。
```

验收：

```text
浏览器页面能创建和删除邮箱。
本地 DB 记录与 Claw 控制台一致。
```

### 第 5 步：封装 Claw SDK 收发信

要做：

```text
1. getMailClient(email)。
2. sendMail。
3. replyMail。
4. readMail。
```

验收：

```text
POST /api/send 可以从某个 vercel.x@claw.163.com 发信。
POST /api/reply 可以回复已收到的邮件。
```

### 第 6 步：实现监听管理器

要做：

```text
1. 服务启动时监听所有 active 邮箱。
2. 新建邮箱后启动新监听。
3. 删除邮箱后停止监听。
4. 收到邮件后保存 mails 表。
5. SSE 通知前端。
```

验收：

```text
给 vercel.2@claw.163.com 发一封测试邮件。
后端日志显示收到 mailId。
网页收件箱出现新邮件。
```

### 第 7 步：实现前端页面

要做：

```text
1. 邮箱列表页面。
2. 创建邮箱弹窗。
3. 删除确认弹窗。
4. 收件箱页面。
5. 邮件详情页面。
6. 发信/回复弹窗。
```

验收：

```text
可以通过网页完成创建、删除、查看、发信、回复。
```

### 第 8 步：Docker 化

要做：

```text
1. Dockerfile。
2. docker-compose.yml。
3. .env.example。
4. README.md。
```

验收：

```bash
docker compose up -d --build
curl http://localhost:3000/health
```

## 测试清单

创建邮箱：

```text
1. 创建 suffix=4。
2. 页面显示 vercel.4@claw.163.com。
3. DB 有 mailboxes 记录。
4. Claw 控制台也能看到该邮箱。
```

删除邮箱：

```text
1. 删除刚创建的邮箱。
2. 页面不再显示。
3. DB status 为 deleted 或记录被删除。
4. Claw 控制台不再显示。
```

收信：

```text
1. 外部邮箱发信到 vercel.2@claw.163.com。
2. 后端日志收到 mailId。
3. mails 表新增记录。
4. 网页收件箱刷新。
```

发信：

```text
1. 从网页选择 vercel.2@claw.163.com。
2. 发信到外部邮箱。
3. 外部邮箱收到邮件。
```

回复：

```text
1. 打开收到的邮件。
2. 点击回复。
3. 原发件人收到回复。
```

重启恢复：

```text
1. docker restart claw-email-webapp。
2. 服务从 DB 读取 active 邮箱。
3. 自动恢复监听。
```

## 风险和边界

Claw Dashboard 内部 API 风险：

```text
创建/删除邮箱接口来自网页控制台实际请求，不是公开文档承诺的 API。
如果 Claw 改前端接口、Cookie 策略或字段名，创建/删除功能需要调整。
```

Cookie 过期风险：

```text
CLAW_DASHBOARD_COOKIE 可能过期。
过期后创建/删除邮箱会返回 401 或登录错误。
需要重新登录 Claw 控制台并更新 .env。
```

API Key 权限风险：

```text
CLAW_API_KEY 是 workspace 级凭证。
泄露后可能允许读写邮箱。
必须只放后端环境变量。
```

多邮箱监听风险：

```text
每个邮箱一个 WebSocket 连接。
如果创建大量邮箱，可能遇到服务端连接数限制。
第一版建议限制 active 邮箱数量。
```

邮件 raw 格式风险：

```text
@clawemail/node-sdk 返回结构化 MailDetail，不一定返回完整 RFC822 raw 邮件。
如果需要完全兼容当前 cloudflare_temp_email 项目的 raw_mails 解析链，需要自行把 MailDetail 转成 MIME raw，或调整存储模型。
```

## 与现有 cloudflare_temp_email 项目的集成选择

方案 A：独立系统，不接入现有项目。

```text
优点: 最快落地，边界清晰。
缺点: 与现有 raw_mails、用户体系、Webhook 配置不共享。
```

方案 B：独立 Node bridge + 调现有 Worker 入站接口。

```text
优点: 可以复用现有项目的收件箱、Webhook、Telegram、AI 提取。
缺点: 需要给现有 Worker 增加一个受密钥保护的 /external/claw/inbound 接口。
```

方案 C：把 Claw 管理页面直接做进现有项目前端。

```text
优点: 一个系统管理所有邮箱。
缺点: 改动面更大，仍然需要额外 Node 服务负责 WebSocket 监听。
```

推荐先做方案 A，跑通后再评估是否接入现有项目。

## 第一版最小功能列表

必须实现：

```text
1. 后端启动。
2. SQLite 初始化。
3. GET /health。
4. GET /api/mailboxes。
5. POST /api/mailboxes。
6. DELETE /api/mailboxes/:id。
7. GET /api/mails。
8. GET /api/mails/:id。
9. POST /api/send。
10. POST /api/reply。
11. SSE /api/events。
12. Docker 部署。
```

暂缓实现：

```text
1. 附件永久保存。
2. 多用户登录。
3. 邮件搜索。
4. 批量删除。
5. HTML 富文本编辑器。
6. 与当前 cloudflare_temp_email 的深度集成。
```

## 资料依据

```text
1. Claw Email setup skill 页面:
   https://claw.163.com/skills-hub/skills/claw-email-setup

2. @clawemail/node-sdk npm 包:
   https://registry.npmjs.org/@clawemail%2Fnode-sdk

3. 当前浏览器会话中观察到的 Claw Dashboard 请求:
   POST /mailserv-claw-dashboard/api/v1/mailboxes
   POST /mailserv-claw-dashboard/api/v1/mailboxes/delete?id=<mailboxId>
   GET  /mailserv-claw-dashboard/api/v1/mailboxes?workspaceId=<workspaceId>
```

置信度：

```text
收信/发信/回复: High
创建/删除邮箱: Medium，因为依赖控制台内部接口
Docker 部署: High
与现有 cloudflare_temp_email 深度复用: Medium，需要额外改 Worker 入站接口
```
