export function getSplitResizeHtml(): string {
    return `function setupResizeHandlers(configName) {
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
        }`;
}