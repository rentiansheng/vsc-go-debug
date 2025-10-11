import { getBodyHtmlScript } from "./body/body_js";

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
       ${getBodyHtmlScript()}
    </script>



</body>
`;
}