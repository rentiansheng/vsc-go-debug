import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface RunConfiguration {
    name: string;
    type: string;
    request: string;
    program?: string;
    args?: string[];
    env?: { [key: string]: string };
    cwd?: string;
    mode?: string;
    buildFlags?: string[];
    dlvFlags?: string[];
    showLog?: boolean;
    logOutput?: string;
    stopOnEntry?: boolean;
}

export class RunConfigurationManager implements vscode.TreeDataProvider<RunConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<RunConfigItem | undefined | null | void> = new vscode.EventEmitter<RunConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<RunConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private configurations: RunConfiguration[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];

    constructor() {
        this.loadConfigurations();
        this.setupFileWatchers();
    }

    refresh(): void {
        this.loadConfigurations();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: RunConfigItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: RunConfigItem): Thenable<RunConfigItem[]> {
        if (!element) {
            // Root level - show configuration categories
            const categories = [
                new RunConfigItem('Launch Configurations', '', vscode.TreeItemCollapsibleState.Expanded, 'category-launch'),
                new RunConfigItem('Attach Configurations', '', vscode.TreeItemCollapsibleState.Expanded, 'category-attach'),
                new RunConfigItem('Test Configurations', '', vscode.TreeItemCollapsibleState.Expanded, 'category-test')
            ];
            return Promise.resolve(categories);
        }

        // Show configurations for each category
        const items: RunConfigItem[] = [];
        
        if (element.contextValue === 'category-launch') {
            const launchConfigs = this.configurations.filter(config => config.request === 'launch');
            items.push(...launchConfigs.map(config => new RunConfigItem(
                config.name,
                this.getConfigurationDescription(config),
                vscode.TreeItemCollapsibleState.None,
                'runConfig',
                config
            )));
        } else if (element.contextValue === 'category-attach') {
            const attachConfigs = this.configurations.filter(config => config.request === 'attach');
            items.push(...attachConfigs.map(config => new RunConfigItem(
                config.name,
                this.getConfigurationDescription(config),
                vscode.TreeItemCollapsibleState.None,
                'runConfig',
                config
            )));
        } else if (element.contextValue === 'category-test') {
            // For now, we'll show test-related configurations
            const testConfigs = this.configurations.filter(config => 
                config.name.toLowerCase().includes('test') || 
                config.program?.includes('test')
            );
            items.push(...testConfigs.map(config => new RunConfigItem(
                config.name,
                this.getConfigurationDescription(config),
                vscode.TreeItemCollapsibleState.None,
                'runConfig',
                config
            )));
        }

        return Promise.resolve(items);
    }

    private getConfigurationDescription(config: RunConfiguration): string {
        if (config.request === 'launch') {
            return config.program || 'Launch configuration';
        } else if (config.request === 'attach') {
            return 'Attach to process';
        }
        return config.type;
    }

    private loadConfigurations(): void {
        this.configurations = [];
        
        // Load from all workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const launchJsonPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
                if (fs.existsSync(launchJsonPath)) {
                    try {
                        const content = fs.readFileSync(launchJsonPath, 'utf8');
                        const launchConfig = JSON.parse(content);
                        if (launchConfig.configurations) {
                            this.configurations.push(...launchConfig.configurations);
                        }
                    } catch (error) {
                        console.error('Error reading launch.json:', error);
                    }
                }
            }
        }
    }

    private setupFileWatchers(): void {
        // Clear existing watchers
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchers = [];

        // Setup watchers for all workspace folders
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const launchJsonPattern = new vscode.RelativePattern(folder, '.vscode/launch.json');
                const watcher = vscode.workspace.createFileSystemWatcher(launchJsonPattern);
                
                watcher.onDidChange(() => this.refresh());
                watcher.onDidCreate(() => this.refresh());
                watcher.onDidDelete(() => this.refresh());
                
                this.watchers.push(watcher);
            }
        }
    }

    public async createNewConfiguration(): Promise<void> {
        const configType = await vscode.window.showQuickPick([
            { label: 'Launch Go Program', value: 'launch' },
            { label: 'Attach to Process', value: 'attach' },
            { label: 'Launch Go Test', value: 'test' }
        ], { placeHolder: 'Select configuration type' });

        if (!configType) {
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: 'Enter configuration name',
            placeHolder: 'My Go Program'
        });

        if (!name) {
            return;
        }

        let newConfig: RunConfiguration;

        switch (configType.value) {
            case 'launch':
                const program = await vscode.window.showInputBox({
                    prompt: 'Enter program path',
                    placeHolder: '${workspaceFolder}/main.go'
                });
                
                newConfig = {
                    name,
                    type: 'go-debug-pro',
                    request: 'launch',
                    program: program || '${workspaceFolder}/main.go',
                    cwd: '${workspaceFolder}',
                    env: {},
                    args: []
                };
                break;

            case 'attach':
                newConfig = {
                    name,
                    type: 'go-debug-pro',
                    request: 'attach',
                    mode: 'local'
                };
                break;

            case 'test':
                newConfig = {
                    name,
                    type: 'go-debug-pro',
                    request: 'launch',
                    mode: 'test',
                    program: '${workspaceFolder}',
                    args: ['-test.run', 'TestName']
                };
                break;

            default:
                return;
        }

        await this.addConfigurationToLaunchJson(newConfig);
    }

    public async editConfiguration(item: RunConfigItem): Promise<void> {
        if (!item.configuration) {
            return;
        }

        const configJson = JSON.stringify(item.configuration, null, 2);
        const doc = await vscode.workspace.openTextDocument({
            content: configJson,
            language: 'json'
        });
        
        await vscode.window.showTextDocument(doc);
    }

    public async duplicateConfiguration(item: RunConfigItem): Promise<void> {
        if (!item.configuration) {
            return;
        }

        const name = await vscode.window.showInputBox({
            prompt: 'Enter new configuration name',
            value: `${item.configuration.name} (Copy)`
        });

        if (!name) {
            return;
        }

        // Create a clean copy of the configuration without circular references
        const newConfig: any = {
            name: name,
            type: item.configuration.type,
            request: item.configuration.request,
            program: item.configuration.program,
            cwd: item.configuration.cwd,
            env: item.configuration.env ? { ...item.configuration.env } : {},
            args: item.configuration.args ? [...item.configuration.args] : [],
            stopOnEntry: item.configuration.stopOnEntry,
            mode: item.configuration.mode,
            buildFlags: item.configuration.buildFlags,
            dlvFlags: item.configuration.dlvFlags,
            showLog: item.configuration.showLog,
            logOutput: item.configuration.logOutput
        };

        // Remove undefined properties
        Object.keys(newConfig).forEach(key => {
            if (newConfig[key] === undefined) {
                delete newConfig[key];
            }
        });

        await this.addConfigurationToLaunchJson(newConfig);
    }

    public async deleteConfiguration(item: RunConfigItem): Promise<void> {
        if (!item.configuration) {
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete configuration "${item.configuration.name}"?`,
            'Delete', 'Cancel'
        );

        if (confirm === 'Delete') {
            await this.removeConfigurationFromLaunchJson(item.configuration.name);
        }
    }

    public async runConfiguration(item: RunConfigItem): Promise<void> {
        if (!item.configuration) {
            return;
        }

        // Start debugging with this configuration
        const success = await vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders?.[0],
            item.configuration.name
        );

        if (success) {
            vscode.window.showInformationMessage(`Started debugging: ${item.configuration.name}`);
        } else {
            vscode.window.showErrorMessage(`Failed to start debugging: ${item.configuration.name}`);
        }
    }

    private async addConfigurationToLaunchJson(config: RunConfiguration): Promise<void> {
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

        // Read existing launch.json if it exists
        if (fs.existsSync(launchJsonPath)) {
            try {
                const content = fs.readFileSync(launchJsonPath, 'utf8');
                launchConfig = JSON.parse(content);
            } catch (error) {
                console.error('Error reading launch.json:', error);
            }
        }

        // Add new configuration
        launchConfig.configurations.push(config);

        // Write back to launch.json
        const vscodePath = path.dirname(launchJsonPath);
        if (!fs.existsSync(vscodePath)) {
            fs.mkdirSync(vscodePath, { recursive: true });
        }

        fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
        
        vscode.window.showInformationMessage(`Configuration "${config.name}" added successfully`);
        this.refresh();
    }

    private async removeConfigurationFromLaunchJson(configName: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
        
        if (!fs.existsSync(launchJsonPath)) {
            return;
        }

        try {
            const content = fs.readFileSync(launchJsonPath, 'utf8');
            const launchConfig = JSON.parse(content);
            
            if (launchConfig.configurations) {
                launchConfig.configurations = launchConfig.configurations.filter(
                    (config: any) => config.name !== configName
                );
                
                fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
                
                vscode.window.showInformationMessage(`Configuration "${configName}" deleted successfully`);
                this.refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error deleting configuration: ${error}`);
        }
    }

    dispose(): void {
        this.watchers.forEach(watcher => watcher.dispose());
    }
}

export class RunConfigItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly configuration?: RunConfiguration
    ) {
        super(label, collapsibleState);
        
        this.description = description;
        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        
        // Add command for run configs (避免循环引用)
        if (contextValue === 'runConfig') {
            this.command = {
                command: 'goDebugPro.showRunConfigDetails',
                title: 'Show Details',
                arguments: [{
                    configuration: this.configuration,
                    label: this.label,
                    contextValue: this.contextValue
                }]
            };
        }
    }

    private getTooltip(): string {
        if (!this.configuration) {
            return this.label;
        }

        const config = this.configuration;
        let tooltip = `Name: ${config.name}\nType: ${config.type}\nRequest: ${config.request}`;
        
        if (config.program) {
            tooltip += `\nProgram: ${config.program}`;
        }
        
        if (config.args && config.args.length > 0) {
            tooltip += `\nArgs: ${config.args.join(' ')}`;
        }
        
        if (config.cwd) {
            tooltip += `\nCwd: ${config.cwd}`;
        }

        return tooltip;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.contextValue) {
            case 'category-launch':
                return new vscode.ThemeIcon('rocket');
            case 'category-attach':
                return new vscode.ThemeIcon('debug-alt');
            case 'category-test':
                return new vscode.ThemeIcon('beaker');
            case 'runConfig':
                return this.configuration?.request === 'launch' 
                    ? new vscode.ThemeIcon('play') 
                    : new vscode.ThemeIcon('debug-alt');
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}
