import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { Variable, VSCodeAPI,VariableTreeNode } from '../types';
import { DebugProtocol } from 'vscode-debugprotocol';

interface VariableTreeProps {
  variables: VariableTreeNode[];
  tabName: string;
  vscode: VSCodeAPI;
  level?: number;
}

interface ExtendedDataNode extends DataNode {
  variableData?: VariableTreeNode;
  variablesReference?: number;
  variablesReferenceCount?: number;

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

  // const getVariableIcon = useCallback((variable: Variable) => {
  //   const hasChildren = variable.variablesReference && variable.variablesReference > 0;

  //   if (hasChildren) {
  //     return '📁';
  //   }

  //   // Based on variable type or presentation hint
  //   if (variable.type?.includes('[]')) return '📋';
  //   if (variable.type?.includes('map')) return '🗂️';
  //   if (variable.type?.includes('struct')) return '📦';
  //   if (variable.type?.includes('pointer')) return '👉';
  //   if (variable.type?.includes('interface')) return '🔌';
  //   if (variable.type?.includes('func')) return '⚡';
  //   return '📄';
  // }, []);

  const getTypeColor = useCallback((type: string) => {
    if (type?.includes('string')) return '#ce9178';
    if (type?.includes('int') || type?.includes('float')) return '#b5cea8';
    if (type?.includes('bool')) return '#569cd6';
    if (type?.includes('nil')) return '#808080';
    return '#9cdcfe';
  }, []);



  function getVariableKey(variable: Variable): string {
    return `addr:${variable.addr}`;
  }


  function convertVariableToTreeData(variable: VariableTreeNode): ExtendedDataNode {
      const hasChildren = variable.variablesReference && variable.variablesReference > 0;
      const key = getVariableKey(variable);
      console.log('convertVariablesToTreeData:', key, variable.name, variable.variablesReference, "xxx", variables.length, treeData.length);
      const title = (
        <span className="variable-tree-node">
          <span className="variable-icon" style={{ display: 'none' }}>{/*getVariableIcon(variable)*/}</span>
          <span className="variable-name">{variable.name}</span>
          <span
            className="variable-type"
            style={{ color: getTypeColor(variable.type) }}
          >
            ({variable.type})
          </span>
          {!hasChildren && (
            <span className="variable-value">= {variable.value}</span>
          )}
        </span>
      );
      
      let children: ExtendedDataNode[] = [];  
      if (hasChildren && variable.children) {
        children = variable.children.map(childVar => convertVariableToTreeData(childVar));
      }

      return {
        key,
        title,
        isLeaf: !hasChildren,
        variablesReference: variable.variablesReference || 0,
        variablesReferenceCount: variable.variablesReferenceCount || 0,
        variableData: variable,
        children: children,
      };
  }


  const convertVariablesToTreeData = useCallback((vars: Variable[]): ExtendedDataNode[] => {
   


    return vars.map((variable, index) => {


      const hasChildren = variable.variablesReference && variable.variablesReference > 0;
      const key = getVariableKey(variable);
      console.log('convertVariablesToTreeData:', key, variable.name, variable.variablesReference, "xxx", variables.length, treeData.length);
      const title = (
        <span className="variable-tree-node">
          <span className="variable-icon" style={{ display: 'none' }}>{/*getVariableIcon(variable)*/}</span>
          <span className="variable-name">{variable.name}</span>
          <span
            className="variable-type"
            style={{ color: getTypeColor(variable.type) }}
          >
            ({variable.type})
          </span>
          {!hasChildren && (
            <span className="variable-value">= {variable.value}</span>
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
  }, [/*getVariableIcon,*/ getTypeColor]);

  // Initialize tree data when variables change
  useEffect(() => {
    // 当 variables 发生变化时，重置所有状态并重新初始化树数据
    setTreeData(convertVariablesToTreeData(variables));
    
    // 可选：重置展开和加载状态（取决于是否希望保持用户的展开状态）
    // setExpandedKeys([]);
    // setLoadedKeys([]);
    // setLoadingKeys([]);
    
    console.log('Variables updated, tree data refreshed:', variables.length, 'variables');
  }, [variables, convertVariablesToTreeData]);

 

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
         expandedKeys={expandedKeys}
        onExpand={onExpand}
        loadedKeys={loadedKeys}
        showIcon={true}
        blockNode={true}
        className="variable-tree"
      />

    </div>
  );
};
