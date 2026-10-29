# Climb 后端

当前进度（2026-10-29）：第二阶段整份快照、独立幂等、注册原子迁移、登录完整下载及服务器时间接口已实现。当前协议与前端接入方法见本文末尾“第二阶段”和[规格第6节](../../docs/10_账户与后端同步规格.md)。以下第一阶段实现及验证记录保留为历史；其中“尚未实现快照”等说明不代表当前接口。

2026-10-29：本地账户基础服务可启动。前端保持 `demo/web/` 原工程，本轮按用户明确要求在根目录 `backend/` 建立独立npm工程及唯一package-lock.json，没有修改前端源码和锁文件，没有连接云服务器或部署。

业务规则统一见[10账户与后端同步规格](../../docs/10_账户与后端同步规格.md)。06—09保留历史本地版本范围并标明当前阶段。完整快照与前端登录尚未接通；不要把基础账户接口的成功当作产品注册迁移或登录替换完成。

## 环境与安装

Node.js 24（实测24.14.0）、npm 11（实测11.11.0），Windows x64。依赖全部固定正式版本：Fastify 5.12.7、better-sqlite3 13.0.3、@fastify/cookie 11.1.5、@fastify/rate-limit 11.2.1、TypeScript 7.0.2、@types/node 24.19.2、@types/better-sqlite3 9.6.0。

已通过npm官方仓库核对版本；[Fastify 5要求Node20以上](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/)，[Cookie插件](https://github.com/fastify/fastify-cookie)及[限流插件](https://github.com/fastify/fastify-rate-limit)兼容Fastify5。采用[better-sqlite3正式发布](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3)的驱动，要求Node22以上；[官方构建矩阵](https://github.com/WiseLibs/better-sqlite3/blob/master/.github/workflows/build.yml)覆盖Windows和Node24。本机安装及加载成功，SQLite运行版本3.53.4，未安装额外系统组件。未来服务器仍需现场验证；若预编译包不可用，不自动安装C++编译工具或Python，先说明必要性。

```powershell
cd D:\job_haunting\product_manager\vibe_coding_product1\demo\backend
npm.cmd ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

将生成的随机值只填写到本机 `.env` 的SESSION_SECRET，不提交或发到日志。DATA_DIR填写项目目录以外的绝对私有目录，如 `C:\Users\你的用户名\AppData\Local\ClimbBackend`；必须由服务账户独占访问，Windows通过NTFS权限控制。不要放到前端public、网盘共享或静态服务目录。示例无秘密，程序不会替你生成固定密钥。更换密钥使已有会话失效。

```powershell
npm.cmd run dev
# 或编译后启动
npm.cmd run build
npm.cmd start
```

默认只监听 `http://127.0.0.1:3001`，Ctrl+C关闭。配置：HOST默认127.0.0.1；PORT默认3001；APP_ORIGIN默认http://127.0.0.1:5173；SESSION_SECRET至少32字节；DATA_DIR必填绝对私有路径；COOKIE_SECURE开发默认false；NODE_ENV=production强制HTTPS来源和Secure Cookie。生产反向代理、HTTPS和Windows服务管理未配置。无CORS，写请求必须携带匹配APP_ORIGIN的Origin；以后采用同源代理，本轮未修改前端代理。

## 目录职责

| 文件 | 职责 |
|---|---|
| src/config.ts | 环境校验，无默认密钥，生产安全约束 |
| src/database.ts | 打开SQLite、顺序迁移、外键、WAL、事务基础 |
| src/auth.ts | 输入规则、scrypt密码、参数化账户和会话访问、会话摘要 |
| src/app.ts | 路由、来源与权限检查、统一错误、限流、Cookie、脱敏日志 |
| src/server.ts | 启动和进程退出关闭 |
| test/backend.test.ts | 隔离临时数据库、注入时间的服务及存储测试 |

accounts、sessions、business_snapshots、idempotency_records独立存储。快照和幂等表仅建立存储基础，尚未提供写入服务；幂等记录不属于可被快照覆盖的数据。迁移在启动事务中执行，较新数据库版本拒绝打开，不重建或清空。

## API与使用边界

GET /health；POST /v1/auth/register、/login、/logout；GET /v1/auth/session。接口详情、输入和统一错误见10。用户名统一小写，3—32位ASCII字母数字下划线；密码12—128个UTF-16代码单元、最多512 UTF-8字节，不含控制字符，不裁剪空格。注册必须传 `acknowledgeNoRecovery: true`，确认无邮箱、密码找回或人工重置。

登录和注册用HttpOnly、SameSite=Strict会话Cookie，生产Secure，固定7天；会话令牌只在Cookie中下发，响应不返回令牌。退出只撤销当前会话。未知用户与错误密码统一错误。认证每IP每分钟10次，全局每分钟120次，单进程限流，重启计数丢失；不信任转发IP。请求体限制16KiB。日志不记录正文及查询串，Cookie与认证头脱敏。

自己的GET/PUT /v1/accounts/:accountId/snapshot返回501；无会话401、跨账户403。游客迁移请求会被拒绝，登录不返回假快照，不执行前端数据切换。注册目前仅独立基础账户，第二阶段需将账户创建、游客快照导入和幂等写入合为事务，之后才允许前端调用产品注册入口。

## 实际验证

2026-10-29，本机实际执行：

- `npm.cmd run typecheck`、`npm.cmd run build`通过。
- `npm.cmd test`：5组全部通过，覆盖重复注册（含大小写同名）、错误密码及不存在用户、会话过期、退出撤销、跨真实账户访问、服务重开保留会话、密钥轮换失效、来源检查、Secure/HttpOnly/SameSite、限流、无找回确认、拒收业务快照、安全配置、顺序迁移重开、拒绝未知新版本、事务回滚和测试数据库隔离。
- 权限条件反转的变异检查使两组隔离测试失败，恢复正式条件后5组重新通过。
- `npm.cmd ls --depth=0`无缺失依赖或对等依赖错误；安装审计0项漏洞。
- 编译产物通过 `npm.cmd start`输出监听127.0.0.1:3001日志。独立HTTP请求受沙箱套接字限制；沙箱外重新启动服务的权限请求被用户拒绝，因此未完成实际端口HTTP验收。健康检查、注册、会话检查与退出已通过Fastify注入请求测试。启动验证使用TEMP独立目录和进程内随机密钥，不使用用户日常业务数据；检查进程随后关闭。

2026-10-29补充验证（用户明确授权执行）：在沙箱外以编译产物启动独立子进程，监听 `127.0.0.1:31391`，真实HTTP请求18项全部通过：健康检查、注册、Cookie属性与禁止缓存、大小写重复注册、错误密码、有效及缺失会话、第二账户注册、跨账户GET及PUT拒绝、自己的未实现快照返回501、缺失Origin拒绝、服务重开保留会话、持久化会话过期拒绝、登录、退出、退出后旧会话拒绝，以及日志不包含密码、密钥或会话Cookie。过期场景仅在停止验证服务后修改隔离数据库，不等待真实7天到期。

首次HTTP检查18项均通过，但临时验证脚本重复关闭已退出子进程时误报超时；修正脚本的退出状态判断后完整复跑，18项通过且退出码0。本次未创建.env，密钥只在进程环境中生成，使用系统临时目录的独立数据库；子进程已停止，复跑数据自动删除，首次残留的专用临时数据库目录经核对后单独删除。未修改源码、锁文件或前端文件。本次只补实际HTTP验收，未重复执行此前已通过的类型检查、构建和自动测试。

初轮发现的TypeScript错误及Node直接执行参数属性的兼容问题已修复并复跑。本轮未运行浏览器和前端测试，未验证云服务器、生产HTTPS或完整同步行为。测试临时目录退出后清理；启动检查目录 `%TEMP%\climb-backend-local-phase1`与测试数据库隔离，包含专用测试账户，不代表产品预置数据。

## 下一阶段入口

实现完整快照白名单、引用及状态一致性校验、账户归属重映射、注册迁移原子事务、登录完整快照下载、同账户整份覆盖和独立幂等处理。凭据、会话与权限永远不能由快照改变；operationId复用不同请求须冲突。覆盖不提供旧副本保护，可能丢记录、恢复删除内容或降低云端历史最高纪录，不能保证跨设备唯一任务。前端接入、缓存替换、断网只读及校时另阶段完成。

## 第二阶段：整份快照、幂等与服务器时间

2026-10-29完成，沿用根目录backend工程，无新增依赖，无前端源码、前端账户页面或锁文件改动，无服务器部署。上一节“下一阶段入口”现作为第一阶段历史计划保存；其中后端接口已经实现，浏览器集成仍待后续阶段。

### 当前协议

- `PUT /v1/accounts/:accountId/snapshot`接受 `{schemaVersion:1,operationId,snapshot}`，整份替换同账户快照。操作ID为16—100位字母数字下划线或短横，建议UUID。没有expectedRevision检查、合并或多设备协调。
- `GET /v1/accounts/:accountId/snapshot`返回完整 `{schemaVersion,revision,updatedAt,snapshot,serverTime}`。会话决定权限，跨账户403，无会话401。
- 注册现在要求原有凭据及 `initialData:{schemaVersion:1,operationId,clientTime,snapshot}`，账户、迁移后快照、幂等记录及会话同事务提交。成功201返回完整迁移快照；同ID同正文重试不重复迁移、不覆盖后来的数据，并重新签发安全会话Cookie。空游客也须明确提交空快照。
- 登录成功200返回完整云端快照；缺失或损坏返回503 SNAPSHOT_UNAVAILABLE，不签发新会话。真正业务空状态返回200及完整空结构，不以null或空响应掩盖读取失败。
- `GET /v1/time`要求会话，只返回schemaVersion及服务器接收/发送毫秒时间，不下载业务数据。`GET /v1/auth/session`也不下载快照。

快照包含chains、rounds、tasks、decisions、precedents、roundPrecedents、interruptions、settlements、taskContents、climbRecords和settings，共11个完整数组。保留实体id及业务时间，排除所有ownerId/accountId、metadata、occupancy、凭据、会话和测试工具；未知字段拒绝。occupancy由唯一未完成任务派生，后续本地导入时建立。声音设置必须一条，攀登纪录最多一条。快照最多20000条，请求体最多2MiB，不截断；业务字段和关联、任务状态、累计、结算、轮次及单份历史一致性在保存前校验。

保存及相关幂等写入同一SQLite事务；同账户同ID同内容返回原revision和updatedAt，不再次执行，同ID不同内容409。对象键排序后摘要，数组顺序属于内容。传输serverTime和重试注册的Cookie/会话到期时间可以变化；令牌不写入幂等结果。幂等记录独立保存，当前无自动过期清理；注册摘要使用环境密钥HMAC，不保存明文密码，密钥轮换后原注册请求重试可能冲突，可用正常登录恢复。

数据迁移user_version=3只为第一阶段旧账户补明确空快照，保留已有数据；日后读取不到快照则报503，不临时补空。无真实数据迁移或清库操作用于验证。

### 错误和恢复

结构/版本请求错误400，权限401/403，幂等或用户名冲突409，体积413 PAYLOAD_TOO_LARGE，业务快照422 INVALID_SNAPSHOT，限流429，快照读取不可用503，内部写错误500。完整错误列表和可复制请求见[规格第6节](../../docs/10_账户与后端同步规格.md)。事务写入失败不部分生效；请求超时、5xx或响应丢失时客户端不能猜测是否提交，保留相同operationId和完全相同正文重试。原ID重试重放原结果；主动使用新ID重新上传旧快照仍会覆盖新快照。

不建立离线待上传队列。结果未知时停止后续写操作，通过原请求恢复确认。整份覆盖可能丢失记录、恢复删除内容、降低云端历史纪录，不保证跨设备唯一任务；服务端结构校验不提供完整防作弊，也不是可靠实时双向同步。

### 时间基准和前端接入方式

新增 `src/snapshot.ts`管理快照格式、校验、存储、幂等及游客迁移；`src/errors.ts`管理统一业务错误；`src/clock-protocol.ts`提供无网络副作用的时间估算函数。原auth/app/database扩展现有边界，无重复工程。

后续Repository适配器负责导出11个数组并剥离本机归属字段；收到成功响应后用本地单一事务导入全量数据，重建当前认证账户归属与任务占用。已有账户登录成功下载后才替换游客；注册使用服务器返回的迁移快照，失败保留游客。退出成功才回空游客。重开只检查session并请求time，使用本地缓存，不自动下载业务数据。

登录/重开校时记录本机发送及接收墙钟和单调时钟，采用服务器接收/发送时间扣除处理时长，网络往返的一半估计单程延迟。可取少量最低延迟样本；拒绝超过10秒或时间跳变样本。展示时钟锚定服务器估算值并以单调时间推进，不逐秒请求。校时失败或会话失效保持只读，不静默切到游客时间；单调时钟重置后重新校准。纯函数已测试，这些前端行为尚未接入。

注册捕获clientTime及业务状态后冻结迁移请求和写操作；服务端保留捕获时的有效时长/预约余量，转换未完成任务的运行锚点；暂停/判定保持冻结，已结算历史不改。捕获至提交是迁移交接窗口，不额外增加未知传输时间；提交后按服务器时间继续。若失败恢复原游客时间基准；结果未知不能修改迁移正文，先重试确认。校时误差和传输非对称仍存在。

### 第二阶段实际验证结果

在demo/backend目录执行：

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
```

2026-10-29最终类型检查、构建通过；测试15组全部通过。实际SQLite文件位于每组专用临时目录；真实HTTP测试监听127.0.0.1的系统随机空闲端口，使用独立Fastify服务和fetch，不操作浏览器或正式服务器。沙箱首次因EACCES阻止HTTP连接，按权限流程在沙箱外运行后全部通过。

- 保留第一阶段认证、安全配置、迁移重开、数据库隔离与事务测试，按第二阶段现行注册及快照协议更新断言。
- 新增test/snapshot.test.ts：重复请求、同ID异内容、提交后丢弃响应重试、旧副本用新ID覆盖、幂等记录保留、跨账户、缺失关联、非法归属字段、重复任务、累计不一致、请求体上限、注册并发重试及改变密码冲突。
- 使用真实SQLite触发器令幂等写入中途失败，确认注册不留下账户/快照/会话，快照替换失败保留原revision和数据；去除故障后原ID可成功提交。
- 游客专注、预约未到期/已到期、取消待判定、正式待判定及暂停的时间基准转换通过；全量历史往返验证已结算任务、中断和结算不重算，声音参与返回。
- 真正空数据与损坏快照读取失败区分通过，登录读取失败不签发会话；延迟估算、墙钟跳变、单调时钟重置及异常样本拒绝通过。
- 新增test/http.test.ts：真实HTTP注册响应及保存响应主动丢弃后重试，验证唯一账户、revision不重复、冲突、真实SQLite失败回滚、旧副本覆盖、登录完整下载及time/session无业务下载。
- 审查时反转幂等内容比较条件，3组用例按预期失败；恢复条件后加入失败轮、历史新轮和允许取消的一致性用例，最终15组全部通过。

初轮请求体上限测试因未设置JSON Content-Type先收到415，修正测试请求后413断言通过。验证服务均在finally关闭，数据库连接关闭后清理隔离目录；最终只读检查未发现本轮专用测试目录残留。未创建.env、临时密钥文件、截图或独立报告。保留源码、可复用测试文件及正常dist构建产物；它们属于交付工程，不是临时验证目录。

尚未验证或实现：浏览器全量替换事务、账户页面、自动上传、断网只读交互、浏览器时钟接入、生产HTTPS及云服务器。后续从统一Repository完成这些适配，不能把当前后端接口通过视为浏览器同步已完成。

## 工程位置更新（2026-10-29）

现有后端已整体移至 demo/backend/，与 demo/web/ 并列；源码、测试、node_modules、唯一package-lock.json、配置示例和既有dist均随目录保留，未重新初始化、未重装依赖。本文第一／第二阶段记录中的根目录backend位置为迁移前历史，不再作为启动位置。

从项目根目录先进入 demo/backend/ 再运行本文命令。数据库DATA_DIR继续使用项目外的私有绝对路径，本次不移动或删除数据库、不更换密钥。配置校验改为根据配置模块位置定位整个项目根目录，不依赖终端cwd，并继续拒绝项目内（含demo/、docs/、outputs/）的数据目录。

本次未运行测试、类型检查、构建、服务或浏览器验证。新增目录校验回归用例，覆盖更换终端工作目录后仍拒绝项目内目录及以双点开头的项目内子目录，此用例尚未执行。保留的dist为迁移前产物；使用npm.cmd start前须先由用户运行npm.cmd run build以生成新的目录校验代码，或直接用npm.cmd run dev运行最新源码。已有15组测试通过记录不代表本次迁移已通过验证。

迁移后由用户按需执行：

```powershell
cd D:\job_haunting\product_manager\vibe_coding_product1\demo\backend
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
# 已配置环境变量或本机.env时再启动
npm.cmd start
```
