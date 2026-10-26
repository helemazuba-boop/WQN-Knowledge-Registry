# WQN OpenCode 分类工作区示例

把这个目录完整发布给 OpenCode V2，以本目录为工作区。不要漏掉隐藏的 `.opencode/`。
本版一题一个新会话；中断恢复原会话；模型使用服务已有默认配置。

```text
registry/
├── README.md
├── opencode.jsonc
├── CATALOG.md
├── bundle.json
├── documents/
│   ├── physics.skill.move.001.md
│   └── ...
└── .opencode/
    ├── agents/mark.md
    └── skills/mark/SKILL.md
```

`opencode.jsonc` 连接唯一的分类 MCP；`mark.md` 只允许读目录/文档、加载 mark Skill 和调用分类工具。
Skill 指导按科目读目录、批量读相关文档、区分目标/必需与推荐/备选、引用原文并提交回执。
当前包含 76 项物理 Skill，Knowledge 定义尚为空，缺失项返回 unresolved。

1. 将 workspace 的 `bundle.json` 同步到 WQN App，并保证 App lock、数据库 active canonical registry 一致。
2. 为 OpenCode 运行账号配置现有 provider/默认模型；必须能处理验收题所需图片。
3. 在 OpenCode 服务进程中设置以下变量，然后启动/重启该服务：

```dotenv
WQN_MARK_MCP_URL=https://wqn.example.com/api/mcp/mark
PROBLEM_MARKING_AGENT_SECRET=REPLACE_WITH_SHARED_MARK_SECRET
```

使用独立账号的 V2 后台服务示例，替换域名和两个不同用途的密钥：

```bash
opencode --version
opencode service set hostname 0.0.0.0
opencode service set port 4096
opencode service set password 'REPLACE_WITH_OPENCODE_PASSWORD'
opencode service set env WQN_MARK_MCP_URL https://wqn.example.com/api/mcp/mark
opencode service set env PROBLEM_MARKING_AGENT_SECRET 'REPLACE_WITH_SHARED_MARK_SECRET'
opencode service start
```

这些命令配置的是当前运行账号的后台服务。端口和认证以前置实际版本帮助及 `/openapi.json` 为准。
若服务已存在，只在其他终端 export 变量不会更新服务环境。官方说明：
[OpenCode V2 服务](https://dev.opencode.ai/v2/docs/cli/web/)。

WQN worker 对应的环境示例：

```dotenv
PROBLEM_MARKING_ENGINE=agent
PROBLEM_MARKING_AGENT_SECRET=REPLACE_WITH_SHARED_MARK_SECRET
WQN_MARK_APP_URL=http://wqn-app:3000
WQN_MARK_OPENCODE_URL=http://10.0.0.20:4096
WQN_MARK_OPENCODE_DIRECTORY=/srv/wqn-mark/registry
WQN_MARK_OPENCODE_USERNAME=opencode
WQN_MARK_OPENCODE_PASSWORD=REPLACE_WITH_OPENCODE_PASSWORD
WQN_MARK_CONCURRENCY=1
```

`WQN_MARK_OPENCODE_DIRECTORY` 必须是 **OpenCode 主机**能读取的本目录绝对路径。
Windows 可用 `C:/WQN/mark-workspace`；Compose 的 App URL 使用 `http://wqn:3000`。
替换示例 IP。分类密钥由 App、worker、MCP 共享；OpenCode HTTP 密码由 worker 与服务对应。

worker 自动发送 run_id/task_token，并用 `mark` agent 创建新会话。流程是：

1. `wqn_mark_get_mark_context` 获取单题客观材料与结果 schema。
2. 读 CATALOG.md，再读相关 documents/ 文件，需要时调用 `wqn_mark_read_mark_images`。
3. `wqn_mark_submit_mark_result` 提交分类与精确证据。
4. 用 `wqn_mark_get_mark_receipt` 核对不确定提交；收到 accepted 回执后结束。

正常聊天没有任务凭据，不能直接提交。不要手工填写或伪造 task_token。
先用 `/api/agent`、`/api/mcp` 验证 mark 和 wqn_mark 已加载，再让 WQN 重新排队一题。
完整云端部署、迁移、测试、导出和回退步骤位于 WQN：
`web/server/mark-worker/DEPLOYMENT.zh-CN.md`。
