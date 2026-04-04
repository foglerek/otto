import assert from "node:assert/strict";
import { test } from "node:test";

import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const mod = await jiti(new URL("../src/index.ts", import.meta.url).href);

test("ui-web exports document and static assets", () => {
  const html = mod.renderUiWebDocument();
  assert.match(html, /<title>Otto Web<\/title>/);
  assert.match(html, /\/styles\.css/);
  assert.match(mod.UI_WEB_STYLES, /OTTO WEB|--bg:/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/api\/status/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/api\/tickets\/create/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/delete/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/api\/control-plane/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/api\/tickets\/ingest/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/api\/runs\/start/);
  assert.match(mod.UI_WEB_APP_SCRIPT, /\/resume/);
});
