declare module 'json-rpc2' {
    import { EventEmitter } from 'events';

    export interface RPCConnection extends EventEmitter {
        on(event: 'connect', listener: () => void): this;
        on(event: 'error', listener: (error: Error) => void): this;
        on(event: 'close', listener: (hadError: boolean) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
        
        // Connection properties
        conn?: any;
        
        // RPC methods
        call<T = any>(method: string, params?: any, callback?: (error: any, result: T) => void): void;
        call<T = any>(method: string, params?: any): Promise<T>;
    }

    export interface ClientBuilder {
        connectSocket(): RPCConnection;
    }

    export class Client {
        static $create(port: number, host: string): ClientBuilder;
    }
}
