export function getConsoleHtml(): string {

    return `function addOutputToTab(tabName, message) {
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
        }`;
}