export function getStyles() : string {
    return `  /* VS Code icon symbols - using Unicode characters that work in VS Code */
        .vscode-icon {
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            font-weight: bold;
        }
        
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            height: 100vh;
            overflow: hidden;
        }
        
        .container {
            display: flex;
            height: 100vh;
            flex-direction: column;
        }
        
        .tabs-container {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-tab-inactiveBackground);
            overflow-x: auto;
            min-height: 35px;
        }
        
        .tab {
            display: flex;
            align-items: center;
            padding: 8px 12px;
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            border-right: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            white-space: nowrap;
            font-size: 12px;
            position: relative;
        }
        
        .tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
        }
        
        .tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }
        
        .tab-close {
            margin-left: 8px;
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 10px;
            opacity: 0.7;
        }
        
        .tab-close:hover {
            background-color: var(--vscode-button-hoverBackground);
            opacity: 1;
        }
        
        .notification {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            border: 1px solid var(--vscode-notifications-border);
            padding: 12px 16px;
            border-radius: 4px;
            font-size: 12px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
            z-index: 1000;
            opacity: 0;
            transform: translateY(10px);
            transition: all 0.3s ease;
        }
        
        .notification.show {
            opacity: 1;
            transform: translateY(0);
        }
        
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 12px;
        }
        
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .output-container {
            flex: 1;
            overflow: hidden;
            background-color: var(--vscode-terminal-background);
            position: relative;
            display: flex;
            flex-direction: column;
            min-height: 0; /* 允许flex子项收缩 */
        }
        
        .tab-content {
            height: 100%;
            overflow: hidden;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            white-space: pre-wrap;
            word-wrap: break-word;
            display: none;
            flex-direction: column;
            min-height: 0; /* 允许flex子项收缩 */
        }
        
        .tab-content.active {
            display: flex;
        }
        
        .toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            background-color: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            gap: 8px;
            flex-shrink: 0;
        }
        
        .state-info {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
        }
 
        
        .duration-info {
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            font-family: var(--vscode-editor-font-family);
        }
        
        .toolbar-buttons {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .toolbar-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            cursor: pointer;
            border-radius: 2px;
            font-size: 11px;
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 24px;
            height: 24px;
            justify-content: center;
        }
        
        .toolbar-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .toolbar-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            background-color: var(--vscode-button-secondaryBackground);
        }
        
        .toolbar-button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .toolbar-button.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        /* VS Code icon styles for toolbar buttons */
        .toolbar-button .vscode-icon {
            font-size: 14px;
            color: inherit;
            display: inline-block;
        }
        
        .toolbar-button:disabled .vscode-icon {
            opacity: 0.5;
        }
        
        /* Special styling for small bug icon */
        .toolbar-button .codicon-bug {
            font-size: 10px; /* 1/4 of normal size (32px -> 8px) */
            margin-left: -22px;
            margin-top: 10px;
        }
        
        .toolbar-separator {
            width: 1px;
            height: 16px;
            background-color: var(--vscode-panel-border);
            margin: 0 4px;
        }
        
        .view-tabs {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .view-tab {
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
            border-radius: 3px;
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            border: 1px solid var(--vscode-panel-border);
            transition: all 0.2s ease;
        }
        
        .view-tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }
        
        .view-tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-color: var(--vscode-focusBorder);
        }
        
        .output-content {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 10px;
            min-height: 0; /* 允许flex子项收缩 */
            max-height: 100%; /* 确保不超出容器 */
            scroll-behavior: smooth; /* 平滑滚动 */
        }
        
        .variables-content {
            flex: 1;
            white-space: nowrap;
            overflow-y: auto;
            overflow-x: hidden;
            min-height: 0;
            max-height: 100%;
        }
        
        .variables-panel {
            display: flex;
            flex-direction: row;
            height: 100%;
            position: relative;
        }
        
        .stack-section {
            margin-left:3px;
            width: 25%;
            min-width: 150px;
            max-width: 60%;
            border-right: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .variables-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            min-width: 0;
        }
        
        /* Variables/Watch tabs */
        .variables-tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-tab-inactiveBackground);
            margin-bottom: 4px;
        }
        
        .variables-tab {
            padding: 6px 12px;
            cursor: pointer;
            font-size: 11px;
            background-color: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
            border-right: 1px solid var(--vscode-panel-border);
            transition: all 0.2s ease;
        }
        
        .variables-tab:hover {
            background-color: var(--vscode-tab-hoverBackground);
        }
        
        .variables-tab.active {
            background-color: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-bottom: 2px solid var(--vscode-focusBorder);
        }
        
        .variables-content-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        /* Watch specific styles */
        .watch-list {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            margin-left: 3px;
        }
        
        .watch-input-area {
            display: flex;
            gap: 4px;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-sideBarSectionHeader-background);
        }
        
        .watch-input {
            flex: 1;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            padding: 4px 8px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            outline: none;
        }
        
        .watch-input:focus {
            border-color: var(--vscode-focusBorder);
        }
        
        .watch-add-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 11px;
            min-width: 24px;
        }
        
        .watch-add-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .watch-expressions {
            flex: 1;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            margin: 0;
            padding: 4px;
        }
        
        .watch-expression-item {
            display: flex;
            align-items: center;
            padding: 4px 6px;
            margin: 2px 0;
            border-radius: 2px;
            cursor: pointer;
            position: relative;
            background-color: var(--vscode-list-background);
        }
        
        .watch-expression-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .watch-expression-content {
            flex: 1;
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 4px;
        }
        
        .watch-expression-name {
            color: var(--vscode-debugTokenExpression-name);
            font-weight: bold;
            font-size: 11px;
            display: inline-block;
            flex-shrink: 0;
            min-width: 80px;
        }
        
        .watch-expression-value {
            color: var(--vscode-debugTokenExpression-value);
            font-size: 11px;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 200px;
        }
        
        .watch-expression-error {
            color: var(--vscode-errorForeground);
            font-size: 11px;
            font-style: italic;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 200px;
        }
        
        .watch-expression-remove {
            background: none;
            border: none;
            color: var(--vscode-errorForeground);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            font-size: 12px;
            opacity: 0.7;
            margin-left: 4px;
        }
        
        .watch-expression-remove:hover {
            opacity: 1;
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .resize-handle {
            width: 4px;
            background-color: var(--vscode-panel-border);
            cursor: col-resize;
            position: relative;
            flex-shrink: 0;
        }
        
        .resize-handle:hover {
            background-color: var(--vscode-focusBorder);
        }
        
        .resize-handle::after {
            content: '';
            position: absolute;
            left: -2px;
            right: -2px;
            top: 0;
            bottom: 0;
        }
        
 
        .variables-list, .stack-list {
            margin-left: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 11px;
            flex: 1;
            overflow-y: auto;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            list-style: none;
            padding: 0;
            margin: 0;
        }
        
        .variable-item, .stack-item, .load-more {
            
            padding: 2px 4px;
            margin: 1px 0;
            border-radius: 2px;
            cursor: pointer;
        }
        
        .variable-item:hover, .stack-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .variable-name {
            color: var(--vscode-debugTokenExpression-name);
            font-weight: bold;
        }
        
        .variable-value {
            color: var(--vscode-debugTokenExpression-value);
            margin-left: 8px;
        }
        
        .editable-value {
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            transition: background-color 0.2s ease;
        }
        
        .editable-value:hover {
            background-color: var(--vscode-list-hoverBackground);
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        .variable-value-editor {
            background: var(--vscode-input-background) !important;
            color: var(--vscode-input-foreground) !important;
            border: 1px solid var(--vscode-input-border) !important;
            border-radius: 2px !important;
            padding: 2px 4px !important;
            font-family: inherit !important;
            font-size: inherit !important;
            min-width: 100px !important;
            outline: none !important;
            margin: 0 !important;
        }
        
        .variable-value-editor:focus {
            border-color: var(--vscode-focusBorder) !important;
            box-shadow: 0 0 0 1px var(--vscode-focusBorder) !important;
        }
        
        .variable-type {
            color: var(--vscode-debugTokenExpression-type);
            font-style: italic;
            margin-left: 4px;
        }
        
        /* 右键菜单样式 */
        .context-menu {
            position: fixed;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 3px;
            padding: 4px 0;
            min-width: 150px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            z-index: 1000;
            font-size: 12px;
            display: none;
        }
        
        .context-menu-item {
            padding: 6px 12px;
            cursor: pointer;
            color: var(--vscode-menu-foreground);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }
        
        .context-menu-item.disabled {
            color: var(--vscode-disabledForeground);
            cursor: not-allowed;
            opacity: 0.5;
        }
        
        .context-menu-item.disabled:hover {
            background: transparent;
            color: var(--vscode-disabledForeground);
        }
        
        .context-menu-separator {
            height: 1px;
            background: var(--vscode-menu-separatorBackground);
            margin: 4px 0;
        }
        
        .context-menu-icon {
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        /* 自定义滚动条样式，使其与VSCode主题匹配 */
        .output-content::-webkit-scrollbar {
            width: 10px;
        }
        
        .output-content::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
        }
        
        .output-content::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 5px;
        }
        
        .output-content::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-hoverBackground);
        }
        
        .empty-state {
            color: var(--vscode-descriptionForeground);
            text-align: center;
            margin-top: 50px;
            font-style: italic;
        }
        
        .log-line {
            margin-bottom: 2px;
            line-height: 1.4;
            word-break: break-word; /* 长单词换行 */
            white-space: pre-wrap; /* 保持空格和换行 */
        }
        
        /* 为输出内容添加一些间距和样式 */
        .output-content .log-line:last-child {
            margin-bottom: 10px; /* 最后一行底部留白 */
        }

        .output-content.stack-list { list-style: none; padding: 0; margin: 0; }
        .output-content .stack-item {
          padding: 10px 14px;
          margin-bottom: 8px;
          border-radius: 7px;
          background: #fff;
          box-shadow: 0 1px 4px #0002;
          display: flex;
          flex-direction: column;
          transition: box-shadow 0.2s, background 0.2s;
          cursor: pointer;
        }
        .output-content .stack-item:hover {
          box-shadow: 0 2px 8px #0003;
          background: #e7f3ff;
        }
        .output-content .stack-item.selected {
          border-left: 4px solid #4c8bf4;
          background: #dbeafe;
        }
        .output-content .stack-item.subtle {
          opacity: 0.7;
          font-style: italic;
          background: #f0f0f0;
        }
  
        .output-content .frame-location {
          color: #888;
          font-size: 13px;
          margin-top: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .output-content .frame-addr {
          color: #aaa; font-size: 12px;
          margin-top: 3px;
        }
        .variables-list .variable-item  .expand-link {
          cursor: pointer;
          margin-left: 10px;
          padding-right: 4px;
           
        }
        .variables-list .load-more  .load-more-link {
          cursor: pointer;
          margin-left: 14px;
          padding-right: 4px;  
        }  
 `;
}