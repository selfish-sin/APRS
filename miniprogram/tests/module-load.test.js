// Loads every mini program script with stubbed WeChat globals.
// Catches syntax errors and top-level failures that page rendering would hit.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'tests', 'tools', '.git', '.preview']);

const storage = Object.create(null);

global.wx = {
  getStorageSync(key) {
    return storage[key] !== undefined ? storage[key] : '';
  },
  setStorageSync(key, value) {
    storage[key] = value;
  },
  removeStorageSync(key) {
    delete storage[key];
  },
  getWindowInfo() {
    return {
      statusBarHeight: 44,
      screenHeight: 812,
      windowWidth: 375,
      windowHeight: 812,
      safeArea: { top: 44, bottom: 778 },
    };
  },
  getMenuButtonBoundingClientRect() {
    return { top: 48, height: 32, left: 280, width: 87 };
  },
  vibrateShort() {},
  showToast() {},
  showModal() {},
};

global.App = function App() {};
global.Page = function Page() {};
global.Component = function Component() {};
global.getApp = () => ({ globalData: {} });
global.getCurrentPages = () => [];

function collect(dir, files) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (SKIP_DIRS.has(entry.name)) {
      return;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(fullPath, files);
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  });
}

const files = [];
collect(ROOT, files);

let failures = 0;
files.forEach((file) => {
  try {
    require(file);
  } catch (error) {
    failures += 1;
    console.log('FAIL ', path.relative(ROOT, file), '-', error.message);
  }
});

if (failures > 0) {
  console.log(`FAIL  ${failures} script(s) failed to load`);
  process.exit(1);
}

console.log(`PASS  ${files.length} mini program scripts loaded without errors`);
