export function getTabControlHtml(): string {
    return `
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
                        <button class="toolbar-button" data-action-group='debug' data-action="continue" title="Continue" disabled>
                            <span class="codicon codicon-debug-continue"></span>
                        </button>
                        <button class="toolbar-button" data-action-group='debug' data-action="stepOver" title="Step Over" disabled>
                            <span class="codicon codicon-debug-step-over"></span>
                        </button>
                        <button class="toolbar-button" data-action-group='debug' data-action="stepInto" title="Step Into" disabled>
                            <span class="codicon codicon-debug-step-into"></span>
                        </button>
                        <button class="toolbar-button" data-action-group='debug' data-action="stepOut" title="Step Out" disabled>
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
                        const frameId = getCurrentFrameId(configName);
                        if (action && !target.disabled) {
                            toolbar.querySelectorAll('.toolbar-button[data-action-group="debug"]').forEach(btn => {
                                btn.disabled = true;
                            });
                            console.log(\`Toolbar action: \${action} for config: \${configName}\`);
                            vscode.postMessage({
                                command: 'toolbarAction',
                                action: action,
                                tabName: configName,
                                args: {
                                    frameId: frameId || 0,
                                }
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
                                        <button class="watch-inspect-btn">👁️</button>
                                        <button class="watch-add-btn">+</button>
                                    </div>
                                    <div class="watch-input-result"> 
                                       
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

        function toolbarDebugButtonEnabled(tabName) {
            const toolbar = document.querySelector(\`.toolbar[data-tab="\${tabName}"]\`);
            if (toolbar) {
                const debugButton = toolbar.querySelectorAll('.toolbar-button[data-action-group="debug"]').forEach(debugButton => {
                    debugButton.disabled = false;
                });
            }
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
    `;
}