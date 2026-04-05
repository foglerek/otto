import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("ui-web exports document and static assets", async () => {
  const html = mod.renderUiWebDocument();
  const assets = await mod.loadUiWebAssets();
  assert.match(html, /<title>Otto Web<\/title>/);
  assert.match(html, /\/styles\.css/);
  assert.match(assets.stylesheet, /OTTO WEB|--bg:/);
  assert.match(assets.javascript, /react-dom/);
  assert.match(assets.javascript, /\/api\/status/);
  assert.match(assets.javascript, /\/api\/tickets\/create/);
  assert.match(assets.javascript, /\/delete/);
  assert.match(assets.javascript, /\/api\/control-plane/);
  assert.match(assets.javascript, /\/api\/stream/);
  assert.match(assets.javascript, /\/ag-ui/);
  assert.match(assets.javascript, /\/api\/tickets\/ingest/);
  assert.match(assets.javascript, /\/api\/runs\/start/);
  assert.match(assets.javascript, /\/resume/);
});
