import {
	DebugSession, 
	InitializedEvent, 
	TerminatedEvent, 
	StoppedEvent, 
	BreakpointEvent, 
	OutputEvent,
	Thread, 
	StackFrame, 
	Scope, 
	Variable, 
	Breakpoint,
	Source
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	program: string;
	args: string[];
	cwd: string;
	env: { [key: string]: string };
	showLog?: boolean;
	logOutput?: string;
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	processId: string;
	mode: 'local' | 'remote';
}

export class GoDebugAdapter extends DebugSession {
	
	private static readonly THREAD_ID = 1;
	private _runtime: GoRuntime;
	private _variableHandles = new Map<number, Variable[]>();
	private _nextVariableHandle = 1000;

	public constructor() {
		super();
		this._runtime = new GoRuntime();
		
		// Setup event handlers
		this._runtime.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', GoDebugAdapter.THREAD_ID));
		});
		
		this._runtime.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', GoDebugAdapter.THREAD_ID));
		});
		
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', GoDebugAdapter.THREAD_ID));
		});
		
		this._runtime.on('stopOnException', (exception: any) => {
			this.sendEvent(new StoppedEvent('exception', GoDebugAdapter.THREAD_ID, exception));
		});
		
		this._runtime.on('breakpointValidated', (bp: any) => {
			this.sendEvent(new BreakpointEvent('changed', bp as DebugProtocol.Breakpoint));
		});
		
		this._runtime.on('output', (text: any, filePath: any, line: any, column: any) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);
			if (filePath) {
				e.body.source = this.createSource(filePath);
				e.body.line = this.convertDebuggerLineToClient(line);
				e.body.column = this.convertDebuggerColumnToClient(column);
			}
			this.sendEvent(e);
		});
		
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		
		// Build and return the capabilities of this debug adapter
		response.body = response.body || {};
		
		// The adapter implements the configurationDone request
		response.body.supportsConfigurationDoneRequest = true;
		
		// Make VS Code use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;
		
		// Make VS Code show a 'step back' button
		response.body.supportsStepBack = false;
		
		// Make VS Code support data breakpoints
		response.body.supportsDataBreakpoints = false;
		
		// Make VS Code support completion in REPL
		response.body.supportsCompletionsRequest = true;
		response.body.completionTriggerCharacters = ['.', '['];
		
		// Make VS Code send cancel request
		response.body.supportsCancelRequest = true;
		
		// Make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;
		
		// Make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = true;
		
		// Make VS Code send exception info request
		response.body.supportsExceptionInfoRequest = true;
		
		// Make VS Code send function breakpoints
		response.body.supportsFunctionBreakpoints = true;
		
		// Support conditional breakpoints
		response.body.supportsConditionalBreakpoints = true;
		
		// Support hit count breakpoints
		response.body.supportsHitConditionalBreakpoints = true;
		
		// Support logpoints
		response.body.supportsLogPoints = true;
		
		// Support variable type
		// response.body.supportsVariableType = true;
		
		// Support variable paging
		// response.body.supportsVariablePaging = true;
		
		// Support restart frame
		response.body.supportsRestartFrame = false;
		
		// Support goto targets
		response.body.supportsGotoTargetsRequest = true;
		
		this.sendResponse(response);
		
		// Since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);
		
		// Notify the runtime that configuration has finished
		this._runtime.start();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
		
		// Start the program in the runtime
		await this._runtime.start(args.program, false, !args.noDebug); // stopOnEntry not in new protocol
		
		this.sendResponse(response);
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
		
		// Attach to the process
		await this._runtime.attach(args.processId, args.mode);
		
		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
		
		const path = args.source.path as string;
		const clientLines = args.lines || [];
		
		// Clear all breakpoints for this file
		this._runtime.clearBreakpoints(path);
		
		// Set and verify breakpoint locations
		const actualBreakpoints = clientLines.map(l => {
			const { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = <DebugProtocol.Breakpoint> new Breakpoint(verified, this.convertDebuggerLineToClient(line));
			bp.id = id;
			
			// Handle conditional breakpoints
			if (args.breakpoints) {
				const sourceBreakpoint = args.breakpoints[clientLines.indexOf(l)];
				if (sourceBreakpoint) {
					// bp.condition = sourceBreakpoint.condition;
					// bp.hitCondition = sourceBreakpoint.hitCondition;
					// bp.logMessage = sourceBreakpoint.logMessage;
				}
			}
			
			return bp;
		});
		
		// Send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
		
		// Runtime supports now threads so just return a default thread
		response.body = {
			threads: [
				new Thread(GoDebugAdapter.THREAD_ID, "main")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {
		
		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;
		
		const stk = this._runtime.stack(startFrame, endFrame);
		
		response.body = {
			stackFrames: stk.frames.map(f => {
				const sf = new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line));
				if (typeof f.column === 'number') {
					sf.column = this.convertDebuggerColumnToClient(f.column);
				}
				return sf;
			}),
			// 4 options for 'totalFrames':
			//omit totalFrames property: 	// VS Code has to probe/guess. Should result in a max. of two requests
			totalFrames: stk.count			// stk.count is the correct size, should result in a max. of two requests
			//totalFrames: 1000000 			// not the correct size, should result in a max. of two requests
			//totalFrames: endFrame + 20 	// dynamically increases the size with every requested chunk, results in paging
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
		
		response.body = {
			scopes: [
				new Scope("Local", this._nextVariableHandle++, false),
				new Scope("Global", this._nextVariableHandle++, true)
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
		
		let variables: Variable[] = [];
		
		if (this._variableHandles.has(args.variablesReference)) {
			variables = this._variableHandles.get(args.variablesReference)!;
		} else {
			// Get variables from runtime
			const vars = await this._runtime.getVariables(args.variablesReference);
			variables = vars.map(v => {
				const variable = new Variable(v.name, v.value);
				// if (v.type) {
				// 	variable.type = v.type;
				// }
				if (v.variablesReference && v.variablesReference > 0) {
					variable.variablesReference = v.variablesReference;
				}
				return variable;
			});
			this._variableHandles.set(args.variablesReference, variables);
		}
		
		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this._runtime.stepIn();
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this._runtime.stepOut();
		this.sendResponse(response);
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
		
		let reply: string | undefined = undefined;
		
		if (args.context === 'repl') {
			// Handle REPL context
			reply = await this._runtime.evaluate(args.expression);
		} else if (args.context === 'hover') {
			// Handle hover context
			reply = await this._runtime.evaluate(args.expression);
		} else if (args.context === 'watch') {
			// Handle watch context
			reply = await this._runtime.evaluate(args.expression);
		} else {
			reply = `evaluate(context: '${args.context}', '${args.expression}')`;
		}
		
		response.body = {
			result: reply ? reply : `null`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	//---- helpers

	private createSource(filePath: string): Source {
		return new Source(path.basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'go-debug-adapter-data');
	}
}

// Mock runtime for Go debugging
class GoRuntime {
	
	private _events = new Map<string, Function[]>();
	private _breakPoints = new Map<string, number[]>();
	private _breakpointId = 1;
	private _currentLine = 0;
	private _process: ChildProcess | undefined;
	
	constructor() {
		// Initialize
	}
	
	public on(event: string, listener: Function) {
		if (!this._events.has(event)) {
			this._events.set(event, []);
		}
		this._events.get(event)!.push(listener);
	}
	
	private emit(event: string, ...args: any[]) {
		if (this._events.has(event)) {
			this._events.get(event)!.forEach(listener => listener(...args));
		}
	}
	
	public async start(program?: string, stopOnEntry?: boolean, noDebug?: boolean): Promise<void> {
		
		if (program) {
			// Start Go program with delve debugger
			this._process = spawn('dlv', ['debug', program, '--headless', '--listen=:2345', '--api-version=2'], {
				cwd: path.dirname(program)
			});
			
			this._process.stdout?.on('data', (data) => {
				this.emit('output', data.toString(), program, 1, 1);
			});
			
			this._process.stderr?.on('data', (data) => {
				this.emit('output', data.toString(), program, 1, 1);
			});
			
			this._process.on('close', (code) => {
				this.emit('end');
			});
		}
		
		if (stopOnEntry) {
			this.emit('stopOnEntry');
		} else {
			this.emit('stopOnStep');
		}
	}
	
	public async attach(processId: string, mode: 'local' | 'remote'): Promise<void> {
		// Implement attach logic
		this.emit('stopOnEntry');
	}
	
	public continue(): void {
		// Continue execution
		this.emit('stopOnStep');
	}
	
	public step(): void {
		this._currentLine++;
		this.emit('stopOnStep');
	}
	
	public stepIn(): void {
		this._currentLine++;
		this.emit('stopOnStep');
	}
	
	public stepOut(): void {
		this._currentLine++;
		this.emit('stopOnStep');
	}
	
	public setBreakPoint(path: string, line: number): { verified: boolean, line: number, id: number } {
		const bp = { verified: true, line, id: this._breakpointId++ };
		
		if (!this._breakPoints.has(path)) {
			this._breakPoints.set(path, []);
		}
		this._breakPoints.get(path)!.push(line);
		
		this.emit('breakpointValidated', bp);
		return bp;
	}
	
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}
	
	public stack(startFrame: number, endFrame: number): { frames: any[], count: number } {
		const frames = [];
		for (let i = startFrame; i < Math.min(endFrame, 10); i++) {
			frames.push({
				index: i,
				name: `frame_${i}`,
				file: '/path/to/file.go',
				line: i + 1
			});
		}
		return { frames, count: 10 };
	}
	
	public async getVariables(reference: number): Promise<any[]> {
		// Mock variables
		return [
			{ name: 'x', value: '42', type: 'int' },
			{ name: 'y', value: 'hello', type: 'string' },
			{ name: 'arr', value: '[1, 2, 3]', type: '[]int', variablesReference: reference + 1 }
		];
	}
	
	public async evaluate(expression: string): Promise<string> {
		// Mock evaluation
		return `result of ${expression}`;
	}
}
