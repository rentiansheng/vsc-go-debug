declare module 'tree-kill' {
    function kill(pid: number | string, signal?: string | number, callback?: (err?: Error) => void): void;
    function kill(pid: number | string, callback?: (err?: Error) => void): void;
    export = kill;
}
