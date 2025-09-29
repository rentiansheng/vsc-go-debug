export function getCreateTabHtml(): string {

    return ` function createTab(configName) {
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
                        if(target.classList && target.classList.contains('toolbar-button')) {
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
        `;
}
