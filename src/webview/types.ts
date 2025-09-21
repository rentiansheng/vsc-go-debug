export interface Variable {
  name: string;
  value: string;
  type: string;
  variablesReference?: number;
  indexedVariables?: number;
  namedVariables?: number;
  presentationHint?: {
    kind?: string;
    attributes?: string[];
    visibility?: string;
  };
  addr?: number;
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
  variables: Variable[];
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
