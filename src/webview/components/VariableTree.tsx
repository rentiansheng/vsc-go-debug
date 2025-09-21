import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { Variable, VSCodeAPI } from '../types';
const [contextMenu, setContextMenu] = useState<{x: number, y: number, node: Variable | null} | null>(null);


interface VariableTreeProps {
  variables: Variable[];
  tabName: string;
  vscode: VSCodeAPI;
  level?: number;
}

interface ExtendedDataNode extends DataNode {
  variablesReference?: number;
  variableData?: Variable;
}


export const VariableTree: React.FC<VariableTreeProps> = ({ 
  variables, 
  tabName, 
  vscode, 
  level = 0 
}) => {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<React.Key[]>([]);
  const [loadingKeys, setLoadingKeys] = useState<React.Key[]>([]);
  const [treeData, setTreeData] = useState<ExtendedDataNode[]>([]);

  const getVariableIcon = useCallback((variable: Variable) => {
    const hasChildren = variable.variablesReference && variable.variablesReference > 0;
    
    if (hasChildren) {
      return '📁';
    }
    
    // Based on variable type or presentation hint
    if (variable.type?.includes('[]')) return '📋';
    if (variable.type?.includes('map')) return '🗂️';
    if (variable.type?.includes('struct')) return '📦';
    if (variable.type?.includes('pointer')) return '👉';
    if (variable.type?.includes('interface')) return '🔌';
    if (variable.type?.includes('func')) return '⚡';
    return '📄';
  }, []);

  const getTypeColor = useCallback((type: string) => {
    if (type?.includes('string')) return '#ce9178';
    if (type?.includes('int') || type?.includes('float')) return '#b5cea8';
    if (type?.includes('bool')) return '#569cd6';
    if (type?.includes('nil')) return '#808080';
    return '#9cdcfe';
  }, []);

  const convertVariablesToTreeData = useCallback((vars: Variable[]): ExtendedDataNode[] => {
    return vars.map((variable, index) => {
      var  key = `${variable.addr}`;
      const hasChildren = variable.variablesReference && variable.variablesReference > 0;
      
      const title = (
        <span className="variable-tree-node">
          <span className="variable-icon">{getVariableIcon(variable)}xxxxxxx</span>
          <span className="variable-name">{variable.name} xxx name</span>
          <span 
            className="variable-type"
            style={{ color: getTypeColor(variable.type) }}
          >
            ({variable.type}) xxxx type
          </span>
          {!hasChildren && (
            <span className="variable-value">= {variable.value} xxx value1</span>
          )}
          {hasChildren && variable.value && (
            <span className="variable-preview">{variable.value} xxx value2</span>
          )}
        </span>
      );

      return {
        key,
        title,
        isLeaf: !hasChildren,
        variablesReference: variable.variablesReference,
        variableData: variable,
        children: hasChildren ? [] : undefined,
      };
    });
  }, [getVariableIcon, getTypeColor]);

  // Initialize tree data when variables change
  useEffect(() => {
    setTreeData(convertVariablesToTreeData(variables));
  }, [variables, convertVariablesToTreeData]);

  const onLoadData = useCallback(({ key, variablesReference }: ExtendedDataNode): Promise<void> => {
    return new Promise((resolve) => {
      if (!variablesReference || loadedKeys.includes(key)) {
        resolve();
        return;
      }

      setLoadingKeys(prev => [...prev, key]);

      // Listen for the response
      const handleMessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.command === 'variables' && 
            message.tabName === tabName &&
            message.arguments?.variablesReference === variablesReference) {
          
          // Find and update the tree node
          const updateTreeData = (nodes: ExtendedDataNode[]): ExtendedDataNode[] => {
            return nodes.map(node => {
              if (node.key === key) {
                const childData = convertVariablesToTreeData(message.variables || []);
                return {
                  ...node,
                  children: childData
                };
              }
              if (node.children) {
                return {
                  ...node,
                  children: updateTreeData(node.children)
                };
              }
              return node;
            });
          };

          setTreeData(prevData => updateTreeData(prevData));
          setLoadedKeys(prev => [...prev, key]);
          setLoadingKeys(prev => prev.filter(k => k !== key));
          window.removeEventListener('message', handleMessage);
          resolve();
        }
      };

      window.addEventListener('message', handleMessage);

      // Request variables
      vscode.postMessage({
        command: 'get_variables',
        tabName: tabName,
        variablesReference: variablesReference
      });
    });
  }, [tabName, vscode, loadedKeys, convertVariablesToTreeData]);

  const onExpand = (newExpandedKeys: React.Key[]) => {
    setExpandedKeys(newExpandedKeys);
  };

  if (!variables || variables.length === 0) {
    return (
      <div className="empty-state">
        No variables available
      </div>
    );
  }

  return (
    <div className="variable-tree-container">
      <Tree
        treeData={treeData}
        loadData={onLoadData}
        expandedKeys={expandedKeys}
        onExpand={onExpand}
        loadedKeys={loadedKeys}
        showIcon={false}
        blockNode={true}
        className="variable-tree"
      />
     
    </div>
  );
};
