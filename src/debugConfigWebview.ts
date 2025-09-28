import * as vscode from 'vscode';
import { DebugConfigItem } from './debugConfigProvider';

export class DebugConfigWebviewProvider {
    
    public static show(context: vscode.ExtensionContext, configItem: DebugConfigItem): void {
        const panel = vscode.window.createWebviewPanel(
            'debugConfigDetails',
            `Debug Config: ${configItem.label}`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getWebviewContent(configItem);

        // 处理来自 webview 的消息
        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'runConfig':
                        await vscode.commands.executeCommand('goDebugPro.runConfiguration', configItem);
                        break;
                    case 'editConfig':
                        await vscode.commands.executeCommand('goDebugPro.editConfiguration', configItem);
                        break;
                    case 'duplicateConfig':
                        await vscode.commands.executeCommand('goDebugPro.duplicateConfiguration', configItem);
                        break;
                    case 'deleteConfig':
                        await vscode.commands.executeCommand('goDebugPro.deleteConfiguration', configItem);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    }

    private static getWebviewContent(configItem: DebugConfigItem): string {
        const config = configItem.configuration;
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Debug Configuration Details</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            margin: 0;
        }
        
        .header {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 20px;
            margin-bottom: 20px;
        }
        
        .title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
            color: var(--vscode-debugIcon-startForeground);
        }
        
        .subtitle {
            font-size: 14px;
            color: var(--vscode-descriptionForeground);
        }
        
        .config-section {
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 15px;
            color: var(--vscode-titleBar-activeForeground);
        }
        
        .config-table {
            width: 100%;
            border-collapse: collapse;
            background-color: var(--vscode-editor-background);
        }
        
        .config-table th,
        .config-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .config-table th {
            background-color: var(--vscode-list-hoverBackground);
            font-weight: bold;
            width: 200px;
        }
        
        .config-table td {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        
        .code {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            overflow-x: auto;
        }
        
        .actions {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        .button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 10px 20px;
            margin-right: 10px;
            margin-bottom: 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .button.danger {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        
        .button.danger:hover {
            background-color: var(--vscode-errorForeground);
            opacity: 0.8;
        }
        
        .status-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: bold;
        }
        
        .status-ready {
            background-color: var(--vscode-debugIcon-startForeground);
            color: white;
        }
        
        .json-viewer {
            max-height: 300px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">🐛 ${config.name}</div>
        <div class="subtitle">
            <span class="status-badge status-ready">${config.type}</span>
            Workspace: ${configItem.workspace}
        </div>
    </div>
    
    <div class="config-section">
        <div class="section-title">📋 Basic Configuration</div>
        <table class="config-table">
            <tr>
                <th>Name</th>
                <td>${config.name}</td>
            </tr>
            <tr>
                <th>Type</th>
                <td>${config.type}</td>
            </tr>
            <tr>
                <th>Request</th>
                <td>${config.request}</td>
            </tr>
            <tr>
                <th>Program</th>
                <td>${config.program || 'Not specified'}</td>
            </tr>
            <tr>
                <th>Working Directory</th>
                <td>${config.cwd || 'Not specified'}</td>
            </tr>
            <tr>
                <th>Stop on Entry</th>
                <td>${config.stopOnEntry ? 'Yes' : 'No'}</td>
            </tr>
        </table>
    </div>
    
    ${config.args && config.args.length > 0 ? `
    <div class="config-section">
        <div class="section-title">⚙️ Arguments</div>
        <div class="code">${config.args.join('\n')}</div>
    </div>
    ` : ''}
    
    ${config.env && Object.keys(config.env).length > 0 ? `
    <div class="config-section">
        <div class="section-title">🌍 Environment Variables</div>
        <table class="config-table">
            ${Object.entries(config.env).map(([key, value]) => `
                <tr>
                    <th>${key}</th>
                    <td>${value}</td>
                </tr>
            `).join('')}
        </table>
    </div>
    ` : ''}
    
    <div class="config-section">
        <div class="section-title">📝 Complete Configuration</div>
        <div class="json-viewer">
            <div class="code">${JSON.stringify(config, null, 2)}</div>
        </div>
    </div>
    
    <div class="actions">
        <button class="button" onclick="runConfig()">
            ▶️ Run Debug
        </button>
        <button class="button secondary" onclick="editConfig()">
            ✏️ Edit Configuration
        </button>
        <button class="button secondary" onclick="duplicateConfig()">
            📋 Duplicate
        </button>
        <button class="button danger" onclick="deleteConfig()">
            🗑️ Delete
        </button>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        function runConfig() {
            vscode.postMessage({ command: 'runConfig' });
        }
        
        function editConfig() {
            vscode.postMessage({ command: 'editConfig' });
        }
        
        function duplicateConfig() {
            vscode.postMessage({ command: 'duplicateConfig' });
        }
        
        function deleteConfig() {
            vscode.postMessage({ command: 'deleteConfig' });
        }
    </script>
</body>
</html>`;
    }
}