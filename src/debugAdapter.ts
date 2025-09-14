
import { DebugProtocol } from '@vscode/debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import * as vsAdapter from '@vscode/debugadapter';
import * as net from 'net';
import { DelveClient } from './delveClient';
import * as fs from 'fs';


interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
	name?: string;
	args?: string[];
	cwd?: string;
	env?: { [key: string]: string };
	showLog?: boolean;
	logOutput?: string;
	stopOnEntry?: boolean;
	dlvPort?: number;
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	processId: string;
	host?: string;
	port?: number;
	mode: 'local' | 'remote';
}

export class DebugSession extends vsAdapter.DebugSession implements vscode.DebugSession {
	private dlvProcess: ChildProcess | null = null;
	private dlvPath: string = 'dlv';
	private dlvSocket: net.Socket | null = null;
	private buffer: string = '';
	private dlvPort: number = 2345;
	private host: string = '127.0.0.1';
	private pendingRequests = new Map<number, any>();
	private isConnected: boolean = false;
	private program: string = '';
	private args: string[] = [];
	private keepAliveInterval: NodeJS.Timeout | null = null;

	private debugSession: vscode.DebugSession | null = null;

	private address(): string {
		return `${this.host}:${this.dlvPort}`;
	}

	public constructor() {
		super();
		console.log('DebugSession constructor called');
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);
	}




	public async setSessionInfo(session: vscode.DebugSession): Promise<void> {
	 
		try {
			this.debugSession = session;

			console.log(`🔗 DelveClient connection status: ${this.isConnected ? 'Connected' : 'Not connected'}`);
			console.log(`📍 DelveClient address: ${this.host}:${this.dlvPort}`);

		} catch (error) {
 			this.dlvPath = 'dlv';
		}
		

		console.log(`DebugSession info: name=${session.configuration.name}, type=${session.configuration.type}`);
	}

	public getDlvInfo(): [ChildProcess | null, net.Socket | null] {
		return [this.dlvProcess, this.dlvSocket];
	}

	 
	protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): Promise<void> {
		console.log('initializeRequest called with args:', args);
		if(!this.isConnected) {
			const delveClient = new DelveClient();
			console.log('🚀 Starting DelveClient...');
			const config = this.debugSession?.configuration;
			if (config) {
				await delveClient.start(config.program, config.name, config.args, config.cwd, config.env);
				console.log('✅ DelveClient started successfully');
				// 等待500ms以确保Delve完全启动
				await new Promise(resolve => setTimeout(resolve, 500));

				this.dlvPath = delveClient.getDlvPath();
				this.dlvPort = delveClient.getPort();
				this.host = delveClient.getHost();
				
				this.dlvProcess = delveClient.getProcess();
				this.dlvSocket = delveClient.getSocket();
				this.isConnected = this.dlvSocket !== null;
			}

		}
		
		response.body = response.body ?? {};
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsSetVariable = true;
		// 将初始化请求转发给 dlv
		if (this.isConnected) {
			this.forwardToDlv({
				seq: 1,
				type: 'request',
				command: 'initialize',
				arguments: args
			});
			response.success = true;
			this.sendResponse(response);
			this.sendEvent(new vsAdapter.InitializedEvent());
		} else {
			// 如果还没连接，先返回基本能力
			response.body = response.body || {};

			response.body.supportsConfigurationDoneRequest = true;
			response.body.supportsEvaluateForHovers = true;
			response.body.supportsStepBack = false;
			response.body.supportsDataBreakpoints = false;
			response.body.supportsCompletionsRequest = true;
			response.body.completionTriggerCharacters = ['.', '['];
			response.body.supportsCancelRequest = true;
			response.body.supportsBreakpointLocationsRequest = true;
			response.body.supportsStepInTargetsRequest = true;
			response.body.supportsExceptionInfoRequest = true;
			response.body.supportsFunctionBreakpoints = true;
			response.body.supportsConditionalBreakpoints = true;
			response.body.supportsHitConditionalBreakpoints = true;
			response.body.supportsLogPoints = true;
			response.body.supportsRestartFrame = false;
			response.body.supportsGotoTargetsRequest = true;

			this.sendResponse(response);
			this.sendEvent(new vsAdapter.InitializedEvent());
		}
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
		console.log('launchRequest called with args:', JSON.stringify(args, null, 2));

		try {
			this.program = args.program;
			this.args = args.args || [];
			
			// 如果已经连接到 DelveClient，直接转发请求
			if (this.isConnected && this.dlvSocket) {
				console.log('Forwarding launch request to Delve DAP...');
				this.forwardToDlv({
					seq: 1,
					type: 'request',
					command: 'launch',
					arguments: args
				});
			} else {
				console.log('No DelveClient connection found, starting standalone mode...');
				// 这里可以实现独立模式的逻辑
			}
			
			response.success = true;
			this.sendResponse(response);

		} catch (error) {
			console.error('Launch request failed:', error);
			response.success = false;
			response.message = `Failed to launch: ${error}`;
			this.sendResponse(response);
		}
	}


 


	private startKeepAlive() {
		// 在 DAP 模式下，我们不发送心跳请求，因为 VS Code 会处理所有 DAP 通信
		// 只是定期检查连接状态
		this.keepAliveInterval = setInterval(() => {
			if (this.dlvProcess && this.dlvProcess && !this.dlvProcess.killed && this.dlvProcess.exitCode === null) {
				console.log("🟢 DAP connection and process are alive");
			} else {
				console.log("🔴 DAP connection or process issues detected");
				// 如果进程已经退出，停止心跳
				if (this.dlvProcess && (this.dlvProcess.killed || this.dlvProcess.exitCode !== null)) {
					this.stopKeepAlive();
				}
			}
		}, 30000);
	}

	private stopKeepAlive() {
		if (this.keepAliveInterval) {
			clearInterval(this.keepAliveInterval);
			this.keepAliveInterval = null;
		}
	}


	private isProcessRunning(processId: string): boolean {
		try {
			// 在 Unix 系统上，使用 kill -0 检查进程是否存在
			process.kill(parseInt(processId), 0);
			return true;
		} catch (error) {
			return false;
		}
	}

	private setupDelveClientEventListeners(): void {


		// 监听 DelveClient 的事件
		this.on('ready', () => {
			console.log('DelveClient is ready');
		});

		this.on('stdout', (data: string) => {
			console.log('[DelveClient stdout]', data);
		});

		this.on('stderr', (data: string) => {
			console.error('[DelveClient stderr]', data);
		});

		this.on('exit', (code: number, signal: string) => {
			console.log(`DelveClient process exited with code ${code}, signal ${signal}`);
			this.sendEvent(new vsAdapter.TerminatedEvent());
		});

		this.on('error', (error: Error) => {
			console.error('DelveClient error:', error);
		});

		// 监听调试相关事件
		this.on('stackTrace', (trace: any) => {
			console.log('Stack trace received:', trace);
			// 可以通过这里更新UI或发送事件到VS Code
		});

		this.on('variables', (vars: any) => {
			console.log('Variables received:', vars);
			// 可以通过这里更新变量视图
		});
	}

	private async connectToDelveClientDap(): Promise<void> {
		const host = this.host;
		const port = this.dlvPort;
		return new Promise((resolve, reject) => {
			let retryCount = 0;
			const maxRetries = 10;

			const tryConnect = () => {
				this.dlvSocket = net.connect(port, host);

				this.dlvSocket.on('connect', () => {
					console.log(`Connected to DelveClient DAP at ${host}:${port}`);
					this.isConnected = true;
					resolve();
				});

				this.dlvSocket.on('data', (data) => {
					this.handleDlvData(data);
					this.startKeepAlive();
				});

				this.dlvSocket.on('error', (err) => {
					console.error('DelveClient DAP socket error:', err);
					retryCount++;
					if (retryCount < maxRetries) {
						console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
						setTimeout(tryConnect, 500);
					} else {
						reject(new Error(`Failed to connect to DelveClient DAP after ${maxRetries} retries`));
					}
				});

				this.dlvSocket.on('close', () => {
					console.log('DelveClient DAP socket closed');
					this.cleanup();
					this.isConnected = false;
				});
			};

			// 初次连接延迟一点，等待 DelveClient 完全启动
			setTimeout(tryConnect, 1000);
		});
	}

 

	private handleDlvData(data: Buffer): void {
		this.buffer += data.toString();

		let idx;
		while ((idx = this.buffer.indexOf('\r\n')) !== -1) {
			const msgStr = this.buffer.slice(0, idx);
			this.buffer = this.buffer.slice(idx + 2);

			if (msgStr.trim()) {
				try {
					const dapMsg = JSON.parse(msgStr);
					this.handleDlvMessage(dapMsg);
				} catch (e) {
					console.error('Failed to parse dlv DAP message:', msgStr, e);
				}
			}
		}
	}

	private handleDlvMessage(msg: any): void {
		console.log('Received message from dlv DAP:', JSON.stringify(msg, null, 2));

		if (msg.type === 'event') {
			console.log(`Forwarding event '${msg.event}' to VS Code`);
			// 转发事件到 VS Code
			this.sendEvent(msg);
		} else if (msg.type === 'response') {
			console.log(`Forwarding response for command '${msg.command}' to VS Code`);
			// 转发响应到 VS Code
			this.sendResponse(msg);
		} else {
			console.log('Unknown message type from dlv:', msg.type);
		}
	}

	private forwardToDlv(request: any): void {
		if (this.dlvSocket && this.dlvSocket.writable) {
			const body = JSON.stringify(request);
			const contentLength = Buffer.byteLength(body, 'utf8');
			const header = `Content-Length: ${contentLength}\r\n\r\n`;
			const msgStr = header + body;
			if (!this.dlvSocket.write(msgStr)) {
				console.warn('dlv socket write returned false, data may be buffered');
			}
		} else {
			console.error('dlv socket not available for forwarding request');
		}
	}

	// 以下所有 DAP 请求都转发给 dlv
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'configurationDone',
			arguments: args
		});
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'setBreakpoints',
			arguments: args
		});
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'threads',
			arguments: {}
		});
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'stackTrace',
			arguments: args
		});
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'scopes',
			arguments: args
		});
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'variables',
			arguments: args
		});
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'continue',
			arguments: args
		});
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'next',
			arguments: args
		});
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'stepIn',
			arguments: args
		});
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'stepOut',
			arguments: args
		});
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'evaluate',
			arguments: args
		});
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		this.forwardToDlv({
			seq: response.request_seq,
			type: 'request',
			command: 'disconnect',
			arguments: args
		});

		// 清理资源
		this.cleanup();
	}

	private cleanup(): void {
		// 清理 socket 连接
		if (this.dlvSocket) {
			this.dlvSocket.destroy();
			this.dlvSocket = null;
		}
		if (this.program && fs.existsSync(this.program)) {
			try {
				fs.unlinkSync(this.program);
				console.log(`Cleaned up binary: ${this.program}`);
			} catch (error) {
				console.error(`Failed to clean up binary ${this.program}: ${error}`);
			}
		}


		// 清理直接启动的 dlv 进程
		if (this.dlvProcess) {
			this.dlvProcess.kill();
			this.dlvProcess = null;
		}

		this.isConnected = false;
	}

	// 实现 vscode.DebugSession 接口的必需方法
	readonly id: string = Math.random().toString(36);
	readonly type: string = 'go-debug-pro';
	readonly name: string = 'Go Debug Pro Session';
	readonly workspaceFolder: vscode.WorkspaceFolder | undefined = undefined;
	readonly configuration: vscode.DebugConfiguration = {
		type: 'go-debug-pro',
		name: 'Go Debug Pro Session',
		request: 'launch'
	};

	customRequest(command: string, args?: any): Thenable<any> {
		return new Promise((resolve, reject) => {
			this.forwardToDlv({
				seq: Date.now(),
				type: 'request',
				command: command,
				arguments: args
			});
			// 简化处理，实际应该跟踪请求ID
			resolve({});
		});
	}

	getDebugProtocolBreakpoint(breakpoint: vscode.Breakpoint): Thenable<vscode.DebugProtocolBreakpoint | undefined> {
		// 简化实现
		return Promise.resolve(undefined);
	}
}
