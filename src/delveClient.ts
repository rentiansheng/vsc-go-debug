import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as fs from 'fs';
import { EventEmitter } from 'events';

let nextId = 1;

export class DelveClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private conn: net.Socket | null = null;
  private pending: Map<number, (res: any) => void> = new Map();
  public activeThreadId = 0;
  public activeFrameId = 0;
  private dlvPath: string;
  private port: number = 2345; // 默认端口
  private host: string = "127.0.0.1";
  private args: string[] = [];
  private extraArgs: {} = {};
  private isReady: boolean = false;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  private getDlvPath(): string {
    let dlvPath = "dlv"; // 默认假设 dlv 在 PATH 中
    // 通过环境变量中 GOPATH 和 GOROOT 查找 dlv
    const goPath = process.env.GOPATH;
    const goRoot = process.env.GOROOT;
   
    if (goRoot) {
      const candidate = `${goRoot}/bin/dlv`;
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {}
    }

     if (goPath) {
      const candidate = `${goPath}/bin/dlv`;
      try {
        if (fs.existsSync(candidate)) {
          dlvPath = candidate;
        }
      } catch {}
    }
    return dlvPath;
  }


  public async checkDlvExists(): Promise<boolean> {
    // Check if dlv is available
    try {
      return new Promise<boolean>((resolve, reject) => {
        const checkDlv = spawn(this.dlvPath, ['version'], { stdio: 'pipe' });
        checkDlv.on('exit', (code) => {
          if (code === 0) {
            resolve(true);
          } else {
            resolve(false);
          }
        });
        checkDlv.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
       return false;
    }
  } 

  // 验证二进制文件是否适合调试
  public static validateBinaryForDebugging(binaryPath: string): { valid: boolean, error?: string } {
    // 检查文件是否存在
    if (!fs.existsSync(binaryPath)) {
      return { valid: false, error: `Binary file does not exist: ${binaryPath}` };
    }
    
    // 检查文件权限
    try {
      fs.accessSync(binaryPath, fs.constants.F_OK | fs.constants.R_OK | fs.constants.X_OK);
    } catch (error) {
      return { valid: false, error: `Binary file is not executable: ${binaryPath}` };
    }
    
    // 检查文件是否为空
    const stats = fs.statSync(binaryPath);
    if (stats.size === 0) {
      return { valid: false, error: `Binary file is empty: ${binaryPath}` };
    }
    
    // 检查是否为 Go 二进制文件（基本检查）
    try {
      const fd = fs.openSync(binaryPath, 'r');
      const buffer = Buffer.alloc(1024);
      fs.readSync(fd, buffer, 0, 1024, 0);
      fs.closeSync(fd);
      const content = buffer.toString('binary');
      
      // 检查是否包含 Go 运行时信息
      if (!content.includes('runtime.') && !content.includes('go.') && !content.includes('Go ')) {
        console.warn(`Warning: ${binaryPath} may not be a Go binary (no Go runtime signatures found)`);
      }
    } catch (error) {
      console.warn(`Warning: Could not read binary file for validation: ${error}`);
    }
    
    return { valid: true };
  } 

  public getProc(): ChildProcess | null {
    return this.proc;
  }


  constructor() {
    super();
    this.dlvPath = this.getDlvPath();
    console.log("Using dlv at:", this.dlvPath);
  }


  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to get free port')));
        }
      });
      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public address(): string {
    return `${this.host}:${this.port}`;
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  public getArgs(): string[] {
    return this.args;
  }

  public getExtraArgs(): {} {
    return this.extraArgs;
  }

  public getProcess(): ChildProcess | null {
    return this.proc;
  }



  public IsReady(): boolean {
    return this.isReady;
  }

  

  async start(program: string, args: string[], workingDir: string, execEnv: NodeJS.ProcessEnv) {
    try {
      this.port = await this.findFreePort();
      console.log("=== Delve Startup Debug Info ===");
      console.log("Starting dlv on port:", this.port);
      console.log("Program to debug:", program);
      console.log("Working directory:", workingDir);
      console.log("Arguments:", args);
      console.log("Environment variables:", Object.keys(execEnv).length);
      
      // 检查二进制文件是否存在和可执行
      if (!fs.existsSync(program)) {
        throw new Error(`Binary file does not exist: ${program}`);
      }
      
      // 检查文件权限
      try {
        fs.accessSync(program, fs.constants.F_OK | fs.constants.X_OK);
        console.log("Binary file exists and is executable ✓");
      } catch (error) {
        throw new Error(`Binary file is not executable: ${program} - ${error}`);
      }
      
      this.args =  [
        "dap",
        `--listen=${this.address()}`,
        "--check-go-version=false",
        "--log",
        "--log-output=debugger,dap",
        "--log-dest=2"  // 将日志输出到 stderr，便于调试
      ];
            // 为 dap 命令设置环境变量
      const dapEnv = {
        ...execEnv,
        'DLV_DAP_EXEC_PATH': program
      };

      
      // dap 命令不需要预设程序路径，VS Code 会通过 DAP 协议发送
      console.log("Full dlv command:", this.dlvPath, this.args.join(' '));

      this.extraArgs =  {
        cwd: workingDir,
        env: dapEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      };
      
      this.isReady = false;
      
      // 启动 delve 调试器
      console.log("Spawning dlv process...");
      this.proc = spawn(this.dlvPath, this.args, this.extraArgs);

      this.proc.stdout?.on("data", d => {
        const output = d.toString();
        console.log("dlv stdout:", output);
        
        // 检查多种可能的就绪信号
        if(!this.isReady && (
          output.includes('API server listening at:') || 
          output.includes('listening at:') ||
          output.includes('DAP server listening at:')
        )) {
          this.isReady = true;
          console.log("Delve is ready!");
          this.emit('ready');
        }
        this.emit('stdout', output);
      });
    
      this.proc.stderr?.on("data", d => {
        const output = d.toString();
        console.error("dlv stderr:", output);
        
        // 也检查 stderr 中的就绪信号，有时 delve 会将日志输出到 stderr
        if(!this.isReady && (
          output.includes('API server listening at:') || 
          output.includes('listening at:') ||
          output.includes('DAP server listening at:')
        )) {
          this.isReady = true;
          console.log("Delve is ready (from stderr)!");
          this.emit('ready');
        }
      
        this.emit('stderr', output);
        
        // 检查常见错误
        if (output.includes('permission denied')) {
          console.error("Permission denied - check if binary is executable");
        }
        if (output.includes('no such file')) {
          console.error("Binary file not found");
        }
        if (output.includes('address already in use')) {
          console.error("Port already in use");
        }
      });

      this.proc.on('exit', (code, signal) => {
        const runtime = Date.now() - startWait;
        console.log(`Delve process exited with code: ${code}, signal: ${signal} after ${runtime}ms`);
        
        this.isReady = false;
        
        // 分析退出原因
        if (code === 0) {
          if (runtime < 5000) {
            console.log("⚠️ Delve exited quickly with code 0 - this usually means:");
            console.log("   1. Program ran to completion (no breakpoints hit)");
            console.log("   2. DAP session ended normally");
            console.log("   3. No debugging target was provided");
          } else {
            console.log("✅ Delve process exited with code 0 after " + runtime + "ms");
          }
        } else {
          console.log(`❌ Delve exited with error code ${code}`);
          if (code === 1) {
            console.log("   This usually indicates a general error or invalid arguments");
          } else if (code === 2) {
            console.log("   This usually indicates command line usage error");
          }
        }
        
        this.isReady = false;
        this.stopKeepAlive(); // 停止心跳
        this.emit('exit', code, signal);
      });

      this.proc.on('error', (error) => {
        console.error("Delve process error:", error);
        this.isReady = false;
        this.emit('error', error);
      });


     
      const maxWaitTime = 10000; // 10 seconds
      const startWait = Date.now();
        // Wait for delve to be ready or timeout
      while (!this.isReady && (Date.now() - startWait) < maxWaitTime) {
        // 检查进程是否还活着
        if (this.proc && (this.proc.killed || this.proc.exitCode !== null)) {
          console.error("Delve process died while waiting for it to be ready");
          throw new Error(`Delve process exited with code: ${this.proc.exitCode}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (!this.isReady) {
        console.error("Delve failed to start within timeout period");
        this.proc?.kill();
        throw new Error("Delve startup timeout - process may have failed to start");
      }
    
      console.log("Delve started successfully, attempting to connect...");
  
      // 连接到 delve
      this.conn = net.createConnection(this.port, this.host);
      this.conn.on("data", chunk => {
        try {
          // 判断是否链接成功， 通信息息中包含 "DAP server listening at:"
          if (!this.isReady && chunk.toString().includes("server listening at:")  ) {
            this.isReady = true;
          }
          const lines = chunk.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            console.log("Raw DAP message from delve:", line);
            const res = JSON.parse(line);
            
            // 检查是否是来自 VS Code 的 disconnect 请求
            if (res.type === 'request' && res.command === 'disconnect') {
              console.log(`🔴 VS Code sent disconnect command:`, res);
              this.emit('vs-code-disconnect', res);
            }
            
            // 检查是否是事件消息
            if (res.type === 'event') {
              console.log(`DAP Event: ${res.event}`, res.body);
              this.emit('dap-event', res);
            }
            
            if (res.id && this.pending.has(res.id)) {
              this.pending.get(res.id)?.(res);
              this.pending.delete(res.id);
            }
          }
        } catch (error) {
          console.error("Error parsing delve response:", error);
        }
      });      
      this.conn.on("error", (error) => {
        console.error("Delve connection error:", error);
      });


      // // 设置连接超时为5秒
      // this.conn.setTimeout(5000);
      // this.conn.on("timeout", () => {
      //   console.error("Delve connection timeout (5s)");
      //   this.conn?.destroy();
      //   this.proc?.kill();
      //   this.conn = null;
      // });

      console.log("Delve connection established successfully");
    
    // 设置保持连接的心跳机制
    this.startKeepAlive();
    } catch(error) {
        console.error("Failed to start delve:", error); 
        this.stop();
    }
  }

 
 

  // 诊断助手函数
  public getDiagnosticInfo(): any {
    return {
      isReady: this.isReady,
      processExists: !!this.proc,
      processKilled: this.proc?.killed,
      processExitCode: this.proc?.exitCode,
      processPid: this.proc?.pid,
      connectionExists: !!this.conn,
      connectionReadyState: this.conn?.readyState,
      host: this.host,
      port: this.port,
      dlvPath: this.dlvPath,
      lastArgs: this.args,
      lastExtraArgs: this.extraArgs
    };
  }

  // 保持连接活跃的心跳机制
  private startKeepAlive() {
    // 每30秒发送一次状态查询以保持连接活跃
    this.keepAliveInterval = setInterval(async () => {
      try {
        // 检查连接状态和进程状态
        if (this.conn && this.isReady && this.proc && !this.proc.killed && this.proc.exitCode === null) {
          // 使用专门的心跳方法，超时时间较短
          await this.pingDelve();
          console.log("Keep-alive ping successful");
        } else {
          console.log("Skip keep-alive: connection not ready or process not running");
          // 如果进程已经退出，停止心跳
          if (this.proc && (this.proc.killed || this.proc.exitCode !== null)) {
            this.stopKeepAlive();
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.log("Keep-alive ping failed, stopping heartbeat:", errorMsg);
        this.stopKeepAlive();
      }
    }, 30000);
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  public stop() { 
    console.log("Stopping delve client...");
    this.isReady = false;
    
    // 停止心跳
    this.stopKeepAlive();
    
    if (this.conn) {
      this.conn.destroy();
      this.conn = null;
    }
    
    if (this.proc && !this.proc.killed) {
      console.log("Killing delve process...");
      this.proc.kill('SIGTERM');
      
      // 如果 2 秒后还没退出，强制杀死
      setTimeout(() => {
        if (this.proc && !this.proc.killed) {
          console.log("Force killing delve process...");
          this.proc.kill('SIGKILL');
        }
      }, 2000);
    }
  }

  private send(method: string, params: any = {}, timeoutMs: number = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error("No connection to delve"));
        return;
      }

      const id = nextId++;
      const msg = JSON.stringify({ id, method, params }) + "\n";
      
      this.conn.write(msg);
      
      // 添加超时机制，允许自定义超时时间
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Request timeout"));
      }, timeoutMs);

      this.pending.set(id, res => {
        clearTimeout(timeout);
        if (res.error) {
          reject(new Error(res.error.message || "Delve error"));
        } else {
          resolve(res.result);
        }
      });
    });
  }

  // 心跳专用方法，使用更短的超时
  private async pingDelve(): Promise<any> {
    return this.send("State", {}, 3000); // 3秒超时
  }

  // 设置断点（支持条件断点和 hit count）
  async setBreakpoints(file: string, bps: any[]) {
    const results = [];
    for (const bp of bps) {
      try {
        const args = [`${file}:${bp.line}`];
        if (bp.condition) {
          args.push(`-cond=${bp.condition}`);
        }
        if (bp.hitCondition) {
          args.push(`-count=${bp.hitCondition}`);
        }
        
        const result = await this.send("CreateBreakpoint", { 
          file,
          line: bp.line,
          condition: bp.condition,
          hitCondition: bp.hitCondition,
          logMessage: bp.logMessage
        });
        results.push(result);
      } catch (error) {
        console.error(`Failed to set breakpoint at ${file}:${bp.line}:`, error);
        results.push(null);
      }
    }
    return results;
  }

  // 清除文件的所有断点
  async clearBreakpoints(file: string) {
    try {
      const breakpoints = await this.send("ListBreakpoints");
      for (const bp of breakpoints) {
        if (bp.file === file) {
          await this.send("ClearBreakpoint", { id: bp.id });
        }
      }
    } catch (error) {
      console.error("Failed to clear breakpoints:", error);
    }
  }

  async run() {
    return this.send("Command", { name: "continue" });
  }
  // 继续执行
  async continue() { 
    return this.send("Command", { name: "continue" }); 
  }

  // 单步执行
  async next() { 
    return this.send("Command", { name: "next" }); 
  }

  // 步入
  async stepIn() {
    return this.send("Command", { name: "step" });
  }

  // 步出
  async stepOut() {
    return this.send("Command", { name: "stepout" });
  }

  // 获取 goroutines 列表
  async listGoroutines(count = 50) { 
    return this.send("ListGoroutines", { count }); 
  }

  // 获取调用栈
  async stacktrace(goroutineID: number, depth = 20) { 
    return this.send("StacktraceGoroutine", { 
      id: goroutineID, 
      depth, 
      full: true 
    }); 
  }

  // 获取局部变量
  async localVariables(frame: number, goroutineID: number) { 
    return this.send("ListLocalVars", { 
      scope: { goroutineID, frame } 
    }); 
  }

  // 获取函数参数
  async functionArgs(frame: number, goroutineID: number) { 
    return this.send("ListFunctionArgs", { 
      scope: { goroutineID, frame } 
    }); 
  }

  // 表达式求值
  async eval(expr: string, scope?: { goroutineID?: number; frame?: number }) { 
    return this.send("Eval", { 
      expr, 
      scope: { 
        goroutineID: scope?.goroutineID || this.activeThreadId, 
        frame: scope?.frame || this.activeFrameId 
      } 
    }); 
  }

  // 获取变量的子项
  async listChildren(varInfo: any) { 
    return this.send("ListChildren", { 
      name: varInfo.name,
      scope: { 
        goroutineID: this.activeThreadId, 
        frame: this.activeFrameId 
      }
    }); 
  }

  // 设置变量值
  async setVariable(scope: any, symbol: string, value: string) {
    return this.send("SetVariable", {
      scope: { 
        goroutineID: scope?.goroutineID || this.activeThreadId, 
        frame: scope?.frame || this.activeFrameId 
      },
      symbol,
      value
    });
  }

  // 获取程序状态
  async getState() {
    return this.send("State");
  }

  // 重启程序
  async restart() {
    return this.send("Restart");
  }

  // 获取断点列表
  async listBreakpoints() {
    return this.send("ListBreakpoints");
  }

  // 获取寄存器信息
  async listRegisters(threadID: number) {
    return this.send("ListRegisters", { threadID });
  }
}
