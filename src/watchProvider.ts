import * as vscode from 'vscode';

export class WatchExpressionProvider implements vscode.TreeDataProvider<WatchExpression> {
    private _onDidChangeTreeData: vscode.EventEmitter<WatchExpression | undefined | null | void> = new vscode.EventEmitter<WatchExpression | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WatchExpression | undefined | null | void> = this._onDidChangeTreeData.event;

    private _watchExpressions: WatchExpression[] = [];
    private _session: vscode.DebugSession | undefined;
    private _refreshTimer: NodeJS.Timeout | undefined;

    constructor() {
        // Register tree data provider
        vscode.window.createTreeView('goDebugProWatch', {
            treeDataProvider: this,
            showCollapseAll: true
        });
    }

    public onSessionStarted(session: vscode.DebugSession): void {
        this._session = session;
        this.startAutoRefresh();
    }

    public onSessionTerminated(session: vscode.DebugSession): void {
        if (this._session === session) {
            this._session = undefined;
            this.stopAutoRefresh();
        }
    }

    public onSessionChanged(session: vscode.DebugSession | undefined): void {
        this._session = session;
        if (session) {
            this.refreshWatchExpressions();
        }
    }

    public async addWatchExpression(): Promise<void> {
        const expression = await vscode.window.showInputBox({
            prompt: 'Enter expression to watch',
            placeHolder: 'variable_name or expression'
        });

        if (expression) {
            const watchExpr = new WatchExpression(expression, 'evaluating...', vscode.TreeItemCollapsibleState.None);
            this._watchExpressions.push(watchExpr);
            
            // Immediately evaluate if session is active
            if (this._session) {
                await this.evaluateExpression(watchExpr);
            }
            
            this._onDidChangeTreeData.fire();
            vscode.window.showInformationMessage(`Added watch expression: ${expression}`);
        }
    }

    public async removeWatchExpression(item: WatchExpression): Promise<void> {
        const index = this._watchExpressions.indexOf(item);
        if (index >= 0) {
            this._watchExpressions.splice(index, 1);
            this._onDidChangeTreeData.fire();
        }
    }

    public async refreshWatchExpressions(): Promise<void> {
        if (!this._session) {
            return;
        }

        for (const watchExpr of this._watchExpressions) {
            await this.evaluateExpression(watchExpr);
        }

        this._onDidChangeTreeData.fire();
    }

    private async evaluateExpression(watchExpr: WatchExpression): Promise<void> {
        if (!this._session) {
            watchExpr.value = 'No active session';
            watchExpr.tooltip = 'No debug session active';
            return;
        }

        try {
            // Use VS Code's debug session to evaluate expression
            const result = await this._session.customRequest('evaluate', {
                expression: watchExpr.expression,
                context: 'watch',
                frameId: 0 // Use current frame
            });

            if (result && result.result !== undefined) {
                watchExpr.value = String(result.result);
                watchExpr.tooltip = `${watchExpr.expression} = ${watchExpr.value}`;
                
                if (result.type) {
                    watchExpr.tooltip += ` (${result.type})`;
                }

                // If the result has nested properties, make it expandable
                if (result.variablesReference && result.variablesReference > 0) {
                    watchExpr.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    watchExpr.variablesReference = result.variablesReference;
                }
            } else {
                watchExpr.value = 'undefined';
                watchExpr.tooltip = `${watchExpr.expression} = undefined`;
            }
        } catch (error) {
            watchExpr.value = 'error';
            watchExpr.tooltip = `Error evaluating ${watchExpr.expression}: ${error}`;
        }
    }

    private startAutoRefresh(): void {
        // Auto-refresh every 500ms during debugging
        this._refreshTimer = setInterval(() => {
            if (this._session) {
                this.refreshWatchExpressions();
            }
        }, 500);
    }

    private stopAutoRefresh(): void {
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = undefined;
        }
    }

    // TreeDataProvider implementation
    getTreeItem(element: WatchExpression): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: WatchExpression): Promise<WatchExpression[]> {
        if (!element) {
            // Return root watch expressions
            return this._watchExpressions;
        }

        // Return child properties for expandable items
        if (element.variablesReference && this._session) {
            try {
                const result = await this._session.customRequest('variables', {
                    variablesReference: element.variablesReference
                });

                if (result && result.variables) {
                    return result.variables.map((variable: any) => {
                        const childExpr = new WatchExpression(
                            variable.name,
                            variable.value,
                            variable.variablesReference > 0 
                                ? vscode.TreeItemCollapsibleState.Collapsed 
                                : vscode.TreeItemCollapsibleState.None
                        );
                        childExpr.tooltip = `${variable.name} = ${variable.value}`;
                        if (variable.type) {
                            childExpr.tooltip += ` (${variable.type})`;
                        }
                        childExpr.variablesReference = variable.variablesReference;
                        return childExpr;
                    });
                }
            } catch (error) {
                console.error('Error getting child variables:', error);
            }
        }

        return [];
    }

    public getWatchExpressions(): WatchExpression[] {
        return [...this._watchExpressions];
    }

    public clearAllWatchExpressions(): void {
        this._watchExpressions = [];
        this._onDidChangeTreeData.fire();
    }
}

export class WatchExpression extends vscode.TreeItem {
    constructor(
        public expression: string,
        public value: string,
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public variablesReference?: number
    ) {
        super(`${expression} = ${value}`, collapsibleState);
        
        this.tooltip = `${expression} = ${value}`;
        this.description = value;
        this.contextValue = 'watchExpression';
        
        // Set icon based on value type
        if (value === 'error') {
            this.iconPath = new vscode.ThemeIcon('error');
        } else if (value === 'evaluating...') {
            this.iconPath = new vscode.ThemeIcon('loading');
        } else if (collapsibleState !== vscode.TreeItemCollapsibleState.None) {
            this.iconPath = new vscode.ThemeIcon('symbol-object');
        } else {
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
        }
    }
}
