import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class GoDebugOutputProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'goDebugOutput';

    private _view?: vscode.WebviewView;
    private _outputTabs: Map<string, string[]> = new Map();
    private _configurations: any[] = [];
    private sessionInfo = new Map<string, { type: 'debug' | 'run'; status: 'running' | 'stopped'; process?: any; }>();

    constructor(private readonly _extensionUri: vscode.Uri) {
        // Don't create default tab anymore
        this.loadConfigurations();
        this.setupFileWatcher();
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

        // Set up delayed configuration refresh
        setTimeout(() => {
            console.log('Delayed configuration refresh');
            this.loadConfigurations();
        }, 1000);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    // Remove copy, clear commands - no longer needed
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
    }
    
    public switchToTab(tabName: string) {
        this._switchToTab(tabName);
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
    
    private getToolbarButtons(tabId: string, tab: any): string {
        const sessionInfo = this.sessionInfo.get(tabId);
        const isDebugSession = sessionInfo?.type === 'debug';
        const isRunning = sessionInfo?.status === 'running';
        
        let buttons = '';
        
        // Stop button (always available when session is running)
        if (isRunning) {
            buttons += `<button class="toolbar-button" data-action="stop" title="Stop">⏹️</button>`;
        }
        
        // Run/Rerun button
        if (!isRunning) {
            buttons += `<button class="toolbar-button primary" data-action="run" title="Run">▶️</button>`;
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
            padding: 10px;
        }
        
        .empty-state {
            color: var(--vscode-descriptionForeground);
            text-align: center;
            margin-top: 50px;
            font-style: italic;
        }
        
        .log-line {
            margin-bottom: 2px;
            line-height: 1.2;
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
            const content = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (content && tabs.has(tabName)) {
                const messages = tabs.get(tabName);
                if (messages.length > 0) {
                    content.innerHTML = messages.map(msg => 
                        \`<div class="log-line">\${msg}</div>\`
                    ).join('');
                    content.scrollTop = content.scrollHeight;
                } else {
                    content.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';
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
            }
        });
    </script>
</body>
</html>`;
    }
}
