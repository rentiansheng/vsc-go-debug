export function getBodyHtml(): string {
return `<body>
    <div class="container">
        <div class="tabs-container">
        </div>

        <div class="output-container" id="output">
            <div class="empty-state">No debug sessions active. Start debugging to see output here.</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let activeTab = null;
        let tabs = new Map();



        function setupResizeHandlers(configName) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;

            const resizeHandle = tabContent.querySelector('.resize-handle');
            const stackSection = tabContent.querySelector('.stack-section');
            const variablesPanel = tabContent.querySelector('.variables-panel');

            if (!resizeHandle || !stackSection || !variablesPanel) return;

            let isResizing = false;
            let startX = 0;
            let startWidth = 0;

            resizeHandle.addEventListener('mousedown', (e) => {
                isResizing = true;
                startX = e.clientX;
                startWidth = stackSection.offsetWidth;

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                e.preventDefault();
            });

            function handleMouseMove(e) {
                if (!isResizing) return;

                const deltaX = e.clientX - startX;
                const newWidth = startWidth + deltaX;
                const panelWidth = variablesPanel.offsetWidth;

                // Calculate percentage, maintaining 1:3 ratio as default
                const minWidthPx = 150;  // minimum width for stack
                const maxWidthPx = panelWidth * 0.6;  // maximum 60% for stack

                if (newWidth >= minWidthPx && newWidth <= maxWidthPx) {
                    const widthPercent = (newWidth / panelWidth) * 100;
                    stackSection.style.width = \`\${widthPercent}%\`;
                }
            }

            function handleMouseUp() {
                isResizing = false;
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        }

        function createTab(configName) {
            if (!tabs.has(configName)) {
                tabs.set(configName, []);

                // Create tab element
                const tabsContainer = document.querySelector('.tabs-container');

                const tab = document.createElement('div');
                tab.className = 'tab';
                tab.setAttribute('data-tab', configName);
                tab.innerHTML = \`
                    <span>\${configName}</span>
                    <span class="tab-close" onclick="closeTab('\${configName}', event)">✕</span>
                \`;
                tab.onclick = () => switchTab(configName);

                tabsContainer.appendChild(tab);

                // Create tab content
                const outputContainer = document.getElementById('output');
                const tabContent = document.createElement('div');
                tabContent.className = 'tab-content';
                tabContent.setAttribute('data-content', configName);

                // Create toolbar
                const toolbar = document.createElement('div');
                toolbar.className = 'toolbar';
                toolbar.setAttribute('data-tab', configName);
                toolbar.innerHTML = \`
               
                    <div class="toolbar-buttons">
                        <button class="toolbar-button" data-action="stop" title="Stop" disabled>
                            <span class="codicon codicon-debug-stop"></span>
                        </button>
                        <button class="toolbar-button primary" data-action="run" title="Run">
                            <span class="codicon codicon-play"></span>
                        </button>
                        <button class="toolbar-button primary" data-action="debug" title="Debug">
                            <span class="codicon codicon-debug-alt"></span>
                        </button>
                        <button class="toolbar-button" data-action="restart" title="Restart" disabled>
                            <span class="codicon codicon-debug-restart"></span>
                        </button>
                        <button class="toolbar-button" data-action="redebug" title="Redebug" disabled>
                            <span class="codicon codicon-debug-restart"></span>
                            <span class="codicon codicon-bug"></span>
                        </button>
                        <div class="toolbar-separator"></div>
                        <button class="toolbar-button" data-action="continue" title="Continue" disabled>
                            <span class="codicon codicon-debug-continue"></span>
                        </button>
                        <button class="toolbar-button" data-action="stepOver" title="Step Over" disabled>
                            <span class="codicon codicon-debug-step-over"></span>
                        </button>
                        <button class="toolbar-button" data-action="stepInto" title="Step Into" disabled>
                            <span class="codicon codicon-debug-step-into"></span>
                        </button>
                        <button class="toolbar-button" data-action="stepOut" title="Step Out" disabled>
                            <span class="codicon codicon-debug-step-out"></span>
                        </button>
                        <div class="toolbar-separator"></div>
                        <div class="view-tabs">
                            <span class="view-tab" data-view="variables" onclick="switchView('\${configName}', 'variables')">Variables And Stack</span>
                            <span class="view-tab active" data-view="console" onclick="switchView('\${configName}', 'console')">Console</span>
                        </div>
                    </div>
     
                \`;

                // Add event listeners to toolbar buttons
                toolbar.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target) {
                        let action = "";

                        // Handle view tab clicks
                        if (target.classList && target.classList.contains('view-tab')) {
                            const viewType = target.getAttribute('data-view');
                            if (viewType) {
                                switchView(configName, viewType);
                                return;
                            }
                        }

                        // Handle toolbar button clicks
                        if (target.classList && target.classList.contains('toolbar-button')) {
                            action = target.getAttribute('data-action');
                        } else {
                            target.closest('.toolbar-button') && (action = target.closest('.toolbar-button').getAttribute('data-action'));
                        }
                        if (action === "") {
                            return;
                        }
                        if (action && !target.disabled) {
                            console.log(\`Toolbar action: \${action} for config: \${configName}\`);
                            vscode.postMessage({
                                command: 'toolbarAction',
                                action: action,
                                tabName: configName
                            });
                        }
                    }
                });

                // Create output content area
                const outputContent = document.createElement('div');
                outputContent.className = 'output-content';
                outputContent.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';

                // Create variables view content (initially hidden)
                const variablesContent = document.createElement('div');
                variablesContent.className = 'variables-content';
                variablesContent.style.display = 'none';
                variablesContent.innerHTML = \`
                    <div class="variables-panel">
                        <div class="stack-section">
                            <div>Call Stack</div>
                            <div class="stack-list">
                            </div>
                        </div>
                        <div class="resize-handle"></div>
                        <div class="variables-section">
                            <div class="variables-tabs">
                                <div class="variables-tab active" data-tab="variables">Variables</div>
                                <div class="variables-tab" data-tab="watch">Watch</div>
                            </div>
                            <div class="variables-content-area">
                                <div class="variables-list active" data-content="variables">
                                    <div class="empty-state"></div>
                                </div>
                                <div class="watch-list" data-content="watch" style="display: none;">
                                    <div class="watch-input-area">
                                        <input type="text" class="watch-input" placeholder="Enter expression..." />
                                        <button class="watch-add-btn">+</button>
                                    </div>
                                    <div class="watch-expressions">
                                        <div class="empty-state">no watch expressions</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                \`;

                tabContent.appendChild(toolbar);
                tabContent.appendChild(outputContent);
                tabContent.appendChild(variablesContent);
                outputContainer.appendChild(tabContent);

                // Setup resize functionality for variables panel
                setupResizeHandlers(configName);

                // Setup watch functionality for variables panel
                setupWatchFunctionality(configName);

                // If this is the first tab, make it active and hide the empty state
                if (tabs.size === 1) {
                    const emptyState = outputContainer.querySelector('.empty-state');
                    if (emptyState && !emptyState.closest('[data-content]')) {
                        emptyState.style.display = 'none';
                    }
                }
            }

            switchTab(configName);
        }


        function switchTab(tabName) {
            // Update active tab
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-tab') === tabName) {
                    tab.classList.add('active');
                }
            });

            // Update active content - hide main empty state and show tab content
            const mainEmptyState = document.querySelector('.output-container > .empty-state');
            if (mainEmptyState) {
                mainEmptyState.style.display = 'none';
            }

            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
                if (content.getAttribute('data-content') === tabName) {
                    content.classList.add('active');
                }
            });

            activeTab = tabName;
        }

        function closeTab(tabName, event) {
            event.stopPropagation();

            if (tabs.has(tabName)) {
                tabs.delete(tabName);

                // Remove tab element
                const tab = document.querySelector(\`[data-tab="\${tabName}"]\`);
                if (tab) tab.remove();

                // Remove tab content
                const content = document.querySelector(\`[data-content="\${tabName}"]\`);
                if (content) content.remove();

                // If this was the active tab and there are other tabs, switch to another one
                if (activeTab === tabName) {
                    const remainingTabs = Array.from(tabs.keys());
                    if (remainingTabs.length > 0) {
                        switchTab(remainingTabs[0]);
                    } else {
                        // No tabs left, show empty state
                        activeTab = null;
                        const mainEmptyState = document.querySelector('.output-container > .empty-state');
                        if (mainEmptyState) {
                            mainEmptyState.style.display = 'block';
                        }
                    }
                }
            }
        }

        function clearTab(tabName) {
            if (tabs.has(tabName)) {
                tabs.set(tabName, []);
                const content = document.querySelector(\`[data-content="\${tabName}"]\`);
                if (content) {
                    content.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';
                }
            }
        }



        function addOutputToTab(tabName, message) {
            if (!tabs.has(tabName)) {
                createTab(tabName);
            }

            const tabMessages = tabs.get(tabName);
            tabMessages.push(message);

            // Keep only last 1000 entries per tab
            if (tabMessages.length > 1000) {
                tabs.set(tabName, tabMessages.slice(-1000));
            }

            updateTabContent(tabName);
        }

        function updateTabContent(tabName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (tabContent && tabs.has(tabName)) {
                const outputContent = tabContent.querySelector('.output-content');
                const messages = tabs.get(tabName);

                if (messages.length > 0) {
                    // 更新输出内容
                    outputContent.innerHTML = messages.map(msg =>
                        \`<div class="log-line">\${msg}</div>\`
                    ).join('');

                    // 自动滚动到底部，显示最新输出
                    setTimeout(() => {
                        outputContent.scrollTop = outputContent.scrollHeight;
                    }, 10);
                } else {
                    outputContent.innerHTML = '<div class="empty-state">No debug output yet for this configuration.</div>';
                }
            }
        }

        // 右键菜单相关函数
        let contextMenuElement = null;


        function createContextMenu(variable, tabName) {
            if (contextMenuElement) {
                contextMenuElement.remove();
            }

            contextMenuElement = document.createElement('div');
            contextMenuElement.className = 'context-menu';
            contextMenuElement.innerHTML = \`
                <div class="context-menu-item" data-action="copy-name">
                    <span class="context-menu-icon">📋</span>
                    <span>copy name</span>
                </div>
                <div class="context-menu-item" data-action="copy-value">
                    <span class="context-menu-icon">📄</span>
                    <span>copy value</span>
                </div>
                <div class="context-menu-item" data-action="copy-expression">
                    <span class="context-menu-icon">📝</span>
                    <span>copy expression</span>
                </div>
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="watch">
                    <span class="context-menu-icon">👁️</span>
                    <span>add to watch</span>
                </div>
                <div class="context-menu-separator"></div>
            \`;

            // 添加点击事件处理
            contextMenuElement.addEventListener('click', (e) => {
                const item = e.target.closest('.context-menu-item');
                if (!item || item.classList.contains('disabled')) return;

                const action = item.getAttribute('data-action');
                handleContextMenuAction(action, variable, tabName);
                hideContextMenu();
            });

            document.body.appendChild(contextMenuElement);
            return contextMenuElement;
        }

        function showContextMenu(x, y, variable, tabName) {


            const menu = createContextMenu(variable, tabName);
            // 显示菜单并调整位置
            menu.style.display = 'block';
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            // 确保菜单不会超出窗口边界
            const rect = menu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            if (rect.right > windowWidth) {
                menu.style.left = (windowWidth - rect.width - 10) + 'px';
            }
            if (rect.bottom > windowHeight) {
                menu.style.top = (windowHeight - rect.height - 10) + 'px';
            }

            // 点击其他地方时隐藏菜单
            setTimeout(() => {
                document.addEventListener('click', hideContextMenu);
                document.addEventListener('contextmenu', hideContextMenu);
            }, 10);
        }

        function hideContextMenu() {
            if (contextMenuElement) {
                contextMenuElement.style.display = 'none';
                document.removeEventListener('click', hideContextMenu);
                document.removeEventListener('contextmenu', hideContextMenu);
            }
        }

        function handleContextMenuAction(action, variable, tabName) {
            if (!variable || !tabName) return;

            switch (action) {
                case 'copy-name':
                    copyToClipboard(variable.name);
                    break;

                case 'copy-value':
                    copyToClipboard(variable.value);
                    break;

                case 'copy-expression':
                    copyToClipboard(\`\${variable.evaluateName}\`);
                    break;


                case 'watch':
                    addToWatch(variable, tabName);
                    break;

                case 'inspect':
                    inspectVariable(variable, tabName);
                    break;
            }
        }

        function copyToClipboard(text) {
            // 优先使用现代的 Clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() => {
                }).catch(err => {
                    console.warn('Clipboard API failed, falling back to legacy method:', err);
                    fallbackCopy(text);
                });
            } else {
                // 回退到传统方法
                fallbackCopy(text);
            }
        }

        function fallbackCopy(text) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-999999px';
                textarea.style.top = '-999999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textarea);

                if (!successful) {
                    console.error('Fallback: Copy command was unsuccessful');
                    showNotification('复制失败', 'error');
                }
            } catch (err) {
                console.error('Copy failed:', err);
                showNotification('复制失败', 'error');
            }
        }



        function addToWatch(variable, tabName, parentReference) {
            if (tabName && variable.name) {
                addWatchExpression(tabName, variable.name, parentReference);
            }
        }

        function inspectVariable(variable, tabName) {
            vscode.postMessage({
                command: 'inspect_variable',
                tabName: tabName,
                variable: variable
            });
        }

        function showNotification(message, type = 'info') {
            const notification = document.createElement('div');
            notification.className = 'notification';
            notification.textContent = message;

            // Add type-specific styling if needed
            if (type === 'error') {
                notification.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
                notification.style.borderColor = 'var(--vscode-inputValidation-errorBorder)';
                notification.style.color = 'var(--vscode-inputValidation-errorForeground)';
            } else if (type === 'success') {
                notification.style.backgroundColor = 'var(--vscode-terminal-ansiGreen)';
                notification.style.color = 'var(--vscode-terminal-background)';
            }

            document.body.appendChild(notification);

            // Trigger animation
            setTimeout(() => {
                notification.classList.add('show');
            }, 10);

            // Auto-remove after 3 seconds
            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300); // Wait for fade-out animation
            }, 3000);
        }

        function switchView(configName, viewType) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;

            const outputContent = tabContent.querySelector('.output-content');
            const variablesContent = tabContent.querySelector('.variables-content');
            const viewTabs = tabContent.querySelectorAll('.view-tab');

            // Update tab states
            viewTabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-view') === viewType) {
                    tab.classList.add('active');
                }
            });

            // Show/hide content based on view type
            if (viewType === 'console') {
                outputContent.style.display = 'block';
                variablesContent.style.display = 'none';
            } else if (viewType === 'variables') {
                outputContent.style.display = 'none';
                variablesContent.style.display = 'block';
                // Update variables and stack when switching to this view
            }
        }

        // Watch Variables functionality
        let watchExpressions = new Map(); // Map<tabName, Array<watchExpression>>

        function setupWatchFunctionality(configName) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;

            // Initialize watch expressions for this tab
            if (!watchExpressions.has(configName)) {
                watchExpressions.set(configName, []);
            }

            // Setup variables/watch tabs
            const variablesTabs = tabContent.querySelectorAll('.variables-tab');
            variablesTabs.forEach(tab => {
                tab.onclick = (e) => {
                    const tabType = e.target.getAttribute('data-tab');
                    switchVariablesTab(configName, tabType);
                };
            });

            // Setup watch input
            const watchInput = tabContent.querySelector('.watch-input');
            const watchAddBtn = tabContent.querySelector('.watch-add-btn');

            if (watchInput && watchAddBtn) {
                watchAddBtn.onclick = () => {
                    const expression = watchInput.value.trim();
                    if (expression) {
                        addWatchExpression(configName, expression);
                        watchInput.value = '';
                    }
                };

                watchInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        watchAddBtn.onclick();
                    }
                };
            }
        }

        function switchVariablesTab(configName, tabType) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;

            // Update tab states
            const tabs = tabContent.querySelectorAll('.variables-tab');
            tabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.getAttribute('data-tab') === tabType) {
                    tab.classList.add('active');
                }
            });

            // Show/hide content
            const variablesList = tabContent.querySelector('[data-content="variables"]');
            const watchList = tabContent.querySelector('[data-content="watch"]');

            if (tabType === 'variables') {
                if (variablesList) {
                    variablesList.style.display = 'block';
                    variablesList.classList.add('active');
                }
                if (watchList) {
                    watchList.style.display = 'none';
                }
            } else if (tabType === 'watch') {
                if (variablesList) {
                    variablesList.style.display = 'none';
                    variablesList.classList.remove('active');
                }
                if (watchList) {
                    watchList.style.display = 'block';
                }
                // Refresh watch expressions when switching to watch tab
                refreshWatchExpressions(configName);
            }
        }


        function updateStack(configName, stack, args) {
            const tabContent = document.querySelector(\`[data-content="\${configName}"]\`);
            if (!tabContent) return;


            const stackList = tabContent.querySelector('.stack-list');
            if (!stackList) { console.warn('Stack list element not found'); return; }
            if (!stack || stack.totalFrames === 0) {
                stackList.innerHTML = '';
                return;
            }


            if (!stack.stackFrames || stack.stackFrames.length === 0) {
                stackList.innerHTML = '';
                return;
            }
            if (!args || args.startFrame === 0) {
                stackList.innerHTML = '';
            }
            // m.arguments
            stack.stackFrames.forEach((frame, idx) => {
                const liIdx = args.startFrame + idx;
                if (liIdx == 0) {
                    stackList.setAttribute('frame-id', frame.id);
                    stackList.setAttribute('thread-id', args.threadId);
                }
                var li = stackList.querySelector(\`li[data-index="\${liIdx}"]\`);
                if (!li) {
                    li = document.createElement('li');
                }
                const filePath = frame.source.path;
                const fileLinePath = frame.title;
                li.className = 'stack-item' + (frame.presentationHint === 'subtle' ? ' ' : ' selected');
                li.setAttribute('data-frame-id', frame.id);
                li.setAttribute('title', fileLinePath);
                li.setAttribute('data-index', idx);
                li.innerHTML = \`
                    <div class="frame-location">
                        <span style="cursor: pointer;" class="source-link"> \${fileLinePath}</span>
                    </div>
                \`;


               // 点击跳转源码
                li.querySelector('.source-link').addEventListener("dblclick", (e) => {
                    e.stopPropagation();
                    vscode.postMessage({
                        command: 'gotoSource',
                        path: filePath,
                        line: frame.line,
                        column: frame.column
                    });
                });
                // 选中高亮
                li.onclick = () => {
                    tabContent.querySelectorAll('.stack-item').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                    stackList.setAttribute('frame-id', frame.id);
                    // 通知扩展侧切换堆栈帧 
                    vscode.postMessage({
                        command: 'refresh_watch_and_variables',
                        tabName: configName,
                        frameId: frame.id,
                        threadId: args.threadId
                    });
                };
                stackList.appendChild(li);
            });

        }

        function updateScopes(tabName, scopes) {
            console.log('Updating scopes for tab:', tabName, scopes);
        }
        
        function cleanVariableAndWatch(tabName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;


            const variablesList = tabContent.querySelector('.variables-list');
            if (variablesList) {
                variablesList.innerHTML = '';
            }
            cleanWatchExpressions(tabName);
      
        }

        function cleanDebugInfo(tabName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;


            const stackList = tabContent.querySelector('.stack-list');
            if (stackList) {
                stackList.innerHTML = '';
            }

            const variablesList = tabContent.querySelector('.variables-list');
            if (variablesList) {
                variablesList.innerHTML = '';
            }
            v2ResetWatchExpressionValue(tabName);
        }


        function updateVariables(tabName, variables, args) {
            if (args.mode === 'watch') {
                v2WatchVariablesTab(tabName, variables, args);
            } else {
                updateVariablesTab(tabName, variables, args);
            }
        }

        function updateVariablesTab(tabName, variables, args) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            var variablesList = tabContent.querySelector('.variables-list');
            if (!variablesList) return;
            const stackListHTMLNode = tabContent.querySelector('.stack-list');
            if (variablesList.childElementCount === 0) {
                variablesList.setAttribute('variable-reference', args.variablesReference);
            } else {
                const existingRef = parseInt(variablesList.getAttribute('variable-reference')) || 0;
                if (existingRef == args.variablesReference && !args.start) {
                    // 清空旧数据
                    variablesList.innerHTML = '';
                }
            }

            updateVariablesLogics(variables, args, tabName, variablesList, stackListHTMLNode);
        }

        function updateVariablesLogics(variables, args, tabName, variablesList, stackListHTMLNode) {
            // Update variables (右侧)
            if (!variables) {
                return;
            }
            const variablesReference = args.variablesReference;
            // 先不支持增量获取
            const variableItemNode = variablesList.querySelector(\`.variable-item[data-reference="\${variablesReference}"]\`);
            var childInfoNode = null;
            var dataLen = 0;
            if (variableItemNode) {
                childInfoNode = variableItemNode.querySelector('.child-variables');
                dataLen = parseInt(variableItemNode.getAttribute('data-len')) || 0;
            }

            var isExpanded = false;
            if (childInfoNode) {
                variablesList = childInfoNode;
                const expandLink = childInfoNode.querySelector('.expand-link');
                if (expandLink) {
                    if (expandLink.getAttribute('expand-status') === 'true') {
                        isExpanded = true;
                    }
                }


            }
            var currentIdx = args.start || 0;
            if (variables && variables.length > 0) {
                variables[0].name === 'len()' && variables.shift();
            }
            const needLoad = currentIdx + variables.length >= parseInt(dataLen);

            variables.forEach((variable, index) => {

                currentIdx += index;
                const div = buildVariableItemNode(tabName, variable, isExpanded, stackListHTMLNode, variablesReference);
                variablesList.appendChild(div);
            });
            if (dataLen && dataLen > variablesList.childElementCount) {
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

        function buildExpandLinkHtml(hasChildren, isExpanded) {
            const expandSpan = document.createElement('span');
            expandSpan.className = 'expand-link';
            if (hasChildren) {
                expandSpan.setAttribute('expand-status', isExpanded ? 'true' : 'false');
                if (isExpanded) {
                    expandSpan.innerHTML = 'v';
                } else {
                    expandSpan.innerText = '>';
                }

            } else {
                expandSpan.setAttribute('expand-status', 'false');
                expandSpan.innerHTML = '&nbsp;';
                expandSpan.style.display = 'inline-block';

            }
            return expandSpan;
        }

        function buildVariableItemNode(tabName, variable, isExpanded, stackListHTMLNode, parentReference) {
            const div = document.createElement('div');
            div.className = 'variable-item';
            const hasChildren = variable.variablesReference && variable.variablesReference > 0;
            div.setAttribute('data-reference', variable.variablesReference);
            div.setAttribute('data-evaluate-name', variable.evaluateName);
            div.setAttribute('data-len', variable.indexedVariables || variable.namedVariables || 0);

            const variableItemInfo = document.createElement('div');
            const expandSpan = buildExpandLinkHtml(hasChildren, isExpanded);
            variableItemInfo.appendChild(expandSpan);

            variableItemInfo.innerHTML += \`<span class="variable-key">\${variable.name}</span>  
            <span class="variable-type">(\${variable.type})</span>\`;

            if (hasChildren) {
                variableItemInfo.innerHTML += \` <span class="variable-value">\${variable.value}</span>\`;
                variableItemInfo.onclick = (e) => {
                    e.stopPropagation();


                    var childNode = e.target.closest(".variable-item");
                    if (!childNode) {
                        return;
                    }
                    childNode = childNode.querySelector('.child-variables');
                    if (!childNode) return;
                    const expandSpan = div.querySelector(".expand-link");
                    const currentlyExpanded = expandSpan.getAttribute('expand-status') === 'true';

                    if (currentlyExpanded) {
                        // 收起子节点
                        childNode.style.display = 'none';
                        if (expandSpan) {
                            expandSpan.innerText = '>';
                        }
                        expandSpan.setAttribute('expand-status', 'false');

                    } else {
                        e.stopPropagation();
                        // 展开子节点
                        if (!div.getAttribute('no-need-load-children')) {
                            vscode.postMessage({
                                tabName: tabName,
                                command: 'get_variables',
                                variablesReference: variable.variablesReference,
                            });
                        }
                        // 标记为不需要加载子节点, 避免重复加载, 这里最好用事件通知
                        div.setAttribute('no-need-load-children', true);
                        childNode.style.display = 'block';
                        if (expandSpan) {
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
                if (variable.value.startsWith('[]') || variable.value.startsWith('map') || variable.value.startsWith('struct')) {
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
            if (noEdit) {
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
                        if (variable.type === 'string') {
                            if (!newValue.startsWith('"')) {
                                newValue = '"' + newValue;
                            }
                            if (!newValue.endsWith('"')) {
                                newValue = newValue + '"';
                            }
                        }
                        var vrn = parentReference;
                        if (!vrn || vrn === 0) {
                            vrn = parseInt(stackListHTMLNode.getAttribute('frame-id') || '0', 10);
                        }
                        // 发送更新变量值的消息
                        vscode.postMessage({

                            command: 'set_variable',
                            tabName: tabName,
                            variableName: variable.name,
                            newValue: newValue,
                            variablesReference: vrn,
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

        function refreshWatchExpressions(tabName) {
            return;
            const expressions = watchExpressions.get(tabName) || [];
            expressions.forEach(expr => {
                evaluateWatchExpression(tabName, expr);
            });
        }

        function updateWatchExpressionValue(tabName, expressionId, value, error, variablesReference) {
            const expressions = watchExpressions.get(tabName) || [];
            const expr = expressions.find(e => e.id == expressionId);
            if (expr) {


                const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
                if (!tabContent) return \`\${tabName} not found\`;

                const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
                if (!watchExpressionsContainer) return "\${tabName} watch tab not found";
                const exprDiv = watchExpressionsContainer.querySelector(\`.variable-item[data-id="\${expressionId}"]\`);
                if (!exprDiv) return;
                exprDiv.setAttribute('data-reference', variablesReference || 0);

                const dataLen = value.indexedVariables || value.namedVariables || 0;
                exprDiv.setAttribute('data-len', dataLen);


                if (error) {
                    const value = { error: error || null, value: error, type: '', name: '', evaluateName: '', variablesReference: 0 };
                    updateVariableRow(tabName, exprDiv, value);
                    return;
                }
                const watchVariableValue = { error: error || null, value: value || '', type: expr.type || '' };
                
                value.error = null;
                if (!value.value) {
                    if (value.result) {
                        value.value = value.result;
                    }
                    value.name = expr.expression || '';
                    value.evaluateName = expr.expression || '';

                }
                updateVariableRow(tabName, exprDiv, value);
                const args = { variablesReference: variablesReference || 0, expressionId: expressionId || '', start: 0 };
                if (value.children) {
                    v2VariablesDiv(tabName, exprDiv, value.children, args);
                }
                

            }
        }

        function v2WatchVariablesTab(tabName, variables, args) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            var watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
            if (!watchExpressionsContainer) return;
            if(args.expressionId) {
                watchExpressionsContainer = watchExpressionsContainer.querySelector(\`[data-id="\${args.expressionId}"]\`);
            } else {
                watchExpressionsContainer = watchExpressionsContainer.querySelector(\`[data-id="\${args.id}"]\`);
            }
            const variablesReference = args.variablesReference;
            // 先不支持增量获取
            const exprDiv = watchExpressionsContainer.querySelector(\`.variable-item[data-reference="\${variablesReference}"]\`);
            if (!exprDiv) {
                return ;
            }

            v2VariablesDiv(tabName, exprDiv, variables, args);
        }

        function v2VariablesDiv(tabName, exprDiv, variables, args) {
            const dataLen = parseInt(exprDiv.getAttribute('data-len')) || 0;
            var variablesReference = args.variablesReference || 0;

            const childNode = exprDiv.querySelector('.child-variables');
            if (variables && variables.length > 0) {
                variables[0].name === 'len()' && variables.shift();
            }
            const start = args.start || args.startIndex || 0;
            if(start === 0){
                // 请求第一页，清空旧数据
                childNode.innerHTML = '';
            }


            variables.map(variable => {
                const v = {
                    id: variable.evaluateName || '',
                    expressionId: args.expressionId || '',
                    ...variable,
                    
                }
                const item = v2VariableDiv(tabName, v, true);

                childNode.appendChild(item);
            });
           const hasCount = start + variables.length;
            if (dataLen && dataLen > hasCount) {
                const loadMore = v2LoadMore(tabName, variablesReference, hasCount, args);
                childNode.appendChild(loadMore);
            }
        }

        function v2LoadMore(tabName, variablesReference, startIndex) {
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
                    // mode: 'watch' || 'variables',
                    startIndex: startIndex,
                    mode: 'watch',
                    expressionId: args.expressionId || '',
                
                });
            }
            return loadMoreDiv;
        }



        function evaluateWatchExpression(tabName, watchExpr) {
            // Send evaluate request to VS Code
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            const stackListHTMLNode = tabContent.querySelector('.stack-list');
            const frameId = parseInt(stackListHTMLNode.getAttribute('frame-id') || '0', 10);
            evaluateWatchExpression(tabName, watchExpr, frameId, false);
        }
        function evaluateWatchExpression(tabName, watchExpr, frameId) {

            vscode.postMessage({
                command: 'evaluate_watch',
                tabName: tabName,
                expression: watchExpr.expression,
                expressionId: watchExpr.id,
                frameId: frameId,
            });
        }

        function removeWatchExpression(event, tabName, expressionId) {
            event.stopPropagation();
            const expressions = watchExpressions.get(tabName) || [];
            const newExpressions = expressions.filter(e => e.id !== expressionId);
            watchExpressions.set(tabName, newExpressions);
            vscode.postMessage({
                command: 'remove_watch',
                tabName: tabName,
                expressionId: expressionId
            });
            removeWatchExpressionHTMLDiv(tabName, expressionId);
            if (newExpressions.length === 0) {
                const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
                if (!tabContent) return;
                const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
                if (!watchExpressionsContainer) return;
                const emptyStateDiv = document.createElement('div');
                emptyStateDiv.className = 'empty-state';
                emptyStateDiv.textContent = 'No watch expressions. Add one using the "+" button.';
                watchExpressionsContainer.appendChild(emptyStateDiv);
            }
        }

        function removeWatchExpressionHTMLDiv(tabName, expressionId) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return \`\${tabName} not found\`;

            const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
            if (!watchExpressionsContainer) return \`\${tabName} watch tab not found\`;
            const exprDiv = watchExpressionsContainer.querySelector(\`.variable-item[data-id="\${expressionId}"]\`);
            if (exprDiv) {
                exprDiv.remove();
            }
            return;
        }



        function getRowLabelSpanHTMLStr(className, value) {
            return \`<span class="\${className}">\${value}</span> \`;
        }

        

        function v2VariableDiv(tabName, expr, noDelBtn) {
            exprDiv = document.createElement('div');
            exprDiv.className = 'variable-item';
            exprDiv.setAttribute('data-id', expr.id || '');
            exprDiv.setAttribute('data-evaluate-name', expr.evaluateName || '');
            exprDiv.setAttribute('no-need-load-children', false);
            exprDiv.setAttribute('data-reference', expr.variablesReference || 0);
            exprDiv.setAttribute('data-len', expr.indexedVariables || expr.namedVariables || 0);

            const hasChildren = expr.variablesReference && expr.variablesReference > 0;
            const exprInfoDiv = document.createElement('div');
            exprInfoDiv.className = 'variable-item-info';
            const expandLink = buildExpandLinkHtml(hasChildren, false);
            exprInfoDiv.appendChild(expandLink);
            exprInfoDiv.innerHTML += getRowLabelSpanHTMLStr('variable-key', expr.name || '');
            exprInfoDiv.innerHTML += getRowLabelSpanHTMLStr('variable-type', expr.type ? \`(\${expr.type})\` : '');
            if (expr.error) {
                exprInfoDiv.innerHTML += getRowLabelSpanHTMLStr('variable-value font-red', expr.value || '');
            } else {
                exprInfoDiv.innerHTML += getRowLabelSpanHTMLStr('variable-value', expr.error ? expr.error : expr.value ? \`= \${expr.value}\` : '');
            }
            if (!noDelBtn) {
                exprInfoDiv.innerHTML += \`<button class="watch-expression-remove" onclick="removeWatchExpression(event, '\${tabName}', \${expr.id})" title="delete">×</button>\`;
            }
            exprDiv.appendChild(exprInfoDiv);

            const childNode = document.createElement('div');
            childNode.className = 'child-variables';
            childNode.style.display = 'none';
            childNode.style.marginLeft = '7px';
            exprDiv.append(childNode);
            // exprInfoDiv  新加单击展开功能
            exprInfoDiv.onclick = function (e) {
                e.stopPropagation();

                var variableItemClick = e.target.closest(".variable-item");
                if (!variableItemClick) {
                    return;
                }
                var variablesReference = variableItemClick.getAttribute('data-reference') || 0;

                var childNode = variableItemClick.querySelector('.child-variables');
                if (!childNode) return;
                if (!variablesReference || variablesReference == 0 || variablesReference == '0') {
                    return;
                }
                const expandSpan = variableItemClick.querySelector(".expand-link");
                const currentlyExpanded = expandSpan.getAttribute('expand-status') === 'true';
                if (currentlyExpanded) {
                    // 收起子节点
                    childNode.style.display = 'none';
                    if (expandSpan) {
                        expandSpan.innerText = '>';
                    }
                    expandSpan.setAttribute('expand-status', 'false');
                } else {
                    e.stopPropagation();
                    noNeedLoad = variableItemClick.getAttribute('no-need-load-children') === 'true';
                    // 展开子节点
                    //if (noNeedLoad) {
                        vscode.postMessage({
                            tabName: tabName,
                            command: 'get_variables',
                            variablesReference: variablesReference,
                            // mode: 'watch' || 'variables',
                            mode: 'watch',

                            expressionId: expr.expressionId || '',

                        });
                    //}
                    // 标记为不需要加载子节点, 避免重复加载, 这里最好用事件通知
                    variableItemClick.setAttribute('no-need-load-children', true);
                    childNode.style.display = 'block';
                    if (expandSpan) {
                        expandSpan.innerHTML = 'v';
                    }

                    expandSpan.setAttribute('expand-status', 'true');

                }
            };
            return exprDiv;
        }

        function addWatchRow(tabName, expr) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
            if (!watchExpressionsContainer) return;
            if (!expr || !expr.expressionId) return;
            var exprDiv = watchExpressionsContainer.querySelector(\`.variable-item[data-id="\${expr.expressionId}"]\`);
            if (exprDiv) {
                return;
            }

            const variableExpr = {
                id: expr.id || '',
                name: expr.expression || '',
                type: expr.type || '',
                value: expr.value || '',
                variablesReference: expr.variablesReference || 0,
                evaluateName: expr.evaluateName || '',
                expression: expr.expression || '',
                error: expr.error || null,
                expressionId: expr.expressionId || '',

            }


            exprDiv = v2VariableDiv(tabName, variableExpr);
            watchExpressionsContainer.appendChild(exprDiv);
            watchExpressionsContainer.querySelector('.empty-state')?.remove();
        }

        function updateVariableRow(tabName, div, res) {
            div.setAttribute('data-reference', res && res.variablesReference || 0);
            div.setAttribute('data-len', (res && res.indexedVariables) || (res && res.namedVariables) || 0);
            const exprInfoDiv = div.querySelector('.variable-item-info');
            if (!exprInfoDiv) {
                return;
            }

            const hasChildren = res && res.variablesReference && res.variablesReference > 0 || false;
            const exprInfoTypeSpan = exprInfoDiv.querySelector('.variable-type');


            if (exprInfoTypeSpan && res.type) {

                exprInfoTypeSpan.innerText = '(' + (res.type || '') + ')';
            }
            const exprInfoValueSpan = exprInfoDiv.querySelector('.variable-value');
            if (exprInfoValueSpan) {
                exprInfoValueSpan.innerText = res && res.value || '';
            }
            if (hasChildren) {

                exprInfoTypeSpan.innerText = '';
                var expandLinkSpan = div.querySelector('.expand-link');
                if (expandLinkSpan.innerText !== '>' && expandLinkSpan.innerText !== 'v') {
                    expandLinkSpan.innerText = '>';
                }

            }
        }




        function v2ResetWatchExpressionValue(tabName) {
            const expressions = watchExpressions.get(tabName);
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;
            const watchExpressionsContainer = tabContent.querySelector('.watch-expressions');
            if (!watchExpressionsContainer) return;
            watchExpressionsContainer.querySelectorAll('.variable-item').forEach(item => item.remove());
            expressions.forEach(watchExpr => {
                watchExpr.value = 'Evaluating...';
                addWatchRow(tabName, watchExpr);
            });
            
        }   


        function addWatchExpression(tabName, expression, variablesReference) {
            if (!watchExpressions.has(tabName)) {
                watchExpressions.set(tabName, []);
            }

            const expressions = watchExpressions.get(tabName);
            const existingIndex = expressions.findIndex(e => e.expression === expression);

            if (existingIndex === -1) {
                const id = Date.now() + Math.random(); // Simple unique ID
                const watchExpr = {
                    id: id,
                    expressionId: id,
                    expression: expression,
                    value: 'Evaluating...',
                    error: null,
                    variablesReference: variablesReference
                };


                vscode.postMessage({
                    command: 'add_watch',
                    tabName: tabName,
                    expressionId: watchExpr.id,
                    expression: expression,
                });

                // Evaluate expression
                evaluateWatchExpression(tabName, watchExpr);

                addWatchRow(tabName, watchExpr);
                expressions.push(watchExpr);
                watchExpressions.set(tabName, expressions);
                showNotification('Added watch expression: ' + expression, 'success');
            } else {
                showNotification('Expression already exists', 'info');
            }
        }


        // Listen for messages from the extension
        function updateToolbar(tabName, configState) {
            const toolbar = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!toolbar) {
                console.warn(\`Toolbar not found for tab: \${tabName}\`);
                return;
            }

            const isRunning = configState && (configState.state === 'running' || configState.state === 'starting');
            const isDebugSession = configState && configState.action === 'debug';

         



            // Update stop button - enabled when running
            const stopBtn = toolbar.querySelector('[data-action="stop"]');
            if (stopBtn) {
                stopBtn.disabled = !isRunning;
            } else {
                console.warn(\`[JS] Stop button not found for \${tabName}\`);
            }

            // Update run button - disabled when running  
            const runBtn = toolbar.querySelector('[data-action="run"]');
            if (runBtn) {
                runBtn.disabled = isRunning;
            } else {
                console.warn(\`[JS] Run button not found for \${tabName}\`);
            }
            const debugBtn = toolbar.querySelector('[data-action="debug"]');
            if (debugBtn) {
                debugBtn.disabled = isRunning;
            } else {
                console.warn(\`[JS] Debug button not found for \${tabName}\`);
            }

            // Update restart button - enabled when running
            const restartBtn = toolbar.querySelector('[data-action="restart"]');
            if (restartBtn) {
                restartBtn.disabled = !isRunning;
            }
            const redebugBtn = toolbar.querySelector('[data-action="redebug"]');
            if (redebugBtn) {
                redebugBtn.disabled = !isRunning;
            }
            if (isRunning) {
                stopBtn.style.display = 'flex';
                runBtn.style.display = 'none';
                debugBtn.style.display = 'none';
                restartBtn.style.display = 'flex';
                redebugBtn.style.display = 'flex';
            } else {
                stopBtn.style.display = 'none';
                runBtn.style.display = 'flex';
                debugBtn.style.display = 'flex';
                restartBtn.style.display = 'none';
                redebugBtn.style.display = 'none';
            }

            // Update debug buttons - enabled when running and is debug session
            const debugButtons = ['continue', 'stepOver', 'stepInto', 'stepOut'];
            debugButtons.forEach(action => {
                const btn = toolbar.querySelector(\`[data-action="\${action}"]\`);
                if (btn) {
                    btn.disabled = !isRunning;
                    btn.style.display = isDebugSession ? 'flex' : 'none';
                }
            });
        }


        // 计算持续时间的辅助函数
        function calculateDurationJS(startTime, endTime) {
            const start = new Date(startTime);
            const end = endTime ? new Date(endTime) : new Date();
            const duration = end.getTime() - start.getTime();

            if (duration < 1000) {
                return \`\${duration}ms\`;
            } else if (duration < 60000) {
                return \`\${Math.floor(duration / 1000)}s\`;
            } else {
                const minutes = Math.floor(duration / 60000);
                const seconds = Math.floor((duration % 60000) / 1000);
                return \`\${minutes}m \${seconds}s\`;
            }
        }

        function setVariableCallback(tabName, variableName, newValue, variablesReference, evaluateName) {
            const tabContent = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!tabContent) return;

            const variablesList = tabContent.querySelector('.variables-list');
            if (!variablesList) return;

            // Find the variable item in the list, by evaluateName
            const variableItem = variablesList.querySelector(\`[data-evaluate-name="\${evaluateName}"]\`);
            if (!variableItem) {
                return;
            }
            const valueSpan = variableItem.querySelector('.variable-value');
            if (valueSpan) {
                // Update the displayed value
                //             valueSpan.innerHTML = \`= <span class="\${className} editable-value" data-value="\${safeValue}" title="click to edit">\${safeValue}</span>\`;           
                const safeValue = escapeHtml(newValue || '');
                valueSpan.setAttribute('data-value', safeValue);
                valueSpan.innerHTML = newValue;

            }

        }


        function updateTabTitle(tabName, newTitle) {
            const tab = document.querySelector(\`[data-tab="\${tabName}"]\`);
            if (tab) {
                const titleSpan = tab.querySelector('span:first-child');
                if (titleSpan) {
                    titleSpan.textContent = newTitle;
                }
            }
        }

        function updateDuration(tabName, duration) {
            const toolbar = document.querySelector(\`[data-tab="\${tabName}"]\`);
            if (toolbar) {
                const durationInfo = toolbar.querySelector('.duration-info');
                if (durationInfo) {
                    durationInfo.textContent = \`运行时长: \${duration}\`;
                    durationInfo.style.display = 'inline';
                }
            }
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateOutput':
                    if (message.tabName) {
                        // Add to specific tab
                        addOutputToTab(message.tabName, message.content);
                    }
                    break;
                case 'createTab':
                    createTab(message.tabName);
                    console.error("[JS] Creating tab:", message.tabName);

                    break;
                case 'switchTab':
                    if (tabs.has(message.tabName)) {
                        switchTab(message.tabName);
                    }
                    break;
                case 'clearTab':
                    if (message.tabName) {
                        clearTab(message.tabName);
                    } else if (activeTab) {
                        clearTab(activeTab);
                    }
                    break;
                case 'updateToolbar':
                    updateToolbar(message.tabName, message.sessionInfo);
                    break;
                case 'updateTabTitle':
                    updateTabTitle(message.tabName, message.newTitle);
                    break;
                case 'updateDuration':
                    // 使用JavaScript计算并更新持续时间
                    if (message.startTime) {
                        const duration = calculateDurationJS(message.startTime);
                        updateDuration(message.tabName, duration);
                    }
                    break;
                case 'updateVariables':
                    // Update variables view with debug data
                    if (message.tabName && message.variables) {
                        updateVariables(message.tabName, message.variables, message.args);
                    }
                    break;
                case 'updateStack':
                    if (message.tabName && message.stack) {
                        updateStack(message.tabName, message.stack, message.args);
                    }
                    break;
                case "updateScopes":
                    if (message.tabName && message.scopes) {
                        updateScopes(message.tabName, message.scopes);
                    }
                    break;

                case "cleanDebugInfo":
                    if (message.tabName) {
                        cleanDebugInfo(message.tabName);
                    }
                    break;
                case "cleanVariableAndWatch":
                    if (message.tabName) {
                        cleanVariableAndWatch(message.tabName);
                    }
                    break;
                case "setVariableCallback":
                    if (message.tabName && message.variableName) {
                        setVariableCallback(message.tabName, message.variableName, message.newValue, message.variablesReference, message.evaluateName);
                    }
                    break;
                case 'showError':
                    if (message.message) {
                        showNotification(message.message, 'error');
                    }
                    break;
             
                case 'updateWatchExpression':
                    if (message.tabName && message.expressionId) {
                        updateWatchExpressionValue(
                            message.tabName,
                            message.expressionId,
                            message.value,
                            message.error,
                            message.variablesReference,

                        );
                    }
                    break;

            }
        });

        // 自定义右键菜单功能 - 只显示Copy选项
        function initCustomContextMenu() {
            // 禁用默认右键菜单并显示自定义菜单
            document.addEventListener('contextmenu', function(e) {
                e.preventDefault(); // 阻止默认右键菜单
                
                const selection = window.getSelection();
                const selectedText = selection ? selection.toString().trim() : '';
                
                // 只有当有选中文本时才显示菜单
                if (selectedText) {
                    showCustomContextMenu(e.pageX, e.pageY, selectedText);
                }
            });

            // 键盘快捷键支持 (Ctrl+C / Cmd+C)
            document.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                    const selection = window.getSelection();
                    if (selection && selection.toString().trim()) {
                        e.preventDefault();
                        copyToClipboard(selection.toString());
                    }
                }
            });
        }

        function showCustomContextMenu(x, y, selectedText) {
            // 移除现有菜单
            const existingMenu = document.querySelector('.custom-context-menu');
            if (existingMenu) {
                existingMenu.remove();
            }

            // 创建自定义菜单
            const menu = document.createElement('div');
            menu.className = 'custom-context-menu';
            menu.style.left = x + 'px';
            menu.style.top = y + 'px';

            // 创建Copy菜单项
            const copyItem = document.createElement('div');
            copyItem.className = 'custom-menu-item';
            copyItem.innerHTML = '📋 Copy';

            copyItem.addEventListener('click', () => {
                copyToClipboard(selectedText);
                menu.remove();
            });

            menu.appendChild(copyItem);
            document.body.appendChild(menu);

            // 确保菜单不会超出窗口边界
            const rect = menu.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            if (rect.right > windowWidth) {
                menu.style.left = (windowWidth - rect.width - 10) + 'px';
            }
            if (rect.bottom > windowHeight) {
                menu.style.top = (windowHeight - rect.height - 10) + 'px';
            }

            // 点击其他地方时隐藏菜单
            setTimeout(() => {
                document.addEventListener('click', function hideMenu(e) {
                    if (!menu.contains(e.target)) {
                        menu.remove();
                        document.removeEventListener('click', hideMenu);
                    }
                });
            }, 10);
        }

        // 初始化自定义右键菜单
        initCustomContextMenu();

 
    </script>



</body>
`;
}