import * as vscode from 'vscode';

export class ConditionalBreakpointManager {
    private _session: vscode.DebugSession | undefined;
    private _conditionalBreakpoints = new Map<string, ConditionalBreakpointInfo>();

    public onSessionStarted(session: vscode.DebugSession): void {
        this._session = session;
    }

    public onSessionTerminated(session: vscode.DebugSession): void {
        if (this._session === session) {
            this._session = undefined;
        }
    }

    public async toggleConditionalBreakpoint(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const document = editor.document;
        const line = editor.selection.active.line;
        const uri = document.uri.toString();

        // Check if there's already a breakpoint on this line
        const existingBreakpoints = vscode.debug.breakpoints.filter(bp => 
            bp instanceof vscode.SourceBreakpoint && 
            bp.location.uri.toString() === uri && 
            bp.location.range.start.line === line
        ) as vscode.SourceBreakpoint[];

        if (existingBreakpoints.length > 0) {
            // Remove existing breakpoint
            vscode.debug.removeBreakpoints(existingBreakpoints);
        } else {
            // Add conditional breakpoint
            const condition = await vscode.window.showInputBox({
                prompt: 'Enter condition for breakpoint (e.g., x > 5)',
                placeHolder: 'condition'
            });

            if (condition) {
                const breakpoint = new vscode.SourceBreakpoint(
                    new vscode.Location(document.uri, new vscode.Position(line, 0)),
                    true,
                    condition
                );
                vscode.debug.addBreakpoints([breakpoint]);

                // Store conditional breakpoint info
                const key = `${uri}:${line}`;
                this._conditionalBreakpoints.set(key, {
                    condition,
                    line,
                    uri,
                    hitCount: 0
                });

                //vscode.window.showInformationMessage(`Conditional breakpoint set: ${condition}`);
            }
        }
    }

    public async setLogpointBreakpoint(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const document = editor.document;
        const line = editor.selection.active.line;

        // Get log message
        const logMessage = await vscode.window.showInputBox({
            prompt: 'Enter log message (use {expression} for variable values)',
            placeHolder: 'Variable x = {x}'
        });

        if (logMessage) {
            const breakpoint = new vscode.SourceBreakpoint(
                new vscode.Location(document.uri, new vscode.Position(line, 0)),
                true,
                undefined,
                undefined,
                logMessage
            );
            vscode.debug.addBreakpoints([breakpoint]);

            //vscode.window.showInformationMessage(`Logpoint set: ${logMessage}`);
        }
    }

    public getBreakpointInfo(uri: string, line: number): ConditionalBreakpointInfo | undefined {
        const key = `${uri}:${line}`;
        return this._conditionalBreakpoints.get(key);
    }

    public updateHitCount(uri: string, line: number): void {
        const key = `${uri}:${line}`;
        const info = this._conditionalBreakpoints.get(key);
        if (info) {
            info.hitCount++;
            this._conditionalBreakpoints.set(key, info);
        }
    }

    public getAllBreakpoints(): Map<string, ConditionalBreakpointInfo> {
        return new Map(this._conditionalBreakpoints);
    }

    public clearAllBreakpoints(): void {
        this._conditionalBreakpoints.clear();
    }
}

interface ConditionalBreakpointInfo {
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    line: number;
    uri: string;
    hitCount: number;
}
