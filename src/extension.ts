// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as Net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { WatchExpressionProvider } from './watchProvider';
import { ConditionalBreakpointManager } from './breakpointManager';
import { DebugConfigurationProvider } from './debugConfigProvider';
import { RunConfigItem, RunConfigurationManager } from './runConfigManager';
import { RunConfigWebviewProvider } from './runConfigWebview';
import { GoDebugConfigurationProvider as GoDebugConfigProvider } from './goDebugConfigurationProvider';
import { ConfigurationEditorProvider } from './configurationEditorProvider';
import { QuickConfigurationProvider } from './quickConfigurationProvider';
import { GoDebugOutputProvider } from './goDebugOutputProvider';
import { GlobalStateManager } from './globalStateManager';
import { DelveClient } from './delveClient';

interface RunningConfig {
	mode: 'run' | 'debug';
	process: cp.ChildProcess;
	startTime: number;
	workingDir: string;
	binaryPath?: string; // For run mode
	debugSession?: vscode.DebugSession; // For debug mode
	debugServer?: {
		host: string;
		port: number;
		address: string;
	}; // For dlv DAP server info
}

// Global variables
let globalDebugConfigProvider: DebugConfigurationProvider | undefined;
let globalGoDebugOutputProvider: GoDebugOutputProvider | undefined;
let globalRunningDebugServers: Map<string, { host: string; port: number; address: string }> = new Map();

// Debug logging utility
class DebugLogger {
	private static formatTimestamp(): string {
		const now = new Date();
		return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}]`;
	}

	static log(message: string, outputChannel?: vscode.OutputChannel): void {
		const timestampedMessage = `${this.formatTimestamp()} ${message}`;
		console.log(`[Go Debug Pro] ${timestampedMessage}`);
		if (outputChannel) {
			outputChannel.appendLine(`🕒 ${timestampedMessage}`);
		}
	}

	static error(message: string, outputChannel?: vscode.OutputChannel): void {
		const timestampedMessage = `${this.formatTimestamp()} ERROR: ${message}`;
		console.error(`[Go Debug Pro] ${timestampedMessage}`);
		if (outputChannel) {
			outputChannel.appendLine(`❌ ${timestampedMessage}`);
		}
	}

	static info(message: string, outputChannel?: vscode.OutputChannel): void {
		const timestampedMessage = `${this.formatTimestamp()} INFO: ${message}`;
		console.log(`[Go Debug Pro] ${timestampedMessage}`);
		if (outputChannel) {
			outputChannel.appendLine(`ℹ️  ${timestampedMessage}`);
		}
	}
}

// Global state manager for tracking running configurations
class ConfigurationStateManager {
	private static instance: ConfigurationStateManager;
	private runningConfigs: Map<string, RunningConfig> = new Map();
	private globalStateManager: GlobalStateManager;

	constructor() {
		// 集成全局状态管理器
		this.globalStateManager = GlobalStateManager.getInstance();
	}

	// 清理所有已退出的进程，防止状态假阳性
	private cleanupExitedConfigs() {
		for (const [name, config] of this.runningConfigs.entries()) {
			if (config.startTime  < Date.now() - 1000) { // 仅清理启动超过1秒的配置，防止误杀刚启动的配置
				if (!config.process || config.process.killed || config.process.exitCode !== null) {
					if (config.debugSession) {
						vscode.debug.stopDebugging(config.debugSession);
					}
				}
			}

		}
	}

	// // 通过调试会话查找配置名称,  
	// findConfigByDebugSession(session: vscode.DebugSession): string | undefined {
	// 	for (const [name, config] of this.runningConfigs.entries()) {
	// 		if (config.debugSession?.id === session.id) {
	// 			return name;
	// 		}
	// 	}
	// 	return undefined;
	// }

	// 获取所有调试会话
	getAllDebugSessions(): vscode.DebugSession[] {
		const sessions: vscode.DebugSession[] = [];
		for (const config of this.runningConfigs.values()) {
			if (config.debugSession) {
				sessions.push(config.debugSession);
			}
		}
		return sessions;
	}

	// 清理调试服务器信息
	cleanupDebugServer(configName: string): void {
		if (globalRunningDebugServers.has(configName)) {
			globalRunningDebugServers.delete(configName);
			DebugLogger.log(`Cleaned up debug server info for config: ${configName}`);
		}
	}

	static getInstance(): ConfigurationStateManager {
		if (!ConfigurationStateManager.instance) {
			ConfigurationStateManager.instance = new ConfigurationStateManager();
		}
		return ConfigurationStateManager.instance;
	}

	setConfigStarting(configName: string, mode: 'debug' | 'run'): void {
		this.cleanupExitedConfigs();
		const config = this.runningConfigs.get(configName);
		if (config) {
			if (config.process?.killed === false) {
				config.process.kill();
			}
		}
		// 同步到全局状态管理器
		this.globalStateManager.setState(
			configName,
			mode as 'debug' | 'run',
			'starting',
		);
	}

	isConfigRunning(configName: string): boolean {
		this.cleanupExitedConfigs();
		const config = this.runningConfigs.get(configName);
		if (!config) {
			return false;
		}

		// Check if process is still alive
		if (config.process.killed || config.process.exitCode !== null) {
			//this.runningConfigs.delete(configName);
			return false;
		}

		return true;
	}

	getConfigState(configName: string): RunningConfig | undefined {
		if (this.runningConfigs.has(configName)) {
			return this.runningConfigs.get(configName);
		}
		return undefined;
	}

	setConfigRunning(configName: string, config: RunningConfig): void {
		this.cleanupExitedConfigs();
		DebugLogger.log(`Setting configuration '${configName}' as running in ${config.mode} mode`);

	 

		this.runningConfigs.set(configName, config);

		// 同步到全局状态管理器
		this.globalStateManager.setState(
			configName,
			config.mode as 'debug' | 'run',
			'running',
			config.process
		);

		if (config.process) {


			// Monitor process exit
			config.process.on('exit', (code, signal) => {
				DebugLogger.log(`Process for ${configName} exited with code ${code}, signal ${signal}`);
				this.setConfigStopped(configName);
			});

			config.process.on('error', (error) => {
				DebugLogger.error(`Process error for ${configName}: ${error}`);
				this.setConfigStopped(configName);
			});
		}
		if (globalDebugConfigProvider) {
			globalDebugConfigProvider.refresh();
		}

		// 通知 GO DEBUG 输出面板
		if (globalGoDebugOutputProvider) {
			globalGoDebugOutputProvider.addOutput(`🚀 Configuration started: ${configName} (${config.mode})`, configName);
		}
	}
	
	private resetConfigState(configName: string): void {
		const config = this.runningConfigs.get(configName);
		if (!config) {
			return ;
		}
		if (config.mode === 'debug' && config.debugSession) {
			DebugLogger.log(`Stopping debug session for '${configName}'`);
			// Stop debug session
			vscode.debug.stopDebugging(config.debugSession);
		}
		try {
			// Kill the process
			if (config.process && !config.process.killed) {
				DebugLogger.log(`Sending SIGTERM to process ${config.process.pid} for '${configName}'`);
				config.process.kill('SIGTERM');

				// If it doesn't respond to SIGTERM in 2 seconds, use SIGKILL
				setTimeout(() => {
					if (!config.process.killed && config.process.exitCode === null) {
						DebugLogger.log(`Sending SIGKILL to process ${config.process.pid} for '${configName}'`);
						config.process.kill('SIGKILL');
					}
				}, 2000);
			}
		} catch (error) {
			DebugLogger.error(`Failed to close Delve clients for ${configName}: ${error}`);
		}
	}


	setConfigStopped(configName: string): void {
		DebugLogger.log(`Setting configuration '${configName}' as stopped`);
		const config = this.runningConfigs.get(configName);
		if (config) {
			// Clean up binary file if it exists
			if (config.binaryPath && fs.existsSync(config.binaryPath)) {
				try {
					fs.unlinkSync(config.binaryPath);
					DebugLogger.log(`Cleaned up binary: ${config.binaryPath}`);
				} catch (error) {
					DebugLogger.error(`Failed to clean up binary ${config.binaryPath}: ${error}`);
				}
			}
			this.resetConfigState(configName);



			//this.runningConfigs.delete(configName);

			// Clean up debug server info if exists
			this.cleanupDebugServer(configName);

			// 同步到全局状态管理器
			this.globalStateManager.setState(configName, config.mode as 'debug' | 'run', 'stopped');

			// Refresh the debug config tree
			if (globalDebugConfigProvider) {
				globalDebugConfigProvider.refresh();
			}

			// 通知 GO DEBUG 输出面板
			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(`⏹️ Configuration stopped: ${configName}`, configName);
			}
		}
	}

	getAllRunningConfigs(): string[] {
		this.cleanupExitedConfigs();
		return Array.from(this.runningConfigs.keys());
	}

	stopConfig(configName: string): boolean {
		DebugLogger.log(`Attempting to stop configuration '${configName}'`);
		const config = this.runningConfigs.get(configName);
		if (!config) {
			DebugLogger.log(`Configuration '${configName}' not found in running configs`);
			return false;
		}

		try {

			this.setConfigStopped(configName);
			return true;
		} catch (error) {
			DebugLogger.error(`Error stopping config ${configName}: ${error}`);
			return false;
		}
	}
}

// Helper function to save configuration to launch.json
async function saveConfigurationToLaunchJson(config: vscode.DebugConfiguration, workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
	const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');

	let launchConfig: any = {
		version: '0.2.0',
		configurations: []
	};

	// Read existing configurations
	if (fs.existsSync(launchJsonPath)) {
		try {
			const content = fs.readFileSync(launchJsonPath, 'utf8');
			const cleanContent = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
			launchConfig = JSON.parse(cleanContent);
		} catch (error) {
			console.error('Error reading launch.json:', error);
		}
	}

	// Create a clean configuration object without circular references
	const cleanConfig = {
		name: config.name,
		type: config.type,
		request: config.request,
		...(config.program && { program: config.program }),
		...(config.args && { args: config.args }),
		...(config.env && { env: config.env }),
		...(config.cwd && { cwd: config.cwd }),
		...(config.mode && { mode: config.mode }),
		...(config.buildFlags && { buildFlags: config.buildFlags }),
		...(config.dlvFlags && { dlvFlags: config.dlvFlags }),
		...(config.host && { host: config.host }),
		...(config.port && { port: config.port }),
		...(config.remotePath && { remotePath: config.remotePath }),
		...(config.trace && { trace: config.trace }),
		...(config.showLog && { showLog: config.showLog }),
		...(config.logOutput && { logOutput: config.logOutput }),
		...(config.console && { console: config.console }),
		...(config.stopOnEntry && { stopOnEntry: config.stopOnEntry }),
		...(config.preLaunchTask && { preLaunchTask: config.preLaunchTask }),
		...(config.postDebugTask && { postDebugTask: config.postDebugTask })
	};

	// Check if configuration with same name already exists
	const existingIndex = launchConfig.configurations.findIndex((c: any) => c.name === config.name);
	if (existingIndex !== -1) {
		// Update existing configuration
		launchConfig.configurations[existingIndex] = cleanConfig;
	} else {
		// Add new configuration
		launchConfig.configurations.push(cleanConfig);
	}

	// Create directory if it doesn't exist
	const vscodePath = path.dirname(launchJsonPath);
	if (!fs.existsSync(vscodePath)) {
		fs.mkdirSync(vscodePath, { recursive: true });
	}

	// Write file
	fs.writeFileSync(launchJsonPath, JSON.stringify(launchConfig, null, 2));
}

// Helper function to run debug configurations with run or debug mode
export async function runDebugConfiguration(configItem: any, mode: 'run' | 'debug'): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Go Debug Pro');

	// TODO: 如果已经展示，无需在 show
	//outputChannel.show();



	try {
		outputChannel.appendLine(`\n=== Go Debug Pro Execution Log ===`);
		outputChannel.appendLine(`Time: ${new Date().toLocaleString()}`);
		outputChannel.appendLine(`Mode: ${mode.toUpperCase()}`);

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			const errorMsg = 'No workspace folder found';
			outputChannel.appendLine(`❌ Error: ${errorMsg}`);
			vscode.window.showErrorMessage(errorMsg);
			return;
		}

		outputChannel.appendLine(`📁 Workspace: ${workspaceFolder.uri.fsPath}`);

		// Get the configuration from the item safely
		let config;
		if (configItem.configuration) {
			// This is a DebugConfigItem
			config = configItem.configuration;
		} else if (configItem.config) {
			// This has a config property
			config = configItem.config;
		} else {
			// Fallback - try to use the item directly
			config = configItem;
		}
		config.mode = mode.toLocaleLowerCase();
		const stateManager = ConfigurationStateManager.getInstance();
		stateManager.setConfigRunning(config.name, config);
		// Create a safe copy of the configuration to avoid circular references
		const safeOriginalConfig = {
			name: config.name,
			type: config.type,
			request: config.request,
			mode: config.mode,
			program: config.program,
			cwd: config.cwd,
			stopOnEntry: config.stopOnEntry,
			...(config.args && config.args.length > 0 && { args: config.args }),
			...(config.env && Object.keys(config.env).length > 0 && { env: config.env }),
			...(config.buildFlags && { buildFlags: config.buildFlags }),
			...(config.trace && { trace: config.trace })
		};

		outputChannel.appendLine(`\n📋 Original Configuration:`);
		outputChannel.appendLine(`   Name: ${safeOriginalConfig.name || 'Unknown'}`);
		outputChannel.appendLine(`   Type: ${safeOriginalConfig.type || 'Unknown'}`);
		outputChannel.appendLine(`   Request: ${safeOriginalConfig.request || 'Unknown'}`);
		outputChannel.appendLine(`   Program: ${safeOriginalConfig.program || 'Unknown'}`);
		outputChannel.appendLine(`   Mode: ${safeOriginalConfig.mode || 'Unknown'}`);
		outputChannel.appendLine(`   CWD: ${safeOriginalConfig.cwd || 'Unknown'}`);
		if (safeOriginalConfig.args && safeOriginalConfig.args.length > 0) {
			outputChannel.appendLine(`   Args: ${JSON.stringify(safeOriginalConfig.args)}`);
		}
		if (safeOriginalConfig.env && Object.keys(safeOriginalConfig.env).length > 0) {
			outputChannel.appendLine(`   Environment Variables:`);
			for (const [key, value] of Object.entries(safeOriginalConfig.env)) {
				outputChannel.appendLine(`     ${key}=${value}`);
			}
		}

		// Clone the configuration to avoid modifying the original
		const runConfig = { ...safeOriginalConfig };

		outputChannel.appendLine(`\n🔧 Pre-execution Actions:`);

		// Modify configuration based on mode
		if (mode === 'run') {
			outputChannel.appendLine(`   • Setting stopOnEntry = false (run mode)`);
			runConfig.stopOnEntry = false;
			outputChannel.appendLine(`   • Modified name to: "${runConfig.name}"`);
		} else {
			outputChannel.appendLine(`   • Setting stopOnEntry = true (debug mode)`);
			runConfig.stopOnEntry = true;
			outputChannel.appendLine(`   • Modified name to: "${runConfig.name}"`);
		}

		outputChannel.appendLine(`\n📋 Final Configuration to Execute:`);
		const safeConfig = {
			name: runConfig.name,
			type: runConfig.type,
			request: runConfig.request,
			mode: runConfig.mode,
			program: runConfig.program,
			cwd: runConfig.cwd,
			stopOnEntry: runConfig.stopOnEntry,
			...(runConfig.args && runConfig.args.length > 0 && { args: runConfig.args }),
			...(runConfig.env && Object.keys(runConfig.env).length > 0 && { env: runConfig.env }),
			...(runConfig.buildFlags && { buildFlags: runConfig.buildFlags }),
			...(runConfig.trace && { trace: runConfig.trace })
		};
		outputChannel.appendLine(JSON.stringify(safeConfig, null, 2));

		// Generate equivalent command line
		outputChannel.appendLine(`\n💻 Equivalent Command Line:`);
		const goCommand = generateGoCommand(runConfig, mode);
		outputChannel.appendLine(`   ${goCommand}`);

		outputChannel.appendLine(`\n🚀 Starting ${mode} session...`);

		if (mode === 'run') {
			// For run mode, use outputChannel only
			outputChannel.appendLine(`📦 Running in background (no terminal)...`);
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				outputChannel.appendLine(`❌ No workspace folder found`);
				return;
			}
			try {
				await executeRunWithDedicatedTerminal(
					workspaceFolder,
					runConfig,
					safeOriginalConfig,
					outputChannel
				);
			} catch (error) {
				outputChannel.appendLine(`❌ Execution failed: ${error}`);
				vscode.window.showErrorMessage(`Execution failed: ${error}`);
			}



		} else {
			// For debug mode, implement compile-first then dlv remote debugging workflow
			outputChannel.appendLine(`🐛 Starting compile-first debug workflow...`);

			try {
				await executeCompileAndDlvDebug(
					workspaceFolder,
					runConfig,
					safeOriginalConfig,
					outputChannel
				);
			} catch (error) {
				outputChannel.appendLine(`❌ Debug execution failed: ${error}`);
				vscode.window.showErrorMessage(`Debug execution failed: ${error}`);
			}
		}
	} catch (error) {
		const errorMsg = `Error running configuration: ${error}`;
		outputChannel.appendLine(`❌ ${errorMsg}`);
		vscode.window.showErrorMessage(errorMsg);
	}
}

// Helper function to generate equivalent Go command
function generateGoCommand(config: any, mode: 'run' | 'debug'): string {
	let command = '';

	if (config.mode === 'test') {
		command = 'go test';
		if (config.args && config.args.length > 0) {
			command += ` ${config.args.join(' ')}`;
		}
		if (config.program && config.program !== '${workspaceFolder}') {
			command += ` ${config.program}`;
		}
	} else {
		if (mode === 'debug') {
			command = 'dlv debug';
		} else {
			command = 'go run';
		}

		if (config.program) {
			const program = config.program.replace('${workspaceFolder}', '.');
			command += ` ${program}`;
		}

		if (config.args && config.args.length > 0) {
			if (mode === 'debug') {
				command += ` -- ${config.args.join(' ')}`;
			} else {
				command += ` ${config.args.join(' ')}`;
			}
		}
	}

	// Add environment variables
	if (config.env && Object.keys(config.env).length > 0) {
		const envVars = Object.entries(config.env)
			.map(([key, value]) => `${key}="${value}"`)
			.join(' ');
		command = `${envVars} ${command}`;
	}

	return command;
}

// Helper function to log to both output channel and debug panel
function logToDebugOutput(message: string, outputChannel?: vscode.OutputChannel) {
	if (outputChannel) {
		outputChannel.appendLine(message);
	}
	if (globalGoDebugOutputProvider) {
		globalGoDebugOutputProvider.addOutput(message);
	}
}

// Helper functions for context menu commands
async function debugCurrentGoFile(context: vscode.ExtensionContext, mode: 'debug' | 'run'): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('Go Debug Pro');
	// TODO: 如果已经展示，无需在 show
	//outputChannel.show();

	outputChannel.appendLine(`\n=== Go Debug Pro File Execution ===`);
	outputChannel.appendLine(`Time: ${new Date().toLocaleString()}`);
	outputChannel.appendLine(`Mode: ${mode.toUpperCase()}`);

	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== 'go') {
		const errorMsg = 'Please open a Go file first';
		outputChannel.appendLine(`❌ Error: ${errorMsg}`);
		vscode.window.showErrorMessage(errorMsg);
		return;
	}

	const filePath = editor.document.uri.fsPath;
	const fileName = path.basename(filePath);
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

	outputChannel.appendLine(`📄 Current File: ${filePath}`);
	outputChannel.appendLine(`📁 Workspace: ${workspaceFolder?.uri.fsPath || 'Not found'}`);

	if (!workspaceFolder) {
		const errorMsg = 'No workspace folder found';
		outputChannel.appendLine(`❌ Error: ${errorMsg}`);
		vscode.window.showErrorMessage(errorMsg);
		return;
	}

	// Only allow main.go files
	if (fileName !== 'main.go') {
		const errorMsg = 'Can only debug/run main.go files';
		outputChannel.appendLine(`❌ Error: ${errorMsg}`);
		vscode.window.showErrorMessage(errorMsg);
		return;
	}

	outputChannel.appendLine(`\n🔧 Pre-execution Actions:`);
	outputChannel.appendLine(`   • Validating file type: ${fileName} ✅`);
	outputChannel.appendLine(`   • Creating configuration for ${mode} mode`);

	// Create configuration
	const config = {
		name: `${mode === 'debug' ? 'Debug' : 'Run'} ${fileName}`,
		type: 'go-debug-pro',
		request: 'launch',
		mode: mode === 'debug' ? 'debug' : 'exec',
		program: filePath,
		cwd: workspaceFolder.uri.fsPath,
		stopOnEntry: mode === 'debug'
	};

	outputChannel.appendLine(`\n📋 Generated Configuration:`);
	outputChannel.appendLine(JSON.stringify(config, null, 2));

	// Generate equivalent command line
	outputChannel.appendLine(`\n💻 Equivalent Command Line:`);
	const goCommand = generateGoCommand(config, mode);
	outputChannel.appendLine(`   ${goCommand}`);

	outputChannel.appendLine(`\n💾 Saving configuration to launch.json...`);

	// Save configuration to launch.json
	await saveConfigurationToLaunchJson(config, workspaceFolder);

	outputChannel.appendLine(`✅ Configuration saved successfully`);

	// Show success message and ask if user wants to run it
	const action = await vscode.window.showInformationMessage(
		`Configuration "${config.name}" created successfully!`,
		'Run Now',
		'Open launch.json'
	);

	if (action === 'Run Now') {
		outputChannel.appendLine(`🚀 Starting ${mode} session...`);
		const success = await vscode.debug.startDebugging(workspaceFolder, config);
		if (success) {
			outputChannel.appendLine(`✅ ${mode.charAt(0).toUpperCase() + mode.slice(1)} session started successfully`);
		} else {
			outputChannel.appendLine(`❌ Failed to start ${mode} session`);
		}
	} else if (action === 'Open launch.json') {
		outputChannel.appendLine(`📝 Opening launch.json file...`);
		const launchJsonPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'launch.json');
		const doc = await vscode.workspace.openTextDocument(launchJsonPath);
		await vscode.window.showTextDocument(doc);
	}
}

async function createConfigurationForCurrentFile(context: vscode.ExtensionContext): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== 'go') {
		vscode.window.showErrorMessage('Please open a Go file first');
		return;
	}

	const filePath = editor.document.uri.fsPath;
	const fileName = path.basename(filePath);
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found');
		return;
	}

	// Only allow main.go files
	if (fileName !== 'main.go') {
		vscode.window.showErrorMessage('Can only create configurations for main.go files.');
		return;
	}

	// Main file configuration template
	const configTemplate = {
		name: `Debug ${fileName}`,
		type: 'go',
		request: 'launch',
		mode: 'debug' as const,
		program: filePath,
		cwd: workspaceFolder.uri.fsPath,
		runMode: 'file' as const
	};

	// Open configuration editor with the template
	ConfigurationEditorProvider.showConfigurationEditor(context, configTemplate, false);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	DebugLogger.log('Go Debug Pro extension activation started');

	console.log('Go Debug Pro extension is now active!');

	// Initialize global state manager
	const stateManager = ConfigurationStateManager.getInstance();
	DebugLogger.log('Configuration state manager initialized');
	(global as any).getConfigurationStateManager = () => stateManager;

	// Initialize managers
	const breakpointManager = new ConditionalBreakpointManager();
	const watchProvider = new WatchExpressionProvider();
	const debugConfigProvider = new DebugConfigurationProvider();
	globalDebugConfigProvider = debugConfigProvider; // Set global reference
	const runConfigManager = new RunConfigurationManager();
	const goDebugConfigProvider = new GoDebugConfigProvider();
	const quickConfigProvider = new QuickConfigurationProvider(context);

	// Register tree view for debug configurations
	const debugConfigView = vscode.window.createTreeView('goDebugProConfigs', {
		treeDataProvider: debugConfigProvider,
		showCollapseAll: true
	});

	// Register tree view for run configurations
	const runConfigView = vscode.window.createTreeView('goDebugProRunConfigs', {
		treeDataProvider: runConfigManager,
		showCollapseAll: true
	});

	// Register Go Debug Output Panel webview provider
	const goDebugOutputProvider = new GoDebugOutputProvider(context.extensionUri);
	globalGoDebugOutputProvider = goDebugOutputProvider; // Set global reference
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('goDebugOutput', goDebugOutputProvider, {
			webviewOptions: { retainContextWhenHidden: true }
		})
	);


	// Register the enhanced debug configuration provider for Run and Debug panel
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('go-debug-pro', goDebugConfigProvider));

	// Register legacy debug configuration provider
	const provider = new LegacyGoDebugConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('go-debug-pro', provider));

	// Register commands
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.toggleConditionalBreakpoint', async () => {
			await breakpointManager.toggleConditionalBreakpoint();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.addWatchExpression', async () => {
			await watchProvider.addWatchExpression();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.removeWatchExpression', async (item) => {
			await watchProvider.removeWatchExpression(item);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.refreshWatch', async () => {
			await watchProvider.refreshWatchExpressions();
		})
	);

	// Register debug configuration management commands
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.refreshConfigs', () => {
			debugConfigProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.createNewConfig', async () => {
			ConfigurationEditorProvider.showConfigurationEditor(context);
		})
	);

	// New run and debug commands for configurations
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.runDebugConfig', async (item) => {
			await runDebugConfiguration(item, 'run');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.debugConfig', async (item) => {
			await runDebugConfiguration(item, 'debug');
		})
	);



	// New restart and terminate commands
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.restartRunConfig', async (item) => {
			await restartConfiguration(item, 'run', stateManager, debugConfigProvider);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.restartDebugConfig', async (item) => {
			await restartConfiguration(item, 'debug', stateManager, debugConfigProvider);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.terminateConfig', async (item) => {
			await terminateConfiguration(item, stateManager, debugConfigProvider);
		})
	);

	// Run Configuration Management Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.refreshRunConfigs', () => {
			runConfigManager.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.createNewRunConfig', async () => {
			await runConfigManager.createNewConfiguration();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.showRunConfigDetails', (item) => {
			RunConfigWebviewProvider.showConfigDetails(context, item);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.editRunConfiguration', async (item) => {
			await runConfigManager.editConfiguration(item);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.duplicateRunConfiguration', async (item) => {
			await runConfigManager.duplicateConfiguration(item);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.deleteRunConfiguration', async (item) => {
			await runConfigManager.deleteConfiguration(item);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.runDebugConfiguration', async (item) => {
			await runConfigManager.runConfiguration(item);
		})
	);

	// Configuration Editor Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.createConfigurationWithEditor', async () => {
			ConfigurationEditorProvider.showConfigurationEditor(context);
		})
	);

	// 复制配置命令
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.duplicateConfig', async (item) => {
			await debugConfigProvider.duplicateConfiguration(item);
		})
	);

	// 删除配置命令
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.deleteConfig', async (item) => {
			await debugConfigProvider.deleteConfiguration(item);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.editConfigurationWithEditor', async (configItem) => {
			// Extract configuration from DebugConfigItem if needed
			let config = configItem;
			if (configItem && configItem.configuration) {
				// This is a DebugConfigItem
				config = configItem.configuration;
			}
			ConfigurationEditorProvider.showConfigurationEditor(context, config, true);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.createConfigurationFromProvider', async () => {
			await goDebugConfigProvider.createNewConfiguration();
		})
	);

	// Quick Configuration Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.refreshQuickConfigs', () => {
			quickConfigProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.runDebugFromQuick', async (config) => {
			await quickConfigProvider.runConfiguration(config);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.editConfigFromQuick', async (config) => {
			await quickConfigProvider.editConfiguration(config);
		})
	);

	// Copy Go Debug Output Command
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.copyGoDebugOutput', async () => {
			// Get the Go Debug Pro output channel content
			const debugInfo = `Go Debug Pro Output
================
Extension: Go Debug Pro
Version: ${context.extension.packageJSON.version}
Time: ${new Date().toLocaleString()}

To view actual debug output, check the "Go Debug Pro" output channel in the Output panel.
You can also check the debug console for runtime information.

Recent debugging sessions and configuration details are logged to the output channel.`;

			await vscode.env.clipboard.writeText(debugInfo);
			vscode.window.showInformationMessage('Go Debug Pro output information copied to clipboard!');
		})
	);

	// Context Menu Commands for Go Files
	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.debugCurrentFile', async () => {
			await debugCurrentGoFile(context, 'debug');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.runCurrentFile', async () => {
			await debugCurrentGoFile(context, 'run');
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('goDebugPro.createConfigForCurrentFile', async () => {
			await createConfigurationForCurrentFile(context);
		})
	);

	// Register debug event listeners
	context.subscriptions.push(
		vscode.debug.onDidStartDebugSession((session) => {
			if (session.type === 'go-debug-pro' || session.type === 'go') {
				console.log('Go Debug Pro session started');
				watchProvider.onSessionStarted(session);
				breakpointManager.onSessionStarted(session);
				if (!session.configuration) {
					return;
				}
				session
				// Update the running configuration with the debug session
				const configName = session.configuration?.name;
				if (configName) {
					const runningConfig = stateManager.getConfigState(configName);
					if (!runningConfig) {
						return;
					}
					if (runningConfig && runningConfig.mode === 'debug') {
						if (runningConfig.debugSession && runningConfig.debugSession.id !== session.id) {
							vscode.debug.stopDebugging(runningConfig.debugSession);
						}

					}
					// Update the running config with the debug session
					runningConfig.debugSession = session;
					stateManager.setConfigRunning(configName, runningConfig);

				}

				// Create a tab for this configuration in the output panel
				if (globalGoDebugOutputProvider && session.configuration?.name) {
					globalGoDebugOutputProvider.createTab(session.configuration.name);
					globalGoDebugOutputProvider.addOutput(
						`🚀 Debug session started for: ${session.configuration.name}`,
						session.configuration.name
					);

					// Show the Go Debug output panel and focus on it
					vscode.commands.executeCommand('workbench.view.extension.goDebugPanel').then(() => {
						// Small delay to ensure panel is shown before focusing the view
						setTimeout(() => {
							vscode.commands.executeCommand('goDebugOutput.focus');
						}, 100);
					});
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.debug.onDidTerminateDebugSession((session) => {
			if (session.type === 'go-debug-pro' || session.type === 'go') {
				console.log('Go Debug Pro session terminated');
				watchProvider.onSessionTerminated(session);
				breakpointManager.onSessionTerminated(session);
				if (!session.configuration || !session.configuration.name) {
					// No configuration name, cannot proceed
					console.warn('Terminated session has no configuration name');
					return;
				}
				// Find and update the running configuration
				const configName = session.configuration?.name;
				if (configName) {
					const runningConfig = stateManager.getConfigState(configName);
					if (runningConfig) {
						// Clear the debug session reference
						runningConfig.debugSession = undefined;
						// Stop the configuration
						stateManager.setConfigStopped(configName);
					}
				}

				// Add termination message to the tab
				if (globalGoDebugOutputProvider && session.configuration?.name) {
					globalGoDebugOutputProvider.addOutput(
						`🛑 Debug session terminated for: ${session.configuration.name}`,
						session.configuration.name
					);
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.debug.onDidChangeActiveDebugSession((session) => {
			if (session?.type === 'go-debug-pro' || session?.type === 'go') {
				watchProvider.onSessionChanged(session);
			}
		})
	);

	// Auto-refresh watch expressions on debug events
	context.subscriptions.push(
		vscode.debug.onDidChangeBreakpoints(() => {
			if (vscode.debug.activeDebugSession?.type === 'go-debug-pro') {
				watchProvider.refreshWatchExpressions();
			}
		})
	);



	// Initialize configurations for the debug output panel
	setTimeout(() => {
		if (globalGoDebugOutputProvider) {
			globalGoDebugOutputProvider.refreshConfigurations();
			// Don't create any default output - let it start empty
		}
	}, 1000);
}

// Debug Configuration Provider (Legacy)
class LegacyGoDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration, token?: vscode.CancellationToken): vscode.ProviderResult<vscode.DebugConfiguration> {

		// If launch.json is missing or empty
		// TODO: delete
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'go') {
				config.type = 'go-debug-pro';
				config.name = 'Launch Go Program';
				config.request = 'launch';
				config.program = editor.document.fileName;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		// 确保为 DAP 模式设置正确的配置
		// 检查是否有对应的运行配置，如果有，使用其二进制路径
		const configName = config.name;
		if (configName) {
			const debugServerInfo = globalRunningDebugServers.get(configName);
			if (debugServerInfo) {
				// 获取运行配置信息
				const runningConfig = getConfigurationStateManager().getConfigState(configName);
				if (runningConfig && runningConfig.binaryPath) {
					// 设置二进制文件路径用于 DAP
					config.program = runningConfig.binaryPath;
					config.mode = 'exec';  // 告诉 delve 这是一个已编译的二进制文件
					console.log(`🔧 Setting DAP config program to: ${config.program}`);
				}
			}
		}

		return config;
	}
}


// Helper function to restart a configuration
async function restartConfiguration(
	item: any,
	mode: 'run' | 'debug',
	stateManager: ConfigurationStateManager,
	debugConfigProvider: any
): Promise<void> {
	const configName = item.configuration.name;

	// First terminate the existing process
	const terminated = stateManager.stopConfig(configName);

	if (terminated) {
		//vscode.window.showInformationMessage(`Restarting ${mode}: ${configName}...`);

		// Wait a moment for cleanup
		setTimeout(async () => {
			// Refresh the tree to update icons
			debugConfigProvider.refresh();

			// Restart with the same mode
			await runDebugConfiguration(item, mode);
		}, 1500);
	} else {
		vscode.window.showWarningMessage(`Configuration "${configName}" is not currently running.`);
	}
}

// Helper function to terminate a configuration
export async function terminateConfiguration(
	item: any,
	stateManager: ConfigurationStateManager,
	debugConfigProvider: any
): Promise<void> {
	const configName = item.configuration.name;

	const state = stateManager.getConfigState(configName);

	if (state) {
		const terminated = stateManager.stopConfig(configName);

		if (terminated) {
			vscode.window.showInformationMessage(`Terminated ${state.mode}: ${configName}`);

			// Refresh the tree to update icons
			setTimeout(() => {
				debugConfigProvider.refresh();
			}, 500);
		}
	} else {
		vscode.window.showWarningMessage(`Configuration "${configName}" is not currently running.`);
	}
}

// This method is called when your extension is deactivated
export function deactivate() { }



// Helper function to execute compile-first then dlv remote debug workflow
async function executeCompileAndDlvDebug(
	workspaceFolder: vscode.WorkspaceFolder,
	runConfig: any,
	safeOriginalConfig: any,
	outputChannel: vscode.OutputChannel
): Promise<void> {
	const stateManager = ConfigurationStateManager.getInstance();

	// Log session start with detailed timing
	DebugLogger.info(`Starting compile-first dlv debug workflow for: ${safeOriginalConfig.name}`, outputChannel);
	DebugLogger.info(`Workspace: ${workspaceFolder.uri.fsPath}`, outputChannel);

	// Add a marker to indicate new debug session
	outputChannel.appendLine(`\n🔨 Starting compile-first debug workflow for: ${safeOriginalConfig.name}`);
	outputChannel.appendLine(`⏰ Time: ${new Date().toLocaleString()}`);

	try {
		// Step 1: Determine source directory and binary details
		let sourceDir = workspaceFolder.uri.fsPath;
		let sourcePath = '.';
		let binaryBaseName = 'main';

		// Create binary in system temporary directory with timestamp
		const timestamp = Date.now();
		const tempDir = os.tmpdir();
		const outputBinary = `${binaryBaseName}-run-${timestamp}`;
		const absoluteBinaryPath = path.join(tempDir, outputBinary);

		await build(workspaceFolder, absoluteBinaryPath, runConfig, safeOriginalConfig, 'debug', outputChannel);



		// Step 3: Start delve in headless mode for remote debugging
		outputChannel.appendLine(`\n🐛 Step 2 - Starting dlv in headless mode for remote debugging...`);

		// Determine working directory
		let workingDir = sourceDir;
		if (runConfig.cwd) {
			workingDir = runConfig.cwd.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
			outputChannel.appendLine(`📂 Working directory: ${workingDir}`);
		}
		// Prepare environment variables
		const execEnv = { ...process.env };



		const delveClient = new DelveClient();


		// 添加事件监听器来监控 dlv 状态
		delveClient.on('stdout', (data) => {
			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(`📤 DLV: ${data.trim()}`, safeOriginalConfig.name);
			}
		});

		delveClient.on('stderr', (data) => {
			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(`⚠️ DLV Error: ${data.trim()}`, safeOriginalConfig.name);
			}
		});

		delveClient.on('exit', (code, signal) => {
			const exitMsg = `Delve process exited - code: ${code}, signal: ${signal}`;
			outputChannel.appendLine(`🔴 ${exitMsg}`);
			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(`🔴 ${exitMsg}`, safeOriginalConfig.name);
			}


			// 分析退出原因
			if (code !== 0) {
				let reasonMsg = `Delve exited with non-zero code ${code}. `;
				if (code === 1) {
					reasonMsg += "This usually indicates a general error.";
				} else if (code === 2) {
					reasonMsg += "This usually indicates a command line usage error.";
				} else if (code === 130) {
					reasonMsg += "This indicates the process was interrupted (Ctrl+C).";
				}
				outputChannel.appendLine(`📋 Exit reason: ${reasonMsg}`);
			}
		});
		delveClient.on('error', (error) => {
			const errorMsg = `Delve process error: ${error}`;
			outputChannel.appendLine(`❌ ${errorMsg}`);
			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(`❌ ${errorMsg}`, safeOriginalConfig.name);
			}
		});
		delveClient.on('ready', () => {
			outputChannel.appendLine(`✅ Delve is ready and listening`);
			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(`✅ Delve is ready and listening`, safeOriginalConfig.name);
			}
		});



		// Check if dlv is available
		try {
			const exists = await delveClient.checkDlvExists();
			if (exists === false) {
				DebugLogger.error(`❌ 'dlv not found. Please install delve: go install github.com/go-delve/delve/cmd/dlv@latest'`, outputChannel);

				logToDebugOutput(
					`❌ 'dlv not found. Please install delve: go install github.com/go-delve/delve/cmd/dlv@latest'`,
					safeOriginalConfig.name
				);

				return;
			}
		} catch (error) {
			logToDebugOutput(
				`❌ Error checking dlv: ${error}`,
				safeOriginalConfig.name
			);

			DebugLogger.error(`❌ 'dlv not found. Please install delve: go install github.com/go-delve/delve/cmd/dlv@latest'`, outputChannel);
			return;
		}

		if (runConfig.env && Object.keys(runConfig.env).length > 0) {
			Object.assign(execEnv, runConfig.env);
			const envStr = Object.entries(runConfig.env)
				.map(([key, value]) => `${key}="${value}"`)
				.join(' ');
			outputChannel.appendLine(`🌍 Environment variables: ${envStr}`);
		}

		let isReady = true;
		delveClient.on("error", (err) => {
			logToDebugOutput(`❌ Delve error: ${err}`, safeOriginalConfig.name);
			stateManager.setConfigStopped(safeOriginalConfig.name);
			isReady = false;
			return;
		});
		try {
			await delveClient.start(absoluteBinaryPath, runConfig.name, runConfig.args, runConfig.workingDir || workingDir, execEnv || {});
		} catch (error) {
			const errorMsg = `Failed to start Delve: ${error}`;
			outputChannel.appendLine(`❌ ${errorMsg}`);
			logToDebugOutput(`❌ ${errorMsg}`, safeOriginalConfig.name);
			throw error;
		}


	} catch (error) {
		const errorMsg = `Failed to execute compile-first debug workflow: ${error}`;
		DebugLogger.error(errorMsg, outputChannel);
		if (globalGoDebugOutputProvider) {
			globalGoDebugOutputProvider.addOutput(
				`❌ ${errorMsg}`,
				safeOriginalConfig.name
			);
		}

		// Clean up debug server info on error
		globalRunningDebugServers.delete(safeOriginalConfig.name);

		//vscode.window.showErrorMessage(errorMsg);
		throw error;
	}
}

// Helper function to get or create a dedicated terminal for a configuration


async function build(
	workspaceFolder: vscode.WorkspaceFolder,
	absoluteBinaryPath: string,
	runConfig: any,
	safeOriginalConfig: any,
	mode: 'run' | 'debug',
	outputChannel: vscode.OutputChannel

) {
	// Determine source directory and binary details
	let sourceDir = workspaceFolder.uri.fsPath;
	let sourcePath = '.';

	if (runConfig.program) {
		let programPath = runConfig.program;

		// Handle ${workspaceFolder} replacement
		if (programPath.includes('${workspaceFolder}')) {
			programPath = programPath.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
		}

		// If program path is relative, make it absolute
		if (!path.isAbsolute(programPath)) {
			programPath = path.resolve(workspaceFolder.uri.fsPath, programPath);
		}

		// Determine source directory (where we'll run go build)
		if (programPath.endsWith('.go')) {
			// Single file: /path/to/main.go -> /path/to
			sourceDir = path.dirname(programPath);
			sourcePath = path.basename(programPath);
		} else {
			// Package/directory: /path/to/cmd/myapp -> /path/to/cmd/myapp
			sourceDir = programPath;
			sourcePath = '.';
		}
	}


	outputChannel.appendLine(`📂 Source directory: ${sourceDir}`);
	outputChannel.appendLine(`📄 Source path: ${sourcePath}`);
	outputChannel.appendLine(`🎯 Absolute binary path: ${absoluteBinaryPath}`);

	// Step 1 & 2: Build the binary
	outputChannel.appendLine(`\n� Step 1-2 - Building Go application...`);
	outputChannel.appendLine(`echo "🔨 Building Go application..."`);

	const buildArgs = ['build'];
	if (mode === 'debug') {
		// 没有 -N -l 参数， 新加 
		const hasNoOpt = buildArgs.some(arg => arg.includes('-gcflags') && arg.includes('-N') && arg.includes('-l'));
		if (!hasNoOpt) {
			buildArgs.push('-gcflags=all=-N -l');
		}
	}

	// Add build flags if any
	if (runConfig.buildFlags) {
		buildArgs.push(...runConfig.buildFlags.split(' ').filter((flag: string) => flag.trim()));
		outputChannel.appendLine(`🔧 Added build flags: ${runConfig.buildFlags}`);
	}

	// Add output and source
	buildArgs.push('-o', absoluteBinaryPath, sourcePath);

	const buildCommand = buildArgs.join(' ');
	outputChannel.appendLine(`🔨 Build command: go ${buildCommand}`);

	// Execute build process
	const buildStartTime = Date.now();
	DebugLogger.info(`Starting RUN build process with command: go ${buildCommand}`, outputChannel);
	DebugLogger.info(`RUN build process starting at: ${new Date().toISOString()}`, outputChannel);

	// Create tab for this configuration in the output panel early
	if (globalGoDebugOutputProvider) {
		globalGoDebugOutputProvider.createTab(safeOriginalConfig.name);
		globalGoDebugOutputProvider.addOutput(
			`🔨 Starting build for: ${safeOriginalConfig.name}`,
			safeOriginalConfig.name
		);

		// Show the Go Debug output panel and focus on it
		vscode.commands.executeCommand('workbench.view.extension.goDebugPanel').then(() => {
			// Small delay to ensure panel is shown before focusing the view
			setTimeout(() => {
				vscode.commands.executeCommand('goDebugOutput.focus');
			}, 100);
		});
	}

	const buildProcess = cp.spawn('go', buildArgs, {
		cwd: sourceDir,
		stdio: ['pipe', 'pipe', 'pipe']
	});

	buildProcess.stdout?.on('data', (data) => {
		const output = data.toString();
		outputChannel.append(output);

		// Send build output to the dedicated tab
		if (globalGoDebugOutputProvider) {
			const lines = output.split('\n');
			lines.forEach((line: string) => {
				if (line.trim()) {
					globalGoDebugOutputProvider!.addOutput(`🔨 ${line}`, safeOriginalConfig.name);
				}
			});
		}
	});

	buildProcess.stderr?.on('data', (data) => {
		const error = data.toString();
		outputChannel.append(error);

		// Send build errors to the dedicated tab
		if (globalGoDebugOutputProvider) {
			const lines = error.split('\n');
			lines.forEach((line: string) => {
				if (line.trim()) {
					globalGoDebugOutputProvider!.addOutput(`❌ Build Error: ${line}`, safeOriginalConfig.name);
				}
			});
		}
	});

	await new Promise<void>((resolve, reject) => {
		buildProcess.on('exit', (code) => {
			const buildDuration = Date.now() - buildStartTime;
			if (code === 0) {
				DebugLogger.info(`RUN build completed successfully in ${buildDuration}ms`, outputChannel);
				outputChannel.appendLine(`✅ Build completed successfully`);

				// Send build success to the dedicated tab
				if (globalGoDebugOutputProvider) {
					globalGoDebugOutputProvider.addOutput(
						`✅ Build completed successfully in ${buildDuration}ms`,
						safeOriginalConfig.name
					);
				}
				resolve();
			} else {
				const errorMsg = `Build failed with exit code ${code}`;
				outputChannel.appendLine(`❌ ${errorMsg}`);

				// Send build failure to the dedicated tab
				if (globalGoDebugOutputProvider) {
					globalGoDebugOutputProvider.addOutput(
						`❌ ${errorMsg}`,
						safeOriginalConfig.name
					);
				}
				reject(new Error(errorMsg));
			}
		});
	});

	// Step 3: Determine working directory
	let workingDir = sourceDir; // Default to source directory
	if (runConfig.cwd) {
		workingDir = runConfig.cwd.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
		outputChannel.appendLine(`📂 Step 3 - Working directory: ${workingDir}`);
	} else {
		outputChannel.appendLine(`📁 Step 3 - Using source directory as working directory: ${workingDir}`);
	}
}

// Helper function to execute run mode with dedicated terminal
async function executeRunWithDedicatedTerminal(
	workspaceFolder: vscode.WorkspaceFolder,
	runConfig: any,
	safeOriginalConfig: any,
	outputChannel: vscode.OutputChannel
): Promise<void> {
	const stateManager = ConfigurationStateManager.getInstance();

	// Log session start with detailed timing
	DebugLogger.info(`Starting new RUN execution session for: ${safeOriginalConfig.name}`, outputChannel);
	DebugLogger.info(`Workspace: ${workspaceFolder.uri.fsPath}`, outputChannel);

	// Add a marker to indicate new execution session
	outputChannel.appendLine(`\n🔄 Starting new execution session for: ${safeOriginalConfig.name}`);
	outputChannel.appendLine(`⏰ Time: ${new Date().toLocaleString()}`);

	// Send a clear command to ensure clean terminal state
	outputChannel.appendLine('echo "=== Starting new execution session ==="');

	try {
		// Determine source directory and binary details
		let sourceDir = workspaceFolder.uri.fsPath;
		let binaryBaseName = 'main';



		// Create binary in system temporary directory with timestamp
		const timestamp = Date.now();
		const tempDir = os.tmpdir();
		const outputBinary = `${binaryBaseName}-run-${timestamp}`;
		const absoluteBinaryPath = path.join(tempDir, outputBinary);

		await build(workspaceFolder, absoluteBinaryPath, runConfig, safeOriginalConfig, 'run', outputChannel);

		// Step 3: Determine working directory
		let workingDir = sourceDir; // Default to source directory
		if (runConfig.cwd) {
			workingDir = runConfig.cwd.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
			outputChannel.appendLine(`📂 Step 3 - Working directory: ${workingDir}`);
		} else {
			outputChannel.appendLine(`📁 Step 3 - Using source directory as working directory: ${workingDir}`);
		}

		// Step 4: Execute the binary
		outputChannel.appendLine(`\n🚀 Step 4 - Executing application...`);
		// dedicatedTerminal.sendText(`echo "🚀 Starting execution from ${workingDir}..."`);

		// Prepare execution arguments
		const execArgs: string[] = [];
		if (runConfig.args && runConfig.args.length > 0) {
			execArgs.push(...runConfig.args);
			outputChannel.appendLine(`⚡ Program arguments: ${runConfig.args.join(' ')}`);
		}

		// Prepare environment variables
		const execEnv = { ...process.env };
		if (runConfig.env && Object.keys(runConfig.env).length > 0) {
			Object.assign(execEnv, runConfig.env);
			const envStr = Object.entries(runConfig.env)
				.map(([key, value]) => `${key}="${value}"`)
				.join(' ');
			outputChannel.appendLine(`🌍 Environment variables: ${envStr}`);
		}

		// Execute the binary
		DebugLogger.info(`Starting RUN execution: ${absoluteBinaryPath} with args: [${execArgs.join(', ')}]`, outputChannel);
		DebugLogger.info(`Working directory: ${workingDir}`, outputChannel);
		DebugLogger.info(`Environment variables count: ${Object.keys(execEnv).length}`, outputChannel);
		const runStartTime = Date.now();
		const runProcess = cp.spawn(absoluteBinaryPath, execArgs, {
			cwd: workingDir,
			env: execEnv,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		// Set configuration as running with process information
		stateManager.setConfigRunning(safeOriginalConfig.name, {
			mode: 'run',
			process: runProcess,
			// terminal: outputChannel, // removed, no terminal used
			startTime: runStartTime,
			workingDir: workingDir,
			binaryPath: absoluteBinaryPath
		});

		DebugLogger.info(`RUN process started with PID: ${runProcess.pid}`, outputChannel);

		// Add execution start message to the existing tab (tab was created during build)
		if (globalGoDebugOutputProvider) {
			globalGoDebugOutputProvider.addOutput(
				`🚀 Execution started (PID: ${runProcess.pid})`,
				safeOriginalConfig.name
			);
		}

		// Redirect process output to terminal and output channel
		runProcess.stdout?.on('data', (data) => {
			const output = data.toString();
			outputChannel.append(output);

			// Send output to the dedicated tab
			if (globalGoDebugOutputProvider) {
				// Split output by lines and send each line
				const lines = output.split('\n');
				lines.forEach((line: string) => {
					if (line.trim()) {
						globalGoDebugOutputProvider!.addOutput(line, safeOriginalConfig.name);
					}
				});
			}
		});

		runProcess.stderr?.on('data', (data) => {
			const error = data.toString();
			outputChannel.append(error);

			// Send error output to the dedicated tab
			if (globalGoDebugOutputProvider) {
				const lines = error.split('\n');
				lines.forEach((line: string) => {
					if (line.trim()) {
						globalGoDebugOutputProvider!.addOutput(`❌ ${line}`, safeOriginalConfig.name);
					}
				});
			}
		});

		// Handle process completion
		runProcess.on('exit', (code, signal) => {
			const runDuration = Date.now() - runStartTime;
			const exitMessage = signal
				? `Process terminated by signal ${signal} after ${runDuration}ms`
				: `Process exited with code ${code} after ${runDuration}ms`;

			outputChannel.appendLine(`\n${exitMessage}`);

			if (globalGoDebugOutputProvider) {
				globalGoDebugOutputProvider.addOutput(
					code === 0 ? `✅ ${exitMessage}` : `❌ ${exitMessage}`,
					safeOriginalConfig.name
				);
			}

			// Mark configuration as no longer running
			stateManager.setConfigStopped(safeOriginalConfig.name);
		});

		outputChannel.appendLine(`✅ Process started with PID: ${runProcess.pid}`);
		// dedicatedTerminal.sendText(`echo "✅ Process started with PID: ${runProcess.pid}"`);

	} catch (error) {
		const errorMsg = `Failed to execute run configuration: ${error}`;
		outputChannel.appendLine(`❌ ${errorMsg}`);
		// dedicatedTerminal.sendText(`echo "❌ ${errorMsg}"`);
		//vscode.window.showErrorMessage(errorMsg);
	}
}


