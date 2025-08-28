import { spawn, ChildProcess } from "child_process";
import * as net from "net";

let nextId = 1;

export class DelveClient {
  private proc: ChildProcess | null = null;
  private conn: net.Socket | null = null;
  private pending: Map<number, (res: any) => void> = new Map();
  public activeThreadId = 0;
  public activeFrameId = 0;

  async start(program: string) {
    // 启动 delve 调试器
    this.proc = spawn("dlv", [
      "debug",
      program,
      "--headless",
      "--listen=:2345",
      "--api-version=2",
      "--accept-multiclient"
    ]);
    
    this.proc.stdout?.on("data", d => console.log("dlv:", d.toString()));
    this.proc.stderr?.on("data", d => console.error("dlv err:", d.toString()));

    // 等待 delve 启动
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // 连接到 delve
    this.conn = net.createConnection(2345, "127.0.0.1");
    this.conn.on("data", chunk => {
      try {
        const lines = chunk.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          const res = JSON.parse(line);
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
  }

  stop() { 
    this.proc?.kill(); 
    this.conn?.end(); 
  }

  private send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.conn) {
        reject(new Error("No connection to delve"));
        return;
      }

      const id = nextId++;
      const msg = JSON.stringify({ id, method, params }) + "\n";
      
      this.conn.write(msg);
      
      // 添加超时机制
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Request timeout"));
      }, 10000);

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

  // 设置断点（支持条件断点和 hit count）
  async setBreakpoints(file: string, bps: any[]) {
    const results = [];
    for (const bp of bps) {
      try {
        const args = [`${file}:${bp.line}`];
        if (bp.condition) args.push(`-cond=${bp.condition}`);
        if (bp.hitCondition) args.push(`-count=${bp.hitCondition}`);
        
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
