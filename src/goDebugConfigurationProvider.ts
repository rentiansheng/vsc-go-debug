import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface GoDebugConfiguration extends vscode.DebugConfiguration {
    // Standard VSCode Go debug configuration properties
    program?: string;
    args?: string[];
    env?: { [key: string]: string };
    cwd?: string;
    mode?: 'debug' | 'test' | 'exec' | 'core' | 'replay' | 'connect' | 'local' | 'remote';
    buildFlags?: string;  // Changed from array to string for VSCode compatibility
    dlvFlags?: string[];
    showLog?: boolean;
    trace?: string;       // VSCode Go extension uses 'trace' instead of 'logOutput'
    stopOnEntry?: boolean;
    host?: string;
    port?: number;
    processId?: string | number;
    substitutePath?: { from: string; to: string }[];
    remotePath?: string;
    
    // Internal editor properties (not saved to launch.json)
    runMode?: 'file' | 'package' | 'directory' | 'module' | 'workspace';
    packagePath?: string;
    mainFile?: string;
    workingDir?: string;
}

export class GoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    
    /**
     * 提供初始调试配置，这些会显示在 Run and Debug 面板的下拉列表中
     */
    async provideDebugConfigurations(folder: vscode.WorkspaceFolder | undefined, token?: vscode.CancellationToken): Promise<GoDebugConfiguration[]> {
        const configs: GoDebugConfiguration[] = [];
        
        // 从 launch.json 读取现有配置
        const existingConfigs = this.loadExistingConfigurations(folder);
        configs.push(...existingConfigs);
        
        // 如果没有配置，提供默认配置
        if (configs.length === 0) {
            configs.push(
                {
                    name: "Launch Go Program",
                    type: "go",
                    request: "launch",
                    mode: "debug",
                    program: "${workspaceFolder}/main.go",
                    cwd: "${workspaceFolder}",
                    env: {},
                    args: []
                },
                {
                    name: "Debug Go Tests",
                    type: "go", 
                    request: "launch",
                    mode: "test",
                    program: "${workspaceFolder}",
                    args: ["-test.v"]
                },
                {
                    name: "Attach to Process",
                    type: "go",
                    request: "attach",
                    mode: "local",
                    processId: "${command:pickProcess}"
                }
            );
        }
        
        return configs;
    }

    /**
     * 在启动调试之前解析和验证配置
     */
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined, 
        config: GoDebugConfiguration, 
        token?: vscode.CancellationToken
    ): Promise<GoDebugConfiguration | null | undefined> {
        
        // 如果没有配置，返回 undefined 让 VS Code 显示配置选择器
        if (!config.type && !config.request && !config.name) {
            return undefined;
        }

        // 确保必要的字段存在
        if (!config.type) {
            config.type = 'go-debug-pro';
        }

        if (!config.request) {
            config.request = 'launch';
        }

        // 为 launch 配置设置默认值
        if (config.request === 'launch') {
            if (!config.program) {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.languageId === 'go') {
                    config.program = activeEditor.document.uri.fsPath;
                } else {
                    config.program = '${workspaceFolder}/main.go';
                }
            }

            if (!config.cwd) {
                config.cwd = folder?.uri.fsPath || '${workspaceFolder}';
            }

            if (!config.env) {
                config.env = {};
            }

            if (!config.args) {
                config.args = [];
            }
        }

        // 为 attach 配置设置默认值
        if (config.request === 'attach') {
            if (!config.mode) {
                config.mode = 'local';
            }
        }

        return config;
    }

    /**
     * 从 launch.json 加载现有配置
     */
    private loadExistingConfigurations(folder: vscode.WorkspaceFolder | undefined): GoDebugConfiguration[] {
        if (!folder) {
            return [];
        }

        const launchJsonPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
        
        if (!fs.existsSync(launchJsonPath)) {
            return [];
        }

        try {
            const content = fs.readFileSync(launchJsonPath, 'utf8');
            // 移除 JSON 注释
            const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            const launchConfig = JSON.parse(cleanContent);
            
            if (launchConfig.configurations) {
                return launchConfig.configurations.filter((config: any) => 
                    config.type === 'go-debug-pro' || config.type === 'go'
                );
            }
        } catch (error) {
            console.error('Error reading launch.json:', error);
        }

        return [];
    }

    /**
     * 创建新的调试配置
     */
    async createNewConfiguration(): Promise<void> {
        const configType = await vscode.window.showQuickPick([
            { 
                label: '$(rocket) Launch Go Program', 
                description: 'Launch and debug a Go program',
                value: 'launch' 
            },
            { 
                label: '$(debug-alt) Attach to Process', 
                description: 'Attach debugger to running Go process',
                value: 'attach' 
            },
            { 
                label: '$(beaker) Debug Go Tests', 
                description: 'Debug Go unit tests',
                value: 'test' 
            }
        ], { 
            placeHolder: 'Select configuration type',
            matchOnDescription: true
        });

        if (!configType) {
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: 'Enter configuration name',
            placeHolder: 'My Go Program',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Name cannot be empty';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        let newConfig: GoDebugConfiguration;

        switch (configType.value) {
            case 'launch':
                newConfig = await this.createLaunchConfiguration(name);
                break;
            case 'attach':
                newConfig = await this.createAttachConfiguration(name);
                break;
            case 'test':
                newConfig = await this.createTestConfiguration(name);
                break;
            default:
                return;
        }

        await this.saveConfigurationToLaunchJson(newConfig);
        
        // 刷新调试配置列表
        vscode.commands.executeCommand('workbench.action.debug.configure');
    }

    private async createLaunchConfiguration(name: string): Promise<GoDebugConfiguration> {
        // 选择运行模式
        const runMode = await vscode.window.showQuickPick([
            { 
                label: '$(file-code) Single Go File', 
                description: 'Debug a single Go file',
                value: 'file' 
            },
            { 
                label: '$(package) Go Package', 
                description: 'Debug a Go package with main function',
                value: 'package' 
            },
            { 
                label: '$(folder) Directory', 
                description: 'Debug all Go files in a directory',
                value: 'directory' 
            },
            { 
                label: '$(extensions) Go Module', 
                description: 'Debug a Go module',
                value: 'module' 
            },
            { 
                label: '$(workspace) Workspace', 
                description: 'Debug the entire workspace',
                value: 'workspace' 
            }
        ], { 
            placeHolder: 'Select how you want to run your Go program',
            matchOnDescription: true
        });

        if (!runMode) {
            throw new Error('No run mode selected');
        }

        let program: string;
        let cwd: string;
        
        switch (runMode.value) {
            case 'file':
                program = await this.promptForFile();
                cwd = '${workspaceFolder}';
                break;
            case 'package':
                program = await this.promptForPackage();
                cwd = '${workspaceFolder}';
                break;
            case 'directory':
                program = await this.promptForDirectory();
                cwd = program;
                break;
            case 'module':
                program = await this.promptForModule();
                cwd = '${workspaceFolder}';
                break;
            case 'workspace':
                program = '${workspaceFolder}';
                cwd = '${workspaceFolder}';
                break;
            default:
                program = '${workspaceFolder}/main.go';
                cwd = '${workspaceFolder}';
        }

        return {
            name,
            type: 'go-debug-pro',
            request: 'launch',
            program,
            cwd,
            runMode: runMode.value as any,
            env: {},
            args: [],
            stopOnEntry: false,
            showLog: false,
            mode: 'debug'
        };
    }

    private async promptForFile(): Promise<string> {
        const files = await vscode.workspace.findFiles('**/*.go', '**/vendor/**');
        if (files.length === 0) {
            const manual = await vscode.window.showInputBox({
                prompt: 'Enter Go file path',
                placeHolder: '${workspaceFolder}/main.go'
            });
            return manual || '${workspaceFolder}/main.go';
        }

        const fileItems = files.map(file => ({
            label: vscode.workspace.asRelativePath(file),
            description: file.fsPath,
            value: file.fsPath
        }));

        const selected = await vscode.window.showQuickPick(fileItems, {
            placeHolder: 'Select Go file to debug'
        });

        return selected?.value || '${workspaceFolder}/main.go';
    }

    private async promptForPackage(): Promise<string> {
        const input = await vscode.window.showInputBox({
            prompt: 'Enter Go package path',
            placeHolder: './cmd/myapp or github.com/user/repo/cmd/myapp',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Package path cannot be empty';
                }
                return null;
            }
        });

        return input || '${workspaceFolder}';
    }

    private async promptForDirectory(): Promise<string> {
        const folders = await vscode.workspace.findFiles('**/go.mod', '**/vendor/**');
        const dirSet = new Set<string>();
        
        folders.forEach(file => {
            dirSet.add(vscode.workspace.asRelativePath(file.fsPath.replace('/go.mod', '')));
        });

        if (dirSet.size === 0) {
            const manual = await vscode.window.showInputBox({
                prompt: 'Enter directory path',
                placeHolder: '${workspaceFolder}/cmd/myapp'
            });
            return manual || '${workspaceFolder}';
        }

        const dirItems = Array.from(dirSet).map(dir => ({
            label: dir || '.',
            description: `Directory: ${dir || 'workspace root'}`,
            value: dir ? `\${workspaceFolder}/${dir}` : '${workspaceFolder}'
        }));

        // Add manual input option
        dirItems.unshift({
            label: '$(edit) Enter manually...',
            description: 'Type directory path manually',
            value: 'manual'
        });

        const selected = await vscode.window.showQuickPick(dirItems, {
            placeHolder: 'Select directory to debug'
        });

        if (selected?.value === 'manual') {
            const manual = await vscode.window.showInputBox({
                prompt: 'Enter directory path',
                placeHolder: '${workspaceFolder}/cmd/myapp'
            });
            return manual || '${workspaceFolder}';
        }

        return selected?.value || '${workspaceFolder}';
    }

    private async promptForModule(): Promise<string> {
        // 查找 go.mod 文件
        const goModFiles = await vscode.workspace.findFiles('**/go.mod', '**/vendor/**');
        
        if (goModFiles.length === 0) {
            vscode.window.showWarningMessage('No go.mod files found in workspace');
            return '${workspaceFolder}';
        }

        if (goModFiles.length === 1) {
            const modulePath = vscode.workspace.asRelativePath(goModFiles[0].fsPath.replace('/go.mod', ''));
            return modulePath ? `\${workspaceFolder}/${modulePath}` : '${workspaceFolder}';
        }

        const moduleItems = goModFiles.map(file => {
            const modulePath = vscode.workspace.asRelativePath(file.fsPath.replace('/go.mod', ''));
            return {
                label: modulePath || '.',
                description: `Module: ${file.fsPath}`,
                value: modulePath ? `\${workspaceFolder}/${modulePath}` : '${workspaceFolder}'
            };
        });

        const selected = await vscode.window.showQuickPick(moduleItems, {
            placeHolder: 'Select Go module to debug'
        });

        return selected?.value || '${workspaceFolder}';
    }

    private async createAttachConfiguration(name: string): Promise<GoDebugConfiguration> {
        const mode = await vscode.window.showQuickPick([
            { label: 'Local Process', value: 'local' },
            { label: 'Remote Process', value: 'remote' }
        ], { placeHolder: 'Select attach mode' });

        const config: GoDebugConfiguration = {
            name,
            type: 'go-debug-pro',
            request: 'attach',
            mode: (mode?.value as any) || 'local'
        };

        if (mode?.value === 'remote') {
            const host = await vscode.window.showInputBox({
                prompt: 'Enter remote host',
                placeHolder: 'localhost'
            });
            const port = await vscode.window.showInputBox({
                prompt: 'Enter remote port',
                placeHolder: '2345',
                validateInput: (value) => {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 1 || num > 65535) {
                        return 'Please enter a valid port number (1-65535)';
                    }
                    return null;
                }
            });

            config.host = host || 'localhost';
            config.port = parseInt(port || '2345');
        } else {
            config.processId = '${command:pickProcess}';
        }

        return config;
    }

    private async createTestConfiguration(name: string): Promise<GoDebugConfiguration> {
        const testPath = await vscode.window.showInputBox({
            prompt: 'Enter test package path',
            placeHolder: '${workspaceFolder}',
            value: '${workspaceFolder}'
        });

        const testName = await vscode.window.showInputBox({
            prompt: 'Enter specific test name (optional)',
            placeHolder: 'Leave empty to run all tests'
        });

        const config: GoDebugConfiguration = {
            name,
            type: 'go-debug-pro',
            request: 'launch',
            mode: 'test',
            program: testPath || '${workspaceFolder}',
            args: ['-test.v']
        };

        if (testName) {
            config.args!.push('-test.run', testName);
        }

        return config;
    }

    private async saveConfigurationToLaunchJson(config: GoDebugConfiguration): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
        
        let launchConfig: any = {
            version: '0.2.0',
            configurations: []
        };

        // 读取现有配置
        if (fs.existsSync(launchJsonPath)) {
            try {
                const content = fs.readFileSync(launchJsonPath, 'utf8');
                const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                launchConfig = JSON.parse(cleanContent);
            } catch (error) {
                console.error('Error reading launch.json:', error);
            }
        }

        // 添加新配置
        launchConfig.configurations.push(config);

        // 创建 .vscode 目录（如果不存在）
        const vscodePath = path.dirname(launchJsonPath);
        if (!fs.existsSync(vscodePath)) {
            fs.mkdirSync(vscodePath, { recursive: true });
        }

        // 写入文件
        fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
        
    }
}
