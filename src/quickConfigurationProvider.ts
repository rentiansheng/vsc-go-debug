import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GoDebugConfiguration } from './goDebugConfigurationProvider';
import { ConfigurationEditorProvider } from './configurationEditorProvider';

export class QuickConfigurationProvider implements vscode.TreeDataProvider<QuickConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<QuickConfigItem | undefined | null | void> = new vscode.EventEmitter<QuickConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<QuickConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private configurations: GoDebugConfiguration[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.loadConfigurations();
        this.setupFileWatchers();
    }

    refresh(): void {
        this.loadConfigurations();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: QuickConfigItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: QuickConfigItem): Thenable<QuickConfigItem[]> {
        if (!element) {
            const items: QuickConfigItem[] = [];

            // Add quick create button
            items.push(new QuickConfigItem(
                '$(plus) Create New Configuration',
                'Click to create a new debug configuration',
                vscode.TreeItemCollapsibleState.None,
                'createConfig',
                {
                    command: 'goDebugPro.createConfigurationWithEditor',
                    title: 'Create Configuration',
                    arguments: []
                }
            ));

            // Add existing configurations
            this.configurations.forEach(config => {
                const description = this.getConfigDescription(config);
                items.push(new QuickConfigItem(
                    config.name,
                    description,
                    vscode.TreeItemCollapsibleState.None,
                    'quickConfig',
                    {
                        command: 'goDebugPro.runDebugFromQuick',
                        title: 'Run Configuration',
                        arguments: [config]
                    },
                    config
                ));
            });

            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    }

    private getConfigDescription(config: GoDebugConfiguration): string {
        if (config.request === 'launch') {
            if (config.mode === 'test') {
                return `🧪 Test • ${this.getShortPath(config.program || '')}`;
            }
            return `🚀 Launch • ${this.getShortPath(config.program || '')}`;
        } else if (config.request === 'attach') {
            return `🔗 Attach • ${config.mode || 'local'}`;
        }
        return config.type;
    }

    private getShortPath(fullPath: string): string {
        if (fullPath.includes('${workspaceFolder}')) {
            return fullPath.replace('${workspaceFolder}', '');
        }
        return path.basename(fullPath);
    }

    private loadConfigurations(): void {
        this.configurations = [];
        
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const launchJsonPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
                if (fs.existsSync(launchJsonPath)) {
                    try {
                        const content = fs.readFileSync(launchJsonPath, 'utf8');
                        const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                        const launchConfig = JSON.parse(cleanContent);
                        if (launchConfig.configurations) {
                            // Filter for Go debug configurations
                            const goConfigs = launchConfig.configurations.filter((config: any) => 
                                config.type === 'go-debug-pro' || config.type === 'go'
                            );
                            this.configurations.push(...goConfigs);
                        }
                    } catch (error) {
                        console.error('Error reading launch.json:', error);
                    }
                }
            }
        }
    }

    private setupFileWatchers(): void {
        this.watchers.forEach(watcher => watcher.dispose());
        this.watchers = [];

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

    public async runConfiguration(config: GoDebugConfiguration): Promise<void> {
        const success = await vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders?.[0],
            config
        );

        if (success) {
            vscode.window.showInformationMessage(`Started debugging: ${config.name}`);
        } else {
            vscode.window.showErrorMessage(`Failed to start debugging: ${config.name}`);
        }
    }

    public async editConfiguration(config: GoDebugConfiguration): Promise<void> {
        ConfigurationEditorProvider.showConfigurationEditor(this.context, config, true);
    }

    dispose(): void {
        this.watchers.forEach(watcher => watcher.dispose());
    }
}

export class QuickConfigItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly command?: vscode.Command,
        public readonly configuration?: GoDebugConfiguration
    ) {
        super(label, collapsibleState);
        
        this.description = description;
        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
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

        if (config.mode) {
            tooltip += `\nMode: ${config.mode}`;
        }

        tooltip += '\n\nClick to run this configuration';

        return tooltip;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.contextValue) {
            case 'createConfig':
                return new vscode.ThemeIcon('add', new vscode.ThemeColor('charts.green'));
            case 'quickConfig':
                if (this.configuration?.request === 'launch') {
                    if (this.configuration.mode === 'test') {
                        return new vscode.ThemeIcon('beaker', new vscode.ThemeColor('charts.orange'));
                    }
                    return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
                } else if (this.configuration?.request === 'attach') {
                    return new vscode.ThemeIcon('debug-alt', new vscode.ThemeColor('charts.blue'));
                }
                return new vscode.ThemeIcon('gear');
            default:
                return new vscode.ThemeIcon('file');
        }
    }
}
