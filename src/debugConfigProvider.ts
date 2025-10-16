import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GoDebugConfiguration } from './goDebugConfigurationProvider';

// Import the ConfigurationStateManager from extension.ts
declare global {
    var getConfigurationStateManager: () => any;
}

export class DebugConfigurationProvider implements vscode.TreeDataProvider<DebugConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DebugConfigItem | undefined | null | void> = new vscode.EventEmitter<DebugConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DebugConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _configurations: DebugConfigItem[] = [];
    private _isMultiFolder: boolean = false;


    private changeMultiToTrue() {
        this._isMultiFolder = true;
    }

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
        if (vscode.workspace.workspaceFolders.length > 1) {
            this.changeMultiToTrue();
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
                            const debugConfig = config as GoDebugConfiguration;
                            if (this._isMultiFolder) {
                                debugConfig.itemName = `${debugConfig.name} (${folder.name})`;
                            }else {
                                debugConfig.itemName = debugConfig.name;
                            }
                            debugConfig.vscWorkspaceFolder = folder.uri.fsPath;
                            debugConfig.vscWorkspaceName = folder.name;


                            const item = new DebugConfigItem(
                                config.name || `Configuration ${index + 1}`,
                                config,
                                launchJsonPath,
                                folder,
                                this._isMultiFolder,
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
            goRoot: '',
            goPath: '',
            dlvFlags: [],
            mode: 'debug',
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
        // Find the workspace folder that matches the configuration's workspace path
        const workspaceFolder = vscode.workspace.workspaceFolders?.find(
            folder => folder.uri.fsPath === item.configuration.vscWorkspaceFolder
        );

        if (!workspaceFolder) {
            vscode.window.showErrorMessage(
                `Cannot find workspace folder for path: ${item.configuration.vscWorkspaceFolder}`
            );
            return;
        }

        try {
            await vscode.debug.startDebugging(workspaceFolder, item.configuration);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to start debugging: ${error}`);
        }
    }

    public findConfigurationByName(name: string): GoDebugConfiguration | undefined {
        const item =  this._configurations.find(config => config.configuration.name === name);
        if(!item) {
            return  undefined;
        }
        return item.configuration;
    }

    public findConfigurationByItemName(itemName: string): GoDebugConfiguration | undefined {
        const item =  this._configurations.find(config => config.configuration.itemName === itemName);
        if(!item) {
            return  undefined;
        }
        return item.configuration;
    }

    public refreshConfigurationState(configName: string): void {
        const item = this._configurations.find(config => config.configuration.itemName === configName);
        if (item) {
            item.refreshConfigurationState();
            this._onDidChangeTreeData.fire(item);
        }
    }
    



}

export class DebugConfigItem extends vscode.TreeItem {
    public readonly  workspace: string = "";
    constructor(
        public readonly label: string,
        public readonly configuration: GoDebugConfiguration,
        public readonly filePath: string,
        public readonly vscFolder: vscode.WorkspaceFolder,
        public readonly isMutiltiFolder?: boolean
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.workspace = vscFolder.uri.fsPath;
        this.configuration.vscWorkspaceFolder = this.workspace;
        this.tooltip = this.generateTooltip();
        this.description = `${vscFolder.name}`;
        
    
       this.refreshConfigurationState();

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

    public refreshConfigurationState(): void {
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
            this.iconPath = new vscode.ThemeIcon('debug');
         
        }
    
    }

    private isConfigurationRunning(): boolean {
        try {
            const stateManager = (global as any).getConfigurationStateManager?.();
            return stateManager?.isConfigRunning(this.configuration.itemName) || false;
        } catch {
            return false;
        }
    }

    private getRunningState(): {mode: 'run' | 'debug', terminal: vscode.Terminal, startTime: number} | undefined {
        try {
            const stateManager = (global as any).getConfigurationStateManager?.();
            return stateManager?.getConfigState(this.configuration.itemName);
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
        
        tooltip += `Workspace: ${this.workspace}\n`;
        if(config.goRoot) {
            tooltip += `Go Root: ${config.goRoot}\n`;
        }
        if(config.goPath) {
            tooltip += `Go Path: ${config.goPath}\n`;
        }
        if(config.dlvFlags && config.dlvFlags.length > 0) {
            tooltip += `Delve Flags: ${config.dlvFlags.join(' ')}\n`;
        }
        if(config.dlvToolPath) {
            tooltip += `Delve Tool Path: ${config.dlvToolPath}\n`;
        }
       
        return tooltip;
    }
}
