# Wrapper 托管 Gateway 重启行为说明

本文档记录当前 fork 在容器 / wrapper 托管模式下对 gateway 重启行为的调整。

## 变更目标

此次调整的目标是同时满足以下三点：

- 正常的 gateway restart 不要误触发整容器重启。
- 真正的 gateway 异常退出 / crash 仍然触发整容器重启。
- bot 尽量保持持续在线。

## 本次改动

wrapper 现在在拉起托管 gateway 子进程时，默认注入：

- `OPENCLAW_NO_RESPAWN=1`

这意味着 wrapper 管理下的 gateway 在收到受控 `SIGUSR1` restart 时，会优先走**同进程重启**，而不是 fresh PID respawn。

## 为什么要这样做

在 upstream 默认模型下，部分 restart 路径可能尝试：

1. 关闭当前 gateway server
2. 启动一个新的 gateway 进程
3. 旧进程退出

这种 fresh PID restart 在容器场景下可能出现一个短窗口：

- 旧 listener 还没有完全释放端口
- 新进程已经开始争抢同一端口
- 结果新进程绑定失败，或者 wrapper 观察到子进程退出并误判为异常退出

改成同进程重启后：

- gateway 仍使用同一个 PID
- 不会再出现“旧 PID 和新 PID 同时争抢同一端口”的问题
- wrapper 在正常 `SIGUSR1` restart 场景下通常看不到子进程退出，因此不会触发容器级 restart

## 预期行为

### 1. 正常 restart

以下几类 restart 现在应优先表现为“同进程重启”，而不是“子进程退出后整容器重启”：

- `openclaw gateway restart`
- gateway tool 的 `restart`
- 配置变更触发的 `SIGUSR1` restart
- update / config apply / config patch 后的受控 restart

### 2. 真正异常退出

如果 gateway 子进程真的退出，例如：

- crash
- 未受 wrapper 标记保护的异常终止
- 启动失败后最终退出

wrapper 默认仍会按既有策略将自己以非零码退出，以便让容器运行时执行 restart。

需要注意：该行为默认受 `OPENCLAW_RESTART_CONTAINER_ON_GATEWAY_EXIT` 控制。默认配置下它是开启的；如果显式关闭，则 gateway 异常退出不会再自动放大为 wrapper 非零退出。

### 3. stop 语义

当前 fork 的目标偏向“bot 永远在线”，因此即使某些 stop 路径最终表现为整容器重启，也属于可接受行为；本次改动重点不是保留 stop 语义，而是避免**正常 restart 被误放大成整容器重启**。

## 与容器重启策略的关系

本改动只是减少“正常 restart 被误判”的概率，不替代容器本身的 restart policy。

如果希望 gateway / wrapper 异常退出后自动恢复，容器运行时仍应开启 restart policy，例如：

- Docker Compose: `restart: always`
- 或 `restart: unless-stopped`

## 建议验证的核心场景

以下是本次变更后建议优先验证的场景。

### A. 正常 restart 不重启容器

1. 在容器内执行 `openclaw gateway restart`
2. 观察：
   - 容器本身不重建
   - gateway 恢复服务
   - 不出现 wrapper 主进程退出
   - 最好确认 PID 保持不变或至少不是 fresh PID 竞争导致的失败

### B. 配置变更触发 restart

1. 通过 config patch / apply 或其他会触发 gateway restart 的路径修改配置
2. 观察：
   - gateway 正常 reload / restart
   - 容器不被整体验证为重启
   - 不再出现“PID 变了但端口仍占用导致起不来”的问题

## 验证结果 (2026-04-12)

已完成对核心生命周期场景的实地验证，确认现行守护逻辑符合预期：

### 1. 正常受控重启 (SIGUSR1) - 验证通过

- **操作**：容器内执行 `kill -10 66` (SIGUSR1)。
- **结果**：Gateway 触发 `in-process restart`，保持 PID 66 不变，日志确认 `OPENCLAW_NO_RESPAWN` 模式生效，容器未重建，服务无中断。

### 2. 异常崩溃恢复 (SIGKILL) - 验证通过

- **操作**：容器内执行 `kill -9 66`。
- **结果**：Wrapper 检测到非预期退出，打印 `[wrapper] gateway exited unexpectedly; exiting wrapper with code 1` 并退出进程。容器运行环境（Coolify）检测到 Wrapper 退出，触发容器级自动重建，成功恢复运行环境。

### 3. 手动停止 (Stop Container) - 验证通过

- **操作**：通过 Coolify API 或 `docker stop` 手动停止容器。
- **结果**：Wrapper 捕获退出信号并优雅关闭，容器进入正常停止状态，未发生非预期的自动重建。
  结论：当前 fork 的三层防护机制（同进程热重载、守护进程兜底、系统级管理）已构成闭环。

## 备注

本改动主要优化“wrapper 托管 gateway + 容器 supervisor”这一组合场景，不改变 upstream 对非容器 / 非 wrapper 模式的默认重启设计。
