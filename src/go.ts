import { spawn } from "child_process";
import * as cp from 'child_process';

import * as path from 'path';

import * as fs from 'fs';

import vscode = require('vscode');
import { GoDebugOutputProvider } from './goDebugOutputProvider';

import { GoDebugConfiguration } from './goDebugConfigurationProvider';




export class GoClient {


  private dlvPath: string = "";
  private dlvMode: 1 | 2 = 1; // 1 for general, 2 for enhancement;
  private goRoot: string | "";
  private goPath: string | "";
  private goBinaryPath: string | "";

  private getDlvPath(goPath: string, goRoot: string) {
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
          return;
        }
      } catch { }
    }

    if (goPath) {
      const candidate = `${goPath}/bin/dlv2`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 1;
        }
      } catch { }
    }

    if (goRoot) {
      const candidate = `${goRoot}/bin/dlv`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 2;
          return;
        }
      } catch { }
    }

    if (goPath) {
      const candidate = `${goPath}/bin/dlv`;
      try {
        if (fs.existsSync(candidate)) {
          this.dlvPath = candidate;
          this.dlvMode = 1;
          return;
        }
      } catch { }
    }
    return;
  }
  constructor(goPath: string, goRoot: string) {
    this.goPath = goPath;
    this.goRoot = goRoot;
    this.goBinaryPath = "";
    this.getDlvPath(goPath, goRoot);
    
  }

  public getDlvMode(): 1 | 2 {
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


  public getGoBinaryPath(): string {
    if (!this.goBinaryPath) {
      this.goBinaryPath = this.findGoBinary();
    }
    return this.goBinaryPath;
  }


  private findGoBinary(): string {
    var goRoot = this.goRoot;
    if (goRoot) {
      const goBinary = path.join(goRoot, 'bin', process.platform === 'win32' ? 'go.exe' : 'go');
      if (fs.existsSync(goBinary)) {
        return goBinary;
      }
    }
    let goPath = 'go';
    if (process.platform === 'win32') {
      goPath = 'go.exe';
    }
    if (process.env.GOROOT) {
      const goBinary = path.join(process.env.GOROOT, 'bin', goPath);
      if (fs.existsSync(goBinary)) {
        return goBinary;
      }
    }
    return goPath;

  }


  public async build(
    absoluteBinaryPath: string,
    safeOriginalConfig: GoDebugConfiguration,
    mode: 'run' | 'debug',
    outputChannel: vscode.OutputChannel

  ) {
    // Determine source directory and binary details
    let sourceDir = safeOriginalConfig.vscWorkspaceFolder || '';
    let sourcePath = '.';

    if (safeOriginalConfig.program) {
      let programPath = safeOriginalConfig.program;

      // Handle ${workspaceFolder} replacement
      if (programPath.includes('${workspaceFolder}')) {
        programPath = programPath.replace('${workspaceFolder}', sourceDir);
      }

      // If program path is relative, make it absolute
      if (!path.isAbsolute(programPath)) {
        programPath = path.resolve(sourceDir, programPath);
      }

      // Determine source directory (where we'll run go build)
      if (programPath.endsWith('.go')) {
        // Single file: /path/to/main.go -> /path/to
        sourceDir = path.dirname(programPath);
        sourcePath = path.basename(programPath);
      } else {
        // Package/directory: /path/to/cmd/myapp -> /path/to/cmd/myapp
        sourceDir = programPath;
        sourcePath = '.';
      }
    }


    outputChannel.appendLine(`📂 Source directory: ${sourceDir}`);
    outputChannel.appendLine(`📄 Source path: ${sourcePath}`);
    outputChannel.appendLine(`🎯 Absolute binary path: ${absoluteBinaryPath}`);

    // Step 1 & 2: Build the binary
    outputChannel.appendLine(`\n Step 1-2 - Building Go application...`);
    outputChannel.appendLine(`echo "🔨 Building Go application..."`);

    const buildArgs = ['build'];
    if (mode === 'debug') {
      // 没有 -N -l 参数， 新加 
      const hasNoOpt = buildArgs.some(arg => arg.includes('-gcflags'));
      if (!hasNoOpt) {
        buildArgs.push('-gcflags="all=-N -l"');
      }
    }

    // Add build flags if any
    if (safeOriginalConfig.buildFlags) {
      buildArgs.push(...safeOriginalConfig.buildFlags.split(' ').filter((flag: string) => flag.trim()));
      outputChannel.appendLine(`🔧 Added build flags: ${safeOriginalConfig.buildFlags}`);
    }

    // Add output and source
    buildArgs.push('-o', absoluteBinaryPath, sourcePath);

    const buildCommand = buildArgs.join(' ');

    // Execute build process
    const buildStartTime = Date.now();

    // Create tab for this configuration in the output panel early
    GoDebugOutputProvider.Output(
      `🔨 Starting build for: ${safeOriginalConfig.name}`,
      safeOriginalConfig.itemName
    );

    // Show the Go Debug output panel and focus on it
    vscode.commands.executeCommand('workbench.view.extension.goDebugPanel').then(() => {
      // Small delay to ensure panel is shown before focusing the view
      setTimeout(() => {
        vscode.commands.executeCommand('goDebugOutput.focus');
      }, 100);
    });

    const goBinary = this.getGoBinaryPath();
    GoDebugOutputProvider.Output(`Using Go binary: ${goBinary} ${buildArgs.join(' ')}`, safeOriginalConfig.itemName);
    const buildProcess = cp.exec(`"${goBinary}" ${buildArgs.join(' ')}`, {
      cwd: sourceDir,
      env: { ...process.env, ...(safeOriginalConfig.env || {}) }
    });

    buildProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      outputChannel.append(output);

      // Send build output to the dedicated tab
      const lines = output.split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          GoDebugOutputProvider!.Output(`🔨 ${line}`, safeOriginalConfig.itemName);
        }
      });

    });

    buildProcess.stderr?.on('data', (data) => {
      const error = data.toString();
      outputChannel.append(error);

      // Send build errors to the dedicated tab

      const lines = error.split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) {
          if (line.length < 600) {
            // 跳转到对应的文件和行号
            const columns = line.split(":");
            var filePath = columns[0];
            // 如果 filePath 不是绝对路径， 则基于 program 进行拼接
            if (!path.isAbsolute(filePath)) {
              if (safeOriginalConfig.program && safeOriginalConfig.program !== "") {
                var programPath = safeOriginalConfig.program;
                if (programPath.includes('${workspaceFolder}')) {
                  programPath = programPath.replace('${workspaceFolder}', safeOriginalConfig.vscWorkspaceFolder || '');
                }
                if(programPath.endsWith('.go')) {
                  programPath = path.dirname(programPath);
                }
                filePath = path.join(programPath, filePath);
              }
              // 还是不是绝对路径， 基于 vscode workspace folder 进行拼接
              if(!filePath.startsWith(safeOriginalConfig.vscWorkspaceFolder)) {
                filePath = path.join(safeOriginalConfig.vscWorkspaceFolder || "", filePath);
              }
            }


            const lineNumber = parseInt(columns[1], 10) || 0;
            var colNumber = 0;
            if (columns.length > 2 && columns[2]) {
              // 不是数字时候，默认0
              colNumber = parseInt(columns[2], 10) || 0;
            }
            //判断文件是否存在
            if (fs.existsSync(filePath)) {
              line = `<span onClick="goSourceFile('${filePath}', ${lineNumber}, ${colNumber})" class="output-content-line-link">${line}</span>`;
            }  


          }  
          GoDebugOutputProvider!.Output(`❌ Build Error: ${line}`, safeOriginalConfig.itemName);
           
        }
      });

    });

    await new Promise<void>((resolve, reject) => {
      buildProcess.on('exit', (code) => {
        const buildDuration = Date.now() - buildStartTime;
        if (code === 0) {
          outputChannel.appendLine(`✅ Build completed successfully`);

          // Send build success to the dedicated tab
          GoDebugOutputProvider.Output(
            `✅ Build completed successfully in ${buildDuration}ms`,
            safeOriginalConfig.itemName
          );

          resolve();
        } else {
          const errorMsg = `Build failed with exit code ${code}`;
          outputChannel.appendLine(`❌ ${errorMsg}`);

          // Send build failure to the dedicated tab
          GoDebugOutputProvider.Output(`❌ ${errorMsg}`, safeOriginalConfig.itemName);

          reject(new Error(errorMsg));
        }
      });
    });

    // Step 3: Determine working directory
    let workingDir = sourceDir; // Default to source directory
    if (safeOriginalConfig.cwd) {
      workingDir = safeOriginalConfig.cwd.replace('${workspaceFolder}', sourceDir);
      outputChannel.appendLine(`📂 Step 3 - Working directory: ${workingDir}`);
    } else {
      outputChannel.appendLine(`📁 Step 3 - Using source directory as working directory: ${workingDir}`);
    }
  }

}
