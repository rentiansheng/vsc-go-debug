import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Import the ConfigurationStateManager from extension.ts
declare global {
    var getConfigurationStateManager: () => any;
}

export class DebugConfigurationProvider implements vscode.TreeDataProvider<DebugConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DebugConfigItem | undefined | null | void> = new vscode.EventEmitter<DebugConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DebugConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _configurations: DebugConfigItem[] = [];

    constructor() {
        this.loadDebugConfigurations();
        
        // 监听 launch.json 文件变化
        const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/launch.json');
        watcher.onDidChange(() => this.refresh());
        watcher.onDidCreate(() => this.refresh());
        watcher.onDidDelete(() => this.refresh());
    }

    refresh(): void {
        this.loadDebugConfigurations();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DebugConfigItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: DebugConfigItem): Promise<DebugConfigItem[]> {
        if (!element) {
            return Promise.resolve(this._configurations);
        }
        return Promise.resolve([]);
    }

    private loadDebugConfigurations(): void {
        this._configurations = [];
        
        if (!vscode.workspace.workspaceFolders) {
            return;
        }

        for (const folder of vscode.workspace.workspaceFolders) {
            const launchJsonPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
            
            if (fs.existsSync(launchJsonPath)) {
                try {
                    const content = fs.readFileSync(launchJsonPath, 'utf8');
                    // 移除注释的简单方法
                    const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                    const launchConfig = JSON.parse(cleanContent);
                    
                    if (launchConfig.configurations) {
                        launchConfig.configurations.forEach((config: any, index: number) => {
                            const item = new DebugConfigItem(
                                config.name || `Configuration ${index + 1}`,
                                config,
                                folder.name,
                                launchJsonPath
                            );
                            this._configurations.push(item);
                        });
                    }
                } catch (error) {
                    console.error('Error parsing launch.json:', error);
                }
            }
        }
    }

    public async createNewConfiguration(): Promise<void> {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        const folder = vscode.workspace.workspaceFolders[0];
        const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
        const launchJsonPath = path.join(vscodeDir, 'launch.json');

        // 确保 .vscode 目录存在
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // 获取配置名称
        const name = await vscode.window.showInputBox({
            prompt: 'Enter configuration name',
            value: 'Go Debug Pro Configuration'
        });

        if (!name) {
            return;
        }

        // 获取程序路径
        const program = await vscode.window.showInputBox({
            prompt: 'Enter program path',
            value: '${workspaceFolder}/main.go'
        });

        if (!program) {
            return;
        }

        const newConfig = {
            name,
            type: 'go-debug-pro',
            request: 'launch',
            program,
            cwd: '${workspaceFolder}',
            env: {},
            args: [],
            stopOnEntry: false
        };

        let launchConfig: any;
        
        if (fs.existsSync(launchJsonPath)) {
            // 读取现有配置
            try {
                const content = fs.readFileSync(launchJsonPath, 'utf8');
                const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                launchConfig = JSON.parse(cleanContent);
            } catch (error) {
                launchConfig = { version: '0.2.0', configurations: [] };
            }
        } else {
            launchConfig = { version: '0.2.0', configurations: [] };
        }

        // 添加新配置
        launchConfig.configurations.push(newConfig);

        // 保存文件
        fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 4));
        
        this.refresh();
    }

    public async editConfiguration(item: DebugConfigItem): Promise<void> {
        const uri = vscode.Uri.file(item.filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document);
    }

    public async duplicateConfiguration(item: DebugConfigItem): Promise<void> {
        const newName = await vscode.window.showInputBox({
            prompt: 'Enter new configuration name',
            value: `${item.label} (Copy)`
        });

        if (!newName) {
            return;
        }

        try {
            const content = fs.readFileSync(item.filePath, 'utf8');
            const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            const launchConfig = JSON.parse(cleanContent);

            // Create a clean copy of the configuration without circular references
            const newConfig: any = {
                name: newName,
                type: item.configuration.type,
                request: item.configuration.request,
                program: item.configuration.program,
                cwd: item.configuration.cwd,
                env: item.configuration.env ? { ...item.configuration.env } : {},
                args: item.configuration.args ? [...item.configuration.args] : [],
                stopOnEntry: item.configuration.stopOnEntry,
                mode: item.configuration.mode,
                buildFlags: item.configuration.buildFlags,
                trace: item.configuration.trace,
                showLog: item.configuration.showLog,
                logOutput: item.configuration.logOutput
            };

            // Remove undefined properties
            Object.keys(newConfig).forEach(key => {
                if (newConfig[key] === undefined) {
                    delete newConfig[key];
                }
            });

            launchConfig.configurations.push(newConfig);
            fs.writeFileSync(item.filePath, JSON.stringify(launchConfig, null, 4));

            this.refresh();
            vscode.window.showInformationMessage(`Configuration duplicated as "${newName}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to duplicate configuration: ${error}`);
        }
    }

    public async deleteConfiguration(item: DebugConfigItem): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${item.label}"?`,
            'Yes', 'No'
        );

        if (confirmation !== 'Yes') {
            return;
        }

        try {
            const content = fs.readFileSync(item.filePath, 'utf8');
            const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
            const launchConfig = JSON.parse(cleanContent);

            launchConfig.configurations = launchConfig.configurations.filter(
                (config: any) => config.name !== item.configuration.name
            );

            fs.writeFileSync(item.filePath, JSON.stringify(launchConfig, null, 4));

            this.refresh();
            vscode.window.showInformationMessage(`Configuration "${item.label}" deleted`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete configuration: ${error}`);
        }
    }

    public async runConfiguration(item: DebugConfigItem): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.find(
            folder => item.filePath.startsWith(folder.uri.fsPath)
        );

        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Cannot find workspace folder');
            return;
        }

        await vscode.debug.startDebugging(workspaceFolder, item.configuration);
    }
}

export class DebugConfigItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly configuration: any,
        public readonly workspace: string,
        public readonly filePath: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = this.generateTooltip();
        this.description = `${configuration.type} • ${workspace}`;
        
        // Check if configuration is currently running
        const isRunning = this.isConfigurationRunning();
        
        if (isRunning) {
            // Configuration is running - show different context and icons
            const state = this.getRunningState();
            this.contextValue = 'debugConfigRunning';
            
            if (state?.mode === 'debug') {
                this.iconPath = new vscode.ThemeIcon('debug-restart', new vscode.ThemeColor('debugIcon.restartForeground'));
                this.description += ' • Debugging';
            } else {
                this.iconPath = new vscode.ThemeIcon('run-above', new vscode.ThemeColor('debugIcon.continueForeground'));
                this.description += ' • Running';
            }
        } else {
            // Configuration is not running - show normal context and icons
            this.contextValue = 'debugConfig';
            
            if (configuration.type === 'go-debug-pro') {
                this.iconPath = new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('debugIcon.startForeground'));
            } else {
                this.iconPath = new vscode.ThemeIcon('debug');
            }
        }

        // 添加命令 - 单击时打开配置编辑器（避免循环引用）
        this.command = {
            command: 'goDebugPro.editConfigurationWithEditor',
            title: 'Edit Configuration',
            arguments: [{
                configuration: this.configuration,
                workspace: this.workspace,
                filePath: this.filePath,
                label: this.label
            }]
        };
    }

    private isConfigurationRunning(): boolean {
        try {
            const stateManager = (global as any).getConfigurationStateManager?.();
            return stateManager?.isConfigRunning(this.configuration.name) || false;
        } catch {
            return false;
        }
    }

    private getRunningState(): {mode: 'run' | 'debug', terminal: vscode.Terminal, startTime: number} | undefined {
        try {
            const stateManager = (global as any).getConfigurationStateManager?.();
            return stateManager?.getConfigState(this.configuration.name);
        } catch {
            return undefined;
        }
    }

    private generateTooltip(): string {
        const config = this.configuration;
        let tooltip = `Name: ${config.name}\n`;
        tooltip += `Type: ${config.type}\n`;
        tooltip += `Request: ${config.request}\n`;
        
        if (config.program) {
            tooltip += `Program: ${config.program}\n`;
        }
        
        if (config.cwd) {
            tooltip += `Working Directory: ${config.cwd}\n`;
        }
        
        if (config.args && config.args.length > 0) {
            tooltip += `Arguments: ${config.args.join(' ')}\n`;
        }
        
        if (config.stopOnEntry) {
            tooltip += `Stop on Entry: Yes\n`;
        }
        
        tooltip += `\nWorkspace: ${this.workspace}`;
        
        return tooltip;
    }
}
