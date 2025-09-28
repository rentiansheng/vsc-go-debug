import * as vscode from 'vscode';
import { DelveClient } from './delveClient';

/**
 * 配置状态定义
 */
export interface ConfigState {
    name: string;
    action: 'debug' | 'run';
    state: 'running' | 'stopped' | 'starting' | 'stopping';
    process?: any;
    startTime?: Date;
    endTime?: Date;
    session?: vscode.DebugSession; 
}

/**
 * 状态变化事件
 */
export interface StateChangeEvent {
    configName: string;
    oldState?: ConfigState;
    newState: ConfigState;
    timestamp: Date;
}

/**
 * 全局状态管理器
 * 管理所有配置的运行状态，提供事件通知机制
 */
export class GlobalStateManager {
    private static instance: GlobalStateManager;
    private stateMap = new Map<string, ConfigState>();
    private eventEmitter = new vscode.EventEmitter<StateChangeEvent>();
    
    // 事件订阅接口
    public readonly onStateChange = this.eventEmitter.event;
    
    private constructor() {}
    
    public static getInstance(): GlobalStateManager {
        if (!GlobalStateManager.instance) {
            GlobalStateManager.instance = new GlobalStateManager();
        }
        return GlobalStateManager.instance;
    }
    
    /**
     * 设置配置状态
     */
    public setState(configName: string, action: 'debug' | 'run', state: 'running' | 'stopped' | 'starting' | 'stopping', process?: any, session?: vscode.DebugSession): void {
        const oldState = this.stateMap.get(configName);
        if(!session && oldState && oldState.session && (state !== 'stopped' && state === 'stopping')) {
            session = oldState.session;
        }
        const newState: ConfigState = {
            name: configName,
            action,
            state,
            process,
            startTime: state === 'starting' || state === 'running' ? new Date() : oldState?.startTime,
            endTime: state === 'stopped' ? new Date() : undefined,
            session
        };
        
        this.stateMap.set(configName, newState);
        
        // 触发状态变化事件
        const event: StateChangeEvent = {
            configName,
            oldState,
            newState,
            timestamp: new Date()
        };
        
        console.log(`[GlobalStateManager] State change for ${configName}:`, {
            from: oldState?.state || 'none',
            to: newState.state,
            action: newState.action
        });
        
        this.eventEmitter.fire(event);
    }
    
    /**
     * 获取配置状态
     */
    public getState(configName: string): ConfigState | undefined {
        return this.stateMap.get(configName);
    }
    
    /**
     * 获取所有状态
     */
    public getAllStates(): Map<string, ConfigState> {
        return new Map(this.stateMap);
    }
    
    /**
     * 检查配置是否正在运行
     */
    public isRunning(configName: string): boolean {
        const state = this.stateMap.get(configName);
        return state?.state === 'running' || state?.state === 'starting';
    }
    
    /**
     * 检查配置是否已停止
     */
    public isStopped(configName: string): boolean {
        const state = this.stateMap.get(configName);
        return !state || state.state === 'stopped';
    }
    
    /**
     * 获取正在运行的配置列表
     */
    public getRunningConfigs(): ConfigState[] {
        return Array.from(this.stateMap.values()).filter(state => 
            state.state === 'running' || state.state === 'starting'
        );
    }
    
    /**
     * 停止配置
     */
    public stopConfig(configName: string): void {
        const currentState = this.stateMap.get(configName);
        if (currentState && (currentState.state === 'running' || currentState.state === 'starting')) {
            this.setState(configName, currentState.action, 'stopping', currentState.process);
            
            // 尝试终止进程
            if (currentState.process) {
                try {
                    if (typeof currentState.process.kill === 'function') {
                        currentState.process.kill();
                    } else if (typeof currentState.process.terminate === 'function') {
                        currentState.process.terminate();
                    }
                } catch (error) {
                    console.error(`[GlobalStateManager] Failed to kill process for ${configName}:`, error);
                }
            }
            
            // 设置为已停止状态
            setTimeout(() => {
                this.setState(configName, currentState.action, 'stopped');
            }, 500);
        }
    }
    
    /**
     * 清理已停止的配置状态
     */
    public cleanup(): void {
        const toRemove: string[] = [];
        this.stateMap.forEach((state, name) => {
            if (state.state === 'stopped' && state.endTime) {
                const timeSinceEnd = Date.now() - state.endTime.getTime();
                // 清理5分钟前停止的配置
                if (timeSinceEnd > 5 * 60 * 1000) {
                    toRemove.push(name);
                }
            }
        });
        
        toRemove.forEach(name => {
            this.stateMap.delete(name);
            console.log(`[GlobalStateManager] Cleaned up old state for ${name}`);
        });
    }
    
    /**
     * 重置所有状态
     */
    public resetAll(): void {
        this.stateMap.clear();
        console.log('[GlobalStateManager] All states reset');
    }
    
    /**
     * 销毁实例
     */
    public dispose(): void {
        this.eventEmitter.dispose();
        this.stateMap.clear();
    }
}
