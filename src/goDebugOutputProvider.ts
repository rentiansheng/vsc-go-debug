import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalStateManager, ConfigState, StateChangeEvent } from './globalStateManager';
import { runDebugConfiguration } from './extension';
 

import { DebugProtocol } from 'vscode-debugprotocol';
 




export class GoDebugOutputProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'goDebugOutput';

    private _view?: vscode.WebviewView;
    private _outputTabs: Map<string, string[]> = new Map();
    private _watchExpressions: Map<string, { id: string, expression: string }[]> = new Map();
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
    public static Variables(variables: DebugProtocol.Variable[], args: DebugProtocol.VariablesArguments, tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.updateVariables(tabName, variables, args);
        }
    }


    public static Stack(stacks: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }, args: DebugProtocol.StackTraceArguments, tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.updateStack(tabName, stacks, args);
        }
    }
    public static Scopes(scopes: DebugProtocol.Scope[], tabName: string = 'General') {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.updateScopes(tabName, scopes);
        }
    }
    public static CleanDebugInfo(tabName: string) {
        if (GoDebugOutputProvider.instance) {
            GoDebugOutputProvider.instance.cleanDebugInfo(tabName);
        }
    }

    public static StopEvent(id: number, tabName: string) {
        var inst = GoDebugOutputProvider.instance;
        if (inst) {
            inst.cleanDebugInfo(tabName);
            const session = inst.getSession(tabName);
            if (!session) {
                return;
            }
            // 重新拉取 stack
            const stackReq  = { threadId: id, startFrame: 0, levels: 20 };
            session.customRequest('stackTrace', stackReq).then((response: any) => {
                if (response && response.stackFrames) {
                    inst?.addStack( response,stackReq, tabName);
                }
                if(response && response.stackFrames && response.stackFrames.length>0){
                    const topFrame = response.stackFrames[0];
                    // 重新拉取 scopes
                    const scopesReq = { threadId: id, frameId: topFrame.id };
                    session.customRequest('scopes', scopesReq).then((response: any) => {
                        // 重新拉取 variables
                        const variablesReq = { variablesReference: topFrame.id, start: 0 };
                        session.customRequest('variables', variablesReq).then((response: any) => {
                            if (response && response.variables) {
                                inst?.addVariables(response.variables, variablesReq, tabName);
                            }
                        });
                    });
                    // 重新拉取 watch expressions
                    // inst?.WatchExpressions();
                    // 获取页面中所有的 watch expressions
                    const watchs = inst?._watchExpressions.get(tabName) || [];
                    for (const { expression, id } of watchs) {
                        inst?.evaluateWatchExpressionByDebugSession(expression, id, session, tabName);
                    }

                }
            });
           
        }
    }

    public static WatchExpressions() {
        if (GoDebugOutputProvider.instance) {
            return GoDebugOutputProvider.instance;
        }
        return [];
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
                    case 'gotoSource':
                        this.handleGotoSource(message.path, message.line, message.column);
                        break;
                    case 'get_variables':
                        this.getVariables(message.variablesReference, message.startIndex, message.tabName);
                        break;
                    case 'set_variable':
                        this.setVariable(message.variableName, message.newValue, message.variablesReference, message.evaluateName, message.tabName);
                        break;
                    case 'evaluate_watch':
                       

                        this.evaluateWatchExpression(message.expression, message.expressionId, message.tabName);
                        break;
                    case 'add_watch':
                        // Just track the expression ID, actual evaluation is done elsewhere
                        const _ae = this._watchExpressions.get(message.tabName) || [];
                        _ae.push({
                            expression: message.expression,
                            id: message.expressionId,
                        });
                        this._watchExpressions.set(message.tabName, _ae);
                        break;
                    case 'remove_watch':
                        const _re = this._watchExpressions.get(message.tabName) || [];
                        this._watchExpressions.set(message.tabName, _re.filter(w => w.id !== message.expressionId));
                        break;
                }
            },
            undefined
        );
    }

    private getSession(tabName: string): vscode.DebugSession | null {
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
                    return null;
                }   
            }
            return session;
        }
        return null;
    }

    private getVariables(variablesReference: number, start: number, tabName: string): void {
 
        var session = this.getSession(tabName);
           
        if (!session) {
            console.warn(`[getVariables] No debug session found for tab: ${tabName}`);
            return;
        }
        var reqVars: DebugProtocol.VariablesArguments  = {
            variablesReference: variablesReference,
            start: start,
        } ;
        if(start>0){
            reqVars.count = 100;
            reqVars.filter = 'indexed';
        }
        session.customRequest('variables', reqVars).then((response: any) => {
            if (response && response.variables) {
                this.addVariables(response.variables, reqVars, tabName);
            }
        });

    

    }

    private async setVariable(variableName: string, newValue: string, variablesReference: number, evaluateName: string, tabName: string): Promise<void> {
        if (this.globalStateManager) {
            const state = this.globalStateManager.getState(tabName);
            const session: vscode.DebugSession | null = state?.session || null;

            if (!session) {
                console.warn(`[setVariable] No debug session found for tab: ${tabName}`);
                return;
            }

            try {
                console.log(`[setVariable] Setting variable ${variableName} to ${newValue} (reference: ${variablesReference})`);

                // 使用 DAP 的 setVariable 请求
                const response = await session.customRequest('setVariable', {
                    variablesReference: variablesReference,
                    name: variableName,
                    value: newValue
                } as DebugProtocol.SetVariableArguments);

                if (response) {
                    console.log(`[setVariable] Successfully set variable ${variableName}:`, response);

                     this._view?.webview.postMessage({
                        command: 'setVariableCallback',
                        tabName: tabName,
                        variableName: variableName,
                        newValue: newValue,
                        variablesReference:  variablesReference,
                        evaluateName: evaluateName
                     });
                } else {
                    console.warn(`[setVariable] Failed to set variable ${variableName}`);
                }
            } catch (error) {
                console.error(`[setVariable] Error setting variable ${variableName}:`, error);

                // 可以通过 webview 显示错误消息
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'showError',
                        message: `Failed to set variable ${variableName}: ${error}`
                    });
                }
            }
        }
    }

    private async evaluateWatchExpression(expression: string, expressionId: string, tabName: string): Promise<void> {
        var session = this.getSession(tabName);
        this.evaluateWatchExpressionByDebugSession(expression, expressionId, session, tabName);
    }

    private async evaluateWatchExpressionByDebugSession(expression: string, expressionId: string, session: vscode.DebugSession | null, tabName: string): Promise<void> {
        if (!session) {
            console.warn(`[evaluateWatchExpression] No debug session found for tab: ${tabName}`);
            // Send error result back to webview
            this._sendWatchExpressionResult(tabName, expressionId, '', 'No debug session', 0);
            return;
        }

        try {
            console.log(`[evaluateWatchExpression] Evaluating expression: ${expression} for tab: ${tabName}`);

            // Use DAP evaluate request to evaluate the expression
            const response = await session.customRequest('evaluate', {
                expression: expression,
                frameId: 0, // Use current frame
                context: 'watch' // Specify this is for watch context
            } as DebugProtocol.EvaluateArguments);

            if (response) {
                console.log(`[evaluateWatchExpression] Successfully evaluated: ${expression}`, response);
                this._sendWatchExpressionResult(
                    tabName,
                    expressionId,
                    response.result,
                    null,
                    response.variablesReference || 0
                );
            } else {
                console.warn(`[evaluateWatchExpression] Empty response for: ${expression}`);
                this._sendWatchExpressionResult(tabName, expressionId, '', 'Empty response', 0);
            }
        } catch (error: any) {
            console.error(`[evaluateWatchExpression] Error evaluating expression ${expression}:`, error);
            const errorMessage = error?.message || error?.toString() || 'Unknown error';
            this._sendWatchExpressionResult(tabName, expressionId, '', errorMessage, 0);
        }
       
    }

    private _sendWatchExpressionResult(tabName: string, expressionId: string, value: string, error: string | null, variablesReference: number): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateWatchExpression',
                tabName: tabName,
                expressionId: expressionId,
                value: value,
                error: error,
                variablesReference: variablesReference
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

        const logEntry = `[${timestamp}] ${message}`;

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

    public addStack(stacks: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }, args: DebugProtocol.StackTraceArguments, tabName: string = 'General') {

        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }
        this.updateStack(tabName, stacks, args);
    }

    public addScopes(scopes: DebugProtocol.Scope[], tabName: string = 'General') {
        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }
        this.updateScopes(tabName, scopes);
    }

    public WatchExpressions(watchExpression: string, value: any, tabName: string = 'General') {
        if (!watchExpression || watchExpression.trim().length === 0) {
            return;
        }
        if (!this._outputTabs.has(tabName)) {
            this._outputTabs.set(tabName, []);
            // Auto-create tab if it doesn't exist
            this._sendCreateTabMessage(tabName);
        }
        this._sendWatchExpressions(tabName, watchExpression, value);

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

    public setSessionInfo(tabName: string, type: 'debug' | 'run', status: 'running' | 'stopped', session?: vscode.DebugSession) {
        // 兼容旧接口，转换为新的状态管理
        const state: 'running' | 'stopped' = status === 'running' ? 'running' : 'stopped';
        this.globalStateManager.setState(tabName, type, state, null, session);
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

    private updateStack(tabName: string, stacks: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }, args?: DebugProtocol.StackTraceArguments) {
        this._sendStackMessage(tabName, stacks, args);
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

    private _sendWatchExpressions(tabName: string, watchExpression: string, value: any) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'watchExpression',
                tabName: tabName,
                watchExpression: watchExpression,
                value: value
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

    private _sendStackMessage(tabName: string, stack: { stackFrames: DebugProtocol.StackFrame[], totalFrames: number }, args?: DebugProtocol.StackTraceArguments) {
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
                stack: stack,
                args: args,
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
            white-space: nowrap;
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
            margin-left:3px;
            width: 25%;
            min-width: 150px;
            max-width: 60%;
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .variables-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }
        
        /* Variables/Watch tabs */
        .variables-tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-tab-inactiveBackground);
            margin-bottom: 4px;
        }
        
        .variables-tab {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 11px;
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            border-right: 1px solid var(--vscode-panel-border);
            transition: all 0.2s ease;
        }
        
        .variables-tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }
        
        .variables-tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-bottom: 2px solid var(--vscode-focusBorder);
        }
        
        .variables-content-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        /* Watch specific styles */
        .watch-list {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-left: 3px;
        }
        
        .watch-input-area {
            display: flex;
            gap: 4px;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBarSectionHeader-background);
        }
        
        .watch-input {
            flex: 1;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 4px 8px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            outline: none;
        }
        
        .watch-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        
        .watch-add-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
            min-width: 24px;
        }
        
        .watch-add-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .watch-expressions {
            flex: 1;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            margin: 0;
            padding: 4px;
        }
        
        .watch-expression-item {
            display: flex;
            align-items: center;
            padding: 4px 6px;
            margin: 2px 0;
            border-radius: 2px;
            cursor: pointer;
            position: relative;
            background-color: var(--vscode-list-background);
        }
        
        .watch-expression-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .watch-expression-content {
            flex: 1;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 4px;
        }
        
        .watch-expression-name {
            color: var(--vscode-debugTokenExpression-name);
            font-weight: bold;
            font-size: 11px;
            display: inline-block;
            flex-shrink: 0;
            min-width: 80px;
        }
        
        .watch-expression-value {
            color: var(--vscode-debugTokenExpression-value);
            font-size: 11px;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 200px;
        }
        
        .watch-expression-error {
            color: var(--vscode-errorForeground);
            font-size: 11px;
            font-style: italic;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 200px;
        }
        
        .watch-expression-remove {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 12px;
            opacity: 0.7;
            margin-left: 4px;
        }
        
        .watch-expression-remove:hover {
            opacity: 1;
            background-color: var(--vscode-button-hoverBackground);
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
        
 
        .variables-list, .stack-list {
            margin-left: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            flex: 1;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .variable-item, .stack-item, .load-more {
            
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
        
        .editable-value {
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            transition: background-color 0.2s ease;
        }
        
        .editable-value:hover {
            background-color: var(--vscode-list-hoverBackground);
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        .variable-value-editor {
            background: var(--vscode-input-background) !important;
            color: var(--vscode-input-foreground) !important;
            border: 1px solid var(--vscode-input-border) !important;
            border-radius: 2px !important;
            padding: 2px 4px !important;
            font-family: inherit !important;
            font-size: inherit !important;
            min-width: 100px !important;
            outline: none !important;
            margin: 0 !important;
        }
        
        .variable-value-editor:focus {
            border-color: var(--vscode-focusBorder) !important;
            box-shadow: 0 0 0 1px var(--vscode-focusBorder) !important;
        }
        
        .variable-type {
            color: var(--vscode-debugTokenExpression-type);
            font-style: italic;
            margin-left: 4px;
        }
        
        /* 右键菜单样式 */
        .context-menu {
            position: fixed;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 3px;
            padding: 4px 0;
            min-width: 150px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            font-size: 12px;
            display: none;
        }
        
        .context-menu-item {
            padding: 6px 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }
        
        .context-menu-item.disabled {
            color: var(--vscode-disabledForeground);
            cursor: not-allowed;
            opacity: 0.5;
        }
        
        .context-menu-item.disabled:hover {
            background: transparent;
            color: var(--vscode-disabledForeground);
        }
        
        .context-menu-separator {
            height: 1px;
            background: var(--vscode-menu-separatorBackground);
            margin: 4px 0;
        }
        
        .context-menu-icon {
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
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
  
        .output-content .frame-location {
          color: #888;
          font-size: 13px;
          margin-top: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .output-content .frame-addr {
          color: #aaa; font-size: 12px;
          margin-top: 3px;
        }
        .variables-list .variable-item  .expand-link {
          cursor: pointer;
          margin-left: 10px;
          padding-right: 4px;
           
        }
        .variables-list .load-more  .load-more-link {
          cursor: pointer;
          margin-left: 14px;
          padding-right: 4px;  
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
                            <div>Call Stack</div>
                            <div class="stack-list">
                            </div>
                        </div>
                        <div class="resize-handle"></div>
                        <div class="variables-section">
                            <div class="variables-tabs">
                                <div class="variables-tab active" data-tab="variables">Variables</div>
                                <div class="variables-tab" data-tab="watch">Watch</div>
                            </div>
                            <div class="variables-content-area">
                                <div class="variables-list active" data-content="variables">
                                    <div class="empty-state"></div>
                                </div>
                                <div class="watch-list" data-content="watch" style="display: none;">
                                    <div class="watch-input-area">
                                        <input type="text" class="watch-input" placeholder="Enter expression..." />
                                        <button class="watch-add-btn">+</button>
                                    </div>
                                    <div class="watch-expressions">
                                        <div class="empty-state">no watch expressions</div>
                                    </div>
                                </div>
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
                
                // Setup watch functionality for variables panel
                setupWatchFunctionality(configName);
                
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
        
        // 右键菜单相关函数
        let contextMenuElement = null;
 
         
        function createContextMenu(variable, tabName) {
            if (contextMenuElement) {
                contextMenuElement.remove();
            }
            
            contextMenuElement = document.createElement('div');
            contextMenuElement.className = 'context-menu';
            contextMenuElement.innerHTML = \`
                <div class="context-menu-item" data-action="copy-name">
                    <span class="context-menu-icon">📋</span>
                    <span>copy name</span>
                </div>
                <div class="context-menu-item" data-action="copy-value">
                    <span class="context-menu-icon">📄</span>
                    <span>copy value</span>
                </div>
                <div class="context-menu-item" data-action="copy-expression">
                    <span class="context-menu-icon">📝</span>
                    <span>copy expression</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="watch">
                    <span class="context-menu-icon">👁️</span>
                    <span>add to watch</span>
                </div>
                <div class="context-menu-separator"></div>
            \`;
            
            // 添加点击事件处理
            contextMenuElement.addEventListener('click', (e) => {
                const item = e.target.closest('.context-menu-item');
                if (!item || item.classList.contains('disabled')) return;
                
                const action = item.getAttribute('data-action');
                handleContextMenuAction(action, variable, tabName);
                hideContextMenu();
            });
            
            document.body.appendChild(contextMenuElement);
            return contextMenuElement;
        }
        
        function showContextMenu(x, y, variable, tabName) {
 
             
            const menu = createContextMenu(variable, tabName);
            // 显示菜单并调整位置
            menu.style.display = 'block';
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            
            // 确保菜单不会超出窗口边界
            const rect = menu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            
            if (rect.right > windowWidth) {
                menu.style.left = (windowWidth - rect.width - 10) + 'px';
            }
            if (rect.bottom > windowHeight) {
                menu.style.top = (windowHeight - rect.height - 10) + 'px';
            }
            
            // 点击其他地方时隐藏菜单
            setTimeout(() => {
                document.addEventListener('click', hideContextMenu);
                document.addEventListener('contextmenu', hideContextMenu);
            }, 10);
        }
        
        function hideContextMenu() {
            if (contextMenuElement) {
                contextMenuElement.style.display = 'none';
                document.removeEventListener('click', hideContextMenu);
                document.removeEventListener('contextmenu', hideContextMenu);
            }
        }

        function handleContextMenuAction(action, variable, tabName) {
            if (!variable || !tabName) return;

            switch (action) {
                case 'copy-name':
                    copyToClipboard(variable.name);
                    break;
                    
                case 'copy-value':
                    copyToClipboard(variable.value);
                    break;
                    
                case 'copy-expression':
                    copyToClipboard(\`\${variable.evaluateName}\`);
                    break;
                    
                    
                case 'watch':
                    addToWatch(variable, tabName);
                    break;
                    
                case 'inspect':
                    inspectVariable(variable, tabName);
                    break;
            }
        }
        
        function copyToClipboard(text) {
            // 优先使用现代的 Clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() => {
                 }).catch(err => {
                    console.warn('Clipboard API failed, falling back to legacy method:', err);
                    fallbackCopy(text);
                });
            } else {
                // 回退到传统方法
                fallbackCopy(text);
            }
        }
        
        function fallbackCopy(text) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-999999px';
                textarea.style.top = '-999999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textarea);
                
                if (!successful) {
                    console.error('Fallback: Copy command was unsuccessful');
                    showNotification('复制失败', 'error');
                }
            } catch (err) {
                console.error('Copy failed:', err);
                showNotification('复制失败', 'error');
            }
        }
        
   
        
        function addToWatch(variable, tabName, parentReference) {
            if(tabName && variable.name) {
                addWatchExpression(tabName, variable.name,parentReference);
            }
        }
        
        function inspectVariable(variable, tabName) {
            vscode.postMessage({
                command: 'inspect_variable',
                tabName: tabName,
                variable: variable
            });
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
            }
        }
        
        // Watch Variables functionality
        let watchExpressions = new Map(); // Map<tabName, Array<watchExpression>>
        
        function setupWatchFunctionality(configName) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            // Initialize watch expressions for this tab
            if (!watchExpressions.has(configName)) {
                watchExpressions.set(configName, []);
            }
            
            // Setup variables/watch tabs
            const variablesTabs = tabContent.querySelectorAll('.variables-tab');
            variablesTabs.forEach(tab => {
                tab.onclick = (e) => {
                    const tabType = e.target.getAttribute('data-tab');
                    switchVariablesTab(configName, tabType);
                };
            });
            
            // Setup watch input
            const watchInput = tabContent.querySelector('.watch-input');
            const watchAddBtn = tabContent.querySelector('.watch-add-btn');
            
            if (watchInput && watchAddBtn) {
                watchAddBtn.onclick = () => {
                    const expression = watchInput.value.trim();
                    if (expression) {
                        addWatchExpression(configName, expression);
                        watchInput.value = '';
                    }
                };
                
                watchInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        watchAddBtn.onclick();
                    }
                };
            }
        }
        
        function switchVariablesTab(configName, tabType) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            // Update tab states
            const tabs = tabContent.querySelectorAll('.variables-tab');
            tabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-tab') === tabType) {
                    tab.classList.add('active');
                }
            });
            
            // Show/hide content
            const variablesList = tabContent.querySelector('[data-content="variables"]');
            const watchList = tabContent.querySelector('[data-content="watch"]');
            
            if (tabType === 'variables') {
                if (variablesList) {
                    variablesList.style.display = 'block';
                    variablesList.classList.add('active');
                }
                if (watchList) {
                    watchList.style.display = 'none';
                }
            } else if (tabType === 'watch') {
                if (variablesList) {
                    variablesList.style.display = 'none';
                    variablesList.classList.remove('active');
                }
                if (watchList) {
                    watchList.style.display = 'block';
                }
                // Refresh watch expressions when switching to watch tab
                refreshWatchExpressions(configName);
            }
        }
        
        function addWatchExpression(configName, expression, variablesReference) {
            if (!watchExpressions.has(configName)) {
                watchExpressions.set(configName, []);
            }
            
            const expressions = watchExpressions.get(configName);
            const existingIndex = expressions.findIndex(e => e.expression === expression);
            
            if (existingIndex === -1) {
                const watchExpr = {
                    id: Date.now() + Math.random(), // Simple unique ID
                    expression: expression,
                    value: 'Evaluating...',
                    error: null,
                    variablesReference: variablesReference
                };
                expressions.push(watchExpr);
                watchExpressions.set(configName, expressions);
                
                // Update UI
                updateWatchUI(configName);
                
                // Evaluate expression
                evaluateWatchExpression(configName, watchExpr);
                vscode.postMessage({
                    command: 'add_watch',
                    tabName: configName,
                    expressionId: watchExpr.id,
                    expression: expression,
                });
                
                showNotification('Added watch expression: ' + expression, 'success');
            } else {
                showNotification('Expression already exists', 'info');
            }
        }
        
        function removeWatchExpression(configName, expressionId) {
            const expressions = watchExpressions.get(configName) || [];
            const newExpressions = expressions.filter(e => e.id !== expressionId);
            watchExpressions.set(configName, newExpressions);
            vscode.postMessage({
                command: 'remove_watch',
                tabName: configName,
                expressionId: expressionId
            });
            updateWatchUI(configName);
        }
        
        function updateWatchUI(configName) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
            if (!watchExpressionsContainer) return;
            
            const expressions = watchExpressions.get(configName) || [];
            
            if (expressions.length === 0) {
                watchExpressionsContainer.innerHTML = '<div class="empty-state">no watch expression</div>';
                return;
            }
            
            watchExpressionsContainer.innerHTML = expressions.map(expr => \`
                <div class="watch-expression-item" data-id="\${expr.id}">
                    <div class="watch-expression-content">
                        <span class="watch-expression-name">\${escapeHtml(expr.expression)}</span>
                        \${expr.error ? 
                            \`<span class="watch-expression-error">\${escapeHtml(expr.error.length > 50 ? expr.error.substring(0, 50) + '...' : expr.error)}</span>\` :
                            \`<span class="watch-expression-value" title="\${escapeHtml(expr.value)}"> = \${escapeHtml(expr.value.length > 50 ? expr.value.substring(0, 50) + '...' : expr.value)}</span>\`
                        }
                    </div>
                    <button class="watch-expression-remove" onclick="removeWatchExpression('\${configName}', \${expr.id})" title="delete">×</button>
                </div>
            \`).join('');
        }
        
        function evaluateWatchExpression(configName, watchExpr) {
            // Send evaluate request to VS Code
            vscode.postMessage({
                command: 'evaluate_watch',
                tabName: configName,
                expression: watchExpr.expression,
                expressionId: watchExpr.id
            });
        }
        
        function refreshWatchExpressions(configName) {
            const expressions = watchExpressions.get(configName) || [];
            expressions.forEach(expr => {
                evaluateWatchExpression(configName, expr);
            });
        }
        
        function updateWatchExpressionValue(configName, expressionId, value, error, variablesReference) {
            const expressions = watchExpressions.get(configName) || [];
            const expr = expressions.find(e => e.id == expressionId);
            if (expr) {
                expr.value = value || '';
                expr.error = error || null;
                expr.variablesReference = variablesReference || 0;
                updateWatchUI(configName);
            }
        }

        


        function updateStack(configName, stack, args) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
 
            const stackList = tabContent.querySelector('.stack-list');
            if (!stackList) { console.warn('Stack list element not found'); return; }
            if (!stack || stack.totalFrames === 0) { 
                stackList.innerHTML = ''; 
                return; 
            }
            
            
            if (!stack.stackFrames || stack.stackFrames.length === 0) {
                stackList.innerHTML = ''; 
                return; 
            }
            if(!args || args.startFrame === 0) {
                stackList.innerHTML = '';
            }
            // m.arguments
            stack.stackFrames.forEach((frame, idx) => {
                const liIdx = args.startFrame + idx;
                if(liIdx == 0)  {
                    stackList.setAttribute('frame-id',  frame.id);
                }
                var li = stackList.querySelector(\`li[data-index="\${liIdx}"]\`);
                if(!li) {
                    li = document.createElement('li');
                }
                const filePath = frame.source.path;
                const fileLinePath = frame.title;
                li.className = 'stack-item' + (frame.presentationHint === 'subtle' ? ' subtle' : '');
                li.setAttribute('data-frame-id', frame.id);
                li.setAttribute('title', fileLinePath);
                li.setAttribute('data-index', idx);
                li.innerHTML = \`
                    <div class="frame-location">
                        <span style="color:#1976d2;text-decoration:underline;cursor:pointer;" class="source-link"> \${fileLinePath}</span>
                    </div>
                \`;
 
 
                // 点击跳转源码
                li.querySelector('.source-link').onclick = (e) => {
                    e.stopPropagation();
                    vscode.postMessage({
                    command: 'gotoSource',
                    path: filePath,
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

        function updateScopes(tabName, scopes) {
            console.log('Updating scopes for tab:', tabName, scopes);
        }

        function cleanDebugInfo(tabName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            
 
            const stackList = tabContent.querySelector('.stack-list');
            if (stackList) { 
                stackList.innerHTML = ''; 
             }

            const variablesList = tabContent.querySelector('.variables-list');
            if (variablesList)  {
                variablesList.innerHTML = '';
            }
        }

        function updateVariables(tabName, variables, args) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            var variablesList = tabContent.querySelector('.variables-list');
            if (!variablesList) return;
             const stackListHTMLNode = tabContent.querySelector('.stack-list');
             if(variablesList.childElementCount === 0) {
                 variablesList.setAttribute('variable-reference', args.variablesReference);
             } else {
                 const existingRef = parseInt(variablesList.getAttribute('variable-reference')) || 0;
                 if(existingRef == args.variablesReference && !args.start) {
                     // 清空旧数据
                     variablesList.innerHTML = '';
                 }
             }

            var isExpanded = false;

             // Update variables (右侧)
            if (variables) {
 
                 const variablesReference = args.variablesReference; 
                // 先不支持增量获取
                const variableItemNode = variablesList.querySelector(\`.variable-item[data-reference="\${variablesReference}"]\`);
                var childInfoNode = null;
                var dataLen = 0;
                if(variableItemNode) {
                    childInfoNode = variableItemNode.querySelector(\`.child-variables\`);
                    dataLen = variableItemNode.getAttribute('data-len');
                }

                isExpanded = false;
                if(childInfoNode){
                    variablesList = childInfoNode;
                    const expandLink = childInfoNode.querySelector('.expand-link');
                    if(expandLink) {
                        if(expandLink.getAttribute('expand-status') === 'true') {
                            isExpanded = true;
                        }
                    }
               
                    
                }
                var currentIdx = args.start || 0;
                if (variables && variables.length  > 0) {
                    variables[0].name === 'len()' && variables.shift();
                }
                const needLoad = currentIdx  + variables.length  >=  parseInt(dataLen);
                
                variables.forEach((variable, index) =>  {
               
                    currentIdx += index;
                    const div = buildVariableItemNode(tabName, variable, isExpanded, stackListHTMLNode, variablesReference);
                    variablesList.appendChild(div);
                });
                if(dataLen  && dataLen > variablesList.childElementCount) {
                    const loadMoreDiv = document.createElement('div');
                    loadMoreDiv.className = 'load-more';
                    loadMoreDiv.innerHTML = '<span class="load-more-link">load more...</span>';
                    loadMoreDiv.onclick = (e) => {
                        loadMoreDiv.remove();
                        e.stopPropagation();
                        vscode.postMessage({
                            tabName: tabName,
                            command: 'get_variables',
                            variablesReference: variablesReference,
                            startIndex: variablesList.childElementCount
                        });
                    };
                    variablesList.appendChild(loadMoreDiv);
                }          
            }  
        }

        function buildVariableItemNode(tabName, variable, isExpanded, stackListHTMLNode, parentReference) {
            const div = document.createElement('div');
            div.className = 'variable-item';
            const hasChildren = variable.variablesReference && variable.variablesReference > 0;
            div.setAttribute('data-reference',  variable.variablesReference );
            div.setAttribute('data-evaluate-name',  variable.evaluateName );
            div.setAttribute('data-len',  variable.indexedVariables || variable.namedVariables|| 0 );
              
            const variableItemInfo = document.createElement('div');
            const expandSpan = document.createElement('span');
            if (hasChildren) {
                expandSpan.className = 'expand-link';
                expandSpan.setAttribute('expand-status', isExpanded ? 'true' : 'false');
                if(isExpanded) {
                    expandSpan.innerHTML = 'v';
                } else {
                    expandSpan.innerText = '>';
                }
                variableItemInfo.appendChild(expandSpan);
            }  else {
                variableItemInfo.innerHTML = \`<span style="display:inline-block;" class='expand-link'>&nbsp;</span>\`;
            } 
     
            variableItemInfo.innerHTML +=  \`<span class="variable-key">\${variable.name}</span>  
            <span class="variable-type">(\${variable.type})</span>\`;
       
            if (hasChildren) {   
                variableItemInfo.innerHTML +=  \` <span class="variable-value">\${variable.value}</span>\`; 
                variableItemInfo.onclick = (e) => {   
                    e.stopPropagation();
                
                
                    var  childNode  =  e.target.closest(".variable-item");
                    if(!childNode)  {
                         return ;
                    }
                    childNode = childNode.querySelector('.child-variables');
                    if(!childNode) return;  
                    const expandSpan = div.querySelector(".expand-link");
                    const currentlyExpanded = expandSpan.getAttribute('expand-status') === 'true';

                    if (currentlyExpanded) {
                        // 收起子节点
                        childNode.style.display = 'none';
                        if(expandSpan) {
                            expandSpan.innerText = '>';
                        }
                        expandSpan.setAttribute('expand-status', 'false');

                    } else {
                        e.stopPropagation();
                        // 展开子节点
                        if(!div.getAttribute('no-need-load-children')) {
                            vscode.postMessage({
                                tabName: tabName,
                                command: 'get_variables',
                                variablesReference: variable.variablesReference,
                            });    
                        }
                        // 标记为不需要加载子节点, 避免重复加载, 这里最好用事件通知
                        div.setAttribute('no-need-load-children', true);
                        childNode.style.display = 'block';
                        if(expandSpan) {
                            expandSpan.innerHTML = 'v';
                        }
                         
                        expandSpan.setAttribute('expand-status', 'true');

                    }
                }
                
                // 添加右键菜单支持
                variableItemInfo.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu(e.clientX, e.clientY, variable, tabName, parentReference);
                };
                
                div.appendChild(variableItemInfo);   

                const childNode = document.createElement('div');
                childNode.className = 'child-variables';
                childNode.style.display = 'none';
                childNode.style.marginLeft = '7px';
                div.append(childNode);

            } else {
                if(variable.value.startsWith('[]') || variable.value.startsWith('map') || variable.value.startsWith('struct')) { 
                    const valueSpan = buildVariableItemNodeValueHTML(tabName, 'variable-value', variable, stackListHTMLNode, parentReference, true);
                    variableItemInfo.appendChild(valueSpan);
                    
                  
                    div.appendChild(variableItemInfo);
                } else {
                    const valueSpan = buildVariableItemNodeValueHTML(tabName, 'variable-value', variable, stackListHTMLNode, parentReference, false);
                    variableItemInfo.appendChild(valueSpan);
                    // 添加右键菜单支持
                    variableItemInfo.oncontextmenu = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showContextMenu(e.clientX, e.clientY, variable, tabName);
                    };
                
                    div.appendChild(variableItemInfo);
                }
            

            }
            return div;
        }
        
        function escapeHtml(value) {
            if (!value) return '';
              return value
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
        }
     
 
        function buildVariableItemNodeValueHTML(tabName, className, variable, stackListHTMLNode, parentReference, noEdit) {
            const valueSpan = document.createElement('span');
            
            // 安全地设置HTML内容，对变量值进行编码
            const safeValue = escapeHtml(variable.value || '');
            valueSpan.innerHTML = \`= <span class="\${className} editable-value" data-value="\${safeValue}" title="click to edit">\${safeValue}</span>\`;           
            if(noEdit) {
                return valueSpan;
            }
 

            // 添加单击编辑功能
            const editableValueSpan = valueSpan.querySelector('.editable-value');
            editableValueSpan.onclick = (e) => {
                e.stopPropagation();
             
                const currentValue = editableValueSpan.getAttribute('data-value');
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentValue;
                input.className = 'variable-value-editor';
                input.style.cssText = \`
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    padding: 2px 4px;
                    font-family: inherit;
                    font-size: inherit;
                    min-width: 100px;
                    outline: none;
                \`;
                
                // 替换显示为输入框
                editableValueSpan.style.display = 'none';
                editableValueSpan.parentElement.insertBefore(input, editableValueSpan);
                input.focus();
                input.select();
                
                // 处理输入完成
                const finishEdit = (save = false) => {
                    if (save && input.value !== currentValue) {
                        newValue = input.value; 
                        if(variable.type === 'string'){
                            if(!newValue.startsWith('"')  ) {
                                newValue = '"' + newValue;
                            }
                            if(!newValue.endsWith('"')  ) {
                                newValue = newValue + '"';
                            }
                        }
                        var vrn = parentReference;
                        if(!vrn || vrn === 0) {
                            vrn = parseInt(stackListHTMLNode.getAttribute('frame-id') || '0', 10);
                        }
                        // 发送更新变量值的消息
                        vscode.postMessage({
                           
                            command: 'set_variable',
                            tabName: tabName,
                            variableName: variable.name,
                            newValue: newValue,
                            variablesReference:  vrn,
                            evaluateName: variable.evaluateName
                        });
                        
                        // 更新显示值
                        //editableValueSpan.textContent = input.value;
                        //editableValueSpan.setAttribute('data-value', input.value);
                    }
                    
                    // 恢复显示
                    input.remove();
                    editableValueSpan.style.display = 'inline';
                };
                
                // 监听键盘事件
                input.onkeydown = (event) => {
                    if (event.key === 'Enter') {
                        finishEdit(true);
                    } else if (event.key === 'Escape') {
                        finishEdit(false);
                    }
                };
                
                // 监听失去焦点
                input.onblur = () => {
                    finishEdit(true);
                };
            };
            return valueSpan;          
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
        
        function setVariableCallback(tabName, variableName, newValue, variablesReference, evaluateName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            
            const variablesList = tabContent.querySelector('.variables-list');
            if (!variablesList) return;
            
            // Find the variable item in the list, by evaluateName
            const variableItem = variablesList.querySelector(\`[data-evaluate-name="\${evaluateName}"]\`);
            if (!variableItem) {
                return;
            }
            const valueSpan = variableItem.querySelector('.variable-value');
            if (valueSpan) {
                // Update the displayed value
                //             valueSpan.innerHTML = \`= <span class="\${className} editable-value" data-value="\${safeValue}" title="单击编辑">\${safeValue}</span>\`;           
                const safeValue = escapeHtml(newValue || '');
                valueSpan.setAttribute('data-value', safeValue);
                valueSpan.innerHTML =  newValue; 
                 
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
                        updateVariables(message.tabName, message.variables, message.args);
                    }
                    break;
                case 'updateStack':
                    if (message.tabName && message.stack) {
                        updateStack(message.tabName, message.stack, message.args);
                    }
                    break;
                case "updateScopes":
                    if (message.tabName && message.scopes) {
                        updateScopes(message.tabName, message.scopes);
                    }
                    break;
                
                case "cleanDebugInfo":
                    if (message.tabName) {
                        cleanDebugInfo(message.tabName);
                    }
                    break;
                case "setVariableCallback":
                    if (message.tabName && message.variableName) {
                        setVariableCallback(message.tabName, message.variableName, message.newValue, message.variablesReference, message.evaluateName);
                    }
                    break;
                case 'showError':
                    if (message.message) {
                        showNotification(message.message, 'error');
                    }
                    break;
                case 'waitchExpressionResponse':
                    if (message.tabName && message.expression) {
                        waitchExpressionResponse(message.tabName, message.expression, message.variablesReference);
                    }
                    break;
                case 'updateWatchExpression':
                    if (message.tabName && message.expressionId) {
                        updateWatchExpressionValue(
                            message.tabName, 
                            message.expressionId, 
                            message.value, 
                            message.error, 
                            message.variablesReference
                        );
                    }
                    break;
                
            }
        });

    </script>
</body>
</html>`;
    }
}
