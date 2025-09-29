import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalStateManager, ConfigState, StateChangeEvent } from './globalStateManager';
import { runDebugConfiguration } from './extension';
import { getStyles } from './goDebugOutputProvider/css';
import { getCreateTabHtml } from './goDebugOutputProvider/create_tab';
import { getSplitResizeHtml } from './goDebugOutputProvider/split_resize';
 

import { DebugProtocol } from 'vscode-debugprotocol';
import { getConsoleHtml } from './goDebugOutputProvider/console';
import { getToolbarHtml } from './goDebugOutputProvider/toolbar';
import { getPostMessageHtml } from './goDebugOutputProvider/post_message';
import { getStackHtml } from './goDebugOutputProvider/stack';
import { getVariablesHtml } from './goDebugOutputProvider/variables';
 




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
    ${getStyles()}
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
        
        ${getSplitResizeHtml()}
        
        ${getCreateTabHtml()}
        
        
        
        ${getConsoleHtml()}
        
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
        

        ${getStackHtml()}

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

        ${getVariablesHtml()}
    

        ${getToolbarHtml()}


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

        ${getPostMessageHtml()}

    </script>
</body>
</html>`;
    }
}
