export function getVariablesHtml(): string {
    return `
      function updateVariables(tabName, variables, args) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            var variablesList = tabContent.querySelector('.variables-list');
            if (!variablesList) return;
             const stackListHTMLNode = tabContent.querySelector('.stack-list');
             if(variablesList.childElementCount === 0) {
                 variablesList.setAttribute('variable-reference', args.variablesReference);
             } else {
                 const existingRef = parseInt(variablesList.getAttribute('variable-reference')) || 0;
                 if(existingRef == args.variablesReference && !args.start) {
                     // 清空旧数据
                     variablesList.innerHTML = '';
                 }
             }

            var isExpanded = false;

             // Update variables (右侧)
            if (variables) {
 
                 const variablesReference = args.variablesReference; 
                // 先不支持增量获取
                const variableItemNode = variablesList.querySelector(\`.variable-item[data-reference="\${variablesReference}"]\`);
                var childInfoNode = null;
                var dataLen = 0;
                if(variableItemNode) {
                    childInfoNode = variableItemNode.querySelector(\`.child-variables\`);
                    dataLen = variableItemNode.getAttribute('data-len');
                }

                isExpanded = false;
                if(childInfoNode){
                    variablesList = childInfoNode;
                    const expandLink = childInfoNode.querySelector('.expand-link');
                    if(expandLink) {
                        if(expandLink.getAttribute('expand-status') === 'true') {
                            isExpanded = true;
                        }
                    }
               
                    
                }
                var currentIdx = args.start || 0;
                if (variables && variables.length  > 0) {
                    variables[0].name === 'len()' && variables.shift();
                }
                const needLoad = currentIdx  + variables.length  >=  parseInt(dataLen);
                
                variables.forEach((variable, index) =>  {
               
                    currentIdx += index;
                    const div = buildVariableItemNode(tabName, variable, isExpanded, stackListHTMLNode, variablesReference);
                    variablesList.appendChild(div);
                });
                if(dataLen  && dataLen > variablesList.childElementCount) {
                    const loadMoreDiv = document.createElement('div');
                    loadMoreDiv.className = 'load-more';
                    loadMoreDiv.innerHTML = '<span class="load-more-link">load more...</span>';
                    loadMoreDiv.onclick = (e) => {
                        loadMoreDiv.remove();
                        e.stopPropagation();
                        vscode.postMessage({
                            tabName: tabName,
                            command: 'get_variables',
                            variablesReference: variablesReference,
                            startIndex: variablesList.childElementCount
                        });
                    };
                    variablesList.appendChild(loadMoreDiv);
                }          
            }  
        }

        function buildVariableItemNode(tabName, variable, isExpanded, stackListHTMLNode, parentReference) {
            const div = document.createElement('div');
            div.className = 'variable-item';
            const hasChildren = variable.variablesReference && variable.variablesReference > 0;
            div.setAttribute('data-reference',  variable.variablesReference );
            div.setAttribute('data-evaluate-name',  variable.evaluateName );
            div.setAttribute('data-len',  variable.indexedVariables || variable.namedVariables|| 0 );
              
            const variableItemInfo = document.createElement('div');
            const expandSpan = document.createElement('span');
            if (hasChildren) {
                expandSpan.className = 'expand-link';
                expandSpan.setAttribute('expand-status', isExpanded ? 'true' : 'false');
                if(isExpanded) {
                    expandSpan.innerHTML = 'v';
                } else {
                    expandSpan.innerText = '>';
                }
                variableItemInfo.appendChild(expandSpan);
            }  else {
                variableItemInfo.innerHTML = \`<span style="display:inline-block;" class='expand-link'>&nbsp;</span>\`;
            } 
     
            variableItemInfo.innerHTML +=  \`<span class="variable-key">\${variable.name}</span>  
            <span class="variable-type">(\${variable.type})</span>\`;
       
            if (hasChildren) {   
                variableItemInfo.innerHTML +=  \` <span class="variable-value">\${variable.value}</span>\`; 
                variableItemInfo.onclick = (e) => {   
                    e.stopPropagation();
                
                
                    var  childNode  =  e.target.closest(".variable-item");
                    if(!childNode)  {
                         return ;
                    }
                    childNode = childNode.querySelector('.child-variables');
                    if(!childNode) return;  
                    const expandSpan = div.querySelector(".expand-link");
                    const currentlyExpanded = expandSpan.getAttribute('expand-status') === 'true';

                    if (currentlyExpanded) {
                        // 收起子节点
                        childNode.style.display = 'none';
                        if(expandSpan) {
                            expandSpan.innerText = '>';
                        }
                        expandSpan.setAttribute('expand-status', 'false');

                    } else {
                        e.stopPropagation();
                        // 展开子节点
                        if(!div.getAttribute('no-need-load-children')) {
                            vscode.postMessage({
                                tabName: tabName,
                                command: 'get_variables',
                                variablesReference: variable.variablesReference,
                            });    
                        }
                        // 标记为不需要加载子节点, 避免重复加载, 这里最好用事件通知
                        div.setAttribute('no-need-load-children', true);
                        childNode.style.display = 'block';
                        if(expandSpan) {
                            expandSpan.innerHTML = 'v';
                        }
                         
                        expandSpan.setAttribute('expand-status', 'true');

                    }
                }
                
                // 添加右键菜单支持
                variableItemInfo.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu(e.clientX, e.clientY, variable, tabName, parentReference);
                };
                
                div.appendChild(variableItemInfo);   

                const childNode = document.createElement('div');
                childNode.className = 'child-variables';
                childNode.style.display = 'none';
                childNode.style.marginLeft = '7px';
                div.append(childNode);

            } else {
                if(variable.value.startsWith('[]') || variable.value.startsWith('map') || variable.value.startsWith('struct')) { 
                    const valueSpan = buildVariableItemNodeValueHTML(tabName, 'variable-value', variable, stackListHTMLNode, parentReference, true);
                    variableItemInfo.appendChild(valueSpan);
                    
                  
                    div.appendChild(variableItemInfo);
                } else {
                    const valueSpan = buildVariableItemNodeValueHTML(tabName, 'variable-value', variable, stackListHTMLNode, parentReference, false);
                    variableItemInfo.appendChild(valueSpan);
                    // 添加右键菜单支持
                    variableItemInfo.oncontextmenu = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showContextMenu(e.clientX, e.clientY, variable, tabName);
                    };
                
                    div.appendChild(variableItemInfo);
                }
            

            }
            return div;
        }

        function escapeHtml(value) {
            if (!value) return '';
              return value
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
        }


        function buildVariableItemNodeValueHTML(tabName, className, variable, stackListHTMLNode, parentReference, noEdit) {
            const valueSpan = document.createElement('span');
            
            // 安全地设置HTML内容，对变量值进行编码
            const safeValue = escapeHtml(variable.value || '');
            valueSpan.innerHTML = \`= <span class="\${className} editable-value" data-value="\${safeValue}" title="click to edit">\${safeValue}</span>\`;           
            if(noEdit) {
                return valueSpan;
            }
 

            // 添加单击编辑功能
            const editableValueSpan = valueSpan.querySelector('.editable-value');
            editableValueSpan.onclick = (e) => {
                e.stopPropagation();
             
                const currentValue = editableValueSpan.getAttribute('data-value');
                const input = document.createElement('input');
                input.type = 'text';
                input.value = currentValue;
                input.className = 'variable-value-editor';
                input.style.cssText = \`
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    padding: 2px 4px;
                    font-family: inherit;
                    font-size: inherit;
                    min-width: 100px;
                    outline: none;
                \`;
                
                // 替换显示为输入框
                editableValueSpan.style.display = 'none';
                editableValueSpan.parentElement.insertBefore(input, editableValueSpan);
                input.focus();
                input.select();
                
                // 处理输入完成
                const finishEdit = (save = false) => {
                    if (save && input.value !== currentValue) {
                        newValue = input.value; 
                        if(variable.type === 'string'){
                            if(!newValue.startsWith('"')  ) {
                                newValue = '"' + newValue;
                            }
                            if(!newValue.endsWith('"')  ) {
                                newValue = newValue + '"';
                            }
                        }
                        var vrn = parentReference;
                        if(!vrn || vrn === 0) {
                            vrn = parseInt(stackListHTMLNode.getAttribute('frame-id') || '0', 10);
                        }
                        // 发送更新变量值的消息
                        vscode.postMessage({
                           
                            command: 'set_variable',
                            tabName: tabName,
                            variableName: variable.name,
                            newValue: newValue,
                            variablesReference:  vrn,
                            evaluateName: variable.evaluateName
                        });
                        
                        // 更新显示值
                        //editableValueSpan.textContent = input.value;
                        //editableValueSpan.setAttribute('data-value', input.value);
                    }
                    
                    // 恢复显示
                    input.remove();
                    editableValueSpan.style.display = 'inline';
                };
                
                // 监听键盘事件
                input.onkeydown = (event) => {
                    if (event.key === 'Enter') {
                        finishEdit(true);
                    } else if (event.key === 'Escape') {
                        finishEdit(false);
                    }
                };
                
                // 监听失去焦点
                input.onblur = () => {
                    finishEdit(true);
                };
            };
            return valueSpan;          
        }

        ${getWatchHTML()}
`;
}


function getWatchHTML(): string {
    return `
    
        function refreshWatchExpressions(configName) {
            const expressions = watchExpressions.get(configName) || [];
            expressions.forEach(expr => {
                evaluateWatchExpression(configName, expr);
            });
        }
            
        function updateWatchExpressionValue(configName, expressionId, value, error, variablesReference) {
            const expressions = watchExpressions.get(configName) || [];
            const expr = expressions.find(e => e.id == expressionId);
            if (expr) {
                expr.value = value || '';
                expr.error = error || null;
                expr.variablesReference = variablesReference || 0;
                updateWatchUI(configName);
            }
        }

        function evaluateWatchExpression(configName, watchExpr) {
            // Send evaluate request to VS Code
            vscode.postMessage({
                command: 'evaluate_watch',
                tabName: configName,
                expression: watchExpr.expression,
                expressionId: watchExpr.id
            });
        }
        
        function removeWatchExpression(configName, expressionId) {
            const expressions = watchExpressions.get(configName) || [];
            const newExpressions = expressions.filter(e => e.id !== expressionId);
            watchExpressions.set(configName, newExpressions);
            vscode.postMessage({
                command: 'remove_watch',
                tabName: configName,
                expressionId: expressionId
            });
            updateWatchUI(configName);
        }
                
        function updateWatchUI(configName) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;
            
            const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
            if (!watchExpressionsContainer) return;
            
            const expressions = watchExpressions.get(configName) || [];
            
            if (expressions.length === 0) {
                watchExpressionsContainer.innerHTML = '<div class="empty-state">no watch expression</div>';
                return;
            }
            
            watchExpressionsContainer.innerHTML = expressions.map(expr => \`
                <div class="watch-expression-item" data-id="\${expr.id}">
                    <div class="watch-expression-content">
                        <span class="watch-expression-name">\${escapeHtml(expr.expression)}</span>
                        \${expr.error ? 
                            \`<span class="watch-expression-error">\${escapeHtml(expr.error.length > 50 ? expr.error.substring(0, 50) + '...' : expr.error)}</span>\` :
                            \`<span class="watch-expression-value" title="\${escapeHtml(expr.value)}"> = \${escapeHtml(expr.value.length > 50 ? expr.value.substring(0, 50) + '...' : expr.value)}</span>\`
                        }
                    </div>
                    <button class="watch-expression-remove" onclick="removeWatchExpression('\${configName}', \${expr.id})" title="delete">×</button>
                </div>
            \`).join('');
        }
                
        function addWatchExpression(configName, expression, variablesReference) {
            if (!watchExpressions.has(configName)) {
                watchExpressions.set(configName, []);
            }
            
            const expressions = watchExpressions.get(configName);
            const existingIndex = expressions.findIndex(e => e.expression === expression);
            
            if (existingIndex === -1) {
                const watchExpr = {
                    id: Date.now() + Math.random(), // Simple unique ID
                    expression: expression,
                    value: 'Evaluating...',
                    error: null,
                    variablesReference: variablesReference
                };
                expressions.push(watchExpr);
                watchExpressions.set(configName, expressions);
                
                // Update UI
                updateWatchUI(configName);
                
                // Evaluate expression
                evaluateWatchExpression(configName, watchExpr);
                vscode.postMessage({
                    command: 'add_watch',
                    tabName: configName,
                    expressionId: watchExpr.id,
                    expression: expression,
                });
                
                showNotification('Added watch expression: ' + expression, 'success');
            } else {
                showNotification('Expression already exists', 'info');
            }
        }
    `;
}

