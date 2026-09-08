# 植物养护 — Supabase 部署说明

## 0. 前置

- 在 [supabase.com](https://supabase.com) 注册并**新建项目**（免费即可），记下项目 URL 和 anon key。

## 1. 建表

打开 Supabase 项目的 **SQL Editor**，执行 [migrations/0001_init.sql](./migrations/0001_init.sql) 的全部内容。

这会创建：

- `plants` 表（植物档案）
- `events` 表（养护事件）
- RLS 策略（anon 可读写，靠私密 URL 保护）
- `plant-photos` 存储桶（图片）

## 2. 前端环境变量

在 `art-portfolio` 项目根目录创建 `.env`（可参考 `.env.example`）：

```
PUBLIC_SUPABASE_URL=https://xxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=xxx
```

- 本地开发：`.env` 即可，`npm run dev` 会自动读取。
- Vercel 部署：在 Vercel 项目 **Settings → Environment Variables** 里添加同名变量。

## 3. 部署定时推送函数

### 方式 A：Supabase Dashboard（推荐，无需装 CLI）

1. 进入 **Edge Functions** → 新建函数，命名 `send-watering-reminder`。
2. 粘贴 [functions/send-watering-reminder/index.ts](./functions/send-watering-reminder/index.ts) 的内容。
3. 在该函数 **Settings → Secrets** 添加 `SENDKEY`（Server 酱的 SENDKEY）。
4. 部署。

### 方式 B：Supabase CLI

```sh
npx supabase login
npx supabase link --project-ref <你的项目ref>
npx supabase functions deploy send-watering-reminder
npx supabase secrets set SENDKEY=<你的SENDKEY>
```

## 4. 配置定时（cron）

给函数添加 schedule。**时区是 UTC**，北京时间早上 8 点 = UTC 0 点：

```
0 0 * * *
```

- Dashboard 方式：函数页面的 **Schedules** 里添加。
- CLI 方式：在 `supabase/config.toml` 里加：

```toml
[functions.send-watering-reminder]
schedule = "0 0 * * *"
```

## 5. 测试

- 在 Dashboard 的函数页面点 **Invoke**（或本地 `npx supabase functions serve`），确认微信收到 Server 酱推送。
- 打开植物页面 `你的域名/garden`，添加植物、记录浇水、上传照片，确认数据落库、跨设备同步。
