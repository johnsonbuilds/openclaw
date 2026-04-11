# 与 upstream 差异记录与同步指南

## 使用约定

- 本文件既是当前 fork 相对 upstream 的差异清单，也是后续同步 upstream repo 时的操作指南。
- 下文“差异点”章节中的“新增文件”和“修改文件”共同构成需要保留的 fork 差异点清单。
- 后续同步 upstream 最新代码时，必须显式核对并保留下文“差异点”章节中记录的差异点，避免在冲突解决、批量覆盖或清理过程中误删本 fork 的既有定制行为。
- 如果后续本 fork 引入了新的差异点，必须持续补充记录到本文件，保持这里始终是最新、完整的差异来源。

## 与 upstream 同步工作流

在将本 fork 与 `openclaw/openclaw` upstream 同步时，默认遵循以下规则：

- 默认在 fetch 并检查分叉情况后，一次性将 `upstream/main` 合并到本地 `main`，不要因为 upstream 领先较多就人为拆成多段同步。
- 如果出现冲突，先汇总冲突文件，再仅对会改变本 fork 本地行为的策略点做决策。
- 解决冲突时，除非存在“明确新决定”，否则不要破坏下文“差异点”章节中已经登记的差异点。

### “明确新决定”的定义

- 这里的“明确新决定”，指当前同步任务中由人工明确确认的变更决定，例如：用户在当前对话中的明确要求、维护者在 PR / review / issue 中明确批准的取舍、或已经形成书面结论的同步策略更新。
- AI 自行推断“这个差异点可能不再重要了”不算“明确新决定”。
- 如果没有人工明确确认，则默认视为该差异点仍然有效，冲突解决时应保留其语义与行为。

### 冲突处理策略

以下策略用于补充说明高频、高风险冲突面的处理方式；它们不是完整穷举清单。凡是下文“差异点”章节中已记录、但这里未单列策略的内容，仍然默认按“保留 fork 差异语义”处理。

- GitHub workflows：优先吸收 upstream 的 workflow 逻辑，但在发生冲突时保留本 fork 对 `workflow_dispatch` 的偏好，因为本 fork 主要依赖手动触发和自定义 Docker 发布流程。
- `Dockerfile`：保留本 fork 的 wrapper 与 `entrypoint.sh` 部署/运行模型，同时尽量吸收 upstream 的构建阶段加固与兼容性修复。
- Gateway 启动流程：保留本地 `AGENT_GATEWAY_READY_NOTIFY_URL` ready 通知行为，同时尽量兼容 upstream 的启动与 update-check 结构。
- Telegram：保留本 fork 的“首个私聊发送者自动加入 allowlist”行为，但在同步时优先把该能力移植到 upstream 的访问控制结构与测试里，而不是简单整文件回退。
- system prompt：保留 `buildValueFirstResponseSection()` 以及相关文档和测试约束。
- 如果 upstream 删除了某个文件，而本 fork 当前也不再依赖它，则接受 upstream 的删除。

### 未单列策略的差异点如何处理

- 若冲突文件已经出现在下文“差异点”章节，但未在上面的“冲突处理策略”中单列，默认仍以该差异点条目的“修改目的”和“涉及功能 / 行为变化”为准。
- 处理优先级应为：先保留 fork 语义，再尽量吸收 upstream 的实现改进；能通过局部移植解决时，不要用整文件回退覆盖 upstream 的其他有效变更。
- 如果发现某个新的冲突面既不在“冲突处理策略”中，也不在下文“差异点”章节中，但它实际上属于本 fork 新增或已存在的定制行为，应先把该差异点补记到本文件，再继续解决冲突。

### 同步后的检查要求

- 冲突解决后，先确认 `git diff --name-only --diff-filter=U` 结果为空。
- 对高风险区域执行定向验证。若 Telegram 相关文件发生冲突，运行 `corepack pnpm vitest run src/telegram/bot.test.ts`；若容器 / wrapper / gateway 启动链相关文件发生冲突，至少补充执行与该链路直接相关的定向验证。
- 如果 merge commit 仅因 pre-commit hook 对本地忽略但 upstream 跟踪的路径重复执行 `git add` 而被阻塞，可在“冲突已解决且定向测试通过”前提下使用 `git commit --no-edit --no-verify`。

## 差异点

本章节是当前 fork 相对 upstream 的权威差异清单。同步 upstream 时，默认应保留本章节描述的目标语义与行为。

### 新增文件

### 1. `.github/workflows/docker-publish.yml`

- 差异摘要：新增一个独立的 Docker 发布工作流，在 `main` 分支和版本 tag 上构建并推送镜像到 GHCR。
- 修改目的：为当前 fork 保留自己的镜像发布通道，不依赖 upstream 的默认发布流程。
- 涉及功能 / 行为变化：
  - 支持自动登录 GHCR。
  - 支持 `linux/amd64` 和 `linux/arm64` 双平台镜像构建。
  - 在 `main` 推送时生成 `latest` 和 `sha-*` 标签，在 tag 推送时附带版本标签。

### 2. `entrypoint.sh`

- 差异摘要：新增容器入口脚本，用于容器启动时初始化状态目录、配置文件、内存参数和网关 token，并最终启动 wrapper。
- 修改目的：把容器运行方式从“直接启动 gateway”改成“先做部署引导，再由 wrapper 管理 gateway”。
- 涉及功能 / 行为变化：
  - 强制要求 `OPENCLAW_STATE_DIR`，并默认推导 `OPENCLAW_CONFIG_PATH` 与 `OPENCLAW_WORKSPACE_DIR`。
  - 根据 cgroup 内存上限自动设置 `NODE_OPTIONS --max-old-space-size`。
  - 若 `openclaw.json` 不存在则生成；若已存在则默认不整体覆盖，而是仅同步 LLM 相关字段，除非显式设置 `OPENCLAW_FORCE_CONFIG=1`。
  - 创建或更新 LLM 配置时，强制要求 `LLM_PROVIDER`、`LLM_MODEL_ID`、`LLM_MODEL_NAME`、`LLM_BASE_URL`、`LLM_API_KEY` 存在，不再使用默认兜底值。
  - 已有配置场景下，会原地更新 `models.providers[LLM_PROVIDER]` 与 `agents.defaults.model.primary`，同时保留其他已有 provider、gateway token 和其余运行时配置不变。
  - 生成配置文件 `openclaw.json`，并保持既有权限收敛逻辑。
  - 尝试复用已有 gateway token，避免重启后 token 漂移。
  - 更换启动入口。

### 3. `wrapper/package.json`

- 差异摘要：新增 wrapper 子项目的包清单。
- 修改目的：给 SaaS 部署用的包装层单独声明依赖与运行脚本。
- 涉及功能 / 行为变化：
  - 引入 `express`、`http-proxy`、`tar`。
  - 暴露 `dev`、`start`、`lint`、`smoke` 等脚本。
  - 使 wrapper 可以作为一个独立 Node 服务运行。

### 4. `wrapper/server.js`

- 差异摘要：新增 wrapper 服务，负责代理外部请求、按需拉起 gateway、保护 `/setup`、提供少量控制台 API，并在 gateway ready 后发通知。
- 修改目的：为云部署提供一层稳定的 Web 包装层，避免直接暴露 OpenClaw gateway。
- 涉及功能 / 行为变化：
  - 对外监听 `8080`，内部反代到 `127.0.0.1:18789`。
  - 统一 gateway token 的来源：环境变量、配置文件、持久化 token 文件三选一。
  - 未配置时强制将用户引导到 `/setup`。
  - 提供 `/setup/healthz` 健康检查，以及 `/setup/api/console/run` 的受限命令执行接口。
  - gateway 改为由 wrapper 托管启动、停止、重启。
  - 支持 `AGENT_GATEWAY_READY_NOTIFY_URL` ready 通知。
  - 支持 websocket 代理。

### 5. `extensions/telegram/src/polling-conflict-alert.ts`

- 差异摘要：新增一个独立的 Telegram polling 冲突告警器，用于在 `getUpdates conflict` 时向机器人所有者主动发送 Telegram 提示。
- 修改目的：当 bot token 被其他实例或第三方程序同时占用时，把问题直接通知到可处理该问题的 owner/operator，而不只是停留在后端日志。
- 涉及功能 / 行为变化：
  - 复用 Telegram 现有 owner / approver 解析语义，优先使用 `execApprovals.approvers`，否则回退到从 `allowFrom` 和直连 `defaultTo` 推断的数字 Telegram 用户 ID。
  - 使用独立 helper 封装告警文案、发送逻辑和冷却窗口，减少对 upstream 主 polling 逻辑的侵入。
  - 同一 owner 默认带 15 分钟冷却，避免冲突持续期间反复刷屏。

### 6. `src/config/backup-baseline.ts`

- 差异摘要：新增一个独立的配置备份基线同步 helper，用于把“当前已验证有效”的 `openclaw.json` 同步到 `.bak`。
- 修改目的：让恢复机制不仅覆盖受控配置写入，也覆盖 bot 或外部流程直接编辑配置文件的场景，同时把逻辑尽量隔离在单独模块中，降低后续同步 upstream 的冲突面。
- 涉及功能 / 行为变化：
  - 当调用方已经确认当前配置有效时，可将其复制为 `${configPath}.bak`。
  - 若 `.bak` 内容与当前配置一致，则不会重复写入。
  - 仅负责刷新“最近一次有效配置”的恢复基线，不替代既有的 `.bak/.bak.1...` 轮转逻辑。

### 修改文件

### 1. `Dockerfile`

- 差异摘要：容器构建与运行模型被改为“OpenClaw 主程序 + wrapper”双层结构，而不是直接运行 gateway。
- 修改目的：适配 SaaS 场景，把对外入口切到 wrapper，并保留本 fork 的部署行为。
- 涉及功能 / 行为变化：
  - 新增对 `/openclaw/extensions`、`/openclaw/.agent`、`/openclaw/.agents` 的权限归一化处理。
  - 额外复制 `wrapper/package.json`、`wrapper/server.js`、`entrypoint.sh` 到镜像中，并安装 wrapper 依赖。
  - Playwright 安装路径从 `/app/node_modules` 改为 `/openclaw/node_modules`。
  - 生成 `/usr/local/bin/openclaw` shim，直接调用 `/openclaw/dist/entry.js`。
  - 对外端口和健康检查从 `18789` 改成 `8080`。
  - 启动命令改为 `ENTRYPOINT ["/entrypoint.sh"]`。
  - upstream 中直接以非 root 用户运行、直接启动 gateway 的行为被本 fork 的 wrapper 启动链替代。

### 2. `docs/concepts/system-prompt.md`

- 差异摘要：文档新增了 “Value-First Response Strategy” 段落，并说明 minimal prompt 也会保留该部分。
- 修改目的：把本 fork 对助手回复风格的额外约束记录到文档里。
- 涉及功能 / 行为变化：
  - 明确要求当用户提到工具、数据源、系统时，先解释价值，再给下一步操作。
  - 说明 sub-agent / minimal prompt 仍然保留这条策略。

### 3. `extensions/telegram/src/bot-access.ts`

- 差异摘要：移除了 allowlist 为空时立即返回“不允许”的早退逻辑。
- 修改目的：为“首个私聊用户自动加入 allowlist”留出后续处理空间。
- 涉及功能 / 行为变化：
  - 当 `allowFrom` 为空时，不再在这里直接判死；后续流程可以继续判断是否触发自动加白或配对逻辑。

### 4. `extensions/telegram/src/bot-deps.ts`

- 差异摘要：新增 `addChannelAllowFromStoreEntry` 依赖，并注入默认实现。
- 修改目的：让 Telegram runtime 可以把用户动态写入 channel allowlist store。
- 涉及功能 / 行为变化：
  - Telegram bot 运行期现在有能力直接追加 allowlist 项，而不只是读取 allowlist 或发起 pairing。

### 5. `extensions/telegram/src/bot-handlers.runtime.ts`

- 差异摘要：调用私聊访问控制时，新增传入 `addAllowFromStoreEntry`。
- 修改目的：把新的动态加白能力接进真正的消息处理链路。
- 涉及功能 / 行为变化：
  - DM 访问控制不再只是“放行 / pairing challenge”，还可能直接把用户写入 allowlist。

### 6. `extensions/telegram/src/bot-message-context.ts`

- 差异摘要：构造 Telegram 消息上下文时，多传递了 `addChannelAllowFromStoreEntry`。
- 修改目的：让消息上下文层也能参与新的私聊访问控制策略。
- 涉及功能 / 行为变化：
  - 私聊首发用户的自动加白逻辑可以在上下文构建阶段生效。

### 7. `extensions/telegram/src/bot-message-context.types.ts`

- 差异摘要：为消息上下文构建参数增加 `addChannelAllowFromStoreEntry` 类型声明。
- 修改目的：补齐上面运行时改动对应的类型契约。
- 涉及功能 / 行为变化：
  - TypeScript 层面承认 Telegram 消息上下文构建器可选接收动态加白函数。

### 8. `extensions/telegram/src/bot-message.ts`

- 差异摘要：创建 Telegram message processor 时，向上下文构建传入 `addChannelAllowFromStoreEntry`。
- 修改目的：把依赖从 bot deps 继续透传到 message processor。
- 涉及功能 / 行为变化：
  - 首个私聊用户自动加白的能力贯通到消息处理入口。

### 9. `extensions/telegram/src/bot.create-telegram-bot.test-harness.ts`

- 差异摘要：测试桩里增加了 `addChannelAllowFromStoreEntry` mock、导出 getter，并在 `telegramBotDepsForTest` 中接入。
- 修改目的：支撑新的 Telegram DM 自动加白测试场景。
- 涉及功能 / 行为变化：
  - 测试环境可以断言是否发生了 allowlist 写入。
  - `beforeEach` 会重置并设置该 mock 的默认返回值。

### 10. `extensions/telegram/src/bot.test.ts`

- 差异摘要：新增多条 Telegram 行为测试，同时调整了部分既有测试输入。
- 修改目的：覆盖本 fork 新增的 DM 自动加白、typing cue 和群聊 mention pattern 行为。
- 涉及功能 / 行为变化：
  - 新增“当 DM allowlist 为空时，首个私聊发送者自动加白”的测试。
  - 新增“自动加白后不再发送 pairing code”的测试。
  - 新增“回复开始时发送 typing 动作”的测试。
  - 新增“群聊中通过 mentionPatterns 命中，即使没有 `@botUsername` 也能接受消息”的测试。
  - 某些场景下的 allowlist 初始值从空数组改成已有用户，以区分自动加白和正常 pairing 行为。

### 11. `extensions/telegram/src/dm-access.test.ts`

- 差异摘要：测试从“allowlist 为空时触发 pairing”改为区分两种情况：空 allowlist 自动加白；已有 allowlist 才触发 pairing。
- 修改目的：把新的私聊访问控制策略表达清楚。
- 涉及功能 / 行为变化：
  - 空 allowlist + `pairing` 策略时，首个 DM 发送者会被直接写入 allowlist 并放行。
  - 非空 allowlist + `pairing` 策略时，未授权用户仍然收到 pairing challenge。

### 12. `extensions/telegram/src/dm-access.ts`

- 差异摘要：在 `pairing` 模式下新增“当 allowlist 为空时自动把首个私聊发送者加入 allowlist”的分支。
- 修改目的：优化 bot 首次配置后的可用性，避免第一位管理员也被卡在 pairing 流程里。
- 涉及功能 / 行为变化：
  - 私聊且 `dmPolicy === "pairing"` 且 allowlist 为空时：
    - 读取发送者 Telegram user id。
    - 写入 channel allowlist store。
    - 记录日志。
    - 直接放行，不发 pairing code。
  - 如果自动加白失败，则继续走原有 pairing 逻辑。

### 13. `package.json`

- 差异摘要：根包新增 `@anthropic-ai/sdk` 和 `openai` 依赖。
- 修改目的：为 fork 中新增的部署 / 集成能力或后续代码路径准备官方 SDK 依赖。
- 涉及功能 / 行为变化：
  - 依赖面扩大，锁文件随之变化。
  - 这些包进入生产依赖集合。

### 14. `extensions/telegram/src/monitor.ts`

- 差异摘要：Telegram monitor 在 polling 模式下新增接入 `getUpdates conflict` owner 告警器。
- 修改目的：把冲突告警挂在启动监控与 polling session 的装配层，尽量局部化改动，降低后续同步 upstream 的冲突范围。
- 涉及功能 / 行为变化：
  - 为每个 Telegram account 创建独立的 conflict alerter。
  - 在不改变原有 polling 重试结构的前提下，把 owner 通知能力以回调形式注入 polling session。

### 15. `extensions/telegram/src/polling-session.ts`

- 差异摘要：在识别到 Telegram `getUpdates conflict` 时，除原有日志和重试外，新增触发 owner 通知。
- 修改目的：让该类冲突从“仅后端可见”变成“owner 可直接收到 Telegram 告警”，同时保持核心 polling 逻辑改动最小。
- 涉及功能 / 行为变化：
  - `409 getUpdates conflict` 分支会调用独立注入的通知函数。
  - 通知失败不会中断原有冲突恢复流程，仍继续保留日志与自动重试。

### 16. `extensions/telegram/src/polling-conflict-alert.test.ts`

- 差异摘要：新增针对 Telegram polling 冲突 owner 告警器的定向测试。
- 修改目的：为 fork 新增的 owner 告警行为提供独立测试覆盖，减少将来同步时回归风险。
- 涉及功能 / 行为变化：
  - 覆盖 owner 解析后正常发信。
  - 覆盖冷却窗口内抑制重复告警。
  - 覆盖无法解析 owner 时仅记录日志、不发送消息。

### 17. `src/agents/pi-embedded-helpers/errors.ts`

- 差异摘要：rate limit 用户提示从通用“稍后重试”改成引导用户添加 / 切换 API key。
- 修改目的：把“额度 / 限流”问题引导到本 fork 希望的商业或 BYOK 流程上。
- 涉及功能 / 行为变化：
  - 用户看到限流提示时，会被引导到 `getclawcloud.com` 的 API key 页面，而不是单纯等待。

### 18. `src/agents/system-prompt.test.ts`

- 差异摘要：测试新增对 “Value-First Response Strategy” 段落的断言。
- 修改目的：确保系统提示词确实包含 fork 自己加的回复策略。
- 涉及功能 / 行为变化：
  - minimal prompt 和完整 prompt 的测试都要求出现这段策略内容。

### 19. `src/agents/system-prompt.ts`

- 差异摘要：新增 `buildValueFirstResponseSection()`，并把该 section 注入系统提示词；同时把原先工具调用风格 fallback 里的标题行去掉。
- 修改目的：改变助手在“提到外部工具 / 系统”场景下的默认表达顺序，让回答更偏产品导向。
- 涉及功能 / 行为变化：
  - 系统提示词新增明确指令：先讲用户收益，再给下一步动作，不要上来就讲配置。
  - minimal / sub-agent prompt 也会带上这条策略。
  - prompt 结构略有变化，工具调用风格部分的标题层级减少一层。

### 20. `src/agents/workspace.defaults.test.ts`

- 差异摘要：新增测试，断言显式设置 `OPENCLAW_WORKSPACE_DIR` 时优先使用它。
- 修改目的：覆盖 fork 对 workspace 路径解析的自定义环境变量行为。
- 涉及功能 / 行为变化：
  - 测试确认 `OPENCLAW_HOME` / `HOME` 不再总是优先，显式 workspace 路径会覆盖默认推导。

### 21. `src/agents/workspace.ts`

- 差异摘要：默认 workspace 目录解析逻辑新增 `OPENCLAW_WORKSPACE_DIR` / `CLAWDBOT_WORKSPACE_DIR` 覆盖项。
- 修改目的：让容器部署可以稳定指定 workspace 位置，不依赖 home 目录规则。
- 涉及功能 / 行为变化：
  - 若设置了显式 workspace 环境变量，则直接使用它。
  - 否则才回退到原先基于 `OPENCLAW_HOME` / `HOME` 的默认解析逻辑。

### 22. `src/dockerfile.test.ts`

- 差异摘要：测试中的 Playwright CLI 路径断言跟随 Dockerfile 一起改成 `/openclaw/node_modules/...`。
- 修改目的：保持测试与新的镜像布局一致。
- 涉及功能 / 行为变化：
  - Dockerfile 测试基线更新为 wrapper 改造后的镜像目录结构。

### 23. `src/gateway/net.ts`

- 差异摘要：当 bind mode 为 `loopback` 时，不再在 127.0.0.1 不可绑定时回退到 `0.0.0.0`。
- 修改目的：强化“loopback 就必须只绑定本机”的安全语义，避免意外对外暴露。
- 涉及功能 / 行为变化：
  - `loopback` 模式现在始终返回 `127.0.0.1`。
  - 去掉极端情况下自动退化为 LAN 监听的行为。

### 24. `docs/reference/templates/BOOTSTRAP.md`

- 差异摘要：将首启 bootstrap 模板从 identity-first / persona-first 改为 task-first。
- 修改目的：避免用户首次连上实例或首次通过 Telegram 等入口开始对话时，被冗长的人格配置问卷打断，优先让用户进入“任务态”。
- 涉及功能 / 行为变化：
  - 首句改为明确要求先问 `👉 What do you want me to do?`。
  - 增加少量任务示例（如 analyze a file / build an automation / set up a voice agent），帮助用户快速进入任务表达。
  - 明确要求：如果用户给了任务，就先做任务，不要先做身份设定。
  - `SOUL.md`、命名、vibe、emoji 等人格信息收集改为延后、可选、渐进式，不再作为首次对话前置门槛。
  - 删除 `BOOTSTRAP.md` 的条件放宽为“用户已进入正常任务对话”，而不是必须先完整做完人格配置。

### 25. `apps/macos/Sources/OpenClaw/OnboardingView+Chat.swift`

- 差异摘要：macOS onboarding chat 的 kickoff 文案改为显式要求 task-first bootstrap。
- 修改目的：让应用侧自动发出的首条引导消息与 fork 的 task-first bootstrap 语义保持一致，避免仍旧把用户导向先配置 `SOUL.md` / persona。
- 涉及功能 / 行为变化：
  - 启动文案不再要求“先访问 `SOUL.md` 再讨论 WhatsApp/Telegram”。
  - 改为明确提示 agent 按 `BOOTSTRAP.md` 进入 task-first 模式。
  - 明确给出首句和示例方向，要求先帮助用户完成任务，再在需要时补做 identity / `SOUL.md` 个性化。

### 26. `docs/start/bootstrapping.md`

- 差异摘要：启动文档同步更新为 task-first bootstrap 描述。
- 修改目的：让文档对首次启动体验的描述与 fork 的实际行为一致，避免保留 upstream 或旧版本的人格优先叙述。
- 涉及功能 / 行为变化：
  - 文档不再描述“先进行一轮身份问答”。
  - 改为说明首次启动先用简短 task-first 提示让用户直接提需求。
  - 身份与偏好信息采集改为在后续有用时再写入 `IDENTITY.md`、`USER.md`、`SOUL.md`。

### 27. `src/config/io.ts`

- 差异摘要：补充导入 `sanitizeTerminalText`，修复配置 warning 格式化路径中的运行时 `ReferenceError`。
- 修改目的：修复 upstream 当前实现中的缺失导入问题，避免当配置包含 warning（例如禁用插件仍保留配置项）时，gateway 在 reload / restart / CLI 启动阶段因为打印 warning 而崩溃。
- 涉及功能 / 行为变化：
  - 当配置校验返回 warnings 时，可以稳定输出 `Config warnings` 日志，不再因 `sanitizeTerminalText is not defined` 失败。
  - bot 或其他外部流程修改配置后，若触发 gateway reload 且配置仅包含 warning，不会再把 warning 误升级为致命启动错误。
  - 该修复属于 fork 需要保留的上游 bugfix，同步 upstream 时若冲突应保留其语义，除非 upstream 已以等效方式修复。

### 28. `entrypoint.sh`

- 差异摘要：在现有启动校验与恢复逻辑基础上，新增“成功验证后刷新 `.bak` 基线”的行为。
- 修改目的：保证容器每次成功启动或恢复后，`${OPENCLAW_CONFIG_PATH}.bak` 都指向最近一次已验证有效的配置，即使此前配置曾被外部直接改写。
- 涉及功能 / 行为变化：
  - 当 `ensure_startup_config_is_valid()` 确认当前配置有效时，会将当前 `openclaw.json` 刷新到 `.bak`。
  - 当入口脚本从 `.bak` 恢复成功后，会再次刷新 `.bak`，确保恢复基线与当前有效配置一致。
  - 该逻辑是恢复机制的补强层，不改变已有 `overwrite-defaults` / `update-llm-only` 主流程。

### 29. `src/gateway/config-reload.ts`

- 差异摘要：gateway 配置热重载器新增一个可选回调，仅在“外部文件变更且快照校验有效”时执行附加动作。
- 修改目的：把“外部有效配置变更后刷新 `.bak`”的行为隔离成可注入回调，减少直接侵入 reload 核心流程，降低后续同步冲突。
- 涉及功能 / 行为变化：
  - 对受控内部写入通知维持原行为，不额外刷新 `.bak`，避免破坏既有备份轮转语义。
  - 对 watcher 检测到的外部文件变更，在确认配置有效后可执行备份基线刷新。

### 30. `src/gateway/server.impl.ts`

- 差异摘要：gateway 启动时为配置热重载器注入“外部有效配置变更后刷新 `.bak`”的回调。
- 修改目的：让 bot 或其他外部流程直接编辑 `/data/openclaw.json` 后，只要配置仍然有效，就能自动建立新的恢复基线。
- 涉及功能 / 行为变化：
  - 当 watcher 检测到有效的外部配置变更时，会把当前 `openclaw.json` 同步到 `.bak`。
  - 对内部受控写入不触发该同步，继续保留 upstream / 现有 fork 的备份轮转行为。
