# dsh-deeptutor

面向 **DeepSeek Harness (dsh)** 的 DeepTutor 桥接 **bundle**,从 pi 编码 agent 扩展迁移而来(`TecFancy/pi-extensions`,`extensions/deeptutor` + `skills/deeptutor`)。

注册三个模型可见工具,驱动 [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) 辅导服务:

| 工具 | 用途 |
|---|---|
| `deeptutor_run` | 运行学习能力: `deep_solve` / `deep_question` / `deep_research` / `chat` / `mastery_path` / `visualize` / `math_animator`(优先 HTTP/WS,CLI 回退) |
| `deeptutor_kb` | 列出 / 搜索 / 查看个人知识库(RAG)信息 |
| `deeptutor_note` | 将 Markdown 学习笔记归档到服务端 notebook |

部署模式自动适配:本机本地 `serve`(或本地 CLI),或通过自动建立的 SSH 隧道访问服务器(含 SSH CLI 回退)。

## 安装到 profile(bundle 方式)

包已发布到 npm(`dsh-deeptutor`)。bundle 安装分两步:(1) 将 npm 包装入 profile;(2) 将其列入 profile 的 `dsh.profile.bundles`,让加载器真正挂载它。

```sh
# 1. 将 npm 包装入 profile(转发给 pnpm)
dsh plugin --profile web add dsh-deeptutor
```

```json
// 2. 在 profile 清单(~/.dsh/profiles/<name>/package.json)中加入 bundle
{
  "dependencies": { "dsh-deeptutor": "^0.1.0" },
  "dsh": {
    "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-deeptutor"] }
  }
}
```

两步缺一不可:在 dsh CLI 0.1.0-rc.x 中,`dsh plugin add` 只是 pnpm 转发器——它只安装依赖,**不会**修改 `dsh.profile.bundles`;跳过第 2 步会导致包已安装却从未被加载。安装后需重启 dsh(bundle 列表在启动时解析)。

也可以不动清单,改用用户 patch 层挂载 bundle(仍需先安装 npm 包):

```yaml
# overlay.yml —— 通过用户 patch 层插入 bundle 行
- insert:
    - id: dsh-deeptutor
      name: 'dsh-deeptutor'
```

```sh
dsh web --patch ./overlay.yml
```

bundle 清单(`dsh.bundle.patch → cordis.patch.yml`)负责插入插件行;上层 patch 层可按 id 覆盖或禁用。

## 源码开发(无需发布)

```sh
dsh web --patch /path/to/dsh-deeptutor/cordis.yml
```

## 构建与发布

```sh
npm install
npm run build        # tsc → lib/(相对 .ts import 改写为 .js)
npm run typecheck
npm pack             # 检查 dsh-deeptutor-0.1.0.tgz
npm publish
```

通过 `--patch` 直接加载 `src/*.ts` 需要 Node ≥ 22.6(type stripping);发布的 bundle 自带编译后的 `lib/`,安装到 profile 后仅需普通 Node ≥ 20 ESM。

## Skills

面向 agent 的工作流位于 `deeptutor` skill,安装于 `~/.dsh/skills/deeptutor/SKILL.md`(dsh 自动发现)。配套的 `html-doc` skill(`~/.dsh/skills/html-doc/`)将学习内容渲染为自包含 HTML 页面;本插件内置同一转换器(`scripts/md-to-html.js`),当 `deeptutor_run` 传入 `html` 路径时自动使用。

## 配置(环境变量,与 agent 无关)

```bash
# 远程部署(DeepTutor 在服务器上,通过 SSH 隧道访问)
export DEEPTUTOR_SSH_HOST="tencent-cloud"           # SSH 主机别名(设置 = 远程模式)
export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"   # 本地隧道地址
export DEEPTUTOR_REMOTE_BIN="/home/ubuntu/my-deeptutor/.venv/bin/deeptutor"
export DEEPTUTOR_REMOTE_HOME="/home/ubuntu/my-deeptutor"

# 本地部署 —— 不要设置 DEEPTUTOR_SSH_HOST
# export DEEPTUTOR_API_BASE="http://127.0.0.1:8001"  # 本地 serve 端口
# export DEEPTUTOR_LOCAL_BIN="deeptutor"             # 本地 CLI 路径(默认: PATH 上的 deeptutor)
```

修改环境变量后需重启 dsh。

## 目录结构

```
src/                 # TypeScript 源码(开发加载、类型检查)
lib/                 # 编译产物(发布入口,由 npm run build 生成)
scripts/md-to-html.js  # 零依赖 Markdown → HTML 转换器
cordis.yml           # 开发 overlay:按绝对路径插入 src/index.ts
cordis.patch.yml     # bundle patch:按包名插入插件
```

`src/index.ts` 注册工具;`config.ts` 环境配置;`cli-exec.ts` 本地/SSH CLI 执行;`http-api.ts` API 探测 + SSH 隧道;`turn.ts` 单次学习回合(WebSocket / CLI 事件折叠与格式化);`html-render.ts` 答案 → 自包含 HTML。
