import {
	DebugSession, 
	InitializedEvent, 
	TerminatedEvent, 
	StoppedEvent, 
	Thread, 
	StackFrame, 
	Scope, 
	Variable, 
	Breakpoint,
	Source
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DelveClient } from './delveClient';
import * as path from 'path';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
	args?: string[];
	cwd?: string;
	env?: { [key: string]: string };
	showLog?: boolean;
	logOutput?: string;
	stopOnEntry?: boolean;
}

export class GoDebugAdapter extends DebugSession {
	
	private _delveClient = new DelveClient();
	private _variableHandles = new Map<number, any>();
	private _nextVariableHandle = 1000;

	public constructor() {
		super();
		
		// This debugger uses one-based lines and columns
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
		// Build and return the capabilities of this debug adapter
		response.body = response.body || {};
		
		response.body.supportsConfigurationDoneRequest = true;
		response.body.supportsEvaluateForHovers = true;
		response.body.supportsCompletionsRequest = true;
		response.body.supportsConditionalBreakpoints = true;
		response.body.supportsHitConditionalBreakpoints = true;
		response.body.supportsLogPoints = true;
		response.body.supportsSetVariable = true;
		response.body.supportsFunctionBreakpoints = true;
		
		this.sendResponse(response);
		this.sendEvent(new InitializedEvent());
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
		super.configurationDoneRequest(response, {});
		this.sendResponse(response);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
		try {
			await this._delveClient.start(args.program, args.args || [], args.cwd || "", args.env || {});
			if (args.stopOnEntry) {
				this.sendEvent(new StoppedEvent('entry', 1));
			} else {
				await this._delveClient.continue();
			}
			
			this.sendResponse(response);
		} catch (error) {
			this.sendErrorResponse(response, 2001, `Failed to launch: ${error}`);
		}
	}

	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): Promise<void> {
		const path = args.source.path as string;
		const clientLines = args.lines || [];
		const sourceBreakpoints = args.breakpoints || [];
		
		try {
			await this._delveClient.clearBreakpoints(path);
			
			const breakpoints = [];
			for (let i = 0; i < clientLines.length; i++) {
				const line = clientLines[i];
				const sourceBp = sourceBreakpoints[i];
				
				const bp = new Breakpoint(true, line);
				// Note: Breakpoint class doesn't have these properties in @vscode/debugadapter
				// They are handled by the protocol response body
				breakpoints.push(bp);
			}
			
			await this._delveClient.setBreakpoints(path, sourceBreakpoints.map((bp, i) => ({
				line: clientLines[i],
				condition: bp.condition,
				hitCondition: bp.hitCondition,
				logMessage: bp.logMessage
			})));
			
			response.body = { breakpoints };
			this.sendResponse(response);
		} catch (error) {
			this.sendErrorResponse(response, 2003, `Failed to set breakpoints: ${error}`);
		}
	}

	protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {
		try {
			const goroutines = await this._delveClient.listGoroutines();
			const threads = goroutines.map((g: any) => 
				new Thread(g.id, g.userCurrentLoc?.function?.name || `goroutine ${g.id}`)
			);
			
			if (threads.length > 0) {
				this._delveClient.activeThreadId = threads[0].id;
			}
			
			response.body = { threads };
			this.sendResponse(response);
		} catch (error) {
			response.body = { threads: [new Thread(1, "main")] };
			this.sendResponse(response);
		}
	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {
		try {
			const threadId = args.threadId || this._delveClient.activeThreadId || 1;
			const stack = await this._delveClient.stacktrace(threadId);
			
			if (stack.length > 0) {
				this._delveClient.activeFrameId = 0;
			}
			
			const stackFrames = stack.map((frame: any, i: number) => {
				return new StackFrame(
					i,
					frame.function?.name || '<unknown>',
					this.createSource(frame.file),
					frame.line || 0,
					frame.column || 0
				);
			});
			
			response.body = {
				stackFrames,
				totalFrames: stack.length
			};
			this.sendResponse(response);
		} catch (error) {
			this.sendErrorResponse(response, 2004, `Failed to get stack trace: ${error}`);
		}
	}

	protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): Promise<void> {
		this._delveClient.activeFrameId = args.frameId;
		
		const scopes = [
			new Scope("Local", this._createVariableHandle({ type: "locals" }), false),
			new Scope("Arguments", this._createVariableHandle({ type: "args" }), false)
		];
		
		response.body = { scopes };
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): Promise<void> {
		try {
			const handle = this._variableHandles.get(args.variablesReference);
			if (!handle) {
				response.body = { variables: [] };
				this.sendResponse(response);
				return;
			}
			
			let variables: Variable[] = [];
			
			if (handle.type === "locals") {
				const locals = await this._delveClient.localVariables(
					this._delveClient.activeFrameId, 
					this._delveClient.activeThreadId
				);
				variables = locals.map((v: any) => this._createVariable(v));
			} else if (handle.type === "args") {
				const args = await this._delveClient.functionArgs(
					this._delveClient.activeFrameId, 
					this._delveClient.activeThreadId
				);
				variables = args.map((v: any) => this._createVariable(v));
			} else if (handle.type === "var") {
				const children = await this._delveClient.listChildren(handle.varInfo);
				variables = children.map((v: any) => this._createVariable(v));
			}
			
			response.body = { variables };
			this.sendResponse(response);
		} catch (error) {
			this.sendErrorResponse(response, 2005, `Failed to get variables: ${error}`);
		}
	}

	protected async continueRequest(response: DebugProtocol.ContinueResponse): Promise<void> {
		try {
			await this._delveClient.continue();
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent('breakpoint', this._delveClient.activeThreadId));
		} catch (error) {
			this.sendErrorResponse(response, 2006, `Failed to continue: ${error}`);
		}
	}

	protected async nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
		try {
			await this._delveClient.next();
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent('step', this._delveClient.activeThreadId));
		} catch (error) {
			this.sendErrorResponse(response, 2007, `Failed to step: ${error}`);
		}
	}

	protected async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
		try {
			await this._delveClient.stepIn();
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent('step', this._delveClient.activeThreadId));
		} catch (error) {
			this.sendErrorResponse(response, 2008, `Failed to step in: ${error}`);
		}
	}

	protected async stepOutRequest(response: DebugProtocol.StepOutResponse): Promise<void> {
		try {
			await this._delveClient.stepOut();
			this.sendResponse(response);
			this.sendEvent(new StoppedEvent('step', this._delveClient.activeThreadId));
		} catch (error) {
			this.sendErrorResponse(response, 2009, `Failed to step out: ${error}`);
		}
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): Promise<void> {
		try {
			const result = await this._delveClient.eval(args.expression, {
				goroutineID: this._delveClient.activeThreadId,
				frame: this._delveClient.activeFrameId
			});
			
			response.body = {
				result: result?.value?.toString() || 'undefined',
				type: result?.type || '',
				variablesReference: 0
			};
			this.sendResponse(response);
		} catch (error) {
			this.sendErrorResponse(response, 2010, `Failed to evaluate: ${error}`);
		}
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): Promise<void> {
		try {
			await this._delveClient.setVariable(
				{
					goroutineID: this._delveClient.activeThreadId,
					frame: this._delveClient.activeFrameId
				},
				args.name,
				args.value
			);
			
			response.body = { value: args.value };
			this.sendResponse(response);
		} catch (error) {
			this.sendErrorResponse(response, 2011, `Failed to set variable: ${error}`);
		}
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
		this._delveClient.stop();
		this.sendResponse(response);
		this.sendEvent(new TerminatedEvent());
	}

	// Helper methods
	private createSource(filePath: string): Source {
		return new Source(path.basename(filePath), filePath);
	}

	private _createVariable(v: any): Variable {
		let variablesReference = 0;
		if (v.kind === "struct" || v.kind === "map" || v.kind === "slice" || v.kind === "array") {
			variablesReference = this._createVariableHandle({ type: "var", varInfo: v });
		}
		
		return new Variable(
			v.name,
			v.value?.toString() || v.type || '<nil>',
			variablesReference
		);
	}

	private _createVariableHandle(value: any): number {
		const handle = this._nextVariableHandle++;
		this._variableHandles.set(handle, value);
		return handle;
	}
}
