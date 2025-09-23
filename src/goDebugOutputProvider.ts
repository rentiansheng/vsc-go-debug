import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalStateManager, ConfigState, StateChangeEvent } from './globalStateManager';
import { runDebugConfiguration } from './extension';
import * as struct from './struct';
import {
    ContinuedEvent,
    DebugSession,
    ErrorDestination,
    Handles,
    InitializedEvent,
    logger,
    Logger,
    LoggingDebugSession,
    OutputEvent,
    Scope,
    Source,
    StackFrame,
    StoppedEvent,
    TerminatedEvent,
    Thread

} from 'vscode-debugadapter';

import { DebugProtocol } from 'vscode-debugprotocol';





export class GoDebugOutputProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'goDebugOutput';

    private _view?: vscode.WebviewView;
    private _outputTabs: Map<string, string[]> = new Map();
    private _configurations: any[] = [];
    private globalStateManager: GlobalStateManager;
    private stateChangeListener: vscode.Disposable;

    private static instance: GoDebugOutputProvider | null = null;

    constructor(private readonly _extensionUri: vscode.Uri) {
        // 初始化全局状态管理器
        this.globalStateManager = GlobalStateManager.getInstance();


        // 监听状态变化事件
        this.stateChangeListener = this.globalStateManager.onStateChange((event: StateChangeEvent) => {
            console.log(`[GoDebugOutputProvider] State change event for ${event.configName}:`, event);

            // 立即更新对应配置的工具栏状态
            this.updateToolbarState(event.configName);

            // 更新状态显示字段
            this.updateStateDisplayFields(event.configName, event.newState);

            // 如果配置正在运行，确保有对应的tab存在
            if (event.newState.state === 'running' && !this._outputTabs.has(event.configName)) {
                this.createTab(event.configName);
            }

            // 添加详细的状态变化输出日志，包含更多字段信息
            const oldStateInfo = event.oldState ?
                `[${event.oldState.action}:${event.oldState.state}]` : '[无状态]';
            const newStateInfo = `[${event.newState.action}:${event.newState.state}]`;
            const processInfo = event.newState.process ?
                ` (PID: ${event.newState.process.pid || 'N/A'})` : '';
            const timeInfo = ` at ${event.timestamp.toLocaleTimeString()}`;

            const statusMessage = `🔄 状态变化: ${oldStateInfo} → ${newStateInfo}${processInfo}${timeInfo}`;
            //this.addOutput(statusMessage, event.configName);

            // 根据新状态显示不同的信息
            if (event.newState.state === 'running') {
                const startMessage = event.newState.action === 'debug' ?
                    `🚀 调试会话已启动` : `🚀 运行会话已启动`;
                //this.addOutput(startMessage, event.configName);
            } else if (event.newState.state === 'stopped') {
                const stopMessage = event.newState.action === 'debug' ?
                    `⏹️ 调试会话已停止` : `⏹️ 运行会话已停止`;
                //this.addOutput(stopMessage, event.configName);
            } else if (event.newState.state === 'starting') {
                //this.addOutput(`⏳ 正在启动${event.newState.action === 'debug' ? '调试' : '运行'}会话...`, event.configName);
            }

            // 更新所有相关的UI组件
            this.updateStateDisplayFields(event.configName, event.newState);
        });

        // Don't create default tab anymore
        this.loadConfigurations();
        this.setupFileWatcher();
        this.setupDebugSessionListeners();

        // 设置定期状态同步
        this.setupPeriodicStateSync();

        // 设置持续时间更新定时器
        this.setupDurationUpdateTimer();
        GoDebugOutputProvider.instance = this;
    }

    public static getInstance(): GoDebugOutputProvider | null {
        return GoDebugOutputProvider.instance;
    }

    public static Output(message: string, tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.addOutput(message, tabName);
        }
        return;
    }

    public static Variables(variables: DebugProtocol.Variable[],  args: DebugProtocol.VariablesArguments, tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.updateVariables(tabName, variables);
        }

    }

    public static Stack(stacks: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }, tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.updateStack(tabName, stacks);
        }
    }
    public static Scopes(scopes: DebugProtocol.Scope[], tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.updateScopes(tabName, scopes);
        }
    }

    private setupDurationUpdateTimer(): void {
        // 每秒更新运行时间显示
        setInterval(() => {
            if (this._view) {
                const runningConfigs = this.globalStateManager.getRunningConfigs();
                runningConfigs.forEach(config => {
                    if (config.state === 'running') {
                        this._view!.webview.postMessage({
                            command: 'updateDuration',
                            tabName: config.name,
                            startTime: config.startTime
                        });
                    }
                });
            }
        }, 1000);
    }

    private setupPeriodicStateSync(): void {
        // 每5秒检查一次状态同步
        setInterval(() => {
            this.syncWithActiveDebugSessions();

            // 检查所有已知的tab是否有正确的工具栏状态
            for (const tabName of this._outputTabs.keys()) {
                this.updateToolbarState(tabName);
            }
        }, 5000);

        // 每秒更新运行时间显示
        setInterval(() => {
            this.updateRunningDurations();
        }, 1000);
    }

    /**
     * 更新所有运行中配置的持续时间显示
     */
    private updateRunningDurations(): void {
        const allStates = this.globalStateManager.getAllStates();
        for (const [configName, state] of allStates.entries()) {
            if (state.state === 'running' && state.startTime) {
                const duration = this.calculateDuration(state.startTime);
                if (this._view && duration) {
                    this._view.webview.postMessage({
                        command: 'updateDuration',
                        tabName: configName,
                        duration: duration
                    });
                }
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                vscode.Uri.joinPath(this._extensionUri, 'out'),
                vscode.Uri.joinPath(this._extensionUri, 'src', 'webview')
            ],
        };

        // Load HTML from index.html file
        webviewView.webview.html = this._getWebviewContent(webviewView.webview);

        // Update all toolbar states after content is loaded
        setTimeout(() => {
            this.updateAllToolbarStates();
        }, 100);

        // Set up delayed configuration refresh
        setTimeout(() => {
            console.log('[GoDebugOutputProvider] Delayed configuration refresh');
            this.loadConfigurations().then(() => {
                // 加载完配置后，创建对应的标签页
                this.createTabsForConfigurations();
            });
        }, 1000);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'toolbarAction':
                        this.handleToolbarAction(message.action, message.tabName);
                        break;
                    case 'gotoSource':
                        this.handleGotoSource(message.path, message.line, message.column);
                        break;
                    case 'get_variables':
                        this.getVariables(message.variablesReference, message.tabName);
                }
            },
            undefined
        );
    }

    private getVariables(variablesReference: number, tabName: string): void {
        if (this.globalStateManager) {
            var state = this.globalStateManager.getState(tabName);
            var session: vscode.DebugSession | null = state?.session || null;
            if (!session) {
                this._configurations.forEach(config => {
                    if (config.name === tabName && config.debugSession) {
                        session = config.debugSession;
                    }
                });
                if (!session) {
                    console.warn(`[GoDebugOutputProvider] No debug session found for tab: ${tabName}`);
                    return;
                }
            }

            session.customRequest('variables', { variablesReference: variablesReference }).then((response: any) => {
                if (response && response.variables) {
                    this._view?.webview.postMessage({
                        command: 'variables',
                        tabName: tabName,
                        variables: response.variables,
                        arguments: { variablesReference: variablesReference } as DebugProtocol.VariablesArguments,
                        child: true,
                    });
                }
            });

        }

    }

    private async loadConfigurations(): Promise<void> {
        console.log('[loadConfigurations] Starting configuration loading...');
        this._configurations = [];

        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const launchJsonPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
                console.log('[loadConfigurations] Checking launch.json at:', launchJsonPath);

                if (fs.existsSync(launchJsonPath)) {
                    try {
                        const content = fs.readFileSync(launchJsonPath, 'utf8');
                        const launch = JSON.parse(content);

                        if (launch.configurations && Array.isArray(launch.configurations)) {
                            console.log('[loadConfigurations] Found configurations:', launch.configurations.length);

                            // 加载所有 go-debug-pro 和 go 类型的配置
                            const goConfigs = launch.configurations.filter(
                                (config: any) => config.type === 'go-debug-pro' || config.type === 'go'
                            );

                            console.log('[loadConfigurations] Go configurations (go-debug-pro + go):', goConfigs.length);
                            console.log('[loadConfigurations] Go config names:', goConfigs.map((c: any) => c.name));

                            this._configurations.push(...goConfigs);
                        }
                    } catch (error) {
                        console.error('[loadConfigurations] Error reading launch.json:', error);
                    }
                } else {
                    console.log('[loadConfigurations] launch.json does not exist at:', launchJsonPath);
                }
            }
        } else {
            console.log('[loadConfigurations] No workspace folders found');
        }

        console.log('[loadConfigurations] Total configurations loaded:', this._configurations.length);
        console.log('[loadConfigurations] Configuration names:', this._configurations.map(c => c.name));
    }

    private createTabsForConfigurations(): void {
        console.log('[createTabsForConfigurations] Creating tabs for loaded configurations...');

        this._configurations.forEach(config => {
            if (!this._outputTabs.has(config.name)) {
                console.log(`[createTabsForConfigurations] Creating tab for: ${config.name}`);
                this.createTab(config.name);
            }
        });

        console.log(`[createTabsForConfigurations] Total tabs created: ${this._outputTabs.size}`);
    }

    private setupFileWatcher(): void {
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const launchJsonPattern = new vscode.RelativePattern(folder, '.vscode/launch.json');
                const watcher = vscode.workspace.createFileSystemWatcher(launchJsonPattern);

                watcher.onDidChange(() => this.loadConfigurations());
                watcher.onDidCreate(() => this.loadConfigurations());
                watcher.onDidDelete(() => this.loadConfigurations());
            }
        }
    }

    private setupDebugSessionListeners(): void {
        // 监听调试会话开始
        vscode.debug.onDidStartDebugSession((session) => {
            const tabName = session.configuration.name;
            console.log('[Go Debug Output] Debug session started:', tabName, session.type);
            if (session.type === 'go-debug-pro') {
                // 确保创建对应的tab
                if (!this._outputTabs.has(tabName)) {
                    this.createTab(tabName);
                }

                // 设置调试状态
                this.setSessionInfo(tabName, 'debug', 'running', session);
                this.addOutput(`🚀 Debug session started: ${session.name}`, tabName);

                // 立即更新工具栏状态
                setTimeout(() => this.updateToolbarState(tabName), 100);
            }
        });

        // 监听调试会话结束
        vscode.debug.onDidTerminateDebugSession((session) => {
            const tabName = session.configuration.name;
            console.log('[Go Debug Output] Debug session terminated:', tabName, session.type);
            if (session.type === 'go-debug-pro') {
                this.setSessionInfo(tabName, 'debug', 'stopped', session);
                this.addOutput(`🛑 Debug session terminated: ${session.name}`, tabName);
                this.addOutput(`📊 Session summary: Configuration "${tabName}" ended`, tabName);

                // 检查是否是正常结束还是异常结束
                const configState = this.globalStateManager.getState(tabName);
                if (configState && configState.startTime) {
                    const duration = new Date().getTime() - configState.startTime.getTime();
                    const durationStr = this.formatDuration(duration);
                    this.addOutput(`⏱️ Total debug session duration: ${durationStr}`, tabName);
                }

                // 立即更新工具栏状态
                setTimeout(() => this.updateToolbarState(tabName), 100);
            }
        });

        // 监听调试会话变化
        vscode.debug.onDidChangeActiveDebugSession((session) => {

            if (session && session.type === 'go-debug-pro') {
                console.log('[Go Debug Output] Active debug session changed:', session.configuration.name);
                // 更新所有工具栏状态，确保UI反映当前状态
                setTimeout(() => this.updateAllToolbarStates(), 100);
            }
        });
    }

    public addOutput(message: string, tabName: string = 'General') {
        const timestamp = new Date().toLocaleTimeString();

        // Process Delve-specific messages
        const processedMessage = this.processDelveMessage(message);
        const logEntry = `[${timestamp}] ${processedMessage}`;

        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }

        const tabLog = this._outputTabs.get(tabName)!;
        tabLog.push(logEntry);

        // Keep only last 1000 entries per tab
        if (tabLog.length > 1000) {
            this._outputTabs.set(tabName, tabLog.slice(-1000));
        }

        this._updateWebview(tabName, logEntry);
    }

    public cleanDebugInfo(tabName: string) {
        if (this._outputTabs.has(tabName)) {

            this._sendCleanDebugInfo(tabName);
        }
    }

    public addVariables(variables: DebugProtocol.Variable[], args: DebugProtocol.VariablesArguments, tabName: string = 'General') {
        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }
        this.updateVariables(tabName, variables, args);
    }

    public addStack(stacks: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }, tabName: string = 'General') {

        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }
        this.updateStack(tabName, stacks);
    }

    public addScopes(scopes: DebugProtocol.Scope[], tabName: string = 'General') {
        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }
        this.updateScopes(tabName, scopes);
    }

    /**
     * 处理 Delve 调试器的特定消息
     */
    private processDelveMessage(message: string): string {
        // Handle Delve DAP protocol messages
        if (message.includes('layer=dap')) {
            if (message.includes('"command":"disconnect"')) {
                return '🔌 Disconnect command received from client';
            } else if (message.includes('layer=dap halting')) {
                return '⏹️ Delve debugger halting...';
            } else if (message.includes('process not running')) {
                return '⚪ Target process is not running';
            } else if (message.includes('"event":"output"')) {
                return '📤 DAP Output Event';
            } else if (message.includes('"event":"terminated"')) {
                return '🛑 Debug Session Terminated';
            } else if (message.includes('"event":"stopped"')) {
                return '⏸️ Debug Session Stopped (Breakpoint Hit)';
            } else if (message.includes('"type":"response"')) {
                return '↩️ DAP Response';
            } else if (message.includes('DAP server stopping')) {
                return '⏹️ DAP Server Stopping';
            } else if (message.includes('DAP server stopped')) {
                return '✅ DAP Server Stopped';
            } else if (message.includes('[<- from client]')) {
                return '📩 DAP Command from client';
            } else if (message.includes('[-> to client]')) {
                return '📤 DAP Response to client';
            }
        }

        // Handle Delve process messages
        if (message.includes('Delve process exited with code:')) {
            const match = message.match(/code: (\d+)/);
            const code = match ? match[1] : 'unknown';
            if (code === '0') {
                return `✅ Delve process completed successfully (exit code: ${code})`;
            } else {
                return `❌ Delve process failed (exit code: ${code})`;
            }
        }

        // Handle warnings about quick exits
        if (message.includes('Delve exited quickly')) {
            return '⚠️ Debug session ended quickly - possible reasons:';
        }

        if (message.includes('Program ran to completion')) {
            return '   📋 Program executed to completion (no breakpoints hit)';
        }

        if (message.includes('DAP session ended normally')) {
            return '   ✅ Debug session ended normally';
        }

        if (message.includes('No debugging target was provided')) {
            return '   ❌ No debugging target specified';
        }

        // Handle detaching messages
        if (message.includes('Detaching and terminating target process')) {
            return '🔌 Detaching from target process...';
        }

        if (message.includes('layer=debugger detaching')) {
            return '🔄 Debugger detaching from process';
        }

        return message;
    }

    /**
     * 处理来自调试适配器的输出
     */
    public handleDebugAdapterOutput(output: string, tabName: string) {
        // Split multi-line output and process each line
        const lines = output.split('\n').filter(line => line.trim().length > 0);

        for (const line of lines) {
            if (line.includes('dlv stderr:')) {
                // Extract the actual Delve message
                const match = line.match(/dlv stderr: (.+)/);
                if (match) {
                    this.addOutput(match[1], tabName);
                }
            } else if (line.includes('Delve process exited')) {
                this.addOutput(line, tabName);
            } else if (line.includes('Delve exited quickly')) {
                this.addOutput(line, tabName);
            } else if (line.includes('Program ran to completion') ||
                line.includes('DAP session ended normally') ||
                line.includes('No debugging target was provided')) {
                this.addOutput(line, tabName);
            } else {
                // For other debug output
                this.addOutput(line, tabName);
            }
        }
    }



    public clearOutput(tabName?: string) {
        if (tabName && this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            this._sendClearMessage(tabName);
        } else {
            // Clear all tabs if no specific tab is specified
            this._outputTabs.forEach((_, tab) => {
                this._outputTabs.set(tab, []);
                this._sendClearMessage(tab);
            });
        }
    }

    public clearTab(tabName: string) {
        this.clearOutput(tabName);
    }

    public createTab(tabName: string) {
        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
        }
        this._sendCreateTabMessage(tabName);
        this._switchToTab(tabName);

        // 延迟更新工具栏状态，确保DOM已创建
        setTimeout(() => {
            this.updateToolbarState(tabName);
        }, 100);
    }

    public switchToTab(tabName: string) {
        this._switchToTab(tabName);
    }

    private async handleToolbarAction(action: string, tabName: string) {
        const configState = this.globalStateManager.getState(tabName);

        console.log(`[GoDebugOutputProvider] Toolbar action ${action} for ${tabName}:`, configState);

        switch (action) {
            case 'run':
                if (!configState || configState.state === 'stopped') {
                    this.addOutput(`Starting ${tabName}...`, tabName);
                    this.globalStateManager.setState(tabName, 'run', 'starting');
                    await this.executeRun(tabName, "run");
                } else {
                    this.addOutput("not can run. proccess is run", tabName);
                }
                break;
            case 'debug':
                if (!configState || configState.state === 'stopped') {
                    this.addOutput(`Starting debug session for ${tabName}...`, tabName);
                    this.globalStateManager.setState(tabName, 'debug', 'starting');
                    await this.executeRun(tabName, "debug");
                } else {
                    this.addOutput("Cannot start debug session. Process is already running.", tabName);
                }
                break;
            case 'stop':
                if (configState && (configState.state === 'running' || configState.state === 'starting')) {
                    this.addOutput(`Stopping ${tabName}...`, tabName);
                    this.globalStateManager.stopConfig(tabName);
                }
                await this.stopSession(tabName);
                break;
            case 'restart':
                this.addOutput(`Restarting ${tabName}...`, tabName);
                await this.restartSession(tabName, "run");
                break;
            case 'redebug':
                this.addOutput(`Restarting ${tabName}...`, tabName);
                await this.restartSession(tabName, "debug");
                break;
            case 'continue':
                if (configState?.action === 'debug') {
                    vscode.commands.executeCommand('workbench.action.debug.continue');
                }
                break;
            case 'stepOver':
                if (configState?.action === 'debug') {
                    vscode.commands.executeCommand('workbench.action.debug.stepOver');
                }
                break;
            case 'stepInto':
                if (configState?.action === 'debug') {
                    vscode.commands.executeCommand('workbench.action.debug.stepInto');
                }
                break;
            case 'stepOut':
                if (configState?.action === 'debug') {
                    vscode.commands.executeCommand('workbench.action.debug.stepOut');
                }
                break;
        }
    }

    /**
     * 处理跳转到源码的请求
     */
    private async handleGotoSource(filePath: string, line: number, column?: number): Promise<void> {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(filePath)) {
                vscode.window.showErrorMessage(`文件不存在: ${filePath}`);
                return;
            }

            // 创建文件URI
            const fileUri = vscode.Uri.file(filePath);

            // 打开文档
            const document = await vscode.workspace.openTextDocument(fileUri);

            // 显示文档并跳转到指定位置
            const editor = await vscode.window.showTextDocument(document, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: false
            });

            // 创建位置对象 (VS Code使用0基索引)
            const position = new vscode.Position(
                Math.max(0, line - 1), // 行号转换为0基索引
                Math.max(0, (column || 1) - 1) // 列号转换为0基索引，默认为第1列
            );

            // 设置光标位置和选中范围
            editor.selection = new vscode.Selection(position, position);

            // 滚动到指定位置，确保该行在编辑器中可见
            editor.revealRange(
                new vscode.Range(position, position),
                vscode.TextEditorRevealType.InCenterIfOutsideViewport
            );

            console.log(`[GoDebugOutputProvider] 成功跳转到: ${filePath}:${line}:${column || 1}`);

        } catch (error) {
            console.error(`[GoDebugOutputProvider] 跳转源码失败:`, error);
            vscode.window.showErrorMessage(`无法打开文件: ${filePath}. 错误: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public findConfigurationByName(name: string): any | undefined {
        return this._configurations.find(c => c.name === name);
    }

    private async executeRun(tabName: string, mode: string) {
        console.log(`[executeRun] Looking for configuration: "${tabName}"`);
        console.log(`[executeRun] Available configurations:`, this._configurations.map(c => c.name));


        // Find configuration and execute it
        const config = this.findConfigurationByName(tabName);
        if (config) {
            console.log(`[executeRun] Found configuration:`, config);
            const sessionType: 'debug' | 'run' = mode === 'run' ? 'run' : 'debug';

            // 创建标签页（如果不存在）
            if (!this._outputTabs.has(tabName)) {
                this.createTab(tabName);

            }

            // 设置为启动状态
            this.globalStateManager.setState(tabName, sessionType, 'starting');
            this.addOutput(`🚀 Starting ${sessionType} session: ${tabName}`, tabName);

            try {
                // 使用现有的封装函数执行调试/运行
                await runDebugConfiguration(config, sessionType);

                console.log(`[executeRun] Successfully started ${sessionType} for ${tabName}`);
                this.globalStateManager.setState(tabName, sessionType, 'running');
                this.addOutput(`✅ Successfully started ${sessionType} session: ${tabName}`, tabName);
            } catch (error) {
                console.error(`[executeRun] Error starting ${sessionType} for ${tabName}:`, error);
                this.globalStateManager.setState(tabName, sessionType, 'stopped');
                this.addOutput(`❌ Error starting ${sessionType} session: ${error}`, tabName);
            }
        } else {
            console.error(`[executeRun] Configuration not found: "${tabName}"`);
            console.error(`[executeRun] Available configurations: [${this._configurations.map(c => `"${c.name}"`).join(', ')}]`);
            this.addOutput(`❌ Configuration not found: ${tabName}`, tabName);
            this.addOutput(`Available configurations: ${this._configurations.map(c => c.name).join(', ')}`, tabName);
        }
    }

    private async stopSession(tabName: string) {
        const configState = this.globalStateManager.getState(tabName);
        if (configState && (configState.state === 'running' || configState.state === 'starting')) {
            this.addOutput(`🛑 Stopping session: ${tabName}`, tabName);

            if (configState.action === 'debug') {
                if (configState.session) {
                    vscode.debug.stopDebugging(configState.session);
                }
                // Stop debug session using VS Code command
                vscode.commands.executeCommand('workbench.action.debug.stop');
            } else {
                if (configState.process) {
                    try {
                        configState.process.kill();
                    } catch (error) {
                        console.error(`[stopSession] Error killing process for ${tabName}:`, error);
                    }

                }
            }

            // Use global state manager to stop the configuration
            this.globalStateManager.stopConfig(tabName);

            this.addOutput(`✅ Successfully stopped session: ${tabName}`, tabName);
        } else {
            this.addOutput(`⚠️ Session ${tabName} is not running`, tabName);
        }
    }

    private async restartSession(tabName: string, mode: string) {
        await this.stopSession(tabName);
        setTimeout(() => this.executeRun(tabName, mode), 500);
    }

    private async executeDebug(tabName: string) {
        // executeDebug is the same as executeRun, the distinction is handled by the config type
        await this.executeRun(tabName, "run");
    }

    public setSessionInfo(tabName: string, type: 'debug' | 'run', status: 'running' | 'stopped', session?: vscode.DebugSession) {
        // 兼容旧接口，转换为新的状态管理
        const state: 'running' | 'stopped' = status === 'running' ? 'running' : 'stopped';
        this.globalStateManager.setState(tabName, type, state,null, session);
    }

    private updateToolbarState(tabName: string) {
        const configState = this.globalStateManager.getState(tabName);
        if (this._view) {

            this._view.webview.postMessage({
                command: 'updateToolbar',
                tabName: tabName,
                sessionInfo: configState
            });
        } else {
            console.log(`[Go Debug Output] Cannot update toolbar - no webview available for ${tabName}`);
        }
    }

    /**
     * 更新状态显示字段 - 根据全局状态变化更新UI显示
     */
    private updateStateDisplayFields(configName: string, newState: ConfigState) {
        // 发送状态字段更新消息到webview
        if (this._view) {
            // 使用 globalStateManager 的方法检查状态
            const isStopped = this.globalStateManager.isStopped(configName);
            const isRunning = this.globalStateManager.isRunning(configName);

            const stateDisplayInfo = {
                configName: configName,
                action: newState.action,
                state: newState.state,
                processId: newState.process?.pid || null,
                startTime: newState.startTime?.toLocaleString() || null,
                endTime: newState.endTime?.toLocaleString() || null,
                duration: this.calculateDuration(newState.startTime, newState.endTime),
                isActive: isRunning,
                isStopped: isStopped,
                // 状态颜色
                stateColor: this.getStateColor(newState.state)
            };

            console.log(`[GoDebugOutputProvider] Updating state display for ${configName}:`, stateDisplayInfo);


            // 同时更新标签页标题，显示运行状态
            this.updateTabTitle(configName, newState);
            this.updateToolbarState(configName);
        }
    }



    /**
     * 获取状态颜色
     */
    private getStateColor(state: string): string {
        switch (state) {
            case 'running':
                return '#4CAF50'; // 绿色
            case 'stopped':
                return '#757575'; // 灰色
            case 'starting':
                return '#FF9800'; // 橙色
            case 'stopping':
                return '#F44336'; // 红色
            default:
                return '#757575'; // 默认灰色
        }
    }

    /**
     * 计算会话持续时间
     */
    private calculateDuration(startTime?: Date, endTime?: Date): string | null {
        if (!startTime) {
            return null;
        }

        const end = endTime || new Date();
        const duration = end.getTime() - startTime.getTime();

        if (duration < 1000) {
            return `${duration}ms`;
        } else if (duration < 60000) {
            return `${Math.floor(duration / 1000)}s`;
        } else {
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }

    /**
     * 更新标签页标题，显示运行状态
     */
    private updateTabTitle(configName: string, state: any) {
        if (this._view) {
            const statusIcon = state.state === 'running' ? '🟢' :
                state.state === 'starting' ? '🟡' : '⚫';
            const titleWithStatus = `${statusIcon} ${configName}`;

            this._view.webview.postMessage({
                command: 'updateTabTitle',
                tabName: configName,
                newTitle: titleWithStatus
            });
        }
    }


    private updateVariables(tabName: string, variables: DebugProtocol.Variable[], args?: DebugProtocol.VariablesArguments) {
        this._sendVariablesMessage(tabName, variables, args);
    }

    private updateStack(tabName: string, stacks: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }) {
        this._sendStackMessage(tabName, stacks);
    }

    private updateScopes(tabName: string, scopes: DebugProtocol.Scope[]) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateScopes',
                tabName: tabName,
                scopes: scopes || []
            });
        }
    }

    private _sendCleanDebugInfo(tabName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'cleanDebugInfo',
                tabName: tabName
            });
        }
    }


    public refreshConfigurations() {
        this.loadConfigurations();
    }

    private _updateWebview(tabName: string, content: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateOutput',
                tabName: tabName,
                content: content
            });
        }
    }

    private _sendCreateTabMessage(tabName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'createTab',
                tabName: tabName
            });
        }
    }

    private _sendClearMessage(tabName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'clearTab',
                tabName: tabName
            });
        }
    }

    private _sendStackMessage(tabName: string, stack: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }) {
        if (this._view) {

            // stack.stackFrames 所有元素，新加一个字段叫 title  = true， 等所有数据处理完成，然后再执行 this._view.webview.postMessage
            stack.stackFrames.forEach(frame => {
                const fileLinePath = `${frame?.source?.path}:${frame.line}`;
                // 删除当前 worker 打开项目时的路径前缀
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const workspacePath = workspaceFolders[0].uri.fsPath;
                    if (fileLinePath.startsWith(workspacePath)) {
                        (frame as any).title = fileLinePath.replace(workspacePath, '').replace(/^\//, '');
                    } else {
                        (frame as any).title = fileLinePath;
                    }
                } else {
                    (frame as any).title = fileLinePath;
                }
            });

            this._view.webview.postMessage({
                command: 'updateStack',
                tabName: tabName,
                stack: stack
            });
        }
    }

    private _sendVariablesMessage(tabName: string, variables: DebugProtocol.Variable[], args?: DebugProtocol.VariablesArguments) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateVariables',
                tabName: tabName,
                variables: variables,
                args: args
            });
        }
    }

    private updateAllToolbarStates() {
        // 首先检查当前活动的调试会话
        this.syncWithActiveDebugSessions();

        // 然后发送工具栏状态更新给所有已知配置
        const allStates = this.globalStateManager.getAllStates();
        for (const [name, configState] of allStates.entries()) {
            this.updateToolbarState(name);
        }

        // 同时也更新所有已创建的tabs，即使它们没有在全局状态中
        for (const tabName of this._outputTabs.keys()) {
            if (!allStates.has(tabName)) {
                // 如果tab存在但没有状态，创建一个默认停止状态
                this.updateToolbarState(tabName);
            }
        }
    }

    private syncWithActiveDebugSessions() {
        // 检查当前活动的调试会话并同步状态
        const activeSessions = vscode.debug.activeDebugSession;
        if (activeSessions && activeSessions.type === 'go-debug-pro') {
            console.log('[Go Debug Output] Syncing with active debug session:', activeSessions.name);
            this.setSessionInfo(activeSessions.configuration.name, 'debug', 'running', activeSessions);
        }

        // 检查所有调试会话
        for (const session of vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []) {
            if (session.type === 'go-debug-pro') {
                console.log('[Go Debug Output] Found active go-debug-pro session:', session.name);
                this.setSessionInfo(session.configuration.name, 'debug', 'running', session);
            }
        }
    }


    public dispose() {
        // 清理事件监听器
        if (this.stateChangeListener) {
            this.stateChangeListener.dispose();
        }
    }

    /**
     * 格式化持续时间
     */
    private formatDuration(duration: number): string {
        if (duration < 1000) {
            return `${duration}ms`;
        } else if (duration < 60000) {
            return `${Math.floor(duration / 1000)}s`;
        } else {
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            return `${minutes}m ${seconds}s`;
        }
    }

    private _switchToTab(tabName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'switchTab',
                tabName: tabName
            });
        }
    }

    private _getWebviewContent(webview: vscode.Webview): string {
        try {
            // Get the webview JS and CSS URIs from dist directory
            const webviewJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
            const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));
            
            // Generate nonce for security
            const nonce = this._getNonce();
            
            // Create HTML content with comprehensive styles
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Go Debug Output</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <style>
        /* VS Code theme variables and base styles */
        :root {
            --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            --vscode-font-size: 12px;
            --vscode-editor-font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        }

        body {
            margin: 0;
            padding: 0;
            height: 100vh;
            overflow: hidden;
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif);
            font-size: var(--vscode-font-size, 12px);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        #root {
            height: 100vh;
            width: 100vw;
        }
        
        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            color: var(--vscode-descriptionForeground);
        }

        .app-container {
            display: flex;
            height: 100vh;
            flex-direction: column;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }

        /* Tabs Header */
        .tabs-header {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-tab-inactiveBackground);
            overflow-x: auto;
            min-height: 35px;
        }

        .tab {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            border-right: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            white-space: nowrap;
            font-size: 12px;
            position: relative;
        }

        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
        }

        .tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }

        .tab-close {
            margin-left: 8px;
            cursor: pointer;
            opacity: 0.7;
        }

        .tab-close:hover {
            opacity: 1;
        }

        /* Toolbar styles */
        .toolbar {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            background-color: var(--vscode-toolbar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 4px;
        }

        .toolbar-button {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .toolbar-button:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .toolbar-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* Tab content */
        .tab-content {
            flex: 1;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }

        .tab-content.active {
            display: flex;
        }

        /* Console styles */
        .console {
            flex: 1;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            padding: 8px;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
        }

        .console-line {
            margin-bottom: 2px;
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* Variables panel styles */
        .variables-panel {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }

        .variable-tree {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .variable-item {
            padding: 2px 0;
            cursor: pointer;
            display: flex;
            align-items: center;
        }

        .variable-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .variable-name {
            font-weight: bold;
            margin-right: 8px;
        }

        .variable-type {
            color: var(--vscode-symbolIcon-typeParameterForeground);
            margin-right: 8px;
            font-style: italic;
        }

        .variable-value {
            color: var(--vscode-debugTokenExpression-string);
        }

        /* Resizable layout styles */
        .resizable-container {
            display: flex;
            height: 100%;
            flex: 1;
        }

        .stack-section {
            flex: 0 0 33.33%;
            min-width: 200px;
            max-width: 50%;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--vscode-panel-border);
            overflow: hidden;
        }

        .variables-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .resize-handle {
            width: 4px;
            background-color: var(--vscode-panel-border);
            cursor: col-resize;
            position: relative;
            flex-shrink: 0;
        }

        .resize-handle:hover {
            background-color: var(--vscode-focusBorder);
        }

        .resize-handle:active {
            background-color: var(--vscode-focusBorder);
        }

        .section-header {
            padding: 8px 12px;
            background-color: var(--vscode-sideBar-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: bold;
            font-size: 11px;
            text-transform: uppercase;
            color: var(--vscode-foreground);
        }

        .stack-list, .variables-list {
            flex: 1;
            overflow-y: auto;
            padding: 4px;
        }

        .stack-item {
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 3px;
            margin-bottom: 2px;
        }

        .stack-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .stack-item.current {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .frame-name {
            font-weight: bold;
            margin-bottom: 2px;
        }

        .frame-location {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .variables-view {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .empty-state {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        /* Ant Design Tree customization for VS Code theme */
        .variable-tree-container {
            flex: 1;
            overflow-y: auto;
        }

        .variable-tree-node {
            display: flex;
            align-items: center;
            gap: 6px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .variable-tree-node .variable-icon {
            font-size: 14px;
            min-width: 16px;
        }

        .variable-tree-node .variable-name {
            font-weight: bold;
            color: var(--vscode-foreground);
        }

        .variable-tree-node .variable-type {
            font-style: italic;
            font-size: 11px;
        }

        .variable-tree-node .variable-value {
            color: var(--vscode-debugTokenExpression-string);
            margin-left: 4px;
        }

        .variable-tree-node .variable-preview {
            color: var(--vscode-descriptionForeground);
            margin-left: 4px;
            font-style: italic;
        }

        /* Override Ant Design Tree styles for VS Code */
        .ant-tree {
            background: transparent !important;
            color: var(--vscode-foreground) !important;
        }

        .ant-tree .ant-tree-node-content-wrapper {
            background: transparent !important;
            color: var(--vscode-foreground) !important;
            border-radius: 3px;
        }

        .ant-tree .ant-tree-node-content-wrapper:hover {
            background-color: var(--vscode-list-hoverBackground) !important;
        }

        .ant-tree .ant-tree-node-content-wrapper.ant-tree-node-selected {
            background-color: var(--vscode-list-activeSelectionBackground) !important;
            color: var(--vscode-list-activeSelectionForeground) !important;
        }

        .ant-tree .ant-tree-switcher {
            color: var(--vscode-foreground) !important;
        }

        .ant-tree .ant-tree-switcher-icon {
            color: var(--vscode-foreground) !important;
        }

        .ant-tree .ant-tree-indent-unit {
            width: 16px !important;
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="loading">Loading Go Debug Output...</div>
    </div>
    <script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
            
            return html;
        } catch (error) {
            console.error('[GoDebugOutputProvider] Error loading webview content:', error);
            // Fallback to the original HTML generation method
            return '<div style="color: red; padding: 20px;">Error loading webview content. Please check the console for details.</div>';
        }
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

}
