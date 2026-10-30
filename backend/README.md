# Climb 后端

2026-10-30交接：按用户要求仅在本机重新打包，上传和云服务器配置由用户执行。最新包为[climb-20261030-ui-release.zip](../../outputs/deploy/climb-20261030-ui-release.zip)，包含首页账户图标及备案页脚；首次手工部署按本文末尾“用户手工部署”执行。此前发布包及验收记录保留历史。

第四阶段（2026-10-29）已完成本机全流程验收、问题修复和隔离HTTPS部署演练，交付Windows x64发布包；当前配置、运行与运维以文末“第四阶段”一节为准。下文前三阶段记录保留历史，不代表尚未实现当前已有能力。没有连接正式服务器或修改DNS，真实Windows Server 2025的服务权限、重启恢复及2核2GB资源条件仍待第五阶段验证，尚不能宣布正式上线就绪。

当前进度（2026-10-29）：第二阶段整份快照、独立幂等、注册原子迁移、登录完整下载及服务器时间接口已实现。当前协议与前端接入方法见本文末尾“第二阶段”和[规格第6节](../../docs/10_账户与后端同步规格.md)。以下第一阶段实现及验证记录保留为历史；其中“尚未实现快照”等说明不代表当前接口。

第三阶段更新：现有前端已接通本地后端账户、整份保存、未确认请求恢复与校准Clock，实际结果及当前启动方式见本文末尾“第三阶段联调”。尚未部署公网服务；前述未接通说明作为历史保留。

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

## 第三阶段联调（2026-10-29）

前端已通过统一CloudRepository接入现有API：注册带游客快照、登录完整下载、已登录重开仅session/time、修改整份覆盖及退出回空游客。前端候选和原操作ID先持久保存，服务器确认后才原子更新本机正式状态；响应丢失或本地事务失败均通过原请求恢复，不创建离线业务队列。前端接入细节见[web README后端接入第三阶段](../web/README.md)，协议及覆盖风险仍以[10](../../docs/10_账户与后端同步规格.md)为准。

### 普通本地使用

继续在demo/backend创建本机.env或设置进程环境，使用项目外私有DATA_DIR、随机SESSION_SECRET及默认PORT=3001，APP_ORIGIN=http://127.0.0.1:5173，SESSION_COOKIE_NAME=session。前端在demo/web运行 `npm.cmd run dev -- --port 5173 --strictPort`。Vite的/api同源代理转至3001，后端不开放CORS。若使用前端4173构建预览，须将APP_ORIGIN同步改为http://127.0.0.1:4173；正式同源代理及HTTPS尚未部署。

```powershell
cd D:\job_haunting\product_manager\vibe_coding_product1\demo\backend
npm.cmd run dev
# 或先npm.cmd run build，再npm.cmd start
```

新增可选配置SESSION_COOKIE_NAME，默认session，只接受1—64位字母数字下划线或短横。测试后端必须使用climb_test_session；同主机不同端口仍共享Cookie命名空间，仅换端口不足以隔离会话。手工测试另用私有测试DATA_DIR及新密钥，PORT=3002、APP_ORIGIN=http://127.0.0.1:5174，对应前端dev:test；不要复用普通数据库、Cookie名或密钥。

测试构建使用独立/test-api前缀固定代理至3002，普通构建使用/api至3001；Vite开发与构建预览均保持此前缀映射，避免测试预览误用普通后端。

自动Chrome/Edge验证由demo/web/integration/run-browser.mjs管理：先构建后端，再从demo/web运行 `node integration/run-browser.mjs`。脚本直接启动独立3002后端、随机密钥、临时SQLite和独立测试Cookie，测试前端为5184；结束关闭服务、删除临时数据库、截图和失败上下文。该入口没有修改普通服务器时钟、增加生产测试路由或接触云服务器。

### 本轮实际结果和边界

- 后端typecheck、build、17组测试通过，包含真实SQLite事务、幂等、HTTP、迁移后目录校验及Cookie隔离；未更换依赖或锁文件。
- 前端typecheck、普通与测试构建通过；81项Vitest测试通过，新增8项跨前后端测试直接使用本地SQLite及隔离IndexedDB。
- Windows Chrome和Edge各3项、共6项联调通过，覆盖任务中注册、声音保存、重开缓存、不下载校时、离线只读、丢失上传响应后刷新恢复、登录替换、退出及两设备覆盖、待判定任务中换号。会话过期和时基细节另由跨前后端测试验证。
- 服务器写成功、浏览器未收到响应与服务器事务失败均已测试：前者返回原幂等结果，后者不部分提交；前端保留未确认候选，重试不重新结算或生成操作ID。
- 联调首轮发现前端原生fetch绑定问题及测试标题断言错误，修复后复跑。沙箱限制本机HTTP访问，实际网络测试按权限流程在沙箱外完成。

本轮没有使用日常账户、实际用户数据或正式服务器。所有本轮验证服务已关闭，专用临时目录已清理；源码、可复用测试及正常构建产物保留。现有浏览器全站回归没有全部重跑，未验证公网、生产TLS、Windows服务管理及真实多设备网络环境。

下一阶段准备正式运行环境与上线前联调，需单独落实HTTPS、同源代理、Windows进程管理及私有数据目录权限。现行同步仍是显式下载＋整份覆盖，不是可靠实时双向同步，不保证跨设备唯一任务或历史纪录单调保留。

清理核对：截图复核曾留下等待终端输入的脚本进程，已关闭并修正脚本的stdin暂停处理；最终核对本轮验证进程0个、3002/5184监听0个、专用临时目录0个。

## 第四阶段：全流程验收与Windows部署准备（2026-10-29）

### 交付和运行方式

发布包为[climb-20261029-stage4-release.zip](../../outputs/deploy/climb-20261029-stage4-release.zip)，旁边提供SHA256校验文件；解压后根目录为同名版本目录，包含普通前端web、后端dist和55项生产依赖、唯一后端锁文件、operations脚本、release.json及逐文件SHA256SUMS.txt。适配Windows x64及Node24，不包含Node安装程序、私钥、数据库、测试前端或日常账户。后端新增部署能力没有增加npm依赖。首次离线打包受沙箱权限阻止，授权后使用原锁文件离线安装成功，npm审计0项。

本机重新生成新版本，不能覆写已有版本目录：

```powershell
# 从项目根目录运行；本机需Node24、现有npm缓存和Windows x64驱动
.\demo\deploy\Build-Release.ps1 -ReleaseName climb-20261029-next
Get-FileHash .\outputs\deploy\climb-20261029-stage4-release.zip -Algorithm SHA256
```

构建均在本机完成。生产由一个Node进程直接提供HTTPS、普通静态前端和/api/v1接口，同源运行，无Vite、CORS或额外代理组件；原/v1接口保留。只允许清单内前端资源，未知路径404，不提供目录浏览。数据库、环境文件及后端路径不能作为静态资源下载。CSP限制同源脚本和连接，禁止框架嵌入；HTTPS启用HSTS，Cookie为Secure/HttpOnly/SameSite=Strict。开发启动仍可沿用第三阶段两终端方式。

建议目标布局（本轮没有创建目标服务器目录）：

| 路径 | 内容与访问 |
|---|---|
| C:\Climb\releases\版本号 | 程序及普通前端，服务账户只读 |
| C:\Climb\operations | 从发布包operations首次复制的稳定启动、切换和任务脚本 |
| C:\Climb\config | current.json、runtime.env及tls私钥/证书，仅管理员和服务账户读取 |
| C:\Climb\data | SQLite及WAL/SHM，服务账户修改权限，私有持久化 |
| C:\Climb\logs | 有界日志，服务账户修改权限 |
| C:\Climb\backups | 一致性备份，仅授权运维读取/修改；另行落实异机备份 |

程序更新只新建release，不覆盖data/config/logs/backups。DATA_DIR拒绝项目内目录；解析现存父目录真实路径，拒绝静态目录内数据、日志或TLS文件及目录链接绕过。DATA_DIR与LOG_DIR不能相互包含。操作系统NTFS权限仍须管理员配置，路径检查不能替代ACL。

按包内runtime.env.example填写私有runtime.env：SESSION_SECRET随机至少32字节；DATA_DIR、LOG_DIR、TLS_KEY_FILE、TLS_CERT_FILE均绝对路径，TLS_KEY_PASSWORD仅加密PEM需要；APP_ORIGIN须与最终HTTPS主机及端口完全一致。公认证书需覆盖该域名；证书续期替换私有PEM后重启，当前没有自动签发/续期。生产要求WEB_ROOT、LOG_DIR和TLS完整配置，不会降级HTTP。current.json按current.example.json填写ReleaseDir、EnvFile及已安装Node24 x64的NodeExe绝对路径，不存密钥。WEB_ROOT由启动脚本固定到该release/web，堆上限256MiB。

```powershell
# 完成私有配置与ACL后，前台排错启动；Ctrl+C停止
& C:\Climb\operations\Start-Climb.ps1 -ControlFile C:\Climb\config\current.json
# 先预览任务；实际注册仅由第五阶段授权后的管理员执行
& C:\Climb\operations\Register-StartupTask.ps1 -ControlFile C:\Climb\config\current.json -PreviewOnly
# & C:\Climb\operations\Register-StartupTask.ps1 -ControlFile C:\Climb\config\current.json
# Start-ScheduledTask -TaskName Climb
```

采用Windows内置任务计划后台运行：开机触发、LOCAL SERVICE有限权限、忽略重复实例、异常退出每分钟重启（最多999次）、取消运行时长限制，PowerShell隐藏窗口。属于后台自动启动方案，未实现Windows SCM服务。具体参数依据[Microsoft任务计划文档](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset?view=windowsserver2025-ps)。最终对公网监听HOST、443防火墙及证书部署均留到第五阶段；本轮只用127.0.0.1、自签临时证书，不写系统证书信任库。

### 更新、迁移、回退、备份恢复

1. 校验压缩包及解压后的SHA256SUMS，将新版本解压至新的releases目录，保留旧版。先在隔离副本验证新版本和迁移；不要在服务器运行Vite/npm构建或覆写旧版。
2. 停止任务并确认Node子进程、监听端口均退出；任务停止不等于已确认子进程退出。对当前数据库做一致性备份并检查，记录备份路径和当前版本，不能仅复制活跃的climb.sqlite而忽略WAL。
3. 运行Switch-Release.ps1，原子切换current.json并保留.previous文件；必须确认停服后传-ServiceStopped。重新启动，检查/health、证书、登录及数据。顺序迁移在启动事务中执行；失败保留原数据库和错误，禁止删库掩盖。较新数据库拒绝被旧版打开。
4. 同schema版本应用回退：停服→备份现状→切回旧release→启动复核。跨schema回退不能仅换程序：先保留故障数据库，再将升级前备份恢复至新空目录，修改私有DATA_DIR后用匹配旧程序启动；备份后产生的数据不会自动合并，需明确恢复损失范围。禁止自动降级、清库或覆盖现有数据库。

```powershell
$node = 'C:\Program Files\nodejs\node.exe'
$maintenance = 'C:\Climb\releases\climb-20261029-stage4-release\backend\dist\maintenance.js'
& $node $maintenance backup C:\Climb\data\climb.sqlite C:\Climb\backups\before-update.sqlite
& $node $maintenance check C:\Climb\backups\before-update.sqlite
& C:\Climb\operations\Switch-Release.ps1 -ControlFile C:\Climb\config\current.json -ReleaseDir C:\Climb\releases\新版本 -ServiceStopped
# 恢复只允许新目录，绝不覆盖已有sqlite、WAL或SHM
& $node $maintenance restore C:\Climb\backups\before-update.sqlite C:\Climb\data-restored-new
```

maintenance使用[SQLite在线备份API](https://www.sqlite.org/backup.html)读取一致性副本，备份完成执行integrity_check、foreign_key_check和落盘；可在服务运行时备份，更新流程仍建议停服以固定恢复点。恢复拒绝已有目标数据库，恢复后需用隔离配置启动、登录和检查业务数据。当前没有备份定时任务、加密、异机复制或保留清理策略；第五阶段由实际恢复目标确定频率、保留和告警。runtime.env、TLS、SESSION_SECRET须独立安全备份，SQLite不含这些秘密；丢失密钥会影响已有会话及注册原请求重试。

### 本轮真实验证

以下在Windows本机隔离环境执行；不接触日常账户、真实数据或正式服务器。

- 后端typecheck、build通过，21组测试全部通过：在前三阶段基础上加入迁移中途失败回滚、活跃WAL一致性备份恢复、静态路径/安全头、认证并发及日志轮转。
- 前端typecheck、普通build、build:test通过，83项Vitest通过；新增真实SQLite集成验证登录下载失败保留游客且只读，29分59秒仅29分钟、重复结算revision不变、余量换节点、失败回退/新轮及删除不降低单份历史。
- Windows Chrome和Edge全站回归34项、账户联调6项、普通发布包HTTPS流程2项，合计42项通过。全站覆盖首次空数据、创建/准备/预约/提前开始/中断判定/暂停继续/结算结果历史/失败新轮、归档恢复删除、路线详情及设置；账户覆盖注册迁移、登录覆盖、任务中换号、退出、离线只读、响应丢失刷新恢复和两设备旧副本覆盖。会话过期、校时失败、下载失败、事务上传失败和时间边界另由集成及后端测试覆盖，不能把注入时钟视为真实休眠数小时测试。
- 1440×1024为基准，1280×720及1920×1080检查长文、滚动、焦点/Esc/遮罩、弹窗按钮与账户反馈；普通HTTPS版本复跑账户弹窗大小窗口和完整失败轮流程。修复路线关闭详情位置偏移、详情/新轮表单重复React key、本地修改失败反馈；修正禁用按钮和滚动测试的错误等待方式，最终复跑通过。界面检测无新增问题；不代表所有Windows缩放比例均覆盖。
- 正式包真实HTTPS、Secure Cookie、同源API、CSP、私有路径404、2MiB限制、无测试API通过。关闭服务后从活跃WAL备份恢复到新目录，重启登录保留revision47及6000条复用内容；之后普通浏览器创建的新账户也随数据库重开保留。
- hidden PowerShell启动脚本及Node24检查真实执行，健康和登录通过；current.json切到复制版本再切回，数据库账户数及完整性不变。迁移故障测试证明整个迁移事务回滚，不留下先前DDL变更。
- 当前主机实际LOCAL SERVICE任务注册被系统拒绝（Access denied），脚本现有明确管理员预检；-PreviewOnly任务定义构造通过。当前用户隐藏进程启动通过，不能据此宣称LOCAL SERVICE、开机自启、崩溃自动重启或Server2025 ACL已通过。

可复跑入口（从各工程目录运行，均创建隔离数据）：

```powershell
# demo/backend
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node test/deployment-drill.mjs ..\..\outputs\deploy\climb-20261029-stage4-release
# demo/web
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
npm.cmd run build:test
node integration/run-browser.mjs --full
node integration/run-browser.mjs
```

deployment-drill需要本机已有OpenSSL生成临时证书、已安装Chrome/Edge及空闲31443端口；本轮使用已有Git自带OpenSSL，未安装系统组件。真实HTTP/浏览器访问因沙箱限制在授权环境运行。脚本finally关闭本轮子进程，清理证书、密钥、SQLite、备份、截图及临时程序副本；正常源码、dist和发布包保留。首次权限失败产生的不完整打包目录另行核对清除。

### 资源实测与限制

本机Node24.14.0、Windows客户端、20逻辑CPU、约16GB内存；演练进程绑定2个逻辑CPU，Node old-space上限256MiB，未限制整机2GB内存，也不是腾讯云2vCPU或Windows Server2025。因此只能报告本机测量，不估算承载人数。

| 隔离测量 | 实际结果 |
|---|---|
| 8个同时注册 | 2个成功、6个503 AUTH_BUSY；密码计算并发峰值2，无排队 |
| 40次小快照写入，并发4 | 中位3.96ms、P95 5.37ms、最大5.57ms |
| 6次1,486,417字节快照写入，并发2 | 中位233.61ms、P95/最大365.83ms |
| >2MiB请求 | 413，未提交 |
| 整轮进程采样峰值 | RSS 281.6MiB，JS heap 93.2MiB；事件循环P99 223.08ms |
| WAL/一致性备份/日志 | 2,249,552 / 1,548,288 / 14,881字节 |

校验器复用Intl.Segmenter后，大快照P95从同机初轮576.52ms降至365.83ms，仍有同步SQLite/校验阻塞。固定密码计算并发2，超限立即503 AUTH_BUSY；整体在途请求上限16，超限503 SERVER_BUSY；客户端按原ID及相同正文重试，不扩大离线队列。每IP认证10次/分钟、总体120次/分钟，单进程计数，无Redis。2MiB/20000条为硬限制，当前没有大账户拆包或自动瘦身；不能将被拒快照当成功。

请求/连接超时15秒、keep-alive5秒；日志仅记录方法、路由模板和状态，未出现密码、密钥或Cookie。日志单文件10MiB、最多10个本应用文件，磁盘同步写入，不采用无界内存队列。256MiB old-space不是进程总内存上限，数据库缓存、原生驱动、TLS及Windows仍需内存。独立幂等记录、会话和业务快照没有自动清理策略；磁盘与备份增长须监控。

### 第五阶段所需信息和阻断项

需要现有Windows Server2025的授权连接方式/管理员权限、Node24 x64安装状态、可用磁盘与其他常驻进程，最终域名及证书取得/续期方式，443入站与主机监听配置，运维账户和NTFS ACL、备份位置/频率/保留及恢复目标。不能在本轮替用户采购或修改DNS。

必须在目标机器验证LOCAL SERVICE读取程序/私钥、写入data/logs权限，开机及异常重启、停止子进程、证书链/续期、正式网络Cookie、真实2核2GB资源和持续SQLite写入压力、磁盘满/备份告警及实际恢复。当前没有这些条件，故正式上线仍被阻断。整份覆盖限制不变：不自动下载、合并、拒绝旧副本或协调设备，仍可能丢记录、恢复已删数据、降低云端历史纪录，不能保证跨设备唯一任务。

最终交付核对：发布包92,267,571字节，SHA256为EA000BF7B2AFB8B185D961056CEBF8A88B4AFBAD07E0DDB557940DA7D46A1399；2393个ZIP条目、release.json及逐文件校验全部通过，未含sqlite、.env、PEM或测试构建。不完整的首次打包目录已删除。只读清理核对：本轮验证进程0、3002/31443/4173/5174/5184监听0、专用临时目录0、ClimbDrill计划任务0。

## 用户手工部署（2026-10-30交接）

当前使用climb-20261030-ui-release.zip及同名.zip.sha256。新包92,249,181字节，2393个文件与ZIP校验通过，2394个ZIP条目，已包含user.svg、首页工具组和备案文字，未含数据库、.env、PEM或测试构建。SHA256：679E353B22CB1DA83C8B2DA61AF90BCE57F746159B0A24D56EA18C36877C86AB。本次前端build（含typecheck）、后端build通过，生产依赖55项安装成功，安装审计0项；未运行浏览器、单元测试、测试构建或服务器验收。原climb-20261030-release和20261029包保留。

本节是用户在云服务器执行的步骤，不是已执行的服务器记录。助手只在本机生成新包，不连接服务器、不改DNS。本次前端build（含typecheck）、后端build及按原锁文件安装55项生产依赖成功；未重跑完整单元/浏览器/压力测试，上一阶段记录不能代替服务器验收。首轮打包受沙箱EPERM限制而失败，清除该未完成目录后在获准环境重建成功；没有安装编译工具等系统组件。

上一份climb-20261030-release历史包92,234,017字节，2392个文件校验及ZIP校验通过，2393个ZIP条目，未发现sqlite、.env、PEM或测试构建。SHA256：C83E188F5A7F909B658CFA0149B504C2378EECFA649D3A63EFDC392CBF270A27。旧包继续保留，不混用两份包的校验文件。

### 1. 准备条件与上传

- Windows Server 2025 x64，以管理员身份打开Windows PowerShell。先确认现有站点、443端口和其他服务，不能停止不属于Climb的程序。首次使用独立C:\Climb目录；若该目录已有内容，先看更新/回退步骤，不覆盖执行首次安装。
- 安装[Node.js官方](https://nodejs.org/en/download)24.x Windows x64版本，本机打包使用24.14.0；本说明默认安装到C:\Program Files\nodejs。服务器不需要npm安装依赖、不需要Vite或源码编译工具。确认具体24.x补丁版本后在服务器验收原生SQLite驱动。
- 准备最终域名及匹配该域名的受信任HTTPS证书、完整证书链PEM和私钥PEM。此程序直接读文件，不读Windows证书存储区；仅有PFX不能直接填入当前配置。证书签发、续期及大陆公网服务相关手续按你的腾讯云控制台要求完成。
- 用你现有的远程桌面文件复制或文件传输方式，将ZIP和同名.zip.sha256上传至服务器C:\ClimbUpload。只上传发布包，不上传本机数据库、.env或node_modules源码目录。无需把密码/私钥发给助手。

以下命令均在服务器管理员PowerShell逐段执行，任何错误先停止排查。第一段只查状态，不更改现有服务：

```powershell
& 'C:\Program Files\nodejs\node.exe' --version
Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue
Get-PSDrive C
Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory
```

Node输出须为v24.x；443占用时先查明用途，不照搬关闭命令。建议先保留安全组443关闭，完成本机启动后再仅允许你的验收公网IP访问。

### 2. 校验、解压、私有目录

```powershell
$ErrorActionPreference = 'Stop'
$package = 'C:\ClimbUpload\climb-20261030-ui-release.zip'
$expected = ((Get-Content -LiteralPath ($package+'.sha256') -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $expected) { throw '压缩包校验失败' }
if (Test-Path -LiteralPath 'C:\Climb') { throw 'C:\Climb已存在：请检查现有数据，禁止覆盖首次安装' }
New-Item -ItemType Directory -Path 'C:\Climb' | Out-Null
# SID：管理员、SYSTEM完全控制，LOCAL SERVICE只读/执行；不依赖系统语言
& icacls.exe 'C:\Climb' /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-19:(OI)(CI)RX'
if ($LASTEXITCODE) { throw '根目录权限设置失败' }
foreach ($name in @('releases','operations','config','data','logs','backups')) {
  New-Item -ItemType Directory -Path (Join-Path 'C:\Climb' $name) | Out-Null
}
New-Item -ItemType Directory -Path 'C:\Climb\config\tls' | Out-Null
foreach ($dir in @('C:\Climb\data','C:\Climb\logs')) {
  & icacls.exe $dir /grant:r '*S-1-5-19:(OI)(CI)M'
  if ($LASTEXITCODE) { throw '数据/日志权限设置失败' }
}
# 备份只由管理员维护；不需要服务账户读取
& icacls.exe 'C:\Climb\backups' /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F'
if ($LASTEXITCODE) { throw '备份权限设置失败' }
Expand-Archive -LiteralPath $package -DestinationPath 'C:\Climb\releases'
$release = 'C:\Climb\releases\climb-20261030-ui-release'
foreach ($line in Get-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt')) {
  if ($line -notmatch '^([A-Fa-f0-9]{64})  (.+)$') { throw '文件清单无效' }
  $fileHash = $Matches[1]; $filePath = Join-Path $release $Matches[2]
  if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $fileHash) { throw "文件校验失败：$filePath" }
}
Copy-Item -Path "$release\operations\*" -Destination 'C:\Climb\operations'
Copy-Item -LiteralPath 'C:\Climb\operations\runtime.env.example' -Destination 'C:\Climb\config\runtime.env'
Copy-Item -LiteralPath 'C:\Climb\operations\current.example.json' -Destination 'C:\Climb\config\current.json'
```

目录权限命令只针对新建Climb目录，不修改系统盘或其他站点权限；使用[Microsoft icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)的SID和继承权限。文件复制完成后用icacls复核config、私钥、data和logs，不给Everyone/Users写权限。日后新增恢复目录也需授予LOCAL SERVICE修改权限。

### 3. 填写配置和证书

将证书完整链放入C:\Climb\config\tls\fullchain.pem，私钥放入同目录private-key.pem，不放到release/web。用服务器记事本编辑两个文件：

```powershell
notepad.exe C:\Climb\config\runtime.env
notepad.exe C:\Climb\config\current.json
```

runtime.env中重点填写（实际域名替换示例）：

```dotenv
HOST=0.0.0.0
PORT=443
APP_ORIGIN=https://你的实际域名
SESSION_SECRET=在服务器本机生成的随机值
```

其他DATA_DIR、LOG_DIR、TLS_KEY_FILE、TLS_CERT_FILE、COOKIE_SECURE、NODE_ENV保留模板值。用以下命令在服务器本机生成SESSION_SECRET，填入文件后保密：

```powershell
& 'C:\Program Files\nodejs\node.exe' -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

current.json填写：

```json
{
  "ReleaseDir": "C:\\Climb\\releases\\climb-20261030-ui-release",
  "EnvFile": "C:\\Climb\\config\\runtime.env",
  "NodeExe": "C:\\Program Files\\nodejs\\node.exe"
}
```

NodeExe按实际安装位置修改；路径反斜线在JSON中须写成双反斜线，.env中使用单反斜线。已有系统环境变量会优先于Node --env-file，请避免同名旧HOST/PORT/DATA_DIR/SESSION_SECRET覆盖文件；不要在日志或截图中展示这些秘密。证书私钥若有口令，填写TLS_KEY_PASSWORD；没有则留空。此时仍不放开公网安全组。

### 4. 前台启动和后台自启

```powershell
# 在首个管理员终端启动，先保留此窗口看启动错误
& C:\Climb\operations\Start-Climb.ps1 -ControlFile C:\Climb\config\current.json
```

另开终端检查；用curl.exe --resolve让域名直达本机，仍然正常验证证书，替换两处域名：

```powershell
curl.exe --noproxy '*' --resolve '你的实际域名:443:127.0.0.1' 'https://你的实际域名/health'
```

返回200及健康JSON后，首个窗口Ctrl+C关闭，确认443监听退出，再注册后台任务：

```powershell
& C:\Climb\operations\Register-StartupTask.ps1 -ControlFile C:\Climb\config\current.json -PreviewOnly
& C:\Climb\operations\Register-StartupTask.ps1 -ControlFile C:\Climb\config\current.json
Start-ScheduledTask -TaskName Climb
Get-ScheduledTask -TaskName Climb | Select-Object TaskName,State
Get-ScheduledTaskInfo -TaskName Climb
# 再运行上面的curl健康检查
```

任务应为Running且健康检查成功；不能只看LastTaskResult判断网站正常。任务存在时报错，不自动覆盖。LOCAL SERVICE身份权限和开机恢复必须在此服务器实际验证；前台成功、后台失败时优先检查Node/脚本/证书读取及data/logs修改权限。日志在C:\Climb\logs；启动阶段配置错误可能尚未生成日志，用前台命令重现，不清空数据库。

### 5. 受限访问与用户验收

域名解析由你设置；正式开放前先通过腾讯云安全组仅允许你的验收公网IP访问TCP443，同时配置Windows防火墙同样限制来源。示例先把占位值换成你的公网IP再执行，不能照抄占位值：

```powershell
New-NetFirewallRule -DisplayName 'Climb HTTPS acceptance' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress '你的验收公网IP'
```

来源限定依据[Microsoft防火墙命令](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line)。原有更宽的443放行规则也要检查，单加窄规则不会收紧已有宽规则。不开放3001、3002、5173或5174；不关闭防火墙，不改现有远程桌面规则。当前没有80跳转，访问时明确使用https://域名。

在本机Chrome/Edge打开正式域名，用全新浏览器配置/专用测试账户验收，避免迁移日常游客数据：

1. 证书无错误，首次为空；游客创建进行中任务，注册带入；已有账户登录覆盖，退出回空游客，声音保存。
2. 预约、开始、判定、暂停继续、结算、历史、失败新轮和归档/删除；普通包没有加速入口，不为验收改业务时长。
3. 刷新只检查会话及校时；断网只读；保存响应未知时原操作恢复；两设备按规格互相覆盖，不能期待冲突保护。
4. 管理员手工备份→恢复至新目录→隔离配置验证后再恢复正常配置，绝不覆盖活跃数据库，步骤见上节。重启服务器后复查任务、网站、数据库和登录；记录内存、日志、磁盘及持续写入情况。

验收期间若失败，保留错误和日志，优先停止新写入并按更新回退步骤处理，不删除climb.sqlite、WAL或SHM，不通过npm重装尝试修复数据。定期备份、证书续期和真实2核2GB压力未落实前，不将服务视为正式上线验收通过；完成后再由你决定放开来源限制。

### 6. 日常操作

```powershell
# 查状态和最近日志（日志不应包含凭据）
Get-ScheduledTask -TaskName Climb | Select-Object TaskName,State
Get-ChildItem C:\Climb\logs -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3
# 停止；之后必须确认本应用Node子进程及443监听也退出
Stop-ScheduledTask -TaskName Climb
Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue
```

若停止任务后仍监听，先按OwningProcess查Get-CimInstance Win32_Process的CommandLine，确认确为C:\Climb\releases下本应用的node.exe后才按该PID停止，不能停止所有node.exe。停服确认后再切换版本或恢复数据。程序更新、迁移、备份和回退使用上节已有命令，新备份必须使用新文件名；SESSION_SECRET不要随程序更新重新生成。
