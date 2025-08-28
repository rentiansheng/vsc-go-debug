# Change Log

Go Debug Pro 扩展的更改日志。

## [0.0.1] - 2025-08-28

### 新增功能 (Added)
- 🎯 智能配置管理系统
  - 单击配置项直接打开可视化编辑器
  - 右键菜单提供复制、删除等快捷操作
  - 整合重复菜单，提供简洁的用户界面
- 🔧 可视化配置编辑器
  - 图形化界面创建和编辑调试配置
  - 实时预览配置更改
  - 支持多种预设模板
- 🛠️ 高级调试功能
  - 条件断点支持 (Ctrl+Shift+F9 / Cmd+Shift+F9)
  - Hit Count 断点功能
  - 自动刷新监视表达式 (Ctrl+Shift+R / Cmd+Shift+R)
  - 完整的 Call Stack、Threads、Variables 支持
- 📂 多种运行模式支持
  - 单文件模式调试
  - Go 包调试
  - 目录调试
  - 模块调试
  - 工作区调试
- 🎛️ 配置管理面板
  - Enhanced configuration 树视图
  - 分类显示 Launch、Attach、Test 配置
  - 实时同步 launch.json 文件变化

### 优化改进 (Improved)
- 简化命令面板，只显示 "Create Configuration (Visual Editor)" 命令
- 优化用户界面，移除冗余的菜单项
- 改进配置验证和错误处理
- 增强 Delve 调试器集成

### 技术特性 (Technical)
- 基于 TypeScript 5.9+ 开发
- 使用 Debug Adapter Protocol
- 集成 Delve 调试器
- 支持 VS Code 1.103.0+

---

## 发布说明格式

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

### 版本类型
- **Added** - 新增功能
- **Changed** - 功能变更
- **Deprecated** - 即将废弃的功能
- **Removed** - 已删除的功能
- **Fixed** - 问题修复
- **Security** - 安全性修复