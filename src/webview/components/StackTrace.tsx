import React, { useState } from 'react';
import { StackFrame, VSCodeAPI } from '../types';

interface StackTraceProps {
  stackFrames: StackFrame[];
  totalFrames: number;
  tabName: string;
  vscode: VSCodeAPI;
}

export const StackTrace: React.FC<StackTraceProps> = ({ 
  stackFrames, 
  totalFrames, 
  tabName, 
  vscode 
}) => {
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(
    stackFrames.length > 0 ? stackFrames[0].id : null
  );

  const handleFrameClick = (frame: StackFrame) => {
    setSelectedFrameId(frame.id);
    
    if (frame.source?.path) {
      vscode.postMessage({
        command: 'gotoSource',
        path: frame.source.path,
        line: frame.line,
        column: frame.column
      });
    }
  };

  const getFrameIcon = (frame: StackFrame, index: number) => {
    if (index === 0) return '📍'; // Current frame
    if (frame.presentationHint === 'subtle') return '🔍'; // System frame
    return '🔄'; // Regular frame
  };

  const formatFrameLocation = (frame: StackFrame) => {
    if (frame.title) return frame.title;
    
    if (frame.source?.path) {
      return `${frame.source.path}:${frame.line}`;
    }
    
    return `${frame.name}:${frame.line}`;
  };

  if (!stackFrames || stackFrames.length === 0) {
    return (
      <div className="empty-state">
        No call stack available
      </div>
    );
  }

  return (
    <div className="stack-trace">
      <div className="stack-header">
        <span>Call Stack ({stackFrames.length}/{totalFrames})</span>
      </div>
      
      <div className="stack-list">
        {stackFrames.map((frame, index) => (
          <div
            key={frame.id}
            className={`stack-item ${
              frame.id === selectedFrameId ? 'selected' : ''
            } ${
              frame.presentationHint === 'subtle' ? 'subtle' : ''
            }`}
            onClick={() => handleFrameClick(frame)}
            title={formatFrameLocation(frame)}
          >
            <div className="frame-header">
              <span className="frame-icon">
                {getFrameIcon(frame, index)}
              </span>
              <span className="frame-name">
                {frame.name}
              </span>
            </div>
            
            <div className="frame-location">
              <span className="source-link">
                {formatFrameLocation(frame)}
              </span>
            </div>
            
            {frame.source && (
              <div className="frame-details">
                <span className="line-number">
                  Line {frame.line}
                  {frame.column && `, Column ${frame.column}`}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      
      {totalFrames > stackFrames.length && (
        <div className="stack-more">
          <button 
            className="load-more-button"
            onClick={() => {
              // Request more stack frames
              vscode.postMessage({
                command: 'loadMoreStackFrames',
                tabName: tabName,
                startFrame: stackFrames.length,
                levels: 20
              });
            }}
          >
            Load more frames ({totalFrames - stackFrames.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
};
