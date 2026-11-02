const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function readAssignedJson(file, property) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const sandbox = { window: { MLO: {} } };
  vm.runInNewContext(text, sandbox, { filename: file });
  return sandbox.window.MLO[property];
}

const inventory = JSON.parse(fs.readFileSync(path.join(root, 'translation-source-inventory.json'), 'utf8'));
const main = readAssignedJson('ui/js/i18n-data.js', 'I18N_DATA');
const extra = readAssignedJson('ui/js/i18n-extra.js', 'I18N_EXTRA');
const langs = Object.keys(main.tr);

test('main catalog arrays stay aligned to every source string', () => {
  assert.equal(main.src.length, 2194);
  assert.equal(new Set(main.src).size, main.src.length);
  assert.equal(langs.length, 30);
  for (const lang of langs) assert.equal(main.tr[lang].length, main.src.length, lang);
});

test('all web-module strings have a translation entry in each non-English/French locale', () => {
  const keys = new Set([...inventory.web_module_source_keys.siteupload, ...inventory.web_module_source_keys.studio]);
  assert.equal(keys.size, 156);
  for (const lang of langs.filter(x => x !== 'en' && x !== 'fr')) {
    for (const key of keys) assert.ok(extra[lang]?.[key], `${lang} missing ${key}`);
  }
});

test('texts shown in the supplied import-panel screenshots are translated in every locale', () => {
  const screenshotKeys = inventory.screenshot_import_panel_source_strings;
  assert.equal(screenshotKeys.length, 16);
  for (const lang of langs) {
    for (const key of screenshotKeys) assert.ok(extra[lang]?.[key], `${lang} missing screenshot text ${key}`);
  }
});

test('every localized MLO Studio C# table covers all source keys once', () => {
  const text = fs.readFileSync(path.join(root, 'studio/src/Lang.cs'), 'utf8');
  const expected = new Set(inventory.studio_csharp_source_keys);
  const blocks = [...text.matchAll(/Tables\["([a-z]+)"\]\s*=\s*new Dictionary<string, string>\s*\{([\s\S]*?)\n\s*\};/g)];
  assert.equal(blocks.length, 28);
  for (const [, lang, body] of blocks) {
    const rows = [...body.matchAll(/\{\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*\}/g)];
    assert.equal(rows.length, 108, `${lang} row count`);
    const decodedKeys = rows.map(x => JSON.parse('\"' + x[1] + '\"'));
    assert.equal(new Set(decodedKeys).size, 108, `${lang} duplicates`);
    assert.deepEqual(new Set(decodedKeys), expected, `${lang} source keys`);
  }
});

test('module fallback and standalone FiveM locale loader are wired', () => {
  const extraJs = fs.readFileSync(path.join(root, 'ui/js/i18n-extra.js'), 'utf8');
  assert.match(extraJs, /return I && I\.t \? I\.t\(en\) : en/);
  const fivem = path.join(root, 'Script fivem/mlo_creator_live');
  assert.match(fs.readFileSync(path.join(fivem, 'config.lua'), 'utf8'), /Config\.Locale\s*=\s*'fr'/);
  assert.match(fs.readFileSync(path.join(fivem, 'fxmanifest.lua'), 'utf8'), /'html\/locale\.js'/);
  assert.ok(fs.existsSync(path.join(fivem, 'html/locale.js')));
});
