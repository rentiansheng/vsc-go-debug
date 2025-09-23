import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { Variable, VSCodeAPI, VariableTreeNode } from '../types';
import { DebugProtocol } from 'vscode-debugprotocol';
import { start } from 'repl';

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
  
  console.log(`VariableTree: Component rendered for tab ${tabName} with ${variables.length} variables:`, variables);
  
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<React.Key[]>([]);
  const [treeData, setTreeData] = useState<ExtendedDataNode[]>([]);

  const getTypeColor = useCallback((type: string) => {
    if (type?.includes('string')) return '#ce9178';
    if (type?.includes('int') || type?.includes('float')) return '#b5cea8';
    if (type?.includes('bool')) return '#569cd6';
    if (type?.includes('nil')) return '#808080';
    return '#9cdcfe';
  }, []);

  const getVariableKey = useCallback((variable: Variable): string => {
    return `addr:${variable.addr}`;
  }, []);

  // 优化的树数据转换函数，使用 useMemo 缓存结果
  const convertVariableToTreeData = useCallback((variable: VariableTreeNode): ExtendedDataNode => {
    const hasChildren = variable.variablesReference && variable.variablesReference > 0;
    const hasActualChildren = variable.children && variable.children.length > 0;
    const key = getVariableKey(variable);
    

    const title = (
      <span className="variable-tree-node">
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
    
    let children: ExtendedDataNode[] | undefined = undefined;
    
    // 如果有实际的子节点数据，递归转换
    if (hasActualChildren) {
      console.log(`VariableTree Converting ${variable.children!.length} children for ${variable.name}`);
      children = variable.children!.map(childVar => convertVariableToTreeData(childVar));
    } 
    // 如果有 variablesReference 但没有子节点数据，设置为空数组启用懒加载
    else if (hasChildren) {
      children = [];
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
  }, [getVariableKey, getTypeColor]);

  // 使用 useMemo 优化树数据转换，只在 variables 变化时重新计算
  const convertedTreeData = useMemo(() => {
    console.log('VariableTree converted tree', treeData, 'v', variables);

    if (!variables || variables.length === 0) {
      return [];
    }

    const startTime = performance.now();
    
    const treeNodes = variables.map(variable => convertVariableToTreeData(variable));
    
    const endTime = performance.now();
    
    return treeNodes;
  }, [variables, convertVariableToTreeData]);

  // 智能状态管理：当 variables 变化时，完全重新构建树并保持展开状态
  useEffect(() => {

   
    console.log('VariableTree Current expanded variables:', treeData, "xxx", Array.from(treeData), "v", variables);
    
    // 保存当前展开的变量名
    const currentExpandedVariableNames = new Set(
      treeData
        .filter(node => expandedKeys.includes(node.key))
        .map(node => node.variableData?.name)
        .filter(Boolean)
    );
    

    // 更新树数据
    setTreeData(convertedTreeData);
    console.log('VariableTree Current expanded variables:', treeData, "xxx", Array.from(treeData), "v", variables);

    // 尝试恢复展开状态
    if (currentExpandedVariableNames.size > 0) {
      // 等待下一个渲染周期再恢复展开状态
      setTimeout(() => {
        const newExpandedKeys = convertedTreeData
          .filter(node => node.variableData?.name && currentExpandedVariableNames.has(node.variableData.name))
          .map(node => node.key);
        
        if (newExpandedKeys.length > 0) {
          console.log('Restoring expanded keys:', newExpandedKeys);
          setExpandedKeys(newExpandedKeys);
        }
      }, 0);
    }

    // 清理已加载状态，因为变量引用可能已经改变
    setLoadedKeys([]);
    
    console.log('Tree data updated, new tree:', convertedTreeData);
  }, [convertedTreeData]);

  // 监听树数据变化，强制重新渲染
  useEffect(() => {
     console.log('VariableTree use effect', treeData, 'nodes');
  }, [treeData]);

  const onLoadData = useCallback(({ key, variablesReference, variableData }: ExtendedDataNode): Promise<void> => {
    
    return new Promise((resolve) => {
          console.log('VariableTree onload data promise', treeData, 'nodes');

      if (!variablesReference || loadedKeys.includes(key)) {
        resolve();
        return;
      }

      // 检查是否已经有子节点数据
      if (variableData?.children && variableData.children.length > 0) {
        setLoadedKeys(prev => [...prev, key]);
        resolve();
        return;
      }

      
      const handleMessage = (event: MessageEvent) => {
        const message = event.data;
        if (message.command === 'variables' && 
            message.tabName === tabName &&
            message.arguments?.variablesReference === variablesReference) {
                    
          // 递归更新树节点
          const updateTreeData = (nodes: ExtendedDataNode[]): ExtendedDataNode[] => {
            return nodes.map(node => {
              if (node.key === key) {
                const childData = message.variables?.map((child: VariableTreeNode) => 
                  convertVariableToTreeData(child)
                ) || [];
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

          setTreeData(prevData => {
            const updatedData = updateTreeData(prevData);
            return updatedData;
          });
          
          setLoadedKeys(prev => [...prev, key]);
          window.removeEventListener('message', handleMessage);
          resolve();
        }
      };

      window.addEventListener('message', handleMessage);

      // 发送请求获取变量
      vscode.postMessage({
        command: 'get_variables',
        tabName: tabName,
        variablesReference: variablesReference
      });

      // 设置超时处理
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        resolve();
      }, 5000);
    });
  }, [tabName, vscode, loadedKeys, convertVariableToTreeData]);

  const onExpand = useCallback((newExpandedKeys: React.Key[], { expanded, node }: any) => {
    if (expanded) {
      if(node.variablesReference && node.variablesReferenceCount >  node.children?.length) {
          // 发送请求获取变量
          vscode.postMessage({
            command: 'get_variables',
            tabName: tabName,
            variablesReference: node.variablesReference,
          });
      }
    } 
    setExpandedKeys(newExpandedKeys);
  }, []);

  // 空状态处理
  if (!variables || variables.length === 0) {
    return (
      <div className="empty-state">
        <span>No variables available</span>
      </div>
    );
  }

  return (
    <div className="variable-tree-container" data-tab={tabName}>
      <Tree
        key={`tree-${tabName}-${variables.length}-${JSON.stringify(variables.map(v => v.name + v.variablesReference))}`}
        treeData={treeData}
        loadData={onLoadData}
        expandedKeys={expandedKeys}
        onExpand={onExpand}
        loadedKeys={loadedKeys}
        showIcon={true}
        blockNode={true}
        className="variable-tree"
        height={400}
        virtual={true} // 启用虚拟滚动以提高大量数据的性能
      />
    </div>
  );
};