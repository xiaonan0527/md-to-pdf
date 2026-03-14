---
name: md-to-pdf
description: Convert Markdown to a beautiful PDF with AI-generated cover image. Supports custom themes, header/footer, Mermaid diagrams, and cover/content separation. Use when user asks to convert a markdown file or document to PDF, generate a PDF report, or create a professional PDF from text content.
trigger: 当用户要求将 Markdown 转换为 PDF、生成 PDF 报告、或将文档导出为 PDF 时触发
---

# Markdown to PDF Skill

将 Markdown 文档转换为专业 PDF，支持 AI 生成封面图、Mermaid 流程图渲染、页眉页脚、杂志风排版。

## 核心特性

- ✅ **封面与内容分离**：封面单独生成（无边距，背景图全出血），内容页独立生成，最终合并
- ✅ **AI 封面生图**：调用 Gemini Pro 生成与主题匹配的封面图
- ✅ **Mermaid 渲染**：自动识别并渲染 flowchart/graph/sequenceDiagram 等图表
- ✅ **页眉页脚**：每页显示文档标题、版本、作者、页码
- ✅ **靛蓝紫主题**：专业科技感配色，表格、代码块、标题均有精心样式

## 快速使用

```bash
# 基础转换（自动生成封面）
node {baseDir}/scripts/convert.cjs \
  --input article.md \
  --output output.pdf \
  --title "文档标题" \
  --author "作者名"

# 指定封面图（跳过 AI 生图）
node {baseDir}/scripts/convert.cjs \
  --input article.md \
  --output output.pdf \
  --title "文档标题" \
  --cover-image /path/to/cover.png

# 不生成封面
node {baseDir}/scripts/convert.cjs \
  --input article.md \
  --output output.pdf \
  --no-cover
```

## 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--input` / `-i` | 输入 Markdown 文件路径（必填） | - |
| `--output` / `-o` | 输出 PDF 路径（必填） | - |
| `--title` | 文档标题（封面 + 页眉） | 从 MD 第一个 H1 提取 |
| `--subtitle` | 副标题（封面） | - |
| `--author` | 作者名（页脚中间） | - |
| `--version` | 版本号（封面 + 页眉） | V1.0 |
| `--date` | 日期（封面 + 页眉） | 今天 |
| `--cover-image` | 封面图路径（与 `--cover-prompt` 二选一） | - |
| `--cover-prompt` | 封面图生成 prompt（调用 Gemini Pro） | 自动生成 |
| `--no-cover` | 不生成封面页 | false |
| `--confidential` | 页脚显示 CONFIDENTIAL 标注 | false |
| `--gemini-api-key` | Gemini API Key（也可用环境变量 GEMINI_API_KEY） | - |
| `--gemini-proxy` | Gemini 代理地址（也可用环境变量 GEMINI_PRO_PROXY） | - |

## 工作流程

```
输入 Markdown
  ↓
提取标题/元数据
  ↓
[可选] 调用 Gemini Pro 生成封面图
  ↓
生成封面 PDF（margin: 0，无页眉页脚）
  ↓
生成内容 PDF（margin: 22mm，含页眉页脚，Mermaid 渲染）
  ↓
pdf-lib 合并封面 + 内容
  ↓
输出最终 PDF
```

## 依赖安装

```bash
cd {baseDir}/scripts
npm install
```

依赖：`puppeteer`、`marked`、`pdf-lib`

## Gemini 生图

封面图通过 Gemini Pro 生成（`gemini-3-pro-image-preview`），需要：
- 设置环境变量 `GEMINI_API_KEY`
- 如需代理，设置 `GEMINI_PRO_PROXY=http://127.0.0.1:7890`

如果不需要 AI 生图，用 `--cover-image` 直接提供图片，或 `--no-cover` 跳过封面。

## 示例：生成技术文档

```bash
export GEMINI_API_KEY=your_key_here
export GEMINI_PRO_PROXY=http://127.0.0.1:7890

node {baseDir}/scripts/convert.cjs \
  --input /path/to/design-doc.md \
  --output /tmp/design-doc.pdf \
  --title "系统设计文档" \
  --subtitle "后端架构 V2.0" \
  --author "张三" \
  --version "V2.0" \
  --confidential \
  --cover-prompt "A modern tech architecture diagram with blue-purple gradient, server nodes, data flow arrows, clean minimal style, professional document cover"
```
