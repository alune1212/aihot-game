# 三角洲行动国服交易行价格

2026-11-04 查过的来源。只记公开接口实际返回了什么，没有使用登录态、别人的密钥，也没有绕过访问限制。

结论：官方 AMS 图表 `352143` / `YWRywA` 可以匿名读到枪和配件的现价。本站用这个目录。下面的第三方要么要密钥，要么不是现价，要么没有稳定的机器可读接口，都没有接进抓取。

## 官方

都是 `POST https://comm.ams.game.qq.com/ide/`，表单字段 `iChartId`、`iSubChartId`、`sIdeToken`、`source=2`、`method`、`param`。`comm.ams.game.qq.com/robots.txt` 是腾讯的 404 页面，不是一份 robots 规则。这是官网改枪台已经在用的活动接口，不是去爬网页。

| 来源 | 地址 / 方法 | 登录 | 字段 | 更新 | 覆盖 | 稳定性 |
|---|---|---|---|---|---|---|
| 现行改枪台图表 | `352143` / `YWRywA`，`dfm/object.price.latest`，`param={"objectID":[id]}` | 不需要。2026-11-04 匿名返回 `ret 0`，M4A1（`18010000001`）的 `avgPrice` 为现价 | `dataMap[id].avgPrice`。没有名称 | 请求当时的交易行均价 | 知道物品 id 就能问。本站原来的 `loadouts.prices` 只问方案里出现过的 id | 和方案列表同一张图表。`ret` 101 / 107 表示改回必须登录 |
| 现行物品目录 | 同一图表，`dfm/object.list`，`param={"primary":"gun"\|"acc","second":"","objectID":""}` | 不需要。同日匿名读到完整列表 | `list[]` 的 `objectID`、`objectName`、`avgPrice`、`primaryClass`、`secondClassCN`。均价 0 是不能上架 | 请求当时的均价，接口不给历史 | 枪 `gun` 68 件全有价；配件 `acc` 576 件全有价。护甲 `protect` 98 件里 85 件有价，弹药 `ammo` 113 件里 104 件有价。这次只收枪和配件 | 一次返回整类，没有分页字段。收集品那一类超过 25 秒还没下完，没有收 |
| 旧图表 | `316969` / `NoOapI` | 不登录返回 `ret 101` | — | — | — | 不用。若现行图表也改回登录，站长自己提供 `DF_QQ_COOKIE`（`openid`、`access_token`、`acctype`、`appid`），不要把 cookie 提交进仓库 |
| 价格历史方法 | `dfm/object.price.history` | 未带登录 | 同日返回 `ret -201`（访问人数太多 / 接口调用失败），不是一份历史 | — | — | 不重试这条。历史由本站每次抓取自己留下 |
| 官网 / 掌上三角洲 | `df.qq.com` 的 robots 同样是 404 页面。公开资料里小程序物价走的就是上面的 AMS `ide/` | 现行图表不需要 | 同目录 | 同目录 | 同目录 | 没有找到另一条不登录的小程序主机 |

`dfm/object.list` 的枪械响应里还有 `relateMap`，里面是弹药的名称和均价。这一轮不写进库。

## 第三方（都没有接）

| 来源 | 地址 | 登录 | 字段 | 更新 | 覆盖 | 为什么不用 |
|---|---|---|---|---|---|---|
| DFTTK 物价文件 | `https://dfttk.com/data/v3/manifest.json` 指到的 `economy/market-prices.json`。robots 允许全站 | 不需要 | 物品 id 到价格，没有名称。`currency` 是 `gameCurrency`。`source.method` 写着 `dfm/object.price.latest` | `priceVersion` 停在 2026-07-24。文件带一年的 immutable 缓存 | 587 个 id，含枪和配件，但是冻结快照 | 不是现价。拿它当现价会把四个月前的数字标成今天 |
| 鸟兽兽 | `https://nss.seoml.com/price`（价格曲线）、`/market`、`/items`。robots 允许这些路径，`Crawl-delay: 1`，禁止 `/admin/`、`/login/`、`/sync`、`/post`、`/search` | 页面公开 | `/price` 是 HTML，正文里没有价格 JSON。`/market` 当次返回「查询失败」。`/items` 只标可交易，不标现价 | 制造页写每 10 分钟，那是 HTML 表 | 看页面，不是目录接口 | 没有稳定的匿名 JSON。不爬 HTML |
| 三角洲数据帝 / 小涛查 | `https://orzice.com/work/`，文档在 Apifox。`orzice.com/robots.txt` 禁止 `/api/` | 要他们的 token，按请求包计费 | 物品 id、名称、最新价、分钟级曲线 | 他们写 1–10 分钟 | 枪、配件、弹药等都有 | 要站长自己的密钥。文档示例里的 Bearer 不能拿来用 |
| DeltaForcePrice | `https://github.com/orzice/DeltaForcePrice` 的 `price.json` | 仓库公开，但没有许可证 | id、名称、价格、分类 | 已于 2026-01-11 停止更新 | 停更前含枪、配件、弹药等 | 无许可证，且已停更 |
| 数据帝的再封装 | `df-api.shallow.ink` 等「官方物品最新价格」 | 要封装方的 API key。响应里能看到他们自己的登录信息 | 转述 AMS 的 `avgPrice` | 取决于他们的账号 | 取决于他们的账号 | 本站直接调 AMS，不经过这层，也不使用公开文档里的示例密钥 |
| 三角洲情报台 | `https://delta.shopping/market`。robots 写 `Content-Signal: search=yes, ai-train=no, use=reference` | 页面公开 | 页上写数据来自数据帝，缓存约 5 分钟 | 约 5 分钟 | 转述 | `use=reference`，不把整站行情再抓一份 |
| 备战助手 | `https://sjz.peiwandi.cn/market/`。robots 允许页面，禁止 `/scripts/` | 页面公开 | 渲染后的行情页 | 页上写随交易行更新 | 页面上的物资 | 没有单独的价格接口。官方目录已经够用 |

## 本站怎么用

开关 `LOADOUT_PRICE_AMS_ENABLED=true`，并且 `COLLECT_ENABLED=true`。默认关。任务 `loadouts.prices.catalog`，上海时间每小时第 25 分，只请求枪和配件两类。

表 `loadout_price_history` 留下每次抓到的名称、物品 id、价格、来源和 `fetched_at`。同一物品同一来源同一次抓取只记一行。枪加配件大约 650 行，一小时一轮。`loadout_item_prices` 仍是最新价，供现在的方案页显示总价；已经是官方源的行，不会被别的来源盖掉。

`GET /api/loadouts/:id/cost` 返回这条码的合计、覆盖率和缺了哪几件。单枪页只在覆盖率不到 100% 时多写「价格覆盖」。
