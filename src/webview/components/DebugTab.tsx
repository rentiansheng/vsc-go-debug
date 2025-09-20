import React, { useState } from 'react';
import { TabData, VSCodeAPI } from '../types';
import { VariableTree } from './VariableTree';
import { StackTrace } from './StackTrace';
import { Toolbar } from './Toolbar';
import { Console } from './Console';

interface DebugTabProps {
  tabData: TabData;
  vscode: VSCodeAPI;
  isActive: boolean;
}

type ViewType = 'console' | 'variables';

export const DebugTab: React.FC<DebugTabProps> = ({ 
  tabData, 
  vscode, 
  isActive 
}) => {
  const [currentView, setCurrentView] = useState<ViewType>('console');
  const [stackWidth, setStackWidth] = useState(25); // Percentage

  const handleViewSwitch = (view: ViewType) => {
    setCurrentView(view);
  };

  if (!isActive) {
    return null;
  }

  return (
    <div className="debug-tab" data-content={tabData.name}>
      <Toolbar 
        tabName={tabData.name}
        sessionInfo={tabData.sessionInfo}
        currentView={currentView}
        onViewSwitch={handleViewSwitch}
        vscode={vscode}
      />
      
      <div className="tab-content-area">
        {currentView === 'console' && (
          <Console 
            logs={tabData.logs}
            tabName={tabData.name}
          />
        )}
        
        {currentView === 'variables' && (
          <div className="variables-view">
            <div className="variables-panel">
              <div 
                className="stack-section"
                style={{ width: `${stackWidth}%` }}
              >
                <div className="section-header">Call Stack</div>
                <StackTrace
                  stackFrames={tabData.stack?.stackFrames || []}
                  totalFrames={tabData.stack?.totalFrames || 0}
                  tabName={tabData.name}
                  vscode={vscode}
                />
              </div>
              
              <div 
                className="resize-handle"
                onMouseDown={(e) => {
                  const startX = e.clientX;
                  const startWidth = stackWidth;
                  
                  const handleMouseMove = (e: MouseEvent) => {
                    const deltaX = e.clientX - startX;
                    const containerWidth = (e.target as HTMLElement)
                      .closest('.variables-panel')?.clientWidth || 800;
                    const deltaPercent = (deltaX / containerWidth) * 100;
                    const newWidth = Math.max(15, Math.min(60, startWidth + deltaPercent));
                    setStackWidth(newWidth);
                  };
                  
                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                  };
                  
                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                }}
              />
              
              <div className="variables-section">
                <div className="section-header">Variables</div>
                <VariableTree
                  variables={tabData.variables}
                  tabName={tabData.name}
                  vscode={vscode}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
