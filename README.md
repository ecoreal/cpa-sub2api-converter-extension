# Browser Extension

[English](README.en.md) · 中文

这是 CPA 批量转换器的浏览器插件版本，适合 Chrome 和 Edge 的开发者模式加载。

## 目录

- `manifest.json`: Manifest V3 配置
- `popup.html`: 扩展弹窗入口
- `dashboard.html`: 完整工作台页面
- `converter-core.js`: 本地转换核心
- `dashboard.js`: 工作台交互逻辑
- `icons/`: 扩展图标资源
- `store-listing.md`: Chrome Web Store 上架文案草稿
- `privacy-policy.md`: 隐私政策草稿
- `package-extension.sh`: 打包脚本

## 加载方式

1. 打开 Chrome 或 Edge 的扩展管理页
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择本目录（即包含 `manifest.json` 的目录）。

图标已随仓库提交（`icons/`）；如果需要替换，直接覆盖同名 PNG 即可。

## 使用方式

1. 点击扩展图标
2. 在弹窗中打开工作台
3. 导入多个 CPA JSON 文件，或直接导入整个目录
4. 按需填写 `type` 过滤条件
5. 下载生成的 `sub2api-account-{timestamp}.json`，或配置远程服务后直接上传

## 远程上传

工作台支持两个远程目标：

- CLIProxyAPI：上传原始 CPA JSON 到 `POST /v0/management/auth-files`，认证头使用 `Authorization: Bearer <Management Key>`。
- sub2api：导入转换后的 `sub2api-data` 到 `POST /api/v1/admin/accounts/data`，认证头使用 `x-api-key: <Admin API Key>`。如果你的部署修改了 `VITE_API_BASE_URL`，在页面里调整 API 前缀。

服务地址和普通偏好保存在 `chrome.storage.local`；Management Key 和 Admin API Key 只保存在当前扩展会话中，不写入持久化存储。只有点击对应上传按钮或测试连接时才会发起网络请求。

远程地址必须使用 HTTPS；仅允许 `localhost`、`127.0.0.1` 和 `::1` 使用 HTTP。本地开发地址不接受用户名、密码、查询参数或片段。

导入最多处理 500 个 JSON 文件，单文件不超过 8 MiB、总大小不超过 32 MiB；远程响应和 ZIP 导出也有大小上限，并带有请求超时。

每个服务都有“测试连接”按钮：

- CLIProxyAPI：请求 `GET /v0/management/auth-files`，只验证 Management Key 和接口可用性。
- sub2api：请求 `GET /api/v1/admin/accounts?page=1&page_size=1`，只验证 Admin API Key 和接口可用性。

## 设计说明

- 不依赖后端接口
- 默认不发起网络请求；远程上传功能会请求用户配置的 CLIProxyAPI/sub2api 服务
- 使用 `chrome.storage.local` 保存筛选条件和文件名前缀；远程密钥仅使用会话存储
- 数据只在扩展页本地处理

## 本地检查

项目包含不依赖第三方包的静态检查和转换核心回归测试：

```bash
python3 scripts/check.py
python3 scripts/test_check.py
node scripts/test-core.js
node scripts/test-remote-request.js
```

`check.py` 会校验扩展清单、关键文件、manifest/HTML/JS 引用图无断链、远程 URL 校验、HTML 输出转义和明显的硬编码 API Key。
`test-core.js` 使用合成数据验证转换文件名不会产生路径穿越或 ZIP Slip 成员路径。

## 打包

在当前目录执行：

```bash
sh package-extension.sh
```

脚本会从 `manifest.json` 和弹窗/工作台的 HTML 引用图自动推导需要打包的文件
（含 JS 模块依赖），引用缺失的文件会直接报错；输出生成在
`dist/cpa-to-sub2api-extension-<version>.zip`，可直接上传 Chrome Web Store。

## 上架前还需要补的内容

- 把 `privacy-policy.md` 发布到一个公开可访问的 URL
- 准备 1-4 张商店截图
- 根据你的发布主体信息调整 `store-listing.md`
