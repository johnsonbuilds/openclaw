# 入口脚本配置恢复说明

本文档记录了 `entrypoint.sh` 的变更，该变更在 SaaS 容器流程中为无效的持久化 OpenClaw 配置增加了启动时恢复功能。

## 变更内容

入口脚本现在会在包装器启动前验证持久化配置。

### 新行为

- 当存在现有配置时，入口脚本会在进行任何原位 LLM 更新之前验证 `OPENCLAW_CONFIG_PATH`。
- 每次入口脚本确认当前 `openclaw.json` 有效后，都会将其刷新为 `${OPENCLAW_CONFIG_PATH}.bak`，确保启动阶段始终留下最近一次已验证的有效备份基线。
- 如果当前配置无效，入口脚本将检查 `${OPENCLAW_CONFIG_PATH}.bak`。
- 仅在以下情况发生恢复：
  - 当前配置无效，且
  - `.bak` 文件存在，且
  - `.bak` 文件有效。
- 在还原之前，无效的当前配置将被复制到一个带有时间戳的文件：
  - `openclaw.json.invalid.<UTC 时间戳>`
- 还原后，入口脚本将再次验证还原后的配置。
- 如果还原验证失败，启动停止。
- 如果不存在有效的备份，启动停止。

### 验证阶段

恢复守卫在三个点运行：

1. `pre-update`
   - 在更新现有配置的 LLM 字段之前
2. `post-update`
   - 在更新现有配置的 LLM 字段之后
3. `post-generate`
   - 在从环境变量生成新配置之后

### 日志格式

入口脚本现在以机器可读的风格输出恢复日志：

- `status=current-invalid`
- `status=backup-missing`
- `status=backup-invalid`
- `status=restored`
- `status=restore-invalid`

这些日志旨在方便 SaaS 后端或容器日志管道进行检测。

## 添加原因

在 SaaS 流程中，用户或机器人可能会意外写入无效的 `openclaw.json`，导致无法启动。OpenClaw 本身在配置无效时会选择“故障关闭”，这对于核心产品是正确的，但容器入口脚本现在增加了一个产品层面的安全网：

- 尽可能保留最后已知的良好配置
- 避免因可恢复的错误编辑导致整个实例停机
- 保留损坏的配置以便调试

## 运行时假设

此恢复功能使用 OpenClaw 自身的配置验证逻辑，通过 `dist/` 下构建的运行时输出来实现。这符合生产容器的预期，即镜像中包含构建产物。

此外，gateway 运行期在检测到“来自外部文件编辑”的有效配置变更后，也会把当前已验证的配置同步到 `.bak`。这样即使配置文件不是通过受控写入路径修改，只要新的配置是有效的，也会更新恢复基线；如果新的配置无效，则不会覆盖现有 `.bak`。

## 如何测试

### 1. 语法检查

在仓库根目录下：

- 运行 `sh -n entrypoint.sh`

预期结果：

- 无输出
- 退出码 `0`

### 2. 有效现有配置的正常路径

准备：

- 一个有效的 `openclaw.json`
- 一个有效的 `.bak`

使用正常的持久化卷运行容器/启动流程。

预期结果：

- 启动成功
- 没有包含 `status=current-invalid` 的恢复日志

### 3. 当前配置无效，`.bak` 有效

准备：

- 保留一个有效的 `openclaw.json.bak`
- 故意破坏 `openclaw.json`，例如写入一个无效的架构键（如顶层的 `web.brave`）

运行启动。

预期结果：

- 日志包含 `status=current-invalid`
- 日志包含 `status=restored`
- 创建一个类似 `openclaw.json.invalid.20260410T120000Z` 的文件
- 启动继续并成功

### 4. 当前配置无效，缺少 `.bak`

准备：

- 无效的 `openclaw.json`
- 没有 `.bak`

运行启动。

预期结果：

- 日志包含 `status=current-invalid`
- 日志包含 `status=backup-missing`
- 启动失败

### 5. 当前配置无效，`.bak` 也无效

准备：

- 无效的 `openclaw.json`
- 无效的 `openclaw.json.bak`

运行启动。

预期结果：

- 日志包含 `status=current-invalid`
- 日志包含 `status=backup-invalid`
- 启动失败

### 6. 现有配置更新路径

准备：

- 持久化的有效配置
- 将 `LLM_PROVIDER` 设置为 `openrouter`、`openai`、`anthropic` 或 `custom` 之一
- 设置所需的配套环境变量

运行启动。

预期结果：

- `pre-update` 验证在原位 LLM 编辑前运行
- `post-update` 验证在编辑后运行
- 使用更新后的 LLM 字段启动成功

### 7. 新配置生成路径

准备：

- 移除持久化配置
- 提供初始配置生成所需的环境变量

运行启动。

预期结果：

- 配置已生成
- `post-generate` 验证运行
- 启动成功

## 运维备注

这是一个启动时的安全网，并非受控配置写入的替代方案。它减少了因错误编辑导致的面向客户的停机，但不能取代 SaaS 设置流程中的上游验证。
