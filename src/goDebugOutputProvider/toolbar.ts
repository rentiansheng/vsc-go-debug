export function getToolbarHtml(): string {
    return `
    // Listen for messages from the extension
    function updateToolbar(tabName, configState) {
            const toolbar = document.querySelector(\`[data-content="\${tabName}"]\`);
            if (!toolbar) {
                console.warn(\`Toolbar not found for tab: \${tabName}\`);
                return;
            }
            
            const isRunning = configState && (configState.state === 'running' || configState.state === 'starting');
            const isDebugSession = configState && configState.action === 'debug';
            
            console.log(\`[JS] Updating toolbar for \${tabName}:\`, {
                configState,
                isRunning,
                isDebugSession,
                toolbarFound: !!toolbar
            });
            
  
            
            // Update stop button - enabled when running
            const stopBtn = toolbar.querySelector('[data-action="stop"]');
            if (stopBtn) {
                stopBtn.disabled = !isRunning;
                console.log(\`[JS] Stop button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
            } else {
                console.warn(\`[JS] Stop button not found for \${tabName}\`);
            }
            
            // Update run button - disabled when running  
            const runBtn = toolbar.querySelector('[data-action="run"]');
            if (runBtn) {
                runBtn.disabled = isRunning;
                console.log(\`[JS] Run button for \${tabName}: \${isRunning ? 'disabled' : 'enabled'}\`);
            } else {
                console.warn(\`[JS] Run button not found for \${tabName}\`);
            }
            const debugBtn = toolbar.querySelector('[data-action="debug"]');    
             if (debugBtn) {
                debugBtn.disabled = isRunning;
                console.log(\`[JS] Debug button for \${tabName}: \${isRunning ? 'disabled' : 'enabled'}\`);
            } else {
                console.warn(\`[JS] Debug button not found for \${tabName}\`);
            }

            // Update restart button - enabled when running
            const restartBtn = toolbar.querySelector('[data-action="restart"]');
            if (restartBtn) {
                restartBtn.disabled = !isRunning;
                console.log(\`[JS] Restart button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
            }
            const redebugBtn = toolbar.querySelector('[data-action="redebug"]');
            if (redebugBtn) {
                redebugBtn.disabled = !isRunning;
                console.log(\`[JS] Restart button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}\`);
            }
            if(isRunning){
                stopBtn.style.display = 'flex';
                runBtn.style.display = 'none';
                debugBtn.style.display = 'none';
                restartBtn.style.display = 'flex';
                redebugBtn.style.display = 'flex';
            }else{
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
                    console.log(\`[JS] \${action} button for \${tabName}: \${!isRunning ? 'disabled' : 'enabled'}, display: \${isDebugSession ? 'flex' : 'none'}\`);
                }
            });
        }
    `;
}