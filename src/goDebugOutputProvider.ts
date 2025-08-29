import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GlobalStateManager, ConfigState, StateChangeEvent } from './globalStateManager';

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
            this.updateToolbarState(event.configName);
        });
        
        // Don't create default tab anymore
        this.loadConfigurations();
        this.setupFileWatcher();
        this.setupDebugSessionListeners();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Update all toolbar states after content is loaded
        setTimeout(() => {
            this.updateAllToolbarStates();
        }, 100);

        // Set up delayed configuration refresh
        setTimeout(() => {
            console.log('Delayed configuration refresh');
            this.loadConfigurations();
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
        console.log('Loading configurations...');
        this._configurations = [];
        
        if (vscode.workspace.workspaceFolders) {
            for (const folder of vscode.workspace.workspaceFolders) {
                const launchJsonPath = path.join(folder.uri.fsPath, '.vscode', 'launch.json');
                console.log('Checking launch.json at:', launchJsonPath);
                
                if (fs.existsSync(launchJsonPath)) {
                    try {
                        const content = fs.readFileSync(launchJsonPath, 'utf8');
                        const launch = JSON.parse(content);
                        
                        if (launch.configurations && Array.isArray(launch.configurations)) {
                            console.log('Found configurations:', launch.configurations.length);
                            const goDebugProConfigs = launch.configurations.filter(
                                (config: any) => config.type === 'go-debug-pro'
                            );
                            console.log('Go Debug Pro configurations:', goDebugProConfigs.length);
                            this._configurations.push(...goDebugProConfigs);
                        }
                    } catch (error) {
                        console.error('Error reading launch.json:', error);
                    }
                } else {
                    console.log('launch.json does not exist at:', launchJsonPath);
                }
            }
        } else {
            console.log('No workspace folders found');
        }
        
        console.log('Total configurations loaded:', this._configurations.length);
        // No need to update webview here since it's just configuration loading
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
            console.log('[Go Debug Output] Debug session started:', session.name, session.type);
            if (session.type === 'go-debug-pro') {
                this.setSessionInfo(session.name, 'debug', 'running');
                this.addOutput(`🚀 Debug session started: ${session.name}`, session.name);
            }
        });

        // 监听调试会话结束
        vscode.debug.onDidTerminateDebugSession((session) => {
            console.log('[Go Debug Output] Debug session terminated:', session.name, session.type);
            if (session.type === 'go-debug-pro') {
                this.setSessionInfo(session.name, 'debug', 'stopped');
                this.addOutput(`🛑 Debug session terminated: ${session.name}`, session.name);
            }
        });

        // 监听调试会话变化
        vscode.debug.onDidChangeActiveDebugSession((session) => {
            if (session && session.type === 'go-debug-pro') {
                console.log('[Go Debug Output] Active debug session changed:', session.name);
                this.setSessionInfo(session.name, 'debug', 'running');
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
                    await this.executeRun(tabName);
                }
                break;
            case 'stop':
                if (configState && (configState.state === 'running' || configState.state === 'starting')) {
                    this.addOutput(`Stopping ${tabName}...`, tabName);
                    this.globalStateManager.stopConfig(tabName);
                }
                break;
            case 'restart':
                this.addOutput(`Restarting ${tabName}...`, tabName);
                await this.restartSession(tabName);
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

    private async executeRun(tabName: string) {
        // Find configuration and execute it
        const config = this._configurations.find(c => c.name === tabName);
        if (config) {
            const sessionType: 'debug' | 'run' = config.mode === 'exec' ? 'run' : 'debug';
            
            // 创建标签页（如果不存在）
            if (!this._outputTabs.has(tabName)) {
                this.createTab(tabName);
            }
            
            // 设置为启动状态
            this.globalStateManager.setState(tabName, sessionType, 'starting');
            this.addOutput(`🚀 Starting ${sessionType} session: ${tabName}`, tabName);
            
            try {
                // 执行调试/运行命令
                const success = await vscode.commands.executeCommand('vscode.startDebugging', undefined, config);
                if (success) {
                    console.log(`[Go Debug Output] Successfully started ${sessionType} for ${tabName}`);
                    this.globalStateManager.setState(tabName, sessionType, 'running');
                } else {
                    console.log(`[Go Debug Output] Failed to start ${sessionType} for ${tabName}`);
                    this.globalStateManager.setState(tabName, sessionType, 'stopped');
                    this.addOutput(`❌ Failed to start ${sessionType} session: ${tabName}`, tabName);
                }
            } catch (error) {
                console.error(`[Go Debug Output] Error starting ${sessionType} for ${tabName}:`, error);
                this.globalStateManager.setState(tabName, sessionType, 'stopped');
                this.addOutput(`❌ Error starting ${sessionType} session: ${error}`, tabName);
            }
        } else {
            this.addOutput(`❌ Configuration not found: ${tabName}`, tabName);
        }
    }

    private async stopSession(tabName: string) {
        const configState = this.globalStateManager.getState(tabName);
        if (configState && (configState.state === 'running' || configState.state === 'starting')) {
            this.addOutput(`🛑 Stopping session: ${tabName}`, tabName);
            
            if (configState.action === 'debug') {
                // Stop debug session
                vscode.commands.executeCommand('workbench.action.debug.stop');
            } else if (configState.process) {
                // Stop managed process
                configState.process.kill('SIGTERM');
                setTimeout(() => {
                    if (configState.process && !configState.process.killed) {
                        configState.process.kill('SIGKILL');
                    }
                }, 3000);
            }
            
            this.globalStateManager.setState(tabName, configState.action, 'stopped');
        }
    }

    private async restartSession(tabName: string) {
        await this.stopSession(tabName);
        setTimeout(() => this.executeRun(tabName), 500);
    }

    private async executeDebug(tabName: string) {
        // executeDebug is the same as executeRun, the distinction is handled by the config type
        await this.executeRun(tabName);
    }

    public setSessionInfo(tabName: string, type: 'debug' | 'run', status: 'running' | 'stopped', process?: any) {
        // 兼容旧接口，转换为新的状态管理
        const state: 'running' | 'stopped' = status === 'running' ? 'running' : 'stopped';
        this.globalStateManager.setState(tabName, type, state, process);
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
    
    private updateAllToolbarStates() {
        // 首先检查当前活动的调试会话
        this.syncWithActiveDebugSessions();
        
        // 然后发送工具栏状态更新给所有会话
        const allStates = this.globalStateManager.getAllStates();
        for (const [name, configState] of allStates.entries()) {
            this.updateToolbarState(name);
        }
    }
    
    private syncWithActiveDebugSessions() {
        // 检查当前活动的调试会话并同步状态
        const activeSessions = vscode.debug.activeDebugSession;
        if (activeSessions && activeSessions.type === 'go-debug-pro') {
            console.log('[Go Debug Output] Syncing with active debug session:', activeSessions.name);
            this.setSessionInfo(activeSessions.name, 'debug', 'running');
        }
        
        // 检查所有调试会话
        for (const session of vscode.debug.activeDebugSession ? [vscode.debug.activeDebugSession] : []) {
            if (session.type === 'go-debug-pro') {
                console.log('[Go Debug Output] Found active go-debug-pro session:', session.name);
                this.setSessionInfo(session.name, 'debug', 'running');
            }
        }
    }
    
    private getToolbarButtons(tabId: string, tab: any): string {
        const configState = this.globalStateManager.getState(tabId);
        const isDebugSession = configState?.action === 'debug';
        const isRunning = configState?.state === 'running' || configState?.state === 'starting';
        
        let buttons = '';
        
        // Stop button (always available when session is running)
        if (isRunning) {
            buttons += `<button class="toolbar-button" data-action="stop" title="Stop">⏹️</button>`;
        } else {
            buttons += `<button class="toolbar-button" data-action="stop" title="Stop" disabled>⏹️</button>`;
        }
        
        // Run/Rerun button
        if (!isRunning) {
            buttons += `<button class="toolbar-button" data-action="run" title="Run">▶️</button>`;
        } else {
            buttons += `<button class="toolbar-button" data-action="restart" title="Restart">🔄</button>`;
        }
        
        // Debug-specific controls
        if (isDebugSession && isRunning) {
            buttons += `<div class="toolbar-separator"></div>`;
            buttons += `<button class="toolbar-button" data-action="continue" title="Continue">▶️</button>`;
            buttons += `<button class="toolbar-button" data-action="stepOver" title="Step Over">⤴️</button>`;
            buttons += `<button class="toolbar-button" data-action="stepInto" title="Step Into">⤵️</button>`;
            buttons += `<button class="toolbar-button" data-action="stepOut" title="Step Out">⤴️</button>`;
        }
        
        return buttons;
    }

    public dispose() {
        // 清理事件监听器
        if (this.stateChangeListener) {
            this.stateChangeListener.dispose();
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
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Go Debug Output</title>
    <style>
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
            padding: 6px 10px;
            background-color: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 4px;
            flex-shrink: 0;
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
        
        .toolbar-separator {
            width: 1px;
            height: 16px;
            background-color: var(--vscode-panel-border);
            margin: 0 4px;
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
                    <button class="toolbar-button" data-action="stop" title="Stop" disabled>⏹️</button>
                    <button class="toolbar-button primary" data-action="run" title="Run">▶️</button>
                    <button class="toolbar-button" data-action="restart" title="Restart" disabled>🔄</button>
                    <div class="toolbar-separator"></div>
                    <button class="toolbar-button" data-action="continue" title="Continue" disabled>▶️</button>
                    <button class="toolbar-button" data-action="stepOver" title="Step Over" disabled>⤴️</button>
                    <button class="toolbar-button" data-action="stepInto" title="Step Into" disabled>⤵️</button>
                    <button class="toolbar-button" data-action="stepOut" title="Step Out" disabled>⤴️</button>
                \`;
                
                // Add event listeners to toolbar buttons
                toolbar.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target && target.classList && target.classList.contains('toolbar-button')) {
                        const action = target.getAttribute('data-action');
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
                
                tabContent.appendChild(toolbar);
                tabContent.appendChild(outputContent);
                outputContainer.appendChild(tabContent);
                
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
        
        function updateToolbar(tabName, configState) {
            const toolbar = document.querySelector(\`[data-tab="\${tabName}"]\`);
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
            
            // Update restart button - enabled when running
            const restartBtn = toolbar.querySelector('[data-action="restart"]');
            if (restartBtn) {
                restartBtn.disabled = !isRunning;
                console.log(\`[JS] Restart button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
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
            }
        });
    </script>
</body>
</html>`;
    }
}
