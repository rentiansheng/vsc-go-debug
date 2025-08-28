# 🎛️ 调试配置管理界面使用说明

## 🚀 功能特点

Go Debug Pro 现在提供了一个完整的图形化界面来管理你的调试配置，让你可以：

- 📋 **可视化查看**所有调试配置
- ➕ **创建新配置**
- ✏️ **编辑现有配置**
- 📋 **复制配置**
- 🗑️ **删除不需要的配置**
- ▶️ **一键运行调试**
- 📊 **详细信息查看**

## 🔍 界面概览

### Debug Configurations 面板

在 VS Code 的调试视图中，你会看到一个新的 "Debug Configurations" 面板，显示了：

```
📁 Debug Configurations
├── 🐛 Go Debug Pro - Test Program (go-debug-pro • workspace)
├── 🐛 Go Debug Pro - Stop on Entry (go-debug-pro • workspace)
└── 🔧 Standard Go Debug (go • workspace)
```

每个配置项显示：
- 配置名称
- 调试器类型
- 所属工作区

## 🎮 操作指南

### 查看配置详情
1. 点击任意配置项
2. 会打开详细信息面板，显示：
   - 基本配置信息
   - 命令行参数
   - 环境变量
   - 完整的 JSON 配置

### 创建新配置
1. 点击面板标题栏的 ➕ 按钮
2. 输入配置名称
3. 输入程序路径
4. 自动生成并保存到 launch.json

### 运行调试
1. 右键点击配置项
2. 选择 "Run Configuration"
3. 或者在详情面板点击 "▶️ Run Debug"

### 编辑配置
1. 右键点击配置项
2. 选择 "Edit Configuration"
3. 直接打开 launch.json 文件进行编辑

### 复制配置
1. 右键点击要复制的配置
2. 选择 "Duplicate Configuration"
3. 输入新名称
4. 自动创建副本

### 删除配置
1. 右键点击要删除的配置
2. 选择 "Delete Configuration"
3. 确认删除

## 📱 详细信息面板

点击配置项会打开一个专门的详细信息面板，包含：

### 📋 基本配置
```
Name: Go Debug Pro - Test Program
Type: go-debug-pro
Request: launch
Program: ${workspaceFolder}/test-program/main.go
Working Directory: ${workspaceFolder}/test-program
Stop on Entry: No
```

### ⚙️ 参数列表
如果配置包含命令行参数，会以列表形式显示

### 🌍 环境变量
以表格形式显示所有环境变量

### 📝 完整配置
显示 JSON 格式的完整配置内容

### 🎛️ 操作按钮
- **▶️ Run Debug**: 立即运行调试
- **✏️ Edit Configuration**: 编辑配置文件
- **📋 Duplicate**: 复制配置
- **🗑️ Delete**: 删除配置

## 🔄 自动同步

配置管理界面会自动监听 launch.json 文件的变化：
- 当你手动编辑 launch.json 时，界面会自动刷新
- 添加、删除、修改配置都会实时反映在界面上

## 💡 使用技巧

1. **多工作区支持**: 如果你打开了多个工作区，每个工作区的配置都会显示，并标明所属工作区

2. **类型识别**: 不同类型的调试器会显示不同的图标：
   - 🐛 go-debug-pro 配置（绿色调试图标）
   - 🔧 其他类型配置（默认调试图标）

3. **快速访问**: 在详情面板中可以快速执行所有操作，无需返回配置列表

4. **状态提示**: 操作完成后会显示成功提示消息

## 🎯 适用场景

- **项目切换**: 快速在不同的调试配置间切换
- **配置管理**: 统一管理所有调试配置
- **团队协作**: 清晰了解项目中的所有调试选项
- **配置调试**: 快速测试和调整调试参数

这个界面让调试配置管理变得直观和高效，特别适合有多个调试配置的复杂项目！🚀
