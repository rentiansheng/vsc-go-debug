import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { GoDebugConfiguration } from './goDebugConfigurationProvider';

export class ConfigurationEditorProvider {
    private static currentPanel: vscode.WebviewPanel | undefined;

    public static showConfigurationEditor(
        context: vscode.ExtensionContext, 
        config?: GoDebugConfiguration,
        isEdit: boolean = false
    ) {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ConfigurationEditorProvider.currentPanel) {
            ConfigurationEditorProvider.currentPanel.reveal(columnToShowIn);
            ConfigurationEditorProvider.currentPanel.webview.html = ConfigurationEditorProvider.getWebviewContent(config, isEdit);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'configurationEditor',
            isEdit ? `Edit Configuration: ${config?.name || 'Unknown'}` : 'New Debug Configuration',
            columnToShowIn || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ConfigurationEditorProvider.currentPanel = panel;

        panel.webview.html = ConfigurationEditorProvider.getWebviewContent(config, isEdit);

        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'saveConfiguration':
                        await ConfigurationEditorProvider.saveConfiguration(message.config, isEdit);
                        break;
                    case 'previewConfiguration':
                        await ConfigurationEditorProvider.previewConfiguration(message.config);
                        break;
                    case 'testConfiguration':
                        await ConfigurationEditorProvider.testConfiguration(message.config);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(() => {
            ConfigurationEditorProvider.currentPanel = undefined;
        }, null, context.subscriptions);
    }

    private static async saveConfiguration(config: GoDebugConfiguration, isEdit: boolean): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        // Create a clean configuration for VSCode compatibility
        const cleanConfig = { ...config };
        
        // Remove internal editor properties that shouldn't be saved to launch.json
        delete cleanConfig.runMode;
        delete cleanConfig.packagePath;
        delete cleanConfig.mainFile;
        delete cleanConfig.workingDir;

        const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
        
        let launchConfig: any = {
            version: '0.2.0',
            configurations: []
        };

        // 读取现有配置
        if (fs.existsSync(launchJsonPath)) {
            try {
                const content = fs.readFileSync(launchJsonPath, 'utf8');
                const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
                launchConfig = JSON.parse(cleanContent);
            } catch (error) {
                console.error('Error reading launch.json:', error);
            }
        }

        if (isEdit) {
            // 更新现有配置
            const index = launchConfig.configurations.findIndex((c: any) => c.name === cleanConfig.name);
            if (index !== -1) {
                launchConfig.configurations[index] = cleanConfig;
            } else {
                launchConfig.configurations.push(cleanConfig);
            }
        } else {
            // 添加新配置
            launchConfig.configurations.push(cleanConfig);
        }

        // 创建目录
        const vscodePath = path.dirname(launchJsonPath);
        if (!fs.existsSync(vscodePath)) {
            fs.mkdirSync(vscodePath, { recursive: true });
        }

        // 写入文件
        fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
        
        vscode.window.showInformationMessage(
            `Configuration "${cleanConfig.name}" ${isEdit ? 'updated' : 'created'} successfully`
        );

        // 关闭编辑器
        if (ConfigurationEditorProvider.currentPanel) {
            ConfigurationEditorProvider.currentPanel.dispose();
        }

        // 注意：不再自动打开 launch.json 文件，直接关闭编辑器
    }

    private static async previewConfiguration(config: GoDebugConfiguration): Promise<void> {
        const configJson = JSON.stringify(config, null, 2);
        const doc = await vscode.workspace.openTextDocument({
            content: configJson,
            language: 'json'
        });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }

    private static async testConfiguration(config: GoDebugConfiguration): Promise<void> {
        const success = await vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders?.[0],
            config
        );

        if (success) {
            vscode.window.showInformationMessage(`Testing configuration: ${config.name}`);
        } else {
            vscode.window.showErrorMessage(`Failed to test configuration: ${config.name}`);
        }
    }

    private static getWebviewContent(config?: GoDebugConfiguration, isEdit: boolean = false): string {
        const isLaunch = config?.request === 'launch' || !config || isEdit;
        const isAttach = config?.request === 'attach';
        const isTest = config?.mode === 'test';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${isEdit ? 'Edit' : 'New'} Debug Configuration</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
            line-height: 1;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .header {
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: bold;
        }
        
        .header p {
            margin: 5px 0 0 0;
            color: var(--vscode-descriptionForeground);
        }
        
        .form-section {
            margin-bottom: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .section-header {
            background: var(--vscode-editorGroupHeader-tabsBackground);
            padding: 10px 13px; /* Reduced from 12px 16px (80%) */
            font-weight: bold;
            font-size: 10px; /* Added reduced font size */
            border-bottom: 1px solid var(--vscode-panel-border);
            line-height: 1;
        }
        
        .section-content {
            padding: 13px; /* Reduced from 16px (80%) */
        }
        
        .form-row {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
            align-items: flex-start;
        }
        
        .form-group {
            flex: 1;
            position: relative;
        }
        
        .form-group.half {
            flex: 0.5;
        }
        
        .form-group.full {
            flex: 1 1 100%;
        }
        
        /* Unified form layout for consistent label alignment */
        .form-field {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px; /* Reduced from 16px to 12px (75%) */
        }
        
        .form-field label {
            min-width: 160px;
            max-width: 160px;
            margin-bottom: 0;
            white-space: nowrap;
            text-align: left;
            font-weight: 600;
            font-size: 10px; /* Reduced from 13px to 10px (77%) */
            flex-shrink: 0;
            line-height: 1; /* Adjusted for better spacing */
        }
        
        .form-field .input-container {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
        
        .form-field input,
        .form-field select,
        .form-field textarea {
            width: 100%;
            margin: 0;
            height: auto; /* Let padding control height */
        }
        
        .form-field .help-text {
            margin-top: 3px; /* Reduced from 4px */
            font-size: 9px; /* Reduced from 11px to 9px (82%) */
            color: var(--vscode-descriptionForeground);
            line-height: 1; /* Tighter line height */
        }
        
        /* Modern label styling */
        label {
            display: block;
            margin-bottom: 6px; /* Reduced from 8px */
            font-weight: 600;
            font-size: 10px; /* Reduced from 13px to 10px (77%) */
            color: var(--vscode-foreground);
            letter-spacing: 0.02em;
            position: relative;
            line-height: 1;
        }
        
        label::after {
            content: "*";
            color: var(--vscode-errorForeground);
            margin-left: 4px;
            font-weight: bold;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        
        label.required::after {
            opacity: 1;
        }
        
        /* Enhanced input styling */
        input, select, textarea {
            width: 100%;
            padding: 8px 11px; /* Reduced from 10px 14px (80%) */
            border: 1px solid var(--vscode-input-border);
            border-radius: 5px; /* Reduced from 6px */
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-editor-font-family);
            font-size: 9px; /* Reduced from 11px to 9px (82%) */
            box-sizing: border-box;
            transition: all 0.2s ease;
            position: relative;
            line-height: 1; 
        }
        
        /* Textarea specific styles */
        textarea {
            resize: vertical;
            min-height: 48px; /* Reduced from 60px (80%) */
            font-family: var(--vscode-editor-font-family);
            line-height: 1;  
        }
        
        input:hover, select:hover, textarea:hover {
            border-color: var(--vscode-inputOption-activeBorder);
        }
        
        input:focus, select:focus, textarea:focus {
            border-color: var(--vscode-focusBorder);
            outline: none;
            box-shadow: 0 0 0 1px var(--vscode-focusBorder);
            transform: translateY(-1px);
        }
        
        input:disabled, select:disabled, textarea:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            background: var(--vscode-input-background);
        }
        
        /* Input validation states */
        input.error, select.error {
            border-color: var(--vscode-errorForeground);
            box-shadow: 0 0 0 1px var(--vscode-errorForeground);
        }
        
        input.success, select.success {
            border-color: var(--vscode-terminal-ansiGreen);
            box-shadow: 0 0 0 1px var(--vscode-terminal-ansiGreen);
        }
        
        /* Floating label effect for inputs */
        .form-group.floating {
            position: relative;
            margin-top: 8px;
        }
        
        .form-group.floating label {
            position: absolute;
            left: 14px;
            top: 11px;
            background: var(--vscode-input-background);
            padding: 0 4px;
            font-size: 14px;
            color: var(--vscode-input-placeholderForeground);
            transition: all 0.2s ease;
            pointer-events: none;
            margin: 0;
        }
        
        .form-group.floating input:focus + label,
        .form-group.floating input:not(:placeholder-shown) + label,
        .form-group.floating select:focus + label,
        .form-group.floating select:not([value=""]) + label {
            top: -8px;
            font-size: 12px;
            color: var(--vscode-focusBorder);
            font-weight: 600;
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .checkbox-group input[type="checkbox"] {
            width: auto;
        }
        
        .array-input {
            margin-bottom: 8px;
        }
        
        .array-item {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        
        .array-item input {
            flex: 1;
        }
        
        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 13px; /* Reduced from 8px 16px (80%) */
            border-radius: 3px; /* Reduced from 4px */
            cursor: pointer;
            font-size: 10px; /* Reduced from 13px to 10px (77%) */
            margin-right: 6px; /* Reduced from 8px */
            line-height: 1;
        }
        
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-small {
            padding: 4px 8px;
            font-size: 11px;
        }
        
        .btn-danger {
            background: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
        }
        
        .actions {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 10px;
        }
        
        .help-text {
            font-size: 9px; /* Reduced from 12px to 9px (75%) */
            color: var(--vscode-descriptionForeground);
            margin-top: 5px; /* Reduced from 6px */
            line-height: 1;
            padding-left: 2px;
        }
        
        .help-text.error {
            color: var(--vscode-errorForeground);
        }
        
        .help-text.success {
            color: var(--vscode-terminal-ansiGreen);
        }
        
        /* Input group styling */
        .input-group {
            display: flex;
            align-items: stretch;
        }
        
        .input-group input {
            border-radius: 5px 0 0 5px; /* Reduced from 6px */
            border-right: 0;
        }
        
        .input-group .input-group-append {
            background: var(--vscode-button-secondaryBackground);
            border: 1px solid var(--vscode-input-border);
            border-left: 0;
            border-radius: 0 5px 5px 0; /* Reduced from 6px */
            padding: 0 10px; /* Reduced from 12px */
            display: flex;
            align-items: center;
            font-size: 10px; /* Reduced from 12px */
            color: var(--vscode-button-secondaryForeground);
        }
        
        .type-selector {
            margin-bottom: 20px;
        }
        
        .type-option {
            display: inline-block;
            padding: 8px 16px;
            margin-right: 8px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            cursor: pointer;
            background: var(--vscode-editor-background);
        }
        
        .type-option.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .conditional-section {
            display: none;
        }
        
        .conditional-section.show {
            display: block;
        }
        
        .run-mode-fields {
            display: none;
        }
        
        .run-mode-fields.show {
            display: block;
        }
        
        .mode-indicator {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            margin-left: 8px;
        }
        
        .mode-file { background: var(--vscode-charts-blue); color: white; }
        .mode-package { background: var(--vscode-charts-green); color: white; }
        .mode-directory { background: var(--vscode-charts-orange); color: white; }
        .mode-module { background: var(--vscode-charts-purple); color: white; }
        .mode-workspace { background: var(--vscode-charts-red); color: white; }
        
        /* Collapsible sections */
        .collapsible-section .section-header {
            cursor: pointer;
            user-select: none;
            position: relative;
            transition: background-color 0.2s ease;
        }
        
        .collapsible-section .section-header:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .collapsible-section .section-header::after {
            content: "▼";
            position: absolute;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            transition: transform 0.2s ease;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .collapsible-section.collapsed .section-header::after {
            transform: translateY(-50%) rotate(-90deg);
        }
        
        .collapsible-section.collapsed .section-content {
            display: none;
        }
        
        .section-header .collapse-indicator {
            float: right;
            margin-top: 2px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header" style="display:none">
            <h1>${isEdit ? 'Edit Debug Configuration' : 'Create New Debug Configuration'}</h1>
            <p>Configure your Go debugging settings with an easy-to-use interface</p>
        </div>

        <form id="configForm">
            <!-- Configuration Type Selector -->
            ${!isEdit ? `
            <div class="form-section" style="display:none">
                <div class="section-header">Configuration Type</div>
                <div class="section-content">
                    <div class="type-selector">
                        <div class="type-option ${isLaunch ? 'active' : ''}" data-type="launch">
                            🚀 Launch Program
                        </div>
                        <div class="type-option ${isAttach ? 'active' : ''}" data-type="attach">
                            🔗 Attach to Process
                        </div>
                        <div class="type-option ${isTest ? 'active' : ''}" data-type="test">
                            🧪 Debug Tests
                        </div>
                    </div>
                </div>
            </div>
            ` : ''}

            <!-- Basic Configuration -->
            <div class="form-section">
                <div class="section-content">
                    <div class="form-field">
                        <label for="name" class="required">Configuration Name</label>
                        <div class="input-container">
                            <input type="text" id="name" name="name" value="${config?.name || ''}" placeholder="Enter a unique name" required>
                            <div class="help-text">A unique name to identify this debug configuration</div>
                        </div>
                    </div>
                    
          
                </div>
            </div>

            <!-- Launch Configuration -->
            <div class="form-section conditional-section launch-section ${isLaunch ? 'show' : ''}">
                <div class="section-header">Launch Settings</div>
                <div class="section-content">
                    <div class="form-field">
                        <label for="runMode">🎯 Run Mode</label>
                        <div class="input-container">
                            <select id="runMode" name="runMode" onchange="updateRunModeFields()">
                                <option value="file" ${config?.runMode === 'file' ? 'selected' : ''}>📄 Single Go File</option>
                                <option value="package" ${config?.runMode === 'package' ? 'selected' : ''}>📦 Go Package</option>
                                <option value="directory" ${config?.runMode === 'directory' ? 'selected' : ''}>📁 Directory</option>
                                <option value="module" ${config?.runMode === 'module' ? 'selected' : ''}>🏗️ Go Module</option>
                                <option value="workspace" ${config?.runMode === 'workspace' ? 'selected' : ''}>🏢 Workspace</option>
                            </select>
                            <div class="help-text">Choose how to execute your Go program</div>
                        </div>
                    </div>
                    
                    <!-- File Mode -->
                    <div class="run-mode-fields file-mode ${config?.runMode === 'file' || !config?.runMode ? 'show' : ''}">
                        <div class="form-field">
                            <label for="program" class="required">📄 File</label>
                            <div class="input-container">
                                <input type="text" id="program" name="program" value="${config?.program || '${workspaceFolder}/main.go'}" placeholder="${'${workspaceFolder}/main.go'}">
                                <div class="help-text">Path to the Go file to debug (e.g. main.go)</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Package Mode -->
                    <div class="run-mode-fields package-mode ${config?.runMode === 'package' ? 'show' : ''}">
                        <div class="form-field">
                            <label for="packagePath" class="required">📦 Package</label>
                            <div class="input-container">
                                <input type="text" id="packagePath" name="packagePath" value="${config?.packagePath || config?.program || './cmd/myapp'}" placeholder="./cmd/myapp or github.com/user/repo/cmd/myapp">
                                <div class="help-text">Go package path (relative like ./cmd/myapp or absolute)</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Directory Mode -->
                    <div class="run-mode-fields directory-mode ${config?.runMode === 'directory' ? 'show' : ''}">
                        <div class="form-field">
                            <label for="directoryPath" class="required">📁 Directory</label>
                            <div class="input-container">
                                <input type="text" id="directoryPath" name="directoryPath" value="${config?.runMode === 'directory' ? config?.program : '\${workspaceFolder}/cmd'}" placeholder="\${workspaceFolder}/cmd/myapp">
                                <div class="help-text">Path to the directory containing Go files to debug</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Module Mode -->
                    <div class="run-mode-fields module-mode ${config?.runMode === 'module' ? 'show' : ''}">
                        <div class="form-field">
                            <label for="modulePath" class="required">🏗️ Module</label>
                            <div class="input-container">
                                <input type="text" id="modulePath" name="modulePath" value="${config?.runMode === 'module' ? config?.program : '\${workspaceFolder}'}" placeholder="\${workspaceFolder}">
                                <div class="help-text">Path to Go module root (directory containing go.mod)</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Workspace Mode -->
                    <div class="run-mode-fields workspace-mode ${config?.runMode === 'workspace' ? 'show' : ''}">
                        <div class="form-field">
                            <label>🏢 Workspace Path</label>
                            <div class="input-container">
                                <div class="input-group">
                                    <input type="text" value="\${workspaceFolder}" readonly>
                                    <div class="input-group-append">🔒</div>
                                </div>
                                <div class="help-text">Debug the entire workspace (automatically detected)</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-field">
                        <label for="cwd">📂 Working Directory</label>
                        <div class="input-container">
                            <input type="text" id="cwd" name="cwd" value="${config?.cwd || '${workspaceFolder}'}" placeholder="${'${workspaceFolder}'}">
                            <div class="help-text">Path to the working directory for program execution</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Attach Configuration -->
            <div class="form-section conditional-section attach-section ${isAttach ? 'show' : ''}">
                <div class="section-header">Attach Settings</div>
                <div class="section-content">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="attachMode">🔗 Attach Mode</label>
                            <select id="attachMode" name="attachMode">
                                <option value="local" ${config?.mode === 'local' ? 'selected' : ''}>🖥️ Local Process</option>
                                <option value="remote" ${config?.mode === 'remote' ? 'selected' : ''}>🌐 Remote Process</option>
                            </select>
                            <div class="help-text">Choose connection type for debugging</div>
                        </div>
                    </div>    
                    <div class="form-row">
                        <div class="form-group">
                            <label for="processId">🔍 Process ID</label>
                            <input type="text" id="processId" name="processId" value="${config?.processId || '${command:pickProcess}'}" placeholder="Enter PID or use picker">
                            <div class="help-text">Process ID to attach to (use picker for convenience)</div>
                        </div>
                    </div>
                    <div class="form-row remote-only" style="display: ${config?.mode === 'remote' ? 'flex' : 'none'}">
                        <div class="form-group">
                            <label for="host">🌐 Remote Host</label>
                            <input type="text" id="host" name="host" value="${config?.host || 'localhost'}" placeholder="localhost or IP address">
                            <div class="help-text">Hostname or IP address of remote server</div>
                        </div>
                    </div>    
                    <div class="form-row">
                        <div class="form-group">
                            <label for="port">🔌 Remote Port</label>
                            <input type="number" id="port" name="port" value="${config?.port || 2345}" min="1" max="65535" placeholder="2345">
                            <div class="help-text">Port number for debug connection</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Arguments -->
            <div class="form-section">
                <div class="section-header">📋 Arguments & Environment</div>
                <div class="section-content">
                    <div class="form-field">
                        <label for="programArgs">⚡ Program Arguments</label>
                        <div class="input-container">
                            <input type="text" id="programArgs" name="programArgs" value="${(config?.args || []).join(' ')}" placeholder="Enter arguments separated by spaces (e.g. --verbose -p 8080 file.txt)">
                            <div class="help-text">Arguments to pass to the program on launch (separated by spaces)</div>
                        </div>
                    </div>

                    <div class="form-field">
                        <label for="goArgs">🔧 Go Arguments</label>
                        <div class="input-container">
                            <input type="text" id="goArgs" name="goArgs" value="${(config?.goArgs || []).join(' ')}" placeholder="Enter Go compiler/tool arguments (e.g. -race -v -ldflags='-X main.version=1.0')">
                            <div class="help-text">Arguments to pass to Go compiler or tools (separated by spaces)</div>
                        </div>
                    </div>

                    <div class="form-field">
                        <label for="envVars">🌍 Environment Variables</label>
                        <div class="input-container">
                            <input type="text" id="envVars" name="envVars" value="${Object.entries(config?.env || {}).map(([key, value]) => `${key}=${value}`).join('; ')}" placeholder="PORT=3000; DEBUG=true; DATABASE_URL=postgres://user:pass@localhost:5432/db">
                            <div id="envVarsError" class="help-text error" style="display: none; color: var(--vscode-errorForeground);"></div>
                            <div class="help-text">Environment variables (format: KEY=value; separated by semicolons)</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Advanced Options -->
            <div class="form-section collapsible-section collapsed">
                <div class="section-header" onclick="toggleSection(this)">⚙️ Advanced Options</div>
                <div class="section-content">
                    <div class="form-row">
                        <div class="form-group">
                            <div class="checkbox-group">
                                <input type="checkbox" id="stopOnEntry" name="stopOnEntry" ${config?.stopOnEntry ? 'checked' : ''}>
                                <label for="stopOnEntry">🛑 Stop on Entry</label>
                            </div>
                            <div class="help-text">Automatically pause execution at the first line</div>
                        </div>
                        <div class="form-group">
                            <div class="checkbox-group">
                                <input type="checkbox" id="showLog" name="showLog" ${config?.showLog ? 'checked' : ''}>
                                <label for="showLog">📝 Show Debug Log</label>
                            </div>
                            <div class="help-text">Display detailed debug adapter communication</div>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="logOutput">📊 Log Output Target</label>
                            <select id="logOutput" name="logOutput">
                                <option value="console" ${config?.logOutput === 'console' ? 'selected' : ''}>🖥️ Console</option>
                                <option value="rpc" ${config?.logOutput === 'rpc' ? 'selected' : ''}>🔗 RPC</option>
                                <option value="dap" ${config?.logOutput === 'dap' ? 'selected' : ''}>🔌 DAP</option>
                            </select>
                            <div class="help-text">Where to display debug logs</div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="actions">
                <button type="button" class="btn" onclick="saveConfiguration()">
                    ${isEdit ? '💾 Update Configuration' : '✨ Create Configuration'}
                </button>
                <button type="button" class="btn btn-secondary" onclick="previewConfiguration()">
                    👁️ Preview JSON
                </button>
                <button type="button" class="btn btn-secondary" onclick="testConfiguration()">
                    🧪 Test Configuration
                </button>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentConfigType = '${config?.request || 'launch'}';

        // Type selector handling
        document.querySelectorAll('.type-option').forEach(option => {
            option.addEventListener('click', function() {
                document.querySelectorAll('.type-option').forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                currentConfigType = this.dataset.type;
                updateFormVisibility();
            });
        });

        // Attach mode handling
        document.getElementById('attachMode')?.addEventListener('change', function() {
            const remoteOnly = document.querySelector('.remote-only');
            if (remoteOnly) {
                remoteOnly.style.display = this.value === 'remote' ? 'flex' : 'none';
            }
        });

        function updateFormVisibility() {
            document.querySelectorAll('.conditional-section').forEach(section => {
                section.classList.remove('show');
            });
            
            const targetSection = document.querySelector('.' + currentConfigType + '-section');
            if (targetSection) {
                targetSection.classList.add('show');
            }
            
            updateRunModeFields();
        }

        function updateRunModeFields() {
            // Hide all run mode fields
            document.querySelectorAll('.run-mode-fields').forEach(field => {
                field.classList.remove('show');
            });
            
            // Show the selected run mode fields
            const runModeSelect = document.getElementById('runMode');
            if (runModeSelect) {
                const selectedMode = runModeSelect.value;
                const targetField = document.querySelector('.' + selectedMode + '-mode');
                if (targetField) {
                    targetField.classList.add('show');
                }
            }
        }
        
        // Toggle collapsible sections
        function toggleSection(header) {
            const section = header.closest('.collapsible-section');
            if (section) {
                section.classList.toggle('collapsed');
            }
        }

        // Real-time input validation
        function validateInput(input) {
            const value = input.value.trim();
            input.classList.remove('error', 'success');
            
            if (input.hasAttribute('required') && !value) {
                input.classList.add('error');
                showFieldError(input, 'This field is required');
            } else if (value && input.type === 'text') {
                input.classList.add('success');
                hideFieldError(input);
            }
        }

        // Environment variables validation
        function validateEnvVars() {
            const envVarsInput = document.getElementById('envVars');
            const errorDiv = document.getElementById('envVarsError');
            const value = envVarsInput.value.trim();
            
            if (!value) {
                envVarsInput.classList.remove('error', 'success');
                errorDiv.style.display = 'none';
                return true;
            }
            
            const errors = [];
            // Split by semicolons and filter out empty entries
            const envPairs = value.split(';').map(pair => pair.trim()).filter(pair => pair);
            const validKeys = new Set();
            
            envPairs.forEach((pair, index) => {
                if (!pair.includes('=')) {
                    errors.push(\`Entry \${index + 1}: Missing '=' in "\${pair}"\`);
                    return;
                }
                
                const [key, ...valueParts] = pair.split('=');
                const trimmedKey = key.trim();
                
                if (!trimmedKey) {
                    errors.push(\`Entry \${index + 1}: Empty variable name in "\${pair}"\`);
                    return;
                }
                
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmedKey)) {
                    errors.push(\`Entry \${index + 1}: Invalid variable name "\${trimmedKey}" (must start with letter/underscore, contain only letters/numbers/underscores)\`);
                    return;
                }
                
                if (validKeys.has(trimmedKey)) {
                    errors.push(\`Entry \${index + 1}: Duplicate variable "\${trimmedKey}"\`);
                    return;
                }
                
                validKeys.add(trimmedKey);
            });
            
            if (errors.length > 0) {
                envVarsInput.classList.add('error');
                envVarsInput.classList.remove('success');
                errorDiv.textContent = errors.slice(0, 2).join('; ') + (errors.length > 2 ? \` (and \${errors.length - 2} more errors)\` : '');
                errorDiv.style.display = 'block';
                return false;
            } else {
                envVarsInput.classList.add('success');
                envVarsInput.classList.remove('error');
                errorDiv.style.display = 'none';
                return true;
            }
        }

        function showFieldError(input, message) {
            let helpText = input.parentElement.querySelector('.help-text');
            if (helpText) {
                helpText.textContent = message;
                helpText.classList.add('error');
            }
        }

        function hideFieldError(input) {
            let helpText = input.parentElement.querySelector('.help-text');
            if (helpText && helpText.classList.contains('error')) {
                helpText.classList.remove('error');
                // Restore original help text based on field
                const fieldId = input.id;
                const originalTexts = {
                    'name': 'A unique name to identify this debug configuration',
                    'program': 'Path to the specific Go file you want to debug',
                    'packagePath': 'Go package path (relative like ./cmd/myapp or absolute)',
                    'directoryPath': 'Directory containing Go files to debug',
                    'modulePath': 'Path to Go module root (directory containing go.mod)'
                };
                if (originalTexts[fieldId]) {
                    helpText.textContent = originalTexts[fieldId];
                }
            }
        }

        // Add input validation to existing inputs
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('input[required]').forEach(input => {
                input.addEventListener('blur', () => validateInput(input));
                input.addEventListener('input', () => validateInput(input));
            });
            
            // Add environment variables validation
            const envVarsInput = document.getElementById('envVars');
            if (envVarsInput) {
                envVarsInput.addEventListener('input', validateEnvVars);
                envVarsInput.addEventListener('blur', validateEnvVars);
            }
        });

        function collectFormData() {
            const formData = new FormData(document.getElementById('configForm'));
            
            const config = {
                name: formData.get('name'),
                type: 'go',
                request: currentConfigType === 'test' ? 'launch' : currentConfigType
            };

            // Collect basic settings
            if (currentConfigType === 'launch' || currentConfigType === 'test') {
                const runMode = formData.get('runMode') || 'file';
                
                // Set program based on run mode - use standard VSCode Go extension format
                switch (runMode) {
                    case 'file':
                        config.mode = currentConfigType === 'test' ? 'test' : 'debug';
                        config.program = formData.get('program') || '\${workspaceFolder}/main.go';
                        break;
                    case 'package':
                        config.mode = currentConfigType === 'test' ? 'test' : 'debug';
                        config.program = formData.get('packagePath') || './cmd/myapp';
                        break;
                    case 'directory':
                        config.mode = currentConfigType === 'test' ? 'test' : 'debug';
                        config.program = formData.get('directoryPath') || '\${workspaceFolder}/cmd';
                        break;
                    case 'module':
                        config.mode = currentConfigType === 'test' ? 'test' : 'debug';
                        config.program = formData.get('modulePath') || '\${workspaceFolder}';
                        break;
                    case 'workspace':
                        config.mode = currentConfigType === 'test' ? 'test' : 'debug';
                        config.program = '\${workspaceFolder}';
                        break;
                    default:
                        config.mode = currentConfigType === 'test' ? 'test' : 'debug';
                        config.program = formData.get('program') || '\${workspaceFolder}/main.go';
                }
                
                // Add standard VSCode Go debug configuration properties
                config.cwd = formData.get('cwd') || '\${workspaceFolder}';
                
                // Override mode if explicitly set in form
                const explicitMode = formData.get('mode');
                if (explicitMode && explicitMode !== 'debug') {
                    config.mode = explicitMode;
                }
                
            } else if (currentConfigType === 'attach') {
                config.mode = 'remote';
                config.remotePath = '';
                config.port = parseInt(formData.get('port')) || 2345;
                config.host = formData.get('host') || '127.0.0.1';
                
                const attachMode = formData.get('attachMode');
                if (attachMode === 'local') {
                    config.mode = 'local';
                    config.processId = parseInt(formData.get('processId')) || 0;
                    delete config.port;
                    delete config.host;
                }
            }

            // Collect arguments from single text input
            const programArgsInput = document.getElementById('programArgs');
            if (programArgsInput && programArgsInput.value.trim()) {
                const argsString = programArgsInput.value.trim();
                config.args = argsString.split(/\s+/).filter(arg => arg.length > 0);
            }

            // Collect Go build flags (buildFlags is the standard VSCode Go extension property)
            const goArgsInput = document.getElementById('goArgs');
            if (goArgsInput && goArgsInput.value.trim()) {
                const goArgsString = goArgsInput.value.trim();
                config.buildFlags = goArgsString;
            }

            // Collect environment variables
            const envVarsInput = document.getElementById('envVars');
            if (envVarsInput && envVarsInput.value.trim()) {
                const envString = envVarsInput.value.trim();
                const envPairs = envString.split(';').map(pair => pair.trim()).filter(pair => pair && pair.includes('='));
                config.env = {};
                envPairs.forEach(pair => {
                    const [key, ...valueParts] = pair.split('=');
                    const trimmedKey = key.trim();
                    if (trimmedKey) {
                        config.env[trimmedKey] = valueParts.join('=') || '';
                    }
                });
            }

            // Collect advanced options with VSCode Go extension compatible names
            if (document.getElementById('stopOnEntry').checked) {
                config.stopOnEntry = true;
            }
            
            if (document.getElementById('showLog').checked) {
                config.showLog = true;
                config.trace = formData.get('logOutput') || 'console';
            }

            // Remove undefined properties to keep config clean
            Object.keys(config).forEach(key => {
                if (config[key] === undefined || config[key] === '' || 
                    (Array.isArray(config[key]) && config[key].length === 0)) {
                    delete config[key];
                }
            });

            return config;
        }

        function saveConfiguration() {
            // Validate environment variables before saving
            if (!validateEnvVars()) {
                alert('Please fix the environment variables format errors before saving.');
                return;
            }
            
            const config = collectFormData();
            if (!config.name || !config.name.trim()) {
                alert('Please enter a configuration name');
                return;
            }
            vscode.postMessage({ type: 'saveConfiguration', config });
        }

        function previewConfiguration() {
            const config = collectFormData();
            vscode.postMessage({ type: 'previewConfiguration', config });
        }

        function testConfiguration() {
            const config = collectFormData();
            if (!config.name || !config.name.trim()) {
                alert('Please enter a configuration name before testing');
                return;
            }
            vscode.postMessage({ type: 'testConfiguration', config });
        }
    </script>
</body>
</html>`;
    }
}
