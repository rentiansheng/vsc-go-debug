import React from 'react';
import { SessionInfo, VSCodeAPI } from '../types';

interface ToolbarProps {
  tabName: string;
  sessionInfo?: SessionInfo;
  currentView: 'console' | 'variables';
  onViewSwitch: (view: 'console' | 'variables') => void;
  vscode: VSCodeAPI;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  tabName,
  sessionInfo,
  currentView,
  onViewSwitch,
  vscode
}) => {
  const isRunning = sessionInfo && (
    sessionInfo.state === 'running' || 
    sessionInfo.state === 'starting'
  );
  const isDebugSession = sessionInfo?.action === 'debug';

  const handleAction = (action: string) => {
    vscode.postMessage({
      command: 'toolbarAction',
      action: action,
      tabName: tabName
    });
  };

  const ToolbarButton: React.FC<{
    action: string;
    title: string;
    icon: string;
    disabled?: boolean;
    primary?: boolean;
    visible?: boolean;
  }> = ({ action, title, icon, disabled = false, primary = false, visible = true }) => {
    if (!visible) return null;
    
    return (
      <button
        className={`toolbar-button ${primary ? 'primary' : ''}`}
        onClick={() => handleAction(action)}
        disabled={disabled}
        title={title}
      >
        <span className={`codicon ${icon}`}></span>
      </button>
    );
  };

  return (
    <div className="toolbar" data-tab={tabName}>
      <div className="toolbar-buttons">
        <ToolbarButton
          action="stop"
          title="Stop"
          icon="codicon-debug-stop"
          disabled={!isRunning}
          visible={isRunning}
        />
        <ToolbarButton
          action="run"
          title="Run"
          icon="codicon-play"
          primary={true}
          disabled={isRunning}
          visible={!isRunning}
        />
        <ToolbarButton
          action="debug"
          title="Debug"
          icon="codicon-debug-alt"
          primary={true}
          disabled={isRunning}
          visible={!isRunning}
        />
        <ToolbarButton
          action="restart"
          title="Restart"
          icon="codicon-debug-restart"
          disabled={!isRunning}
          visible={isRunning}
        />
        <ToolbarButton
          action="redebug"
          title="Redebug"
          icon="codicon-debug-restart"
          disabled={!isRunning}
          visible={isRunning}
        />
        
        <span className="toolbar-separator"></span>
        
        <ToolbarButton
          action="continue"
          title="Continue"
          icon="codicon-debug-continue"
          disabled={!isRunning}
          visible={isDebugSession}
        />
        <ToolbarButton
          action="stepOver"
          title="Step Over"
          icon="codicon-debug-step-over"
          disabled={!isRunning}
          visible={isDebugSession}
        />
        <ToolbarButton
          action="stepInto"
          title="Step Into"
          icon="codicon-debug-step-into"
          disabled={!isRunning}
          visible={isDebugSession}
        />
        <ToolbarButton
          action="stepOut"
          title="Step Out"
          icon="codicon-debug-step-out"
          disabled={!isRunning}
          visible={isDebugSession}
        />

        <span className="toolbar-separator"></span>

        <span className="view-tabs">
          <button className={`view-tab ${currentView === 'variables' ? 'active' : ''}`} onClick={() => onViewSwitch('variables')}>Variables & Stack</button>
          <button className={`view-tab ${currentView === 'console' ? 'active' : ''}`} onClick={() => onViewSwitch('console')}>Console</button>
        </span>
      </div>
    </div>
  );
};
