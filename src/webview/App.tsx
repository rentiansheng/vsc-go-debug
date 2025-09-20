import React, { useState, useEffect, useCallback } from 'react';
import { TabData, VSCodeAPI, Variable, StackFrame } from './types';
// import './styles.css'; // Temporarily disabled - using inline styles in HTML

const App: React.FC = () => {
  const [tabs, setTabs] = useState<Map<string, TabData>>(new Map());
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<'console' | 'variables'>('console');
  const [vscode] = useState<VSCodeAPI>(() => {
    if (typeof window !== 'undefined' && window.acquireVsCodeApi) {
      return window.acquireVsCodeApi();
    }
    return {
      postMessage: (message: any) => console.log('VS Code message:', message),
      getState: () => ({}),
      setState: (state: any) => console.log('VS Code state:', state)
    };
  });

  // Handle messages from the extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      console.log('Received message:', message);
      
      switch (message.command) {
        case 'createTab':
          if (message.tabName) {
            createTab(message.tabName);
          }
          break;
          
        case 'updateOutput':
          if (message.tabName && message.content) {
            updateTabLogs(message.tabName, message.content);
          }
          break;
          
        case 'updateVariables':
          if (message.tabName && message.variables) {
            updateTabVariables(message.tabName, message.variables);
          }
          break;
          
        case 'updateStack':
          if (message.tabName && message.stack) {
            updateTabStack(message.tabName, message.stack);
          }
          break;
          
        case 'updateToolbar':
          if (message.tabName && message.sessionInfo) {
            updateTabSession(message.tabName, message.sessionInfo);
          }
          break;
          
        case 'switchTab':
          if (message.tabName) {
            setActiveTab(message.tabName);
          }
          break;
          
        case 'clearTab':
          if (message.tabName) {
            clearTab(message.tabName);
          }
          break;
          
        case 'cleanDebugInfo':
          if (message.tabName) {
            cleanDebugInfo(message.tabName);
          }
          break;
          
        case 'updateTabTitle':
          if (message.tabName && message.newTitle) {
            updateTabTitle(message.tabName, message.newTitle);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const createTab = useCallback((tabName: string) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      if (!newTabs.has(tabName)) {
        newTabs.set(tabName, {
          name: tabName,
          active: false,
          logs: [],
          variables: [],
          stack: { stackFrames: [], totalFrames: 0 }
        });
        
        if (newTabs.size === 1) {
          setActiveTab(tabName);
        }
      }
      return newTabs;
    });
  }, []);

  const updateTabLogs = useCallback((tabName: string, logEntry: string) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        const newLogs = [...tab.logs, logEntry];
        if (newLogs.length > 1000) {
          newLogs.splice(0, newLogs.length - 1000);
        }
        newTabs.set(tabName, { ...tab, logs: newLogs });
      }
      return newTabs;
    });
  }, []);

  const updateTabVariables = useCallback((tabName: string, variables: Variable[]) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        newTabs.set(tabName, { ...tab, variables });
      }
      return newTabs;
    });
  }, []);

  const updateTabStack = useCallback((tabName: string, stack: { stackFrames: StackFrame[], totalFrames: number }) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        newTabs.set(tabName, { ...tab, stack });
      }
      return newTabs;
    });
  }, []);

  const updateTabSession = useCallback((tabName: string, sessionInfo: any) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        newTabs.set(tabName, { ...tab, sessionInfo });
      }
      return newTabs;
    });
  }, []);

  const updateTabTitle = useCallback((tabName: string, newTitle: string) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        newTabs.set(tabName, { ...tab, name: newTitle });
      }
      return newTabs;
    });
  }, []);

  const clearTab = useCallback((tabName: string) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        newTabs.set(tabName, { 
          ...tab, 
          logs: [],
          variables: [],
          stack: { stackFrames: [], totalFrames: 0 }
        });
      }
      return newTabs;
    });
  }, []);

  const cleanDebugInfo = useCallback((tabName: string) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      const tab = newTabs.get(tabName);
      if (tab) {
        newTabs.set(tabName, { 
          ...tab, 
          variables: [],
          stack: { stackFrames: [], totalFrames: 0 }
        });
      }
      return newTabs;
    });
  }, []);

  const closeTab = useCallback((tabName: string) => {
    setTabs(prev => {
      const newTabs = new Map(prev);
      newTabs.delete(tabName);
      
      if (activeTab === tabName) {
        const remainingTabs = Array.from(newTabs.keys());
        setActiveTab(remainingTabs.length > 0 ? remainingTabs[0] : null);
      }
      
      return newTabs;
    });
  }, [activeTab]);

  const handleToolbarAction = (action: string, tabName: string) => {
    vscode.postMessage({
      command: 'toolbarAction',
      action: action,
      tabName: tabName
    });
  };

  const handleViewSwitch = (view: 'console' | 'variables') => {
    setCurrentView(view);
  };

  const handleGotoSource = (filePath: string, line: number, column?: number) => {
    vscode.postMessage({
      command: 'gotoSource',
      path: filePath,
      line: line,
      column: column
    });
  };

  const tabsArray = Array.from(tabs.values());
  const activeTabData = activeTab ? tabs.get(activeTab) : null;

  return (
    <div className="app-container">
      <div className="tabs-header">
        {tabsArray.map(tab => (
          <div
            key={tab.name}
            className={`tab ${activeTab === tab.name ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.name)}
          >
            <span className="tab-title">{tab.name}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.name);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="tabs-content">
        {tabsArray.length === 0 ? (
          <div className="empty-state">
            No debug sessions active. Start debugging to see output here.
          </div>
        ) : (
          activeTabData && (
            <div className="tab-content active">
              {/* Toolbar */}
              <div className="toolbar">
                <div className="toolbar-buttons">
                  <button 
                    className="toolbar-button primary"
                    onClick={() => handleToolbarAction('run', activeTabData.name)}
                    disabled={activeTabData.sessionInfo?.state === 'running'}
                  >
                    ▶ Run
                  </button>
                  <button 
                    className="toolbar-button primary"
                    onClick={() => handleToolbarAction('debug', activeTabData.name)}
                    disabled={activeTabData.sessionInfo?.state === 'running'}
                  >
                    🐛 Debug
                  </button>
                  <button 
                    className="toolbar-button"
                    onClick={() => handleToolbarAction('stop', activeTabData.name)}
                    disabled={activeTabData.sessionInfo?.state !== 'running'}
                  >
                    ⏹ Stop
                  </button>
                  
                  {/* Debug controls - only show when debugging */}
                  {activeTabData.sessionInfo?.action === 'debug' && activeTabData.sessionInfo?.state === 'running' && (
                    <>
                      <div className="toolbar-separator"></div>
                      <button 
                        className="toolbar-button"
                        onClick={() => handleToolbarAction('continue', activeTabData.name)}
                      >
                        ▶️ Continue
                      </button>
                      <button 
                        className="toolbar-button"
                        onClick={() => handleToolbarAction('stepOver', activeTabData.name)}
                      >
                        ⏭️ Step Over
                      </button>
                      <button 
                        className="toolbar-button"
                        onClick={() => handleToolbarAction('stepInto', activeTabData.name)}
                      >
                        ⏬ Step Into
                      </button>
                      <button 
                        className="toolbar-button"
                        onClick={() => handleToolbarAction('stepOut', activeTabData.name)}
                      >
                        ⏫ Step Out
                      </button>
                    </>
                  )}
                  
                  <div className="toolbar-separator"></div>
                  
                  {/* View switcher */}
                  <div className="view-tabs">
                    <button
                      className={`view-tab ${currentView === 'console' ? 'active' : ''}`}
                      onClick={() => handleViewSwitch('console')}
                    >
                      Console
                    </button>
                    <button
                      className={`view-tab ${currentView === 'variables' ? 'active' : ''}`}
                      onClick={() => handleViewSwitch('variables')}
                    >
                      Variables & Stack
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Content area */}
              {currentView === 'console' ? (
                <div className="console-output">
                  {activeTabData.logs.length === 0 ? (
                    <div className="empty-state">
                      No debug output yet for this configuration.
                    </div>
                  ) : (
                    activeTabData.logs.map((log, index) => (
                      <div key={index} className="log-line">
                        {log}
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="variables-view">
                  <div className="variables-panel">
                    <div className="resizable-container">
                      <div className="stack-section">
                        <div className="section-header">Call Stack</div>
                        <div className="stack-list">
                          {activeTabData.stack.stackFrames.map((frame, index) => (
                            <div
                              key={frame.id}
                              className={`stack-item ${index === 0 ? 'current' : ''}`}
                              onClick={() => frame.source?.path && handleGotoSource(frame.source.path, frame.line, frame.column)}
                            >
                              <div className="frame-name">
                                {index === 0 ? '📍' : '🔄'} {frame.name}
                              </div>
                              <div className="frame-location">
                                {frame.title || `${frame.source?.path}:${frame.line}`}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="resize-handle"></div>
                      
                      <div className="variables-section">
                        <div className="section-header">Variables</div>
                        <div className="variables-list">
                          {activeTabData.variables.length === 0 ? (
                            <div className="empty-state">No variables to display</div>
                          ) : (
                            activeTabData.variables.map((variable, index) => (
                              <div key={index} className="variable-item">
                                <span className="variable-name">{variable.name}</span>
                                <span className="variable-type">({variable.type})</span>
                                <span className="variable-value">= {variable.value}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default App;
