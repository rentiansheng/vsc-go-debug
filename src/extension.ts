import * as vscode from 'vscode';
import * as Net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';

import { DebugConfigurationProvider } from './debugConfigProvider';
import { ConfigurationEditorProvider } from './configurationEditorProvider';
import { GoDebugOutputProvider } from './goDebugOutputProvider';
import { GlobalStateManager } from './globalStateManager';
import { GoClient } from './go';
import * as dap from './dap';
import { config } from 'process';
import { GoDebugConfiguration } from './goDebugConfigurationProvider';


interface RunningConfig {
	mode: 'run' | 'debug';
	process: cp.ChildProcess;
	startTime: number;
	workingDir: string;
	binaryPath?: string; // For run mode
	debugSession?: vscode.DebugSession; // For debug mode
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

// Output Channel Manager - ensures each channel is created only once
class OutputChannelManager {
	private static instance: OutputChannelManager;
	private channels: Map<string, vscode.OutputChannel> = new Map();
	private logChannels: Map<string, vscode.LogOutputChannel> = new Map();

	private constructor() {}

	static getInstance(): OutputChannelManager {
		if (!OutputChannelManager.instance) {
			OutputChannelManager.instance = new OutputChannelManager();
		}
		return OutputChannelManager.instance;
	}

	getChannel(name: string): vscode.OutputChannel;
	getChannel(name: string, options: { log: true }): vscode.LogOutputChannel;
	getChannel(name: string, options?: { log: boolean }): vscode.OutputChannel | vscode.LogOutputChannel {
		if (options?.log) {
			if (!this.logChannels.has(name)) {
				const channel = vscode.window.createOutputChannel(name, { log: true });
				this.logChannels.set(name, channel);
				DebugLogger.log(`Created new log output channel: ${name}`);
			}
			return this.logChannels.get(name)!;
		} else {
			if (!this.channels.has(name)) {
				const channel = vscode.window.createOutputChannel(name);
				this.channels.set(name, channel);
				DebugLogger.log(`Created new output channel: ${name}`);
			}
			return this.channels.get(name)!;
		}
	}

	dispose(): void {
		for (const channel of this.channels.values()) {
			channel.dispose();
		}
		for (const channel of this.logChannels.values()) {
			channel.dispose();
		}
		this.channels.clear();
		this.logChannels.clear();
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
			if (config.startTime < Date.now() - 1000) { // 仅清理启动超过1秒的配置，防止误杀刚启动的配置
				if (!config.process || config.process.killed || config.process.exitCode !== null) {
					if (config.debugSession) {
						// vscode.debug.stopDebugging(config.debugSession);
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
		if ((!config.process || config.process.killed || config.process.exitCode !== null) && (!config.debugSession)) {
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
			config.process,
			config.debugSession,
		);

		if (config.process) {


			// Monitor process exit
			config.process.on('exit', (code, signal) => {
				DebugLogger.log(`Process for ${configName} exited with code ${code}, signal ${signal}`);
				this.setConfigStopped(configName);
			});

			config.process.on('error', (error) => {
				DebugLogger.error(`Process error for ${configName}: ${error}`);
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

	setConfigDebugSession(configName: string, proc: cp.ChildProcess | null, dlvSocket: Net.Socket | null, debugSession: vscode.DebugSession): void {
		const config = this.runningConfigs.get(configName);
		if (!config) {
			return;
		}
		if (!proc) {
			return;
		}

		this.globalStateManager.setState(configName, config.mode as 'debug' | 'run', 'running', proc, debugSession);

		config.process = proc;

		this.runningConfigs.set(configName, config!);
	}

	private resetConfigState(configName: string): void {
		const config = this.runningConfigs.get(configName);
		if (!config) {
			return;
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
export async function runDebugConfiguration(configItem: GoDebugConfiguration, mode: 'run' | 'debug'): Promise<Boolean> {
	const outputChannelManager = OutputChannelManager.getInstance();
	const outputChannel = outputChannelManager.getChannel('Go Debug Pro');



	try {
		outputChannel.appendLine(`\n=== Go Debug Pro Execution Log ===`);
		outputChannel.appendLine(`Time: ${new Date().toLocaleString()}`);
		outputChannel.appendLine(`Mode: ${mode.toUpperCase()}`);

		 
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
		outputChannel.appendLine(`📁 Workspace: ${config.vscWorkspaceFolder}`);

		config.mode = mode.toLocaleLowerCase();
		const stateManager = ConfigurationStateManager.getInstance();
		stateManager.setConfigRunning(config.itemName, config);
		// Create a safe copy of the configuration to avoid circular references
		const safeOriginalConfig = { ... config } as GoDebugConfiguration;

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

	 

		outputChannel.appendLine(`\n🔧 Pre-execution Actions:`);

		// Modify configuration based on mode
		if (mode === 'run') {
			outputChannel.appendLine(`   • Setting stopOnEntry = false (run mode)`);
			safeOriginalConfig.stopOnEntry = false;
			outputChannel.appendLine(`   • Modified name to: "${safeOriginalConfig.name}"`);
		} else {
			outputChannel.appendLine(`   • Setting stopOnEntry = true (debug mode)`);
			safeOriginalConfig.stopOnEntry = true;
			outputChannel.appendLine(`   • Modified name to: "${safeOriginalConfig.name}"`);
		}

		outputChannel.appendLine(`\n📋 Final Configuration to Execute:`);
 
		outputChannel.appendLine(JSON.stringify(safeOriginalConfig, null, 2));

		// Generate equivalent command line
		outputChannel.appendLine(`\n💻 Equivalent Command Line:`);
		const goCommand = generateGoCommand(safeOriginalConfig, mode);
		outputChannel.appendLine(`   ${goCommand}`);

		outputChannel.appendLine(`\n🚀 Starting ${mode} session...`);
		

		if (mode === 'run') {
			// For run mode, use outputChannel only
			outputChannel.appendLine(`📦 Running in background (no terminal)...`);
			const workspaceFolder = config.vscWorkspaceFolder;
			if (!workspaceFolder) {
				outputChannel.appendLine(`❌ No workspace folder found`);
				return false;
			}
			
			try {
				await executeRunWithDedicatedTerminal(
 					config,
					safeOriginalConfig,
					outputChannel
				);
			} catch (error) {
				outputChannel.appendLine(`❌ Execution failed: ${error}`);
				vscode.window.showErrorMessage(`Execution failed: ${error}`);
				return false;
			}



		} else {
			// For debug mode, implement compile-first then dlv remote debugging workflow
			outputChannel.appendLine(`🐛 Starting compile-first debug workflow...`);

			try {
				await executeCompileAndDlvDebug(
					config,
					safeOriginalConfig,
					outputChannel
				);
			} catch (error) {
				outputChannel.appendLine(`❌ Debug execution failed: ${error}`);
				vscode.window.showErrorMessage(`Debug execution failed: ${error}`);
				return false;
			}
		}
	} catch (error) {
		const errorMsg = `Error running configuration: ${error}`;
		outputChannel.appendLine(`❌ ${errorMsg}`);
		vscode.window.showErrorMessage(errorMsg);
		return false;
	}
	return true;
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

 

// Helper functions for context menu commands
async function debugCurrentGoFile(context: vscode.ExtensionContext, mode: 'debug' | 'run'): Promise<void> {
	const outputChannelManager = OutputChannelManager.getInstance();
	const outputChannel = outputChannelManager.getChannel('Go Debug Pro');

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
		runMode: 'file' as const,
		vscWorkspaceFolder: workspaceFolder.uri.fsPath,
	} as GoDebugConfiguration;

	// Open configuration editor with the template
	ConfigurationEditorProvider.showConfigurationEditor(context, configTemplate, false);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Suppress Node.js deprecation warnings and telemetry errors
	process.removeAllListeners('warning');
	process.on('warning', (warning) => {
		// Only log critical warnings, suppress punycode and telemetry warnings
		if (!warning.message.includes('punycode') && 
			!warning.message.includes('ApplicationInsights') &&
			!warning.message.includes('SQLite') &&
			!warning.message.includes('ExperimentalWarning')) {
			console.warn('Extension Warning:', warning.message);
		}
	});

	// Suppress unhandled promise rejections for telemetry
	process.on('unhandledRejection', (reason, promise) => {
		if (reason && typeof reason === 'object' && 'message' in reason) {
			const message = (reason as Error).message;
			if (message.includes('ApplicationInsights') || 
				message.includes('ERR_NAME_NOT_RESOLVED') ||
				message.includes('Ingestion endpoint') ||
				message.includes('ERR_INVALID_ARG_VALUE') ||
				message.includes('telemetry data') ||
				message.includes('cannot be empty')) {
				// Silently ignore telemetry-related errors
				return;
			}
		}
		console.error('Unhandled Promise Rejection:', reason);
	});

	// Additional error handler for TypeError related to files
	process.on('uncaughtException', (error) => {
		if (error.message.includes('ERR_INVALID_ARG_VALUE') ||
			error.message.includes('telemetry') ||
			error.message.includes('cannot be empty')) {
			// Silently ignore telemetry file errors
			return;
		}
		console.error('Uncaught Exception:', error);
	});

	DebugLogger.log('Go Debug Pro extension activation started');
	
 
	
	// Create output channel immediately for debugging
	const activationChannel = vscode.window.createOutputChannel('Go Debug Pro Activation');
	activationChannel.show();
	activationChannel.appendLine('🚀 Go Debug Pro Extension Activation Started');
	activationChannel.appendLine(`Time: ${new Date().toISOString()}`);
	activationChannel.appendLine(`Extension Path: ${context.extensionPath}`);
	activationChannel.appendLine(`VS Code Version: ${vscode.version}`);
	
	try {

	console.log('Go Debug Pro extension is now active!');

	// Initialize global state manager
	const stateManager = ConfigurationStateManager.getInstance();
	DebugLogger.log('Configuration state manager initialized');
	(global as any).getConfigurationStateManager = () => stateManager;

	// Initialize managers
 	const debugConfigProvider = new DebugConfigurationProvider();
	globalDebugConfigProvider = debugConfigProvider; // Set global reference
   
	activationChannel.appendLine('✅ Data providers initialized successfully');

	// Register tree view for debug configurations
	const debugConfigView = vscode.window.createTreeView('goDebugProConfigs', {
		treeDataProvider: debugConfigProvider,
		showCollapseAll: true
	});
 
	// Register Go Debug Output Panel webview provider
	const goDebugOutputProvider = new GoDebugOutputProvider(context.extensionUri, debugConfigProvider);
	globalGoDebugOutputProvider = goDebugOutputProvider; // Set global reference
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('goDebugOutput', goDebugOutputProvider, {
			webviewOptions: { retainContextWhenHidden: true }
		})
	);
	activationChannel.appendLine('✅ Go Debug Output webview provider registered');

 

 

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
 				if (!session.configuration) {
					return;
				}

				 
				// Update the running configuration with the debug session
				const tabName = session.configuration.itemName;
				if (tabName) {
					const runningConfig = stateManager.getConfigState(tabName);
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
					stateManager.setConfigRunning(tabName, runningConfig);

				}

				// Create a tab for this configuration in the output panel
				if (globalGoDebugOutputProvider ) {
					globalGoDebugOutputProvider.createTab(tabName);
					globalGoDebugOutputProvider.addOutput(
						`🚀 Debug session started for: ${session.configuration.name}`,
						tabName
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
		 
				// Find and update the running configuration
				const tabName = session.configuration.itemName;
				if (tabName) {
					const runningConfig = stateManager.getConfigState(tabName);
					if (runningConfig && runningConfig.debugSession && runningConfig.debugSession.id === session.id) {
							// Stop the configuration
						stateManager.setConfigStopped(tabName);
						// Clear the debug session reference
						runningConfig.debugSession = undefined;
					
					}
				}

				// Add termination message to the tab
				if (globalGoDebugOutputProvider) {
					globalGoDebugOutputProvider.addOutput(
						`🛑 Debug session terminated for: ${session.configuration.name}`,
						tabName
					);
					globalGoDebugOutputProvider.cleanDebugInfo(tabName);
				}
			}
		})
	);

 
 

	// Register DAP Debug Adapter Factory
	const goDebugAdapterFactory = new GoDebugAdapterFactory();
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory('go-debug-pro', goDebugAdapterFactory)
	);

 
	
	activationChannel.appendLine('✅ Go Debug Pro Extension Activation Completed Successfully');
	
	} catch (error) {
		const errorMsg = `❌ Go Debug Pro Extension Activation Failed: ${error}`;
		console.error(errorMsg);
		activationChannel.appendLine(errorMsg);
		vscode.window.showErrorMessage(errorMsg);
	}
}

export function deactivated() {
	console.log('Go Debug Pro extension is deactivating...');
	if (globalGoDebugOutputProvider) {
		globalGoDebugOutputProvider.dispose();
	}
	
	// Dispose all output channels
	const outputChannelManager = OutputChannelManager.getInstance();
	outputChannelManager.dispose();
	 
	console.log('Go Debug Pro extension deactivated.');
}

// Debug Adapter Factory for Go Debug Pro
class GoDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	private outputChannel: vscode.LogOutputChannel;

	constructor() {
		const outputChannelManager = OutputChannelManager.getInstance();
		this.outputChannel = outputChannelManager.getChannel('Go Debug Pro Adapter', { log: true });
		console.log('🎯 GoDebugAdapterFactory initialized');
	}

	createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		console.log(`🎯 GoDebugAdapterFactory.createDebugAdapterDescriptor called for session: ${session.name} (${session.type})`);
		
		// 临时返回 undefined 以使用默认适配器，避免干扰配置显示
		console.log(`🎯 Using default adapter for compatibility`);
 
		
		// TODO: 未来可以在这里实现自定义调试适配器
		try {
			DebugLogger.log(`Creating GoDebugSession...`, this.outputChannel);
			console.log('About to create GoDebugSession with parameters: true, false, fs');
			//const debugSession = new GoDebugSession(true, false);
 			var debugSession = new dap.DelveDAPOutputAdapter(session.configuration, this.outputChannel);

			console.log('debugSession methods:', Object.getOwnPropertyNames(debugSession));
			
			DebugLogger.log(`GoDebugSession created successfully`, this.outputChannel);
			debugSession.setDebugSession(session);

			debugSession.startDapServer(session.configuration);
			
			DebugLogger.log(`Setting up event listeners...`, this.outputChannel);
			 
			DebugLogger.log(`Creating debug adapter for session: ${session.name} (${session.type})`, this.outputChannel);
			return new vscode.DebugAdapterInlineImplementation(debugSession);
		} catch (error) {
			DebugLogger.error(`Failed to create GoDebugSession: ${error}`, this.outputChannel);
			return undefined;
		}
	}

	// 实现 dispose 方法以避免错误
	dispose(): void {
		console.log('🎯 GoDebugAdapterFactory disposing...');
		if (this.outputChannel) {
			this.outputChannel.dispose();
		}
	}
}

 

// Helper function to restart a configuration
async function restartConfiguration(
	item: any,
	mode: 'run' | 'debug',
	stateManager: ConfigurationStateManager,
	debugConfigProvider: any
): Promise<void> {
	const configName = item.configuration.itemName;

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
	const configName = item.configuration.itemName;

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
	runConfig: GoDebugConfiguration,
	safeOriginalConfig: GoDebugConfiguration,
	outputChannel: vscode.OutputChannel
): Promise<void> {
	const stateManager = ConfigurationStateManager.getInstance();

	// Log session start with detailed timing
	DebugLogger.info(`Starting compile-first dlv debug workflow for: ${safeOriginalConfig.name}`, outputChannel);
	DebugLogger.info(`Workspace: ${safeOriginalConfig.vscWorkspaceFolder}`, outputChannel);

	// Add a marker to indicate new debug session
	outputChannel.appendLine(`\n🔨 Starting compile-first debug workflow for: ${safeOriginalConfig.name}`);
	outputChannel.appendLine(`⏰ Time: ${new Date().toLocaleString()}`);

	try {
		// Step 1: Determine source directory and binary details
		let sourceDir = safeOriginalConfig.vscWorkspaceFolder;
		let sourcePath = '.';
		let binaryBaseName = 'main';

		// Create binary in system temporary directory with timestamp
		const timestamp = Date.now();
		const tempDir = os.tmpdir();
		const outputBinary = `${binaryBaseName}-run-${timestamp}`;
		const absoluteBinaryPath = path.join(tempDir, outputBinary);

		const goClient = new GoClient(safeOriginalConfig.goPath, safeOriginalConfig.goRoot);


		await goClient.build(absoluteBinaryPath, safeOriginalConfig, 'debug', outputChannel);
		if(!fs.existsSync(absoluteBinaryPath)) {
 			stateManager.stopConfig(safeOriginalConfig.itemName);
			return ;
		}


		// Step 3: Start delve in headless mode for remote debugging
		outputChannel.appendLine(`\n🐛 Step 2 - Starting dlv in headless mode for remote debugging...`);

		// Determine working directory
		let workingDir = sourceDir;
		if (runConfig.cwd) {
			workingDir = runConfig.cwd.replace('${workspaceFolder}', safeOriginalConfig.vscWorkspaceFolder || '');
			outputChannel.appendLine(`📂 Working directory: ${workingDir}`);
		}
 
 
		const debugConfig = {
			//type: 'go',
			type: 'go-debug-pro',

			name: safeOriginalConfig.name,
			request: 'launch',
			mode: "exec", // Use 'exec' mode for compiled binary
			stopOnEntry: false, // Always stop on entry for debug mode
			dlvToolPath: goClient.getDlvExecutablePath(),
			dlvMode: goClient.getDlvMode(),
			dlvFlags: runConfig.dlvFlags || [],
			program: absoluteBinaryPath,
			args: safeOriginalConfig.args || [],
			env: safeOriginalConfig.env || {},
			cwd: safeOriginalConfig.cwd || safeOriginalConfig.vscWorkspaceFolder,
			configuration: safeOriginalConfig,
			itemName: safeOriginalConfig.itemName,

		};

		var sessionOpt: vscode.DebugSessionOptions = {
			 suppressDebugView: true
		};
		// vscode folder 
		const workspaceFolder = vscode.workspace.workspaceFolders?.find(folder => folder.uri.fsPath === safeOriginalConfig.vscWorkspaceFolder);
		if (!workspaceFolder) {
			throw new Error('Workspace folder not found');
		}
		const success = await vscode.debug.startDebugging(workspaceFolder, debugConfig, sessionOpt);
		if (!success) {
			throw new Error('Failed to start debug session');
		}



	} catch (error) {
		const errorMsg = `Failed to execute compile-first debug workflow: ${error}`;
		DebugLogger.error(errorMsg, outputChannel);
		if (globalGoDebugOutputProvider) {
			globalGoDebugOutputProvider.addOutput(
				`❌ ${errorMsg}`,
				safeOriginalConfig.itemName
			);
		}

		stateManager.setConfigStopped(safeOriginalConfig.itemName);
		// Clean up debug server info on error
		globalRunningDebugServers.delete(safeOriginalConfig.itemName);

		//vscode.window.showErrorMessage(errorMsg);
		throw error;
	}
}

 


// Helper function to execute run mode with dedicated terminal
async function executeRunWithDedicatedTerminal(
 	runConfig: GoDebugConfiguration,
	safeOriginalConfig: GoDebugConfiguration,
	outputChannel: vscode.OutputChannel
): Promise<void> {
	const stateManager = ConfigurationStateManager.getInstance();

	// Log session start with detailed timing
	DebugLogger.info(`Starting new RUN execution session for: ${safeOriginalConfig.name}`, outputChannel);
	DebugLogger.info(`Workspace: ${safeOriginalConfig.vscWorkspaceFolder}`, outputChannel);

	// Add a marker to indicate new execution session
	outputChannel.appendLine(`\n🔄 Starting new execution session for: ${safeOriginalConfig.name}`);
	outputChannel.appendLine(`⏰ Time: ${new Date().toLocaleString()}`);

	// Send a clear command to ensure clean terminal state
	outputChannel.appendLine('echo "=== Starting new execution session ==="');

	try {
		// Determine source directory and binary details
		let sourceDir = safeOriginalConfig.vscWorkspaceFolder;
		let binaryBaseName = 'main';



		// Create binary in system temporary directory with timestamp
		const timestamp = Date.now();
		const tempDir = os.tmpdir();
		const outputBinary = `${binaryBaseName}-run-${timestamp}`;
		const absoluteBinaryPath = path.join(tempDir, outputBinary);

		const goClient = new GoClient(safeOriginalConfig.goPath, safeOriginalConfig.goRoot);

		await goClient.build(absoluteBinaryPath, safeOriginalConfig, 'run', outputChannel);

		// Step 3: Determine working directory
		let workingDir = sourceDir; // Default to source directory
		if (runConfig.cwd) {
			workingDir = runConfig.cwd.replace('${workspaceFolder}', safeOriginalConfig.vscWorkspaceFolder);
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
		stateManager.setConfigRunning(safeOriginalConfig.itemName, {
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
				safeOriginalConfig.itemName
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
						globalGoDebugOutputProvider!.addOutput(line, safeOriginalConfig.itemName);
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
						globalGoDebugOutputProvider!.addOutput(`❌ ${line}`, safeOriginalConfig.itemName);
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
					safeOriginalConfig.itemName
				);
			}

			// Mark configuration as no longer running
			stateManager.setConfigStopped(safeOriginalConfig.itemName);
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


