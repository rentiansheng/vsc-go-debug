# 项目结构说明

本项目是一个功能强大的 VS Code Golang 调试扩展，提供类似 GoLand 的专业级调试体验。

## 项目架构

```
go-debug-pro/
├── src/                          # TypeScript 源代码
│   ├── extension.ts             # 扩展入口文件
│   ├── debugAdapter.ts         # Debug Adapter 实现
│   ├── debugAdapterOptimized.ts # 优化的 Debug Adapter
│   ├── debugConfigProvider.ts  # 配置树视图提供器
│   ├── configurationEditorProvider.ts # 可视化编辑器
│   ├── debugConfigWebview.ts   # 配置管理 Webview
│   ├── watchProvider.ts        # 监视表达式提供器
│   ├── breakpointManager.ts    # 断点管理器
│   ├── delveClient.ts          # Delve 客户端
│   ├── runConfigManager.ts     # 运行配置管理器
│   ├── runConfigWebview.ts     # 运行配置 Webview
│   ├── goDebugConfigurationProvider.ts # Go 调试配置提供器
│   └── quickConfigurationProvider.ts   # 快速配置提供器
├── out/                         # 编译输出目录
├── test-program/               # 测试用的 Go 程序
├── .vscode/                    # VS Code 配置
├── node_modules/               # npm 依赖
├── package.json               # 扩展清单文件
├── tsconfig.json              # TypeScript 配置
├── eslint.config.mjs          # ESLint 配置
├── README.md                  # 项目说明文档
├── CHANGELOG.md               # 更改日志
├── LICENSE                    # 许可证文件
├── .gitignore                 # Git 忽略文件
└── .vscodeignore             # VS Code 打包忽略文件
```

## 核心组件

### 1. 扩展入口 (extension.ts)
- 扩展激活和注销逻辑
- 命令注册
- 事件监听器设置
- 全局状态管理

### 2. 调试适配器 (debugAdapter.ts / debugAdapterOptimized.ts)
- 实现 Debug Adapter Protocol (DAP)
- 与 Delve 调试器通信
- 处理调试会话生命周期
- 断点、变量、调用栈管理

### 3. 配置管理器
- **debugConfigProvider.ts**: 配置树视图
- **configurationEditorProvider.ts**: 可视化编辑器
- **runConfigManager.ts**: 运行配置管理
- **quickConfigurationProvider.ts**: 快速配置

### 4. 调试功能
- **breakpointManager.ts**: 条件断点、Hit Count 断点
- **watchProvider.ts**: 监视表达式自动刷新
- **delveClient.ts**: Delve 调试器客户端

### 5. 用户界面
- **debugConfigWebview.ts**: 配置管理 Webview
- **runConfigWebview.ts**: 运行配置 Webview
- 树视图集成
- 命令面板集成

## 开发流程

### 环境设置
1. 安装 Node.js 和 npm
2. 安装 TypeScript: `npm install -g typescript`
3. 安装 Delve: `go install github.com/go-delve/delve/cmd/dlv@latest`

### 开发命令
```bash
npm install        # 安装依赖
npm run compile    # 编译 TypeScript
npm run watch      # 监视模式编译
npm test           # 运行测试
npm run lint       # 代码检查
```

### 调试扩展
1. 在 VS Code 中打开项目
2. 按 F5 启动扩展开发宿主
3. 在新窗口中测试扩展功能
4. 在原窗口中设置断点调试

## 发布流程

### 准备发布
1. 更新版本号 (package.json)
2. 更新 CHANGELOG.md
3. 运行测试确保功能正常
4. 编译项目: `npm run compile`

### 打包发布
```bash
# 安装 vsce (VS Code Extension Manager)
npm install -g vsce

# 打包扩展
vsce package

# 发布到市场 (需要配置发布者账号)
vsce publish
```

## 代码规范

### TypeScript 规范
- 使用严格的 TypeScript 配置
- 遵循 ESLint 规则
- 添加类型注解
- 编写 JSDoc 注释

### 文件命名
- 使用 camelCase 命名文件
- 类文件以大写字母开头
- 接口以 I 开头
- 类型以 T 开头

### 代码组织
- 单一职责原则
- 合理的文件分割
- 清晰的模块导入导出
- 适当的错误处理

## 测试策略

### 单元测试
- 使用 Mocha + Chai
- 测试核心功能模块
- Mock 外部依赖

### 集成测试
- 测试扩展激活
- 测试命令执行
- 测试调试会话

### 手动测试
- 不同 Go 项目结构
- 各种调试场景
- 用户界面交互

## 部署注意事项

### 依赖管理
- 只包含运行时必需的依赖
- 使用 .vscodeignore 排除开发文件
- 验证打包后的扩展大小

### 兼容性
- 支持 VS Code 1.103.0+
- 兼容不同操作系统
- 支持不同 Go 版本

### 性能优化
- 延迟加载非关键组件
- 优化文件监听器
- 减少内存占用
