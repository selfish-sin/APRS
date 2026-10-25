const assert = require('assert');

const calls = [];

global.wx = {
  navigateBack(options) {
    calls.push({ type: 'navigateBack', options });
  },
  redirectTo(options) {
    calls.push({ type: 'redirectTo', options });
  },
  switchTab(options) {
    calls.push({ type: 'switchTab', options });
  },
  reLaunch(options) {
    calls.push({ type: 'reLaunch', options });
  },
};

let stackLength = 1;
global.getCurrentPages = () => new Array(stackLength);

const feedback = require('../utils/feedback');

function lastCall() {
  return calls[calls.length - 1];
}

function run() {
  calls.length = 0;
  stackLength = 1;
  feedback.navigateBack('/pages/projects/index');
  assert.strictEqual(lastCall().type, 'redirectTo');
  assert.strictEqual(lastCall().options.url, '/pages/projects/index');

  calls.length = 0;
  feedback.navigateBack('/pages/board/index');
  assert.strictEqual(lastCall().type, 'switchTab');
  assert.strictEqual(lastCall().options.url, '/pages/board/index');

  calls.length = 0;
  stackLength = 2;
  feedback.navigateBack('/pages/projects/index');
  assert.strictEqual(lastCall().type, 'navigateBack');
  assert.strictEqual(lastCall().options.delta, 1);

  const backCall = lastCall();
  calls.length = 0;
  backCall.options.fail();
  assert.strictEqual(calls[calls.length - 1].type, 'redirectTo');
  assert.strictEqual(
    calls[calls.length - 1].options.url,
    '/pages/projects/index'
  );

  console.log('PASS  non-tab fallback exits archive to project list');
  console.log('PASS  tab fallback uses switchTab');
  console.log('PASS  failed navigateBack falls back to the requested route');
}

run();
