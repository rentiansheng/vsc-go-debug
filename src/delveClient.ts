import { spawn, ChildProcess } from "child_process";
import * as net from "net";
import * as fs from 'fs';
import { EventEmitter } from 'events';
import * as vscode  from  "vscode";
import { DAPProtocol } from './struct';

 
 
  
let nextId = 1;

export class DelveClient extends EventEmitter {
  private proc: ChildProcess | null = null;
  private pending: Map<number, (res: any) => void> = new Map();
  public activeThreadId = 0;
  public activeFrameId = 0;
  private dlvPath: string;
  private port: number = 2345; // 默认端口
  private host: string = "127.0.0.1";
  private args: string[] = [];
  private binaryArgs : string[] = [];
  private extraArgs: {} = {};
  private isReady: boolean = false;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private dlvSocket: net.Socket | null = null;
  

  public getDlvPath(): string {
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


  private async getAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, () => {
                const port = (server.address() as net.AddressInfo).port;
                server.close(() => resolve(port));
            });
            server.on('error', reject);
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

  public getSocket(): net.Socket | null {
    return this.dlvSocket;
  }



  public IsReady(): boolean {
    return this.isReady;
  }

  

  async start(program: string, runName: string, args: string[], workingDir: string, execEnv: NodeJS.ProcessEnv) {
    try {
      this.port = await this.getAvailablePort();
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
      
      // --listen=127.0.0.1:0,你需要先从 stderr 里读取实际端口号，然后再去 net.createConnection。

      this.args =  [
        "dap",
        //"--headless",
        `--listen=${this.address()}`,
        "--check-go-version=false",
        //"--accept-multiclient",
        //"--api-version=2",
        //"--accept-multiclient=true",
        "--log",
        "--log-output=dap",
        //"--log-dest=2"  // 将日志输出到 stderr，便于调试
      ];

      this.binaryArgs = args || [];
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
        for (const line of output.split('\n')) {
          if (line.includes('API server listening at:') || 
              line.includes('listening at:') ||
              line.includes('DAP server listening at:')) {
            this.isReady = true;
            console.log("Delve is ready!");
            this.emit('ready');
          }  else if (line.includes('layer=dap [-> to client]')) {

                const jsonPart = line.substring(line.indexOf('{'));
                try {
                  const msg: DAPProtocol = JSON.parse(jsonPart);
                  if(!msg) {
                    console.warn("Received non-JSON DAP message:", line);
                    continue;
                  }
                  // {"seq":0,"type":"response","request_seq":11,"success":true,"command":"stackTrace","body":{"stackFrames":[{"id":1001,"name":"runtime.main","source":{"name":"proc.go","path":"/usr/local/go/src/runtime/proc.go"},"line":250,"column":0,"instructionPointerReference":"0x102718b4c","presentationHint":"subtle"},{"id":1002,"name":"runtime.goexit","source":{"name":"asm_arm64.s","path":"/usr/local/go/src/runtime/asm_arm64.s"},"line":1172,"column":0,"instructionPointerReference":"0x102743414","presentationHint":"subtle"}],"totalFrames":3}}
                  // {"seq":0,"type":"response","request_seq":17,"success":true,"command":"variables","body":{"variables":[]}}
                  // {"seq":0,"type":"event","event":"stopped","body":{"reason":"breakpoint","threadId":1,"allThreadsStopped":true,"hitBreakpointIds":[1]}}
                  // {"seq":0,"type":"response","request_seq":13,"success":true,"command":"next"}
                  // {"seq":0,"type":"event","event":"stopped","body":{"reason":"step","threadId":1,"allThreadsStopped":true}}
                  
                  switch (msg.type) {
                    case "event":
                      switch (msg.event) {
                        case "stopped":
                          break;
                      }
                      break;
                    case "response":

                      switch (msg.command) {
                        case "stackTrace":
                          this.emit("stackTrace", msg.body);
                          break;
                        case "variables":
                            this.emit("variables", msg.body);
                            break;
                      }

                      break;
                  }
 
                } catch (err) {
                  console.error("Failed to parse DAP JSON from stdout:", err);
                }
              
           
          }
        }
        
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
      
        var emitMsg = '';

        // 检查常见错误
        if (output.includes('permission denied')) {
          emitMsg = "Permission denied - check if binary is executable";
        } else if (output.includes('no such file')) {
          emitMsg = "Binary file not found";
        } else  if (output.includes('address already in use')) {
          emitMsg = "Port already in use";
        } else {
          emitMsg = output;
        }

        if (emitMsg) {
          this.emit('stderr', emitMsg);
        }
        console.log("Emitted stderr message:", emitMsg);
        console.log("Full stderr output:", output); 
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
    
      //this.initializeAndLaunch(program, args);

   

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
        
 
     

      
 

      
    await this.connectToDelveClientDap();
    if(!this.dlvSocket) {
      this.stop();
    }
    
    
    // DAP 请求发送完成，extension 现在控制调试会话
    } catch(error) {
        console.error("Failed to start delve:", error); 
        this.stop();
    }
  }

 
 
  private async connectToDelveClientDap(): Promise<void> {
		const host = this.host;
		const port = this.port;
		return new Promise((resolve, reject) => {
			let retryCount = 0;
			const maxRetries = 5;
			let resolved = false;

			const tryConnect = () => {

				let dlvSocket = net.connect(port, host);

				dlvSocket.on('connect', () => {
					console.log(`Connected to DelveClient DAP at ${host}:${port}`);
					if (!resolved) {
						resolved = true;
            this.dlvSocket = dlvSocket;
						resolve();
					}
				});

				dlvSocket.on('data', (data) => {
					const msg = data.toString();
					console.log('DelveClient DAP received:', msg);
					this.emit('dapData', msg);
				});

				dlvSocket.on('error', (err) => {
					console.error('DelveClient DAP socket error:', err);
					
					// 清理当前连接
					if (this.dlvSocket) {
						this.dlvSocket.removeAllListeners();
						this.dlvSocket.destroy();
						this.dlvSocket = null;
					}
					
					if (!resolved) {
						retryCount++;
						if (retryCount < maxRetries) {
							console.log(`Retrying connection (${retryCount}/${maxRetries})...`);
							setTimeout(tryConnect, 500);
						} else {
							resolved = true;
							reject(new Error(`Failed to connect to DelveClient DAP after ${maxRetries} retries`));
						}
					}
				});

				dlvSocket.on('close', () => {
					console.log('DelveClient DAP socket closed');
					if (this.dlvSocket) {
						this.dlvSocket.removeAllListeners();
						this.dlvSocket = null;
					}
					
					// 只有在连接建立后才停止服务
					if (resolved) {
						this.emit('disconnected');
						// 不要自动调用 stop()，让调用者决定如何处理断开连接
					}
				});

				// 设置连接超时
				dlvSocket.setTimeout(5000);
				dlvSocket.on('timeout', () => {
          if (resolved) {
            return;
          }
					console.error('DelveClient DAP connection timeout');
					if (dlvSocket) {
						dlvSocket.destroy();
					}
				});
			};

			tryConnect();
		});
	}
 
 
  private startKeepAlive() {
    // 在 DAP 模式下，我们不发送心跳请求，因为 VS Code 会处理所有 DAP 通信
    // 只是定期检查连接状态
    this.keepAliveInterval = setInterval(() => {
      if (this.dlvSocket && this.isReady && this.proc && !this.proc.killed && this.proc.exitCode === null) {
        console.log("🟢 DAP connection and process are alive");
      } else {
        console.log("🔴 DAP connection or process issues detected");
        // 如果进程已经退出，停止心跳
        if (this.proc && (this.proc.killed || this.proc.exitCode !== null)) {
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

  public stop() { 
    console.log("Stopping delve client...");
    this.isReady = false;
    
    // 停止心跳
    this.stopKeepAlive();
    
    if (this.dlvSocket) {
      this.dlvSocket.destroy();
      this.dlvSocket = null;
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

 

   
 
  private isProcessRunning(processId: string): boolean {
    try {
      // 在 Unix 系统上，使用 kill -0 检查进程是否存在
      process.kill(parseInt(processId), 0);
      return true;
    } catch (error) {
      return false;
    }
  }
}
