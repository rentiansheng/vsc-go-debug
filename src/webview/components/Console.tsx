import React, { useEffect, useRef } from 'react';

interface ConsoleProps {
  logs: string[];
  tabName: string;
}

export const Console: React.FC<ConsoleProps> = ({ logs, tabName }) => {
  const consoleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  if (!logs || logs.length === 0) {
    return (
      <div className="console-output">
        <div className="empty-state">
          No debug output yet for this configuration.
        </div>
      </div>
    );
  }

  return (
    <div className="console-output" ref={consoleRef}>
      {logs.map((log, index) => (
        <div key={index} className="log-line">
          {log}
        </div>
      ))}
    </div>
  );
};
