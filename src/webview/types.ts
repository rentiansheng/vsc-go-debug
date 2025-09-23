import { DebugProtocol } from 'vscode-debugprotocol';

export interface Variable {
  name: string;
  value: string;
  type: string;
  // 在 debug Adapter 中对应 DebugProtocol.Variable 的 variablesReference， 表示可以展开的子变量引用
  variablesReference?: number;
  // 在 debug Adapter 中对应 DebugProtocol.Variable 的 variablesReferenceCount，表示子变量的数量，
  variablesReferenceCount?: number;
  indexedVariables?: number;
  namedVariables?: number;
  presentationHint?: {
    kind?: string;
    attributes?: string[];
    visibility?: string;
  };
  addr?: number;
}

export interface VariableTreeNode extends Variable {
  children?: VariableTreeNode[];
}



export interface StackFrame {
  id: number;
  name: string;
  source?: {
    name?: string;
    path?: string;
    sourceReference?: number;
  };
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  presentationHint?: string;
  title?: string;
}

export interface SessionInfo {
  action: 'debug' | 'run';
  state: 'running' | 'stopped' | 'starting' | 'stopping';
  process?: {
    pid: number;
  };
  session?: any;
  startTime?: Date;
  endTime?: Date;
}

export interface TabData {
  name: string;
  active: boolean;
  logs: string[];
  variables: VariableTreeNode[];
  stack: {
    stackFrames: StackFrame[];
    totalFrames: number;
  };
  sessionInfo?: SessionInfo;
}

export interface WebviewMessage {
  command: string;
  tabName?: string;
  content?: string;
  variables?: Variable[];
  stack?: {
    stackFrames: StackFrame[];
    totalFrames: number;
  };
  scopes?: Scope[];
  sessionInfo?: SessionInfo;
  action?: string;
  path?: string;
  line?: number;
  column?: number;
  variablesReference?: number;
  args?: any;
  newTitle?: string;
  startTime?: string;
  duration?: string;
  stackFrames?: StackFrame[];
  totalFrames?: number;
  child?: boolean;
  arguments?: any;
}

export interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
  }
}
export interface Scope  {
  stackFrames?: StackFrame[];
  totalFrames?: number;
  child?: boolean;
  arguments?: any;
}

export interface VSCodeAPI {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare global {
  interface Window {
    acquireVsCodeApi(): VSCodeAPI;
  }
}
