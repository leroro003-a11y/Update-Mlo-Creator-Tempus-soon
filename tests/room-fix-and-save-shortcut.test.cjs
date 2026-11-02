const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('room fix defines and uses its percentile helper in fixPass scope', () => {
    const source = fs.readFileSync(path.join(root, 'ui/js/importmodel.js'), 'utf8');
    const start = source.indexOf('function fixPass(opts)');
    const end = source.indexOf('IM.drawRoomCheck =', start);
    assert.ok(start >= 0 && end > start, 'fixPass block exists');
    const block = source.slice(start, end);
    const match = block.match(/const pct = (.*);/);
    assert.ok(match, 'fixPass declares pct locally');
    assert.match(block, /pct\(ds,\s*0\.05\)/, 'the straight-wall correction calls the local helper');
    const pct = vm.runInNewContext('(' + match[1] + ')');
    assert.equal(pct([20, 0, 10], 0.05), 0);
    assert.equal(pct([20, 0, 10], 0.5), 10);
    assert.equal(pct([20, 0, 10], 1), 20);
});

test('Ctrl+S saves an imported reference and handles save failures', () => {
    const source = fs.readFileSync(path.join(root, 'ui/js/tools.js'), 'utf8');
    const line = source.split('\n').find(x => x.includes("k === 's'"));
    assert.ok(line);
    assert.match(line, /Model\.saveRef\(\)/);
    assert.match(line, /catch\(e => toast\('Save failed: '/);
});
