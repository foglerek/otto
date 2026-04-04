export function renderUiWebDocument(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Otto Web</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app">
      <div class="shell-loading">
        <span class="shell-mark">OTTO</span>
        <p>Loading local control plane...</p>
      </div>
    </div>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}
