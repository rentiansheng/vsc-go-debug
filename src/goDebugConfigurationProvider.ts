import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface GoDebugConfiguration extends vscode.DebugConfiguration {
    name: string;
    type: 'go';
    request: 'launch' | 'attach';
     // Standard VSCode Go debug configuration properties
    program?: string;
    args?: string[];
    env?: { [key: string]: string };
    cwd?: string;
    mode?: 'debug' | 'test' | 'exec' | 'core' | 'replay' | 'connect' | 'local' | 'remote';
    buildFlags?: string;  // Changed from array to string for VSCode compatibility
    dlvFlags?: string[];
    showLog?: boolean;
    trace?: string;       // VSCode Go extension uses 'trace' instead of 'logOutput'
    stopOnEntry?: boolean;
    host?: string;
    port?: number;
    processId?: string | number;
    substitutePath?: { from: string; to: string }[];
    remotePath?: string;
    
    // Internal editor properties (not saved to launch.json)
    runMode?: 'file' | 'package' | 'directory' | 'module' | 'workspace';
    packagePath?: string;
    mainFile?: string;
    workingDir?: string;
    vscWorkspaceFolder: string;
    vscWorkspaceName: string;
    itemName: string;
}
 