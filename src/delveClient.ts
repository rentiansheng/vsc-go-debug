import { spawn } from "child_process";
 
import * as fs from 'fs';
 
 
 
 
  
 

export class DelveClient   {
 
 
  private dlvPath: string = "";
  private dlvMode: 1|2 = 1; // 1 for general, 2 for enhancement;
 

  private getDlvPath(goPath: string, goRoot: string )  {
    let dlvPath = "dlv"; // 默认假设 dlv 在 PATH 中
    // 通过环境变量中 GOPATH 和 GOROOT 查找 dlv
    if (!goPath && process.env.GOPATH) {
      goPath = process.env.GOPATH;
    }
    if (!goRoot && process.env.GOROOT) {
      goRoot = process.env.GOROOT;
    }

     if (goRoot) {
      const candidate = `${goRoot}/bin/dlv2`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 2;
          return ;
        }
      } catch {}
    }

     if (goPath) {
      const candidate = `${goPath}/bin/dlv2`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 1;
        }
      } catch {}
    }

    if (goRoot) {
      const candidate = `${goRoot}/bin/dlv`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 2;
          return ;
        }
      } catch {}
    }

     if (goPath) {
      const candidate = `${goPath}/bin/dlv`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 1;
          return ;
        }
      } catch {}
    }
    return  ;
  }
  constructor(goPath: string, goRoot: string) {
    this.getDlvPath(goPath, goRoot);
  }

  public getDlvMode(): 1|2 {
    return this.dlvMode;
  }

  public getDlvExecutablePath(): string {
    return this.dlvPath;
  }

  private async checkDlvExists(): Promise<boolean> {
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
      const data = fs.readFileSync(binaryPath);
      const content = data.subarray(0, Math.min(1024, data.length)).toString('binary');
      
      // 检查是否包含 Go 运行时信息
      if (!content.includes('runtime.') && !content.includes('go.') && !content.includes('Go ')) {
        console.warn(`Warning: ${binaryPath} may not be a Go binary (no Go runtime signatures found)`);
      }
    } catch (error) {
      console.warn(`Warning: Could not read binary file for validation: ${error}`);
    }
    
    return { valid: true };
  } 

 
  
}
