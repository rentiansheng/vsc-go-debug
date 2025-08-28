# Go Debug Pro

🚀 一个功能强大的 VS Code Golang 调试扩展，提供类似 GoLand 的专业级调试体验。

![VS Code Version](https://img.shields.io/badge/VS%20Code-1.103.0+-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-blue)

## ✨ 主要特性

### � 智能配置管理
- **单击打开配置**：单击配置项直接打开可视化编辑器
- **右键操作菜单**：复制配置、删除配置等快捷操作
- **统一菜单整合**：清理重复菜单，提供简洁的用户界面
- **命令面板简化**：只在命令面板中显示新建配置相关命令

### � 可视化配置编辑器
- **图形化界面**：无需手写 JSON，通过可视化界面创建和编辑调试配置
- **实时预览**：配置更改实时显示，所见即所得
- **模板支持**：提供多种预设模板，快速创建不同类型的配置
- **智能验证**：自动验证配置的正确性，防止配置错误

### �️ 高级调试功能
- **条件断点**：支持基于表达式的条件断点设置
- **Hit Count 断点**：支持命中次数控制的断点
- **自动刷新监视**：监视表达式自动刷新，实时查看变量变化
- **完整调试支持**：Call Stack、Threads、Variables 全面支持

### 📂 项目结构支持
- **多种运行模式**：支持单文件、包、目录、模块、工作区等运行方式
- **智能路径检测**：自动检测 go.mod 文件和 Go 包结构
- **工作区管理**：统一管理多个工作区的调试配置

## 🚀 快速开始

### 前置条件

确保已安装 [Delve](https://github.com/go-delve/delve) 调试器：

```bash
go install github.com/go-delve/delve/cmd/dlv@latest
```

### 安装扩展

1. 在 VS Code 扩展市场搜索 "Go Debug Pro"
2. 点击安装
3. 重启 VS Code（如果需要）

### 创建第一个调试配置

1. 按 `Shift + Cmd + P` 打开命令面板
2. 搜索 "Create Configuration (Visual Editor)"
3. 选择配置类型并填写参数
4. 保存配置即可开始调试

## 📖 使用指南

### 配置管理

#### 创建新配置
- **命令面板方式**：`Shift + Cmd + P` → "Create Configuration (Visual Editor)"
- **面板方式**：在调试面板点击 "Enhanced configuration" 视图的 "+" 按钮

#### 管理现有配置
- **单击配置项**：直接打开可视化编辑器
- **右键配置项**：显示操作菜单（复制、删除等）
- **实时同步**：所有更改自动同步到 `launch.json` 文件

### 调试操作

#### 设置条件断点
1. 在代码行右键
2. 选择 "Toggle Conditional Breakpoint"
3. 输入条件表达式（如：`x > 5 && y != nil`）

#### 使用监视表达式
1. 调试时打开 "Go Debug Pro Watch" 面板
2. 点击 "+" 按钮添加表达式
3. 表达式值会自动刷新显示

## ⚙️ 配置选项

### Launch 配置
```json
{
    "name": "Launch Go Program",
    "type": "go-debug-pro",
    "request": "launch",
    "program": "${workspaceFolder}/main.go",
    "cwd": "${workspaceFolder}",
    "env": {},
    "args": [],
    "stopOnEntry": false
}
```

### Attach 配置
```json
{
    "name": "Attach to Process",
    "type": "go-debug-pro",
    "request": "attach",
    "processId": "${command:pickProcess}",
    "mode": "local"
}
```

## 🎹 快捷键

| 功能 | Windows/Linux | macOS |
|------|---------------|-------|
| 条件断点 | `Ctrl+Shift+F9` | `Cmd+Shift+F9` |
| 刷新监视 | `Ctrl+Shift+R` | `Cmd+Shift+R` |

## 🏗️ 项目架构

```
src/
├── extension.ts              # 扩展入口文件
├── debugAdapter.ts          # Debug Adapter 实现
├── debugConfigProvider.ts   # 配置树视图提供器
├── configurationEditorProvider.ts  # 可视化编辑器
├── watchProvider.ts         # 监视表达式提供器
├── breakpointManager.ts     # 断点管理器
└── delveClient.ts          # Delve 客户端
```

## 🛠️ 开发

### 环境准备
```bash
# 克隆项目
git clone <repository-url>
cd go-debug

# 安装依赖
npm install
```

### 开发命令
```bash
# 编译项目
npm run compile

# 监视模式编译
npm run watch

# 运行测试
npm test

# 代码检查
npm run lint
```

### 调试扩展
1. 按 `F5` 启动扩展开发宿主
2. 在新窗口中测试扩展功能
3. 在原窗口中设置断点调试扩展代码

## 🐛 问题排查

### 常见问题

1. **Delve 未安装**
   ```bash
   go install github.com/go-delve/delve/cmd/dlv@latest
   ```

2. **配置无效**
   - 检查 Go 程序路径是否正确
   - 确认工作目录设置
   - 验证环境变量配置

3. **断点不生效**
   - 确保代码已编译
   - 检查断点设置的行是否有效
   - 验证调试器连接状态

## 🤝 贡献指南

我们欢迎任何形式的贡献！

### 报告问题
- 使用 GitHub Issues 报告 bug
- 提供详细的重现步骤
- 包含相关的错误日志

### 提交代码
1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 发起 Pull Request

### 开发规范
- 遵循 TypeScript 编码规范
- 编写单元测试
- 更新相关文档

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE)。

## 🙏 致谢

感谢以下项目和社区的支持：
- [Delve](https://github.com/go-delve/delve) - Go 调试器
- [VS Code](https://code.visualstudio.com/) - 开发环境
- [Go 社区](https://golang.org/) - 语言支持

---

**享受高效的 Go 调试体验！** 🎉
