# Go Debug Pro 测试指南

## 🧪 测试程序说明

我们创建了一个完整的测试程序 `test-program/main.go`，包含了各种调试场景。

## 🚀 测试步骤

### 1. 启动扩展开发模式

1. 在当前 VS Code 窗口中按 `F5`
2. 这会打开一个新的 Extension Development Host 窗口
3. 在新窗口中打开 `test-program` 文件夹

### 2. 测试基本调试功能

1. 打开 `test-program/main.go`
2. 按 `F5` 开始调试
3. 选择 "Go Debug Pro 测试" 配置
4. 程序应该正常启动并运行

### 3. 测试条件断点

1. 在第 33 行设置条件断点：
   ```go
   if i > 5 {
   ```
2. 右键选择 "Toggle Conditional Breakpoint"
3. 输入条件：`i > 7`
4. 程序应该只在 i=8, 9 时停止

### 4. 测试 Hit Count 断点

1. 在第 37 行设置 Hit Count 断点：
   ```go
   processNumber(i)
   ```
2. 右键选择 "Set Hit Count Breakpoint"
3. 输入条件：`%3` (每3次触发)
4. 程序应该在第3、6、9次调用时停止

### 5. 测试监视表达式

1. 启动调试并停在某个断点
2. 打开 "Go Debug Pro Watch" 面板
3. 添加以下监视表达式：
   - `counter`
   - `i`
   - `person.Name`
   - `len(numbers)`
   - `scores["math"]`
4. 观察这些表达式在程序执行时的实时变化

### 6. 测试调用栈和线程

1. 在 `calculateSum` 函数内设置断点（第 73 行）
2. 当程序停止时，查看：
   - **Call Stack**: 应该显示完整的调用链
   - **Threads**: 显示当前的 goroutine
   - **Variables**: 显示局部变量和参数

### 7. 测试 Step 操作

当程序停在断点时，测试：
- **Step Over** (F10): 跳过函数调用
- **Step Into** (F11): 进入函数内部
- **Step Out** (Shift+F11): 跳出当前函数
- **Continue** (F5): 继续执行

### 8. 测试表达式求值

1. 停在断点时，将鼠标悬停在变量上
2. 应该显示变量的当前值
3. 在 Debug Console 中输入表达式：
   - `i + counter`
   - `person.Age * 2`
   - `numbers[0]`

## 🎯 预期结果

### 条件断点测试
- 程序输出：
```
大于5的循环: i=8, counter=9
大于5的循环: i=9, counter=10
```

### Hit Count 断点测试
- 应该在循环的第3、6、9次时停止

### 监视面板测试
- 所有监视表达式应该实时更新
- 复杂对象应该可以展开查看

### 调用栈测试
- 在 `calculateSum` 中应该看到：
```
calculateSum (main.go:73)
main (main.go:49)
```

## 🐛 常见问题

### 1. Delve 未安装
```bash
go install github.com/go-delve/delve/cmd/dlv@latest
```

### 2. 端口占用
如果 2345 端口被占用，重启 VS Code 或结束相关进程

### 3. 断点不生效
确保 Go 程序是以调试模式编译的（扩展会自动处理）

## 📊 测试检查清单

- [ ] 基本调试启动
- [ ] 条件断点功能
- [ ] Hit Count 断点
- [ ] 监视表达式自动刷新
- [ ] 调用栈显示
- [ ] 线程/Goroutine 管理
- [ ] 变量查看
- [ ] Step 操作
- [ ] 表达式求值
- [ ] 悬停显示值

完成所有测试后，你的 Go Debug Pro 扩展就已经具备了专业级的调试能力！🎉
