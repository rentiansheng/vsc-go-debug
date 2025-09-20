import React, { useState, useCallback } from 'react';
import { Variable, VSCodeAPI } from '../types';

interface VariableTreeProps {
  variables: Variable[];
  tabName: string;
  vscode: VSCodeAPI;
  level?: number;
}

interface VariableNodeProps {
  variable: Variable;
  tabName: string;
  vscode: VSCodeAPI;
  level: number;
}

const VariableNode: React.FC<VariableNodeProps> = ({ 
  variable, 
  tabName, 
  vscode, 
  level 
}) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(false);

  const hasChildren = variable.variablesReference && variable.variablesReference > 0;
  const indent = level * 16;

  const handleToggle = useCallback(async () => {
    if (!hasChildren) return;

    if (!expanded && children.length === 0) {
      setLoading(true);
      vscode.postMessage({
        command: 'get_variables',
        tabName: tabName,
        variablesReference: variable.variablesReference
      });
    }
    
    setExpanded(!expanded);
  }, [expanded, hasChildren, children.length, tabName, variable.variablesReference, vscode]);

  // This would be called from parent when new variables are received
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.command === 'variables' && 
          message.tabName === tabName &&
          message.arguments?.variablesReference === variable.variablesReference) {
        setChildren(message.variables || []);
        setLoading(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [tabName, variable.variablesReference]);

  const getVariableIcon = (variable: Variable) => {
    if (hasChildren) {
      if (loading) return '⏳';
      return expanded ? '▼' : '▶';
    }
    
    // Based on variable type or presentation hint
    if (variable.type?.includes('[]')) return '📋';
    if (variable.type?.includes('map')) return '🗂️';
    if (variable.type?.includes('struct')) return '📦';
    if (variable.type?.includes('pointer')) return '👉';
    if (variable.type?.includes('interface')) return '🔌';
    if (variable.type?.includes('func')) return '⚡';
    return '📄';
  };

  const getTypeColor = (type: string) => {
    if (type?.includes('string')) return '#ce9178';
    if (type?.includes('int') || type?.includes('float')) return '#b5cea8';
    if (type?.includes('bool')) return '#569cd6';
    if (type?.includes('nil')) return '#808080';
    return '#9cdcfe';
  };

  return (
    <div className="variable-node">
      <div 
        className={`variable-item ${hasChildren ? 'expandable' : ''}`}
        style={{ paddingLeft: `${indent}px` }}
        onClick={hasChildren ? handleToggle : undefined}
      >
        <span className="variable-icon">
          {getVariableIcon(variable)}
        </span>
        <span className="variable-name">
          {variable.name}
        </span>
        <span 
          className="variable-type"
          style={{ color: getTypeColor(variable.type) }}
        >
          ({variable.type})
        </span>
        {!hasChildren && (
          <span className="variable-value">
            = {variable.value}
          </span>
        )}
        {hasChildren && variable.value && (
          <span className="variable-preview">
            {variable.value}
          </span>
        )}
      </div>
      
      {expanded && children.length > 0 && (
        <div className="variable-children">
          {children.map((child, index) => (
            <VariableNode
              key={`${child.name}-${index}`}
              variable={child}
              tabName={tabName}
              vscode={vscode}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const VariableTree: React.FC<VariableTreeProps> = ({ 
  variables, 
  tabName, 
  vscode, 
  level = 0 
}) => {
  if (!variables || variables.length === 0) {
    return (
      <div className="empty-state">
        No variables available
      </div>
    );
  }

  return (
    <div className="variable-tree">
      {variables.map((variable, index) => (
        <VariableNode
          key={`${variable.name}-${index}`}
          variable={variable}
          tabName={tabName}
          vscode={vscode}
          level={level}
        />
      ))}
    </div>
  );
};
