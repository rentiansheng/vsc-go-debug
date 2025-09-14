import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalStateManager, ConfigState, StateChangeEvent } from './globalStateManager';
import { runDebugConfiguration } from './extension';
import * as struct from './struct';
import { StackFrame } from 'vscode-debugadapter';

export class GoDebugOutputProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'goDebugOutput';

    private _view?: vscode.WebviewView;
    private _outputTabs: Map<string, string[]> = new Map();
    private _configurations: any[] = [];
    private globalStateManager: GlobalStateManager;
    private stateChangeListener: vscode.Disposable;

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
            this.addOutput(statusMessage, event.configName);
            
            // 根据新状态显示不同的信息
            if (event.newState.state === 'running') {
                const startMessage = event.newState.action === 'debug' ? 
                    `🚀 调试会话已启动` : `🚀 运行会话已启动`;
                this.addOutput(startMessage, event.configName);
            } else if (event.newState.state === 'stopped') {
                const stopMessage = event.newState.action === 'debug' ? 
                    `⏹️ 调试会话已停止` : `⏹️ 运行会话已停止`;
                this.addOutput(stopMessage, event.configName);
            } else if (event.newState.state === 'starting') {
                this.addOutput(`⏳ 正在启动${event.newState.action === 'debug' ? '调试' : '运行'}会话...`, event.configName);
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
            localResourceRoots: [this._extensionUri],
        };
      
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

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
                }
            },
            undefined
        );
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
                    this.createTab(tabName );
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
            const sessionType: 'debug' | 'run' =  mode === 'run' ? 'run' : 'debug';
            
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
                if(configState.process) {
                    try {
                        configState.process.kill();
                    } catch(error) {
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
        this.globalStateManager.setState(tabName, type, state, session);
    }

    private updateToolbarState(tabName: string) {
        const configState = this.globalStateManager.getState(tabName);
        if (this._view) {
            console.log(`[Go Debug Output] Updating toolbar state for ${tabName}:`, configState);
            console.log(`[Go Debug Output] Config state details:`, {
                hasState: !!configState,
                action: configState?.action,
                state: configState?.state,
                process: !!configState?.process
            });
            
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
                             state.state === 'starting' ? '🟡' : '⚫' ;
            const titleWithStatus = `${statusIcon} ${configName}`;
            
            this._view.webview.postMessage({
                command: 'updateTabTitle',
                tabName: configName,
                newTitle: titleWithStatus
            });
        }
    }

    /**
     * 更新变量和调用栈信息
     */
    public updateVariablesAndStack(tabName: string, variables?: any[], callStack?: any[]) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateVariables',
                tabName: tabName,
                variables: variables || [],
                callStack: callStack || []
            });
        }
    }

    public updateVariables(tabName: string, variables: struct.DAPVariableResponse) {
        this._sendVariablesMessage(tabName, variables);
    }

    public updateStack(tabName: string, stack: struct.DAPStackTraceResponse) {
        this._sendStackMessage(tabName, stack);
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

    private _sendStackMessage(tabName: string, stack: struct.DAPStackTraceResponse) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateStack',
                tabName: tabName,
                stack: stack
            });
        }
    }

    private _sendVariablesMessage(tabName: string, variables: struct.DAPVariableResponse) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateVariables',
                tabName: tabName,
                variables: variables
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

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get path to codicons
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'));
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Go Debug Output</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <style>
        /* VS Code icon symbols - using Unicode characters that work in VS Code */
        .vscode-icon {
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            font-weight: bold;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            height: 100vh;
            overflow: hidden;
        }
        
        .container {
            display: flex;
            height: 100vh;
            flex-direction: column;
        }
        
        .tabs-container {
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
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 10px;
            opacity: 0.7;
        }
        
        .tab-close:hover {
            background-color: var(--vscode-button-hoverBackground);
            opacity: 1;
        }
        
        .notification {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            border: 1px solid var(--vscode-notifications-border);
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 12px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            z-index: 1000;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
        }
        
        .notification.show {
            opacity: 1;
            transform: translateY(0);
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 12px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .output-container {
            flex: 1;
            overflow: hidden;
            background-color: var(--vscode-terminal-background);
            position: relative;
            display: flex;
            flex-direction: column;
            min-height: 0; /* 允许flex子项收缩 */
        }
        
        .tab-content {
            height: 100%;
            overflow: hidden;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            word-wrap: break-word;
            display: none;
            flex-direction: column;
            min-height: 0; /* 允许flex子项收缩 */
        }
        
        .tab-content.active {
            display: flex;
        }
        
        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            background-color: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 8px;
            flex-shrink: 0;
        }
        
        .state-info {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
        }
 
        
        .duration-info {
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            font-family: var(--vscode-editor-font-family);
        }
        
        .toolbar-buttons {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .toolbar-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 24px;
            height: 24px;
            justify-content: center;
        }
        
        .toolbar-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .toolbar-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            background-color: var(--vscode-button-secondaryBackground);
        }
        
        .toolbar-button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .toolbar-button.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        /* VS Code icon styles for toolbar buttons */
        .toolbar-button .vscode-icon {
            font-size: 14px;
            color: inherit;
            display: inline-block;
        }
        
        .toolbar-button:disabled .vscode-icon {
            opacity: 0.5;
        }
        
        /* Special styling for small bug icon */
        .toolbar-button .codicon-bug {
            font-size: 10px; /* 1/4 of normal size (32px -> 8px) */
            margin-left: -22px;
            margin-top: 10px;
        }
        
        .toolbar-separator {
            width: 1px;
            height: 16px;
            background-color: var(--vscode-panel-border);
            margin: 0 4px;
        }
        
        .view-tabs {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .view-tab {
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
            border-radius: 3px;
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            border: 1px solid var(--vscode-panel-border);
            transition: all 0.2s ease;
        }
        
        .view-tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }
        
        .view-tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-color: var(--vscode-focusBorder);
        }
        
        .output-content {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 10px;
            min-height: 0; /* 允许flex子项收缩 */
            max-height: 100%; /* 确保不超出容器 */
            scroll-behavior: smooth; /* 平滑滚动 */
        }
        
        .variables-content {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            min-height: 0;
            max-height: 100%;
        }
        
        .variables-panel {
            display: flex;
            flex-direction: row;
            height: 100%;
            position: relative;
        }
        
        .stack-section {
            width: 25%;
            min-width: 150px;
            max-width: 60%;
            padding: 10px;
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .variables-section {
            flex: 1;
            padding: 10px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
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
        
        .resize-handle::after {
            content: '';
            position: absolute;
            left: -2px;
            right: -2px;
            top: 0;
            bottom: 0;
        }
        
        .variables-section h4, .stack-section h4 {
            margin: 0 0 8px 0;
            font-size: 12px;
            font-weight: bold;
            color: var(--vscode-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 4px;
        }
        
        .variables-list, .stack-list {
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            flex: 1;
            overflow-y: auto;
            padding: 4px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            margin-top: 8px;
        }
        
        .variable-item, .stack-item {
            padding: 2px 4px;
            margin: 1px 0;
            border-radius: 2px;
            cursor: pointer;
        }
        
        .variable-item:hover, .stack-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .variable-name {
            color: var(--vscode-debugTokenExpression-name);
            font-weight: bold;
        }
        
        .variable-value {
            color: var(--vscode-debugTokenExpression-value);
            margin-left: 8px;
        }
        
        .variable-type {
            color: var(--vscode-debugTokenExpression-type);
            font-style: italic;
            margin-left: 4px;
        }
        
        /* 自定义滚动条样式，使其与VSCode主题匹配 */
        .output-content::-webkit-scrollbar {
            width: 10px;
        }
        
        .output-content::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }
        
        .output-content::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 5px;
        }
        
        .output-content::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
        
        .empty-state {
            color: var(--vscode-descriptionForeground);
            text-align: center;
            margin-top: 50px;
            font-style: italic;
        }
        
        .log-line {
            margin-bottom: 2px;
            line-height: 1.4;
            word-break: break-word; /* 长单词换行 */
            white-space: pre-wrap; /* 保持空格和换行 */
        }
        
        /* 为输出内容添加一些间距和样式 */
        .output-content .log-line:last-child {
            margin-bottom: 10px; /* 最后一行底部留白 */
        }

        .output-content.stack-list { list-style: none; padding: 0; margin: 0; }
        .output-content .stack-item {
          padding: 10px 14px;
          margin-bottom: 8px;
          border-radius: 7px;
          background: #fff;
          box-shadow: 0 1px 4px #0002;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.2s, background 0.2s;
          cursor: pointer;
        }
        .output-content .stack-item:hover {
          box-shadow: 0 2px 8px #0003;
          background: #e7f3ff;
        }
        .output-content .stack-item.selected {
          border-left: 4px solid #4c8bf4;
          background: #dbeafe;
        }
        .output-content .stack-item.subtle {
          opacity: 0.7;
          font-style: italic;
          background: #f0f0f0;
        }
        .output-content .frame-header { font-weight: bold; color: #2457a3; }
        .output-content .frame-location {
          color: #888;
          font-size: 13px;
          margin-top: 3px;
        }
        .output-content .frame-addr {
          color: #aaa; font-size: 12px;
          margin-top: 3px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="tabs-container">
        </div>
        
        <div class="output-container" id="output">
            <div class="empty-state">No debug sessions active. Start debugging to see output here.</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let activeTab = null;
        let tabs = new Map();
        
        function setupResizeHandlers(configName) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            const resizeHandle = tabContent.querySelector('.resize-handle');
            const stackSection = tabContent.querySelector('.stack-section');
            const variablesPanel = tabContent.querySelector('.variables-panel');
            
            if (!resizeHandle || !stackSection || !variablesPanel) return;
            
            let isResizing = false;
            let startX = 0;
            let startWidth = 0;
            
            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startWidth = stackSection.offsetWidth;
                
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                
                e.preventDefault();
            });
            
            function handleMouseMove(e) {
                if (!isResizing) return;
                
                const deltaX = e.clientX - startX;
                const newWidth = startWidth + deltaX;
                const panelWidth = variablesPanel.offsetWidth;
                
                // Calculate percentage, maintaining 1:3 ratio as default
                const minWidthPx = 150;  // minimum width for stack
                const maxWidthPx = panelWidth * 0.6;  // maximum 60% for stack
                
                if (newWidth >= minWidthPx && newWidth <= maxWidthPx) {
                    const widthPercent = (newWidth / panelWidth) * 100;
                    stackSection.style.width = \`\${widthPercent}%\`;
                }
            }
            
            function handleMouseUp() {
                isResizing = false;
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        }
        
        function createTab(configName) {
            if (!tabs.has(configName)) {
                tabs.set(configName, []);
                
                // Create tab element
                const tabsContainer = document.querySelector('.tabs-container');
                
                const tab = document.createElement('div');
                tab.className = 'tab';
                tab.setAttribute('data-tab', configName);
                tab.innerHTML = \`
                    <span>\${configName}</span>
                    <span class="tab-close" onclick="closeTab('\${configName}', event)">✕</span>
                \`;
                tab.onclick = () => switchTab(configName);
                
                tabsContainer.appendChild(tab);
                
                // Create tab content
                const outputContainer = document.getElementById('output');
                const tabContent = document.createElement('div');
                tabContent.className = 'tab-content';
                tabContent.setAttribute('data-content', configName);
                
                // Create toolbar
                const toolbar = document.createElement('div');
                toolbar.className = 'toolbar';
                toolbar.setAttribute('data-tab', configName);
                toolbar.innerHTML = \`
               
                    <div class="toolbar-buttons">
                        <button class="toolbar-button" data-action="stop" title="Stop" disabled>
                            <span class="codicon codicon-debug-stop"></span>
                        </button>
                        <button class="toolbar-button primary" data-action="run" title="Run">
                            <span class="codicon codicon-play"></span>
                        </button>
                        <button class="toolbar-button primary" data-action="debug" title="Debug">
                            <span class="codicon codicon-debug-alt"></span>
                        </button>
                        <button class="toolbar-button" data-action="restart" title="Restart" disabled>
                            <span class="codicon codicon-debug-restart"></span>
                        </button>
                        <button class="toolbar-button" data-action="redebug" title="Redebug" disabled>
                            <span class="codicon codicon-debug-restart"></span>
                            <span class="codicon codicon-bug"></span>
                        </button>
                        <div class="toolbar-separator"></div>
                        <button class="toolbar-button" data-action="continue" title="Continue" disabled>
                            <span class="codicon codicon-debug-continue"></span>
                        </button>
                        <button class="toolbar-button" data-action="stepOver" title="Step Over" disabled>
                            <span class="codicon codicon-debug-step-over"></span>
                        </button>
                        <button class="toolbar-button" data-action="stepInto" title="Step Into" disabled>
                            <span class="codicon codicon-debug-step-into"></span>
                        </button>
                        <button class="toolbar-button" data-action="stepOut" title="Step Out" disabled>
                            <span class="codicon codicon-debug-step-out"></span>
                        </button>
                        <div class="toolbar-separator"></div>
                        <div class="view-tabs">
                            <span class="view-tab" data-view="variables" onclick="switchView('\${configName}', 'variables')">Variables And Stack</span>
                            <span class="view-tab active" data-view="console" onclick="switchView('\${configName}', 'console')">Console</span>
                        </div>
                    </div>
     
                \`;
                
                // Add event listeners to toolbar buttons
                toolbar.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target) {
                        let action = "";
                        
                        // Handle view tab clicks
                        if (target.classList && target.classList.contains('view-tab')) {
                            const viewType = target.getAttribute('data-view');
                            if (viewType) {
                                switchView(configName, viewType);
                                return;
                            }
                        }
                        
                        // Handle toolbar button clicks
                        if(target.classList && target.classList.contains('toolbar-button')) {
                            action = target.getAttribute('data-action');
                        } else {
                            target.closest('.toolbar-button') && (action = target.closest('.toolbar-button').getAttribute('data-action'));
                        }
                        if (action === "") {
                            return;
                        }
                        if (action && !target.disabled) {
                            console.log(\`Toolbar action: \${action} for config: \${configName}\`);
                            vscode.postMessage({
                                command: 'toolbarAction',
                                action: action,
                                tabName: configName
                            });
                        }
                    }
                });
                
                // Create output content area
                const outputContent = document.createElement('div');
                outputContent.className = 'output-content';
                outputContent.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';
                
                // Create variables view content (initially hidden)
                const variablesContent = document.createElement('div');
                variablesContent.className = 'variables-content';
                variablesContent.style.display = 'none';
                variablesContent.innerHTML = \`
                    <div class="variables-panel">
                        <div class="stack-section">
                            <h6>Call Stack</h6>
                            <div class="stack-list">
                                <div class="empty-state">No call stack available. Start debugging to see call stack.</div>
                            </div>
                        </div>
                        <div class="resize-handle"></div>
                        <div class="variables-section">
                            <h6>Variables</h6>
                            <div class="variables-list">
                                <div class="empty-state">No variables available. Start debugging to see variables.</div>
                            </div>
                        </div>
                    </div>
                \`;
                
                tabContent.appendChild(toolbar);
                tabContent.appendChild(outputContent);
                tabContent.appendChild(variablesContent);
                outputContainer.appendChild(tabContent);
                
                // Setup resize functionality for variables panel
                setupResizeHandlers(configName);
                
                // If this is the first tab, make it active and hide the empty state
                if (tabs.size === 1) {
                    const emptyState = outputContainer.querySelector('.empty-state');
                    if (emptyState && !emptyState.closest('[data-content]')) {
                        emptyState.style.display = 'none';
                    }
                }
            }
            
            switchTab(configName);
        }
        
        function switchTab(tabName) {
            // Update active tab
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-tab') === tabName) {
                    tab.classList.add('active');
                }
            });
            
            // Update active content - hide main empty state and show tab content
            const mainEmptyState = document.querySelector('.output-container > .empty-state');
            if (mainEmptyState) {
                mainEmptyState.style.display = 'none';
            }
            
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                if (content.getAttribute('data-content') === tabName) {
                    content.classList.add('active');
                }
            });
            
            activeTab = tabName;
        }
        
        function closeTab(tabName, event) {
            event.stopPropagation();
            
            if (tabs.has(tabName)) {
                tabs.delete(tabName);
                
                // Remove tab element
                const tab = document.querySelector(\`[data-tab="\${tabName}"]\`);
                if (tab) tab.remove();
                
                // Remove tab content
                const content = document.querySelector(\`[data-content="\${tabName}"]\`);
                if (content) content.remove();
                
                // If this was the active tab and there are other tabs, switch to another one
                if (activeTab === tabName) {
                    const remainingTabs = Array.from(tabs.keys());
                    if (remainingTabs.length > 0) {
                        switchTab(remainingTabs[0]);
                    } else {
                        // No tabs left, show empty state
                        activeTab = null;
                        const mainEmptyState = document.querySelector('.output-container > .empty-state');
                        if (mainEmptyState) {
                            mainEmptyState.style.display = 'block';
                        }
                    }
                }
            }
        }
        
        function clearTab(tabName) {
            if (tabs.has(tabName)) {
                tabs.set(tabName, []);
                const content = document.querySelector(\`[data-content="\${tabName}"]\`);
                if (content) {
                    content.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';
                }
            }
        }
        
        function addOutputToTab(tabName, message) {
            if (!tabs.has(tabName)) {
                createTab(tabName);
            }
            
            const tabMessages = tabs.get(tabName);
            tabMessages.push(message);
            
            // Keep only last 1000 entries per tab
            if (tabMessages.length > 1000) {
                tabs.set(tabName, tabMessages.slice(-1000));
            }
            
            updateTabContent(tabName);
        }
        
        function updateTabContent(tabName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (tabContent && tabs.has(tabName)) {
                const outputContent = tabContent.querySelector('.output-content');
                const messages = tabs.get(tabName);
                
                if (messages.length > 0) {
                    // 更新输出内容
                    outputContent.innerHTML = messages.map(msg => 
                        \`<div class="log-line">\${msg}</div>\`
                    ).join('');
                    
                    // 自动滚动到底部，显示最新输出
                    setTimeout(() => {
                        outputContent.scrollTop = outputContent.scrollHeight;
                    }, 10);
                } else {
                    outputContent.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';
                }
            }
        }
        
        function showNotification(message, type = 'info') {
            const notification = document.createElement('div');
            notification.className = 'notification';
            notification.textContent = message;
            
            // Add type-specific styling if needed
            if (type === 'error') {
                notification.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
                notification.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
                notification.style.color = 'var(--vscode-inputValidation-errorForeground)';
            } else if (type === 'success') {
                notification.style.backgroundColor = 'var(--vscode-terminal-ansiGreen)';
                notification.style.color = 'var(--vscode-terminal-background)';
            }
            
            document.body.appendChild(notification);
            
            // Trigger animation
            setTimeout(() => {
                notification.classList.add('show');
            }, 10);
            
            // Auto-remove after 3 seconds
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300); // Wait for fade-out animation
            }, 3000);
        }
        
        function switchView(configName, viewType) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            const outputContent = tabContent.querySelector('.output-content');
            const variablesContent = tabContent.querySelector('.variables-content');
            const viewTabs = tabContent.querySelectorAll('.view-tab');
            
            // Update tab states
            viewTabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-view') === viewType) {
                    tab.classList.add('active');
                }
            });
            
            // Show/hide content based on view type
            if (viewType === 'console') {
                outputContent.style.display = 'block';
                variablesContent.style.display = 'none';
            } else if (viewType === 'variables') {
                outputContent.style.display = 'none';
                variablesContent.style.display = 'block';
                // Update variables and stack when switching to this view
                updateVariablesView(configName);
            }
        }
        
        function updateVariablesView(configName) {
            // This function will be called to update variables and call stack
            // For now, we'll just show placeholder content
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            const variablesContent = tabContent.querySelector('.variables-content');
            if (!variablesContent) return;
            
            // In a real implementation, you would fetch actual debug data here
            // For now, we'll show some example data
            const stackList = variablesContent.querySelector('.stack-list');
            const variablesList = variablesContent.querySelector('.variables-list');
            
            if (stackList) {
                stackList.innerHTML = \`
                    <div class="stack-item">📍 main.main() - main.go:25</div>
                    <div class="stack-item">🔄 main.processData() - main.go:15</div>
                    <div class="stack-item">🔄 main.validateInput() - main.go:8</div>
                    <div class="stack-item">⚙️ runtime.main() - proc.go:250</div>
                    <div class="stack-item">⚙️ runtime.goexit() - asm_amd64.s:1571</div>
                \`;
            }
            
            if (variablesList) {
                variablesList.innerHTML = \`
                    <div class="variable-item">
                        <span class="variable-name">msg</span>
                        <span class="variable-value">"Hello, World!"</span>
                        <span class="variable-type">string</span>
                    </div>
                    <div class="variable-item">
                        <span class="variable-name">count</span>
                        <span class="variable-value">42</span>
                        <span class="variable-type">int</span>
                    </div>
                    <div class="variable-item">
                        <span class="variable-name">isDebug</span>
                        <span class="variable-value">true</span>
                        <span class="variable-type">bool</span>
                    </div>
                    <div class="variable-item">
                        <span class="variable-name">users</span>
                        <span class="variable-value">[]User{...}</span>
                        <span class="variable-type">[]User</span>
                    </div>
                \`;
        }
        }


        function updateStack(configName, callStack) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
 
            const stackList = variablesContent.querySelector('.stack-list');
            if (!stackList) { console.warn('Stack list element not found'); return; }

            stack.forEach((frame, idx) => {
                const li = document.createElement('li');
                li.className = 'stack-item' + (frame.presentationHint === 'subtle' ? ' subtle' : '');
                li.innerHTML = \`
                    <div class="frame-header">\${frame.name}</div>
                    <div class="frame-location" title="\${frame.source.path}">
                    <span style="color:#1976d2;text-decoration:underline;cursor:pointer;" class="source-link">\${frame.source.name}</span> :\${frame.line}
                    </div>
                    <div class="frame-addr">IP: \${frame.instructionPointerReference}</div>
                \`;
                // 点击跳转源码
                li.querySelector('.source-link').onclick = (e) => {
                    e.stopPropagation();
                    window.vscode.postMessage({
                    command: 'gotoSource',
                    path: frame.source.path,
                    line: frame.line,
                    column: frame.column
                    });
                };
                // 选中高亮
                li.onclick = () => {
                    tabContent.querySelectorAll('.stack-item').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                };
                stackList.appendChild(li);
            });

        }

        function updateVariables(tabName, variables) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            const variablesContent = tabContent.querySelector('.variables-content');
            if (!variablesContent) return;
            if (!tabContent) return;
             // Update variables (右侧)
            if (variablesList && variables && variables.length > 0) {
                variablesList.innerHTML = variables.map(variable => \`
                    <div class="variable-item">
                        <span class="variable-name">\${variable.name}</span>
                        <span class="variable-value">\${variable.value}</span>
                        <span class="variable-type">\${variable.type}</span>
                    </div>
                \`).join('');
            } else if (variablesList) {
                variablesList.innerHTML = '<div class="empty-state">No variables available.</div>';
            }
        }
        
        function updateVariablesData(configName, variables, callStack) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            const variablesContent = tabContent.querySelector('.variables-content');
            if (!variablesContent) return;
            
            const stackList = variablesContent.querySelector('.stack-list');
            const variablesList = variablesContent.querySelector('.variables-list');
            
            // Update call stack (左侧)
            if (stackList && callStack && callStack.length > 0) {
                stackList.innerHTML = callStack.map((frame, index) => {
                    const icon = index === 0 ? '📍' : '🔄'; // 当前帧用📍，其他用🔄
                    return \`<div class="stack-item">\${icon} \${frame.name} - \${frame.source}:\${frame.line}</div>\`;
                }).join('');
            } else if (stackList) {
                stackList.innerHTML = '<div class="empty-state">No call stack available.</div>';
            }
            
            // Update variables (右侧)
            if (variablesList && variables && variables.length > 0) {
                variablesList.innerHTML = variables.map(variable => \`
                    <div class="variable-item">
                        <span class="variable-name">\${variable.name}</span>
                        <span class="variable-value">\${variable.value}</span>
                        <span class="variable-type">\${variable.type}</span>
                    </div>
                \`).join('');
            } else if (variablesList) {
                variablesList.innerHTML = '<div class="empty-state">No variables available.</div>';
            }
        }
        
        function updateToolbar(tabName, configState) {
            const toolbar = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!toolbar) {
                console.warn(\`Toolbar not found for tab: \${tabName}\`);
                return;
            }
            
            const isRunning = configState && (configState.state === 'running' || configState.state === 'starting');
            const isDebugSession = configState && configState.action === 'debug';
            
            console.log(\`[JS] Updating toolbar for \${tabName}:\`, {
                configState,
                isRunning,
                isDebugSession,
                toolbarFound: !!toolbar
            });
            
  
            
            // Update stop button - enabled when running
            const stopBtn = toolbar.querySelector('[data-action="stop"]');
            if (stopBtn) {
                stopBtn.disabled = !isRunning;
                console.log(\`[JS] Stop button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
            } else {
                console.warn(\`[JS] Stop button not found for \${tabName}\`);
            }
            
            // Update run button - disabled when running  
            const runBtn = toolbar.querySelector('[data-action="run"]');
            if (runBtn) {
                runBtn.disabled = isRunning;
                console.log(\`[JS] Run button for \${tabName}: \${isRunning ? 'disabled' : 'enabled'}\`);
            } else {
                console.warn(\`[JS] Run button not found for \${tabName}\`);
            }
            const debugBtn = toolbar.querySelector('[data-action="debug"]');    
             if (debugBtn) {
                debugBtn.disabled = isRunning;
                console.log(\`[JS] Debug button for \${tabName}: \${isRunning ? 'disabled' : 'enabled'}\`);
            } else {
                console.warn(\`[JS] Debug button not found for \${tabName}\`);
            }

            // Update restart button - enabled when running
            const restartBtn = toolbar.querySelector('[data-action="restart"]');
            if (restartBtn) {
                restartBtn.disabled = !isRunning;
                console.log(\`[JS] Restart button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
            }
            const redebugBtn = toolbar.querySelector('[data-action="redebug"]');
            if (redebugBtn) {
                redebugBtn.disabled = !isRunning;
                console.log(\`[JS] Restart button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
            }
            if(isRunning){
                stopBtn.style.display = 'flex';
                runBtn.style.display = 'none';
                debugBtn.style.display = 'none';
                restartBtn.style.display = 'flex';
                redebugBtn.style.display = 'flex';
            }else{
                stopBtn.style.display = 'none';
                runBtn.style.display = 'flex';
                debugBtn.style.display = 'flex';
                restartBtn.style.display = 'none';
                redebugBtn.style.display = 'none';
            }
            
            // Update debug buttons - enabled when running and is debug session
            const debugButtons = ['continue', 'stepOver', 'stepInto', 'stepOut'];
            debugButtons.forEach(action => {
                const btn = toolbar.querySelector(\`[data-action="\${action}"]\`);
                if (btn) {
                    btn.disabled = !isRunning;
                    btn.style.display = isDebugSession ? 'flex' : 'none';
                    console.log(\`[JS] \${action} button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}, display: \${isDebugSession ? 'flex' : 'none'}\`);
                }
            });
        }
        
         
        
        // 计算持续时间的辅助函数
        function calculateDurationJS(startTime, endTime) {
            const start = new Date(startTime);
            const end = endTime ? new Date(endTime) : new Date();
            const duration = end.getTime() - start.getTime();
            
            if (duration < 1000) {
                return \`\${duration}ms\`;
            } else if (duration < 60000) {
                return \`\${Math.floor(duration / 1000)}s\`;
            } else {
                const minutes = Math.floor(duration / 60000);
                const seconds = Math.floor((duration % 60000) / 1000);
                return \`\${minutes}m \${seconds}s\`;
            }
        }
        
   
        
        function updateTabTitle(tabName, newTitle) {
            const tab = document.querySelector(\`[data-tab="\${tabName}"]\`);
            if (tab) {
                const titleSpan = tab.querySelector('span:first-child');
                if (titleSpan) {
                    titleSpan.textContent = newTitle;
                }
            }
        }
        
        function updateDuration(tabName, duration) {
            const toolbar = document.querySelector(\`[data-tab="\${tabName}"]\`);
            if (toolbar) {
                const durationInfo = toolbar.querySelector('.duration-info');
                if (durationInfo) {
                    durationInfo.textContent = \`运行时长: \${duration}\`;
                    durationInfo.style.display = 'inline';
                }
            }
        }

        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateOutput':
                    if (message.tabName) {
                        // Add to specific tab
                        addOutputToTab(message.tabName, message.content);
                    }
                    break;
                case 'createTab':
                    createTab(message.tabName);
                    console.error("[JS] Creating tab:", message.tabName);

                    break;
                case 'switchTab':
                    if (tabs.has(message.tabName)) {
                        switchTab(message.tabName);
                    }
                    break;
                case 'clearTab':
                    if (message.tabName) {
                        clearTab(message.tabName);
                    } else if (activeTab) {
                        clearTab(activeTab);
                    }
                    break;
                case 'updateToolbar':
                    updateToolbar(message.tabName, message.sessionInfo);
                    break;
                case 'updateTabTitle':
                    updateTabTitle(message.tabName, message.newTitle);
                    break;
                case 'updateDuration':
                    // 使用JavaScript计算并更新持续时间
                    if (message.startTime) {
                        const duration = calculateDurationJS(message.startTime);
                        updateDuration(message.tabName, duration);
                    }
                    break;
                case 'updateVariables':
                    // Update variables view with debug data
                    if (message.tabName && message.variables) {
                        updateVariables(message.tabName, message.variables);
                    }
                    break;
                case 'updateStack':
                    if (message.tabName && message.callStack) {
                        updateStack(message.tabName, message.callStack);
                    }
                    break;
                
            }
        });

        window.vscode = acquireVsCodeApi();

    </script>
</body>
</html>`;
    }
}
