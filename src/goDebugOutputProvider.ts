import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalStateManager, ConfigState, StateChangeEvent } from './globalStateManager';
import { runDebugConfiguration } from './extension';



import { DebugProtocol } from '@vscode/debugprotocol';
import { getBodyHtml } from './goDebugOutputProvider/body';
import { getStyles } from './goDebugOutputProvider/styles';
import { isString } from 'util';

 
import { GoDebugConfiguration } from './goDebugConfigurationProvider';
import { DebugConfigurationProvider } from "./debugConfigProvider";
import { threadId } from 'worker_threads';
 

export class GoDebugOutputProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'goDebugOutput';

    private _view?: vscode.WebviewView;
    private _outputTabs: Map<string, string[]> = new Map();
    private _watchExpressions: Map<string, { id: string, expression: string }[]> = new Map();
    private _configurations: GoDebugConfiguration[] = [];
    private globalStateManager: GlobalStateManager;
    private stateChangeListener: vscode.Disposable;
    private debugConfigProvider: DebugConfigurationProvider;

    private static instance: GoDebugOutputProvider | null = null;

    constructor(private readonly _extensionUri: vscode.Uri, debugConfigProvider: DebugConfigurationProvider) {
        // 初始化全局状态管理器
        this.globalStateManager = GlobalStateManager.getInstance();
        this.debugConfigProvider = debugConfigProvider;


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

            this.debugConfigProvider.refreshConfigurationState(event.configName);
            // 更新所有相关的UI组件
            this.updateStateDisplayFields(event.configName, event.newState);
        });

 
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
            const stackReq = { threadId: id, startFrame: 0, levels: 20 };
            session.customRequest('stackTrace', stackReq).then((response: any) => {
                session.configuration.gid = id;
                if (response && response.stackFrames) {
                    inst?.addStack(response, stackReq, tabName);
                }
                if (response && response.stackFrames && response.stackFrames.length > 0) {
                    const topFrame = response.stackFrames[0];
                    // 重新拉取 scopes
                    inst?._refreshVariableAndWatchByInst(tabName, session, id, topFrame.id);

                }
                inst?.sendToolbarDebugButtonEnabled(tabName);
            });

        }
    }

    public  sendToolbarDebugButtonEnabled(tabName: string): void {
        this._sendToolbarDebugButtonEnabled(tabName);
    }
    
    public static refreshVariableAndWatch(tabName: string, session: vscode.DebugSession, threadId: number, frameId: number) {
        var inst = GoDebugOutputProvider.instance;
        if (!inst) {
            console.warn(`No instance found`);
            return;
        }

        inst?._refreshVariableAndWatchByInst(tabName, session, threadId, frameId);
    }

    private refreshVariableAndWatch(tabName: string, threadId: number, frameId: number) {
        const session = this.getSession(tabName);
        if (!session) {
            console.warn(`No debug for : ${tabName}`);
            return;
        }
        this._sendCleanVariableAndWatchMessage(tabName);
        this._refreshVariableAndWatchByInst(tabName, session, threadId, frameId);

    }

 
    private _refreshVariableAndWatchByInst(tabName: string, session: vscode.DebugSession, threadId: number, frameId: number) {

        // 重新拉取 scopes
        const scopesReq = { threadId: threadId, frameId: frameId };
        session.customRequest('scopes', scopesReq).then((scopesResponse: any) => {
            var variablesReference = scopesResponse.scopes[0].variablesReference;
            // 重新拉取 variables
            const variablesReq = { variablesReference: variablesReference, start: 0 };
            session.customRequest('variables', variablesReq).then((response: any) => {
                if (response && response.variables) {
                    this.addVariables(response.variables, variablesReq, tabName);
                }
            });

            // 重新拉取 watch expressions
            // inst?.WatchExpressions();
            // 获取页面中所有的 watch expressions
            const watchs = this._watchExpressions.get(tabName) || [];
            for (const { expression, id } of watchs) {
                this.evaluateWatchExpressionByDebugSession(expression, id, variablesReference, session, tabName);
            }
        });
       

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
                this.debugConfigProvider.refreshConfigurationState(tabName);
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

 
        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'toolbarAction':
                        this.handleToolbarAction(message.action, message.tabName, message.args);
                        break;
                    case 'gotoSource':
                        this.handleGotoSource(message.path, message.line, message.column);
                        break;
                    case 'get_variables':
                        this.getVariables(message.variablesReference, message.startIndex, message, message.tabName);
                        break;
                    case 'set_variable':
                        this.setVariable(message.variableName, message.newValue, message.variablesReference, message.evaluateName, message.tabName);
                        break;
                    case 'evaluate_watch':
                        this.evaluateWatchExpression(message.expression, message.expressionId, message.frameId, message.tabName);
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
                    case 'call_function':
                        this.callFunctionEvaluate(message.expression, message.frameId, message.tabName);
                        break;
                    case 'remove_watch':
                        const _re = this._watchExpressions.get(message.tabName) || [];
                        this._watchExpressions.set(message.tabName, _re.filter(w => w.id !== message.expressionId));
                        break;
                    case 'refresh_watch_and_variables':
                        this.refreshVariableAndWatch(message.tabName, message.threadId, message.frameId);
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
                    if (config.itemName === tabName && config.debugSession) {
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

    private getVariables(variablesReference: number, start: number, message: any, tabName: string): void {

        var session = this.getSession(tabName);

        if (!session) {
            console.warn(`[getVariables] No debug session found for tab: ${tabName}`);
            return;
        }
        if (isString(variablesReference)) {
            variablesReference = parseInt(variablesReference) || 0;
        }

        var reqVars: DebugProtocol.VariablesArguments = {
            variablesReference: variablesReference,
            start: start,
        };
        if (start > 0) {
            reqVars.count = 100;
            reqVars.filter = 'indexed';
        }
        session.customRequest('variables', reqVars).then((response: any) => {
            if (response && response.variables) {
                // merge message args into reqVars, 已经存在的属性不覆盖
                Object.keys(message).forEach(key => {
                    if (!(key in reqVars)) {
                        (reqVars as any)[key] = message[key];
                    }
                });

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
                        variablesReference: variablesReference,
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

    private async evaluateWatchExpression(expression: string, expressionId: string, frameId: number, tabName: string): Promise<void> {
        var session = this.getSession(tabName);
        this.evaluateWatchExpressionByDebugSession(expression, expressionId, frameId, session, tabName);
    }

    private async callFunctionEvaluate(expression: string, frameId: number, tabName: string) {
        try {
            var session = this.getSession(tabName);
            if (!session) {
                console.warn(`[callFunctionEvaluate] No debug session found for tab: ${tabName}`);
                return;
            }
            var cmdStr = 'evaluate';

            // Use DAP evaluate request to evaluate the expression
            var response = await session.customRequest(cmdStr, {
                expression: expression,
                frameId: frameId, // Use current frame
                context: 'repl' // Specify this is for repl context
            } as DebugProtocol.EvaluateArguments);
         
            this._sendCallFunctionEvaluateMessage(tabName, expression, response, "");
        } catch (error: any) {
            this._sendCallFunctionEvaluateMessage(tabName, expression, "", error?.message || error?.toString() || 'Unknown error');
            console.error(`[callFunctionEvaluate] Error calling function ${expression}:`, error);
        }
    }

    private async evaluateWatchExpressionByDebugSession(expression: string, expressionId: string, frameId: number, session: vscode.DebugSession | null, tabName: string): Promise<void> {
        if (!session) {
            console.warn(`[evaluateWatchExpression] No debug session found for tab: ${tabName}`);
            // Send error result back to webview
            this._sendWatchExpressionResult(tabName, expressionId, '', 'No debug session', 0);
            return;
        }

        try {
            console.log(`[evaluateWatchExpression] Evaluating expression: ${expression} for tab: ${tabName}`);

            // Use DAP evaluate request to evaluate the expression
            var response = await session.customRequest('evaluate', {
                expression: expression,
                frameId: frameId, // Use current frame
                context: 'repl' // Specify this is for repl context
            } as DebugProtocol.EvaluateArguments);

            if (response) {
                console.log(`[evaluateWatchExpression] Successfully evaluated: ${expression}`, response);

                if (response.variablesReference && response.variablesReference > 0) {
                    const rvn = response?.variablesReference;
                    // Optionally, you can fetch variables here if needed
                    const r2 = await session.customRequest('variables', {
                        variablesReference: rvn
                    } as DebugProtocol.VariablesArguments);
                    response.children = r2.variables || [];

                }
                this._sendWatchExpressionResult(
                    tabName,
                    expressionId,
                    response,
                    null,
                    frameId || 0,
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
                variablesReference: variablesReference,
            });
        }
    }

 

    private createTabsForConfigurations(): void {
        console.log('[createTabsForConfigurations] Creating tabs for loaded configurations...');

        this._configurations.forEach(config => {
            if (!this._outputTabs.has(config.itemName)) {
                console.log(`[createTabsForConfigurations] Creating tab for: ${config.itemName}`);
                this.createTab(config.itemName);
            }
        });

        console.log(`[createTabsForConfigurations] Total tabs created: ${this._outputTabs.size}`);
    }

    private  _sendToolbarDebugButtonEnabled(tabName: string): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'toolbarDebugButtonEnabled',
                tabName: tabName,
            });
        }
    }
 

    private setupDebugSessionListeners(): void {
        // 监听调试会话开始
        vscode.debug.onDidStartDebugSession((session) => {
            const tabName = session.configuration.itemName;
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
            const tabName = session.configuration.itemName;
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
                console.log('[Go Debug Output] Active debug session changed:', session.configuration.itemName);
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
        if(!tabName || tabName.trim().length === 0) {
            tabName = "General";
        }
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

    private async handleToolbarAction(action: string, tabName: string, args?: any) {
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
                   //this.vscodeCommandSession(tabName, 'workbench.action.debug.continue');
                   this.sessionToolbarCommand( tabName, 'continue', args);
                }
                break;
            case 'stepOver':
                if (configState?.action === 'debug') {
                   //this.vscodeCommandSession(tabName, 'workbench.action.debug.stepOver');
                     this.sessionToolbarCommand( tabName, 'next', args);
                }
                break;
            case 'stepInto':
                if (configState?.action === 'debug') {
                   //this.vscodeCommandSession(tabName, 'workbench.action.debug.stepInto');
                    this.sessionToolbarCommand( tabName, 'stepIn', args);
                }
                break;
            case 'stepOut':
                if (configState?.action === 'debug') {
                   //this.vscodeCommandSession(tabName, 'workbench.action.debug.stepOut');
                    this.sessionToolbarCommand( tabName, 'stepOut', args);
                }
                break;
        }
    }

     private async sessionToolbarCommand(tabName: string, command: string, args?: any) {
        const session = this.getSession(tabName);
        if (!session) {
            this.addOutput(`⚠️ No active session for ${tabName}`, tabName);
            return;
        }

        try {
            await session.customRequest(command, { threadId:session.configuration.gid,...args });
        } catch (error) {
            console.error(`[sessionCommand] Error executing command "${command}" for ${tabName}:`, error);
            this.addOutput(`❌ Error executing command "${command}" for ${tabName}: ${error}`, tabName);
        }
    }
    
    private vscodeCommandSession(tabName: string, cmd: string) {
        var session = this.getSession(tabName);
        if(!session) {
            this.addOutput(`No active debug session for tab: ${tabName}`, tabName);
            return;
        }
        if(vscode.debug.activeDebugSession?.id !== session.id) {
            try{
                vscode.debug.activeDebugSession = session;  
            }catch(e){
                console.error(`Error setting active debug session:`, e);
                this.addOutput(`Error setting active debug session: ${e}`, tabName);
            }   
        }
        vscode.commands.executeCommand(cmd);

    }


    /**
     * 处理跳转到源码的请求
     */
    private async handleGotoSource(filePath: string, line: number, column?: number): Promise<void> {
        try {
            
            // 检查文件是否存在,
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

    public findConfigurationByName(name: string): GoDebugConfiguration | undefined {
        // DebugConfigurationProvider 找到对应的配置
        return this.debugConfigProvider.findConfigurationByItemName(name);
        
    }

    private async executeRun(tabName: string, mode: string) {
        console.log(`[executeRun] Looking for configuration: "${tabName}"`);
        console.log(`[executeRun] Available configurations:`, this._configurations.map(c => c.itemName));


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
                const result = await runDebugConfiguration(config, sessionType);
                if (result) {
                    console.log(`[executeRun] Successfully started ${sessionType} for ${tabName}`);
                    this.globalStateManager.setState(tabName, sessionType, 'running');
                    this.addOutput(`✅ Successfully started ${sessionType} session: ${tabName}`, tabName);
                }
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

    private _sendCleanVariableAndWatchMessage(tabName: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'cleanVariableAndWatch',
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

            const cfg = this.findConfigurationByName(tabName);
            var wsf = cfg?.vscWorkspaceFolder;
 
        
            // stack.stackFrames 所有元素，新加一个字段叫 title  = true， 等所有数据处理完成，然后再执行 this._view.webview.postMessage
            stack.stackFrames.forEach(frame => {
                const fileLinePath = `${frame?.source?.path}:${frame.line}`;
                if (wsf) {
                    if (fileLinePath.startsWith(wsf)) {
                        (frame as any).title = fileLinePath.replace(wsf, '').replace(/^\//, '');
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

    private _sendCallFunctionEvaluateMessage(tabName: string, expression: string, result: any, error: string ) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'call_function_result',
                tabName: tabName,
                expression: expression,
                result: result,
                error: error
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
            const tabName = activeSessions.configuration?.itemName;
            if (tabName) {
                console.log('[Go Debug Output] Syncing with active debug session:', activeSessions.name);
                this.setSessionInfo(tabName, 'debug', 'running', activeSessions);
            }
        }

        // 检查所有调试会话
        for (const session of vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []) {
            if (session.type === 'go-debug-pro') {
                const tabName = session.configuration?.itemName;
                if (tabName) {
                    console.log('[Go Debug Output] Found active go-debug-pro session:', session.name);
                    this.setSessionInfo(tabName, 'debug', 'running', session);
                }
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
${getBodyHtml()};
</html>`;
    }
}
