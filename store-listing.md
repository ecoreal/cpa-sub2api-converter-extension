# Chrome Web Store Listing Draft

## Name

CPA to sub2api Converter

## Summary

在浏览器本地批量将 CPA 账号 JSON 转换为 sub2api 账号 JSON。

## Description

CPA to sub2api Converter 是一个面向本地文件处理的浏览器扩展，用于把多个 CPA 账号导出的 JSON 批量转换成 sub2api 可导入的账号 JSON。

这个扩展的设计重点是本地处理和最小权限：

- 支持多文件选择
- 支持整目录导入
- 支持按 `type` 过滤，例如 `codex`
- 支持预览输出结果
- 支持复制或下载最终 JSON
- 不依赖远端 API
- 不上传文件内容

适用场景：

- 你已经持有 CPA 格式的账号导出文件
- 你需要批量生成 sub2api 账号配置
- 你不希望把敏感 token 发送到第三方服务端

## Single Purpose

将用户本地选择的 CPA JSON 文件批量转换为 sub2api JSON 文件。

## Permissions Justification

`storage`

用于保存用户在扩展中的本地偏好设置，例如 `type` 过滤条件和导出文件名前缀。不会用于上传或同步账号内容。

## Data Handling Disclosure

- 扩展读取用户手动选择的本地 JSON 文件
- 文件内容仅在当前浏览器扩展页面中处理
- 不会将账号文件、token、邮箱或转换结果发送到外部服务器
- 不会出售用户数据
- 不会将数据用于广告或追踪

## Suggested Category

Developer Tools

## Suggested Screenshots

- 弹窗首页
- 工作台空状态
- 导入文件后的结果预览
- 下载生成 JSON 的界面
