export function getStackHtml(): string {
    return `
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
            if(!args || args.startFrame === 0) {
                stackList.innerHTML = '';
            }
            // m.arguments
            stack.stackFrames.forEach((frame, idx) => {
                const liIdx = args.startFrame + idx;
                if(liIdx == 0)  {
                    stackList.setAttribute('frame-id',  frame.id);
                }
                var li = stackList.querySelector(\`li[data-index="\${liIdx}"]\`);
                if(!li) {
                    li = document.createElement('li');
                }
                const filePath = frame.source.path;
                const fileLinePath = frame.title;
                li.className = 'stack-item' + (frame.presentationHint === 'subtle' ? ' subtle' : '');
                li.setAttribute('data-frame-id', frame.id);
                li.setAttribute('title', fileLinePath);
                li.setAttribute('data-index', idx);
                li.innerHTML = \`
                    <div class="frame-location">
                        <span style="color:#1976d2;text-decoration:underline;cursor:pointer;" class="source-link"> \${fileLinePath}</span>
                    </div>
                \`;
 
 
                // 点击跳转源码
                li.querySelector('.source-link').onclick = (e) => {
                    e.stopPropagation();
                    vscode.postMessage({
                    command: 'gotoSource',
                    path: filePath,
                    line: frame.line,
                    column: frame.column
                    });
                };
                // 选中高亮
                li.onclick = () => {
                    tabContent.querySelectorAll('.stack-item').forEach(el => el.classList.remove('selected'));
                    li.classList.add('selected');
                };
                stackList.appendChild(li);
            });

        } `;
}