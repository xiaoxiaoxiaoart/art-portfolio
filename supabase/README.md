# 植物养护 — Supabase 部署说明

## 0. 前置

- 在 [supabase.com](https://supabase.com) 注册并**新建项目**（免费即可），记下项目 URL 和 anon key。

## 1. 建表

打开 Supabase 项目的 **SQL Editor**，依次执行 [migrations](./migrations) 中的 SQL 文件。

这会创建：

- `plants` 表（植物档案）
- `events` 表（养护事件）
- RLS 策略（anon 可读写，靠私密 URL 保护）
- `plant-photos` 存储桶（图片）

### 已有花园升级到今日养护

1. 在 SQL Editor 中执行 [0004_watering_schedule.sql](./migrations/0004_watering_schedule.sql)。它会根据现有浇水事件重算「上次浇水」，并从旧版固定格式的推迟日记恢复推迟时间。缺少浇水事件的植物会显示「未记录」。
2. 用仓库中的 [提醒函数](./functions/send-watering-reminder/index.ts) 更新已部署的函数。现有项目使用 `dynamic-endpoint`，沿用已有名称和定时任务。
3. 部署新版前端。页面和提醒函数都读取 `plants_with_watering_schedule`，因此数据库迁移要先执行。三步请在同一次更新中完成。

「明天再看」以北京时间的自然日为准。微信仍在每天北京时间 8 点检查，有待办才发送。

## 2. 前端环境变量

在 `art-portfolio` 项目根目录创建 `.env`（可参考 `.env.example`）：

```
PUBLIC_SUPABASE_URL=https://xxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=xxx
```

- 本地开发：`.env` 即可，`npm run dev` 会自动读取。
- Cloudflare Pages 部署：在项目的环境变量设置中添加同名变量。正式站的 `/garden-api` 只读转发植物列表和养护记录，只连接此花园的 Supabase 项目，并将页面的公开密钥交给 Supabase 校验。迁移到另一个 Supabase 项目时，同步更新该函数的项目地址。

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

## 5. 启用拍照识别

1. 在 [Pl@ntNet 开发者后台](https://my.plantnet.org/) 获取 API 密钥。
2. 在本项目 Supabase 后台的 **Edge Functions → Secrets** 添加 `PLANTNET_API_KEY`，并添加 `GARDEN_IDENTIFICATION_CODE` 作为花园的识别码。识别码使用随机值，例如用 `openssl rand -hex 16` 生成。两个值都只存到服务端。
3. 部署 [identify-plant](./functions/identify-plant/index.ts)。在后台将该函数的 **Verify JWT** 关闭，或使用以下命令部署。花园目前没有账户登录，函数会校验识别码，通过后才向 Pl@ntNet 发送照片。

```sh
npx supabase functions deploy identify-plant --project-ref <项目引用> --no-verify-jwt
```

4. 部署前端。在「添加植物」中拍照或选图，按页面提示输入识别码，选一个候选并检查填入的名称和学名。照片可继续用作封面。此功能无需新增数据库字段或前端环境变量。

选中候选后，表单优先填中文名。Pl@ntNet 和内置资料未提供中文名时，前端按学名查询 [GBIF](https://techdocs.gbif.org/en/openapi/v1/species)。常见盆栽的养护建议按学名匹配，参考 [NC State Extension](https://plants.ces.ncsu.edu/) 、[UMN Extension](https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/houseplants/spring-houseplant-care) 和 [新加坡国家公园局植物资料](https://www.nparks.gov.sg/florafaunaweb/)。浇水天数是可编辑的检查提醒起点，表单保留手填的养护值。

## 6. 测试

- 在 Dashboard 的函数页面点 **Invoke**（或本地 `npx supabase functions serve`），确认微信收到 Server 酱推送。
- 打开植物页面 `你的域名/garden`，添加植物、记录浇水、上传照片，确认数据落库、跨设备同步。
