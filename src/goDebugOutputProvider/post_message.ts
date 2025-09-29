export function getPostMessageHtml(): string   {
    return `
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
                case 'waitchExpressionResponse':
                    if (message.tabName && message.expression) {
                        waitchExpressionResponse(message.tabName, message.expression, message.variablesReference);
                    }
                    break;
                case 'updateWatchExpression':
                    if (message.tabName && message.expressionId) {
                        updateWatchExpressionValue(
                            message.tabName, 
                            message.expressionId, 
                            message.value, 
                            message.error, 
                            message.variablesReference
                        );
                    }
                    break;
                
            }
        });
    `;


}