import * as vscode from 'vscode';
import { RunConfiguration, RunConfigItem } from './runConfigManager';

export class RunConfigWebviewProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static showConfigDetails(context: vscode.ExtensionContext, configItem: RunConfigItem) {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (RunConfigWebviewProvider.currentPanel) {
            RunConfigWebviewProvider.currentPanel.reveal(columnToShowIn);
            RunConfigWebviewProvider.currentPanel.webview.html = this.getWebviewContent(configItem);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'runConfigDetails',
            `Run Configuration: ${configItem.configuration?.name || 'Details'}`,
            columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        RunConfigWebviewProvider.currentPanel = panel;

        panel.webview.html = this.getWebviewContent(configItem);

        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'runConfig':
                        if (configItem.configuration) {
                            const success = await vscode.debug.startDebugging(
                                vscode.workspace.workspaceFolders?.[0],
                                configItem.configuration.name
                            );
                            if (success) {
                                //vscode.window.showInformationMessage(`Started: ${configItem.configuration.name}`);
                            } else {
                                vscode.window.showErrorMessage(`Failed to start: ${configItem.configuration.name}`);
                            }
                        }
                        break;
                    case 'editConfig':
                        if (configItem.configuration) {
                            const configJson = JSON.stringify(configItem.configuration, null, 2);
                            const doc = await vscode.workspace.openTextDocument({
                                content: configJson,
                                language: 'json'
                            });
                            await vscode.window.showTextDocument(doc);
                        }
                        break;
                    case 'duplicateConfig':
                        vscode.commands.executeCommand('goDebugPro.duplicateRunConfiguration', configItem);
                        break;
                    case 'deleteConfig':
                        vscode.commands.executeCommand('goDebugPro.deleteRunConfiguration', configItem);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(() => {
            RunConfigWebviewProvider.currentPanel = undefined;
        }, null, context.subscriptions);
    }

    private static getWebviewContent(configItem: RunConfigItem): string {
        const config = configItem.configuration;
        if (!config) {
            return '<html><body><h1>No configuration data available</h1></body></html>';
        }

        const configJson = JSON.stringify(config, null, 2);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Run Configuration Details</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .header {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .config-icon {
            width: 32px;
            height: 32px;
            margin-right: 15px;
            background: var(--vscode-button-background);
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
        }
        
        .config-title {
            flex: 1;
        }
        
        .config-name {
            font-size: 24px;
            font-weight: bold;
            margin: 0;
        }
        
        .config-type {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            margin: 5px 0 0 0;
        }
        
        .actions {
            display: flex;
            gap: 10px;
        }
        
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-danger {
            background: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
        }
        
        .section {
            margin-bottom: 25px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .section-header {
            background: var(--vscode-editorGroupHeader-tabsBackground);
            padding: 12px 16px;
            font-weight: bold;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .section-content {
            padding: 16px;
        }
        
        .property-grid {
            display: grid;
            grid-template-columns: 150px 1fr;
            gap: 12px 20px;
            align-items: start;
        }
        
        .property-label {
            font-weight: bold;
            color: var(--vscode-symbolIcon-propertyForeground);
        }
        
        .property-value {
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-input-background);
            padding: 6px 8px;
            border-radius: 3px;
            border: 1px solid var(--vscode-input-border);
            word-break: break-all;
        }
        
        .property-value.code {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        
        .property-value.empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        
        .json-view {
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 16px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            overflow-x: auto;
            white-space: pre-wrap;
            line-height: 1.5;
        }
        
        .array-value {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        .array-item {
            background: var(--vscode-input-background);
            padding: 4px 8px;
            border-radius: 3px;
            border: 1px solid var(--vscode-input-border);
            font-family: var(--vscode-editor-font-family);
        }
        
        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .status-launch {
            background: var(--vscode-charts-green);
            color: var(--vscode-editor-background);
        }
        
        .status-attach {
            background: var(--vscode-charts-blue);
            color: var(--vscode-editor-background);
        }
        
        .status-test {
            background: var(--vscode-charts-orange);
            color: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="config-icon">
                ${config.request === 'launch' ? '🚀' : '🔗'}
            </div>
            <div class="config-title">
                <h1 class="config-name">${config.name}</h1>
                <p class="config-type">
                    <span class="status-badge status-${config.request}">${config.request}</span>
                    ${config.type}
                </p>
            </div>
            <div class="actions">
                <button class="btn btn-primary" onclick="runConfig()">
                    ▶️ Run
                </button>
                <button class="btn btn-secondary" onclick="editConfig()">
                    ✏️ Edit
                </button>
                <button class="btn btn-secondary" onclick="duplicateConfig()">
                    📋 Duplicate
                </button>
                <button class="btn btn-danger" onclick="deleteConfig()">
                    🗑️ Delete
                </button>
            </div>
        </div>

        <div class="section">
            <div class="section-header">Basic Configuration</div>
            <div class="section-content">
                <div class="property-grid">
                    <div class="property-label">Name:</div>
                    <div class="property-value">${config.name}</div>
                    
                    <div class="property-label">Type:</div>
                    <div class="property-value">${config.type}</div>
                    
                    <div class="property-label">Request:</div>
                    <div class="property-value">${config.request}</div>
                    
                    ${config.program ? `
                    <div class="property-label">Program:</div>
                    <div class="property-value code">${config.program}</div>
                    ` : ''}
                    
                    ${config.cwd ? `
                    <div class="property-label">Working Directory:</div>
                    <div class="property-value code">${config.cwd}</div>
                    ` : ''}
                    
                    ${config.mode ? `
                    <div class="property-label">Mode:</div>
                    <div class="property-value">${config.mode}</div>
                    ` : ''}
                </div>
            </div>
        </div>

        ${config.args && config.args.length > 0 ? `
        <div class="section">
            <div class="section-header">Arguments</div>
            <div class="section-content">
                <div class="array-value">
                    ${config.args.map(arg => `<div class="array-item">${arg}</div>`).join('')}
                </div>
            </div>
        </div>
        ` : ''}

        ${config.env && Object.keys(config.env).length > 0 ? `
        <div class="section">
            <div class="section-header">Environment Variables</div>
            <div class="section-content">
                <div class="property-grid">
                    ${Object.entries(config.env).map(([key, value]) => `
                        <div class="property-label">${key}:</div>
                        <div class="property-value code">${value}</div>
                    `).join('')}
                </div>
            </div>
        </div>
        ` : ''}

        ${config.buildFlags && config.buildFlags.length > 0 ? `
        <div class="section">
            <div class="section-header">Build Flags</div>
            <div class="section-content">
                <div class="array-value">
                    ${config.buildFlags.map(flag => `<div class="array-item">${flag}</div>`).join('')}
                </div>
            </div>
        </div>
        ` : ''}

        ${config.dlvFlags && config.dlvFlags.length > 0 ? `
        <div class="section">
            <div class="section-header">Delve Flags</div>
            <div class="section-content">
                <div class="array-value">
                    ${config.dlvFlags.map(flag => `<div class="array-item">${flag}</div>`).join('')}
                </div>
            </div>
        </div>
        ` : ''}

        <div class="section">
            <div class="section-header">Advanced Options</div>
            <div class="section-content">
                <div class="property-grid">
                    <div class="property-label">Show Log:</div>
                    <div class="property-value">${config.showLog ? 'Yes' : 'No'}</div>
                    
                    ${config.logOutput ? `
                    <div class="property-label">Log Output:</div>
                    <div class="property-value">${config.logOutput}</div>
                    ` : ''}
                    
                    <div class="property-label">Stop on Entry:</div>
                    <div class="property-value">${config.stopOnEntry ? 'Yes' : 'No'}</div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-header">Raw JSON Configuration</div>
            <div class="section-content">
                <div class="json-view">${configJson}</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function runConfig() {
            vscode.postMessage({ type: 'runConfig' });
        }

        function editConfig() {
            vscode.postMessage({ type: 'editConfig' });
        }

        function duplicateConfig() {
            vscode.postMessage({ type: 'duplicateConfig' });
        }

        function deleteConfig() {
            if (confirm('Are you sure you want to delete this configuration?')) {
                vscode.postMessage({ type: 'deleteConfig' });
            }
        }
    </script>
</body>
</html>`;
    }
}
