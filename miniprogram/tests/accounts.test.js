const assert = require('assert');

const storage = Object.create(null);

global.wx = {
  getStorageSync(key) {
    return storage[key] !== undefined
      ? JSON.parse(JSON.stringify(storage[key]))
      : '';
  },
  setStorageSync(key, value) {
    storage[key] = JSON.parse(JSON.stringify(value));
  },
  removeStorageSync(key) {
    delete storage[key];
  },
};

const constants = require('../utils/constants');
const accounts = require('../services/accounts');
const session = require('../services/session');

function run() {
  assert.strictEqual(constants.ADMIN_SECRET, 'APRS1023');
  assert.strictEqual(accounts.listAccounts().length, 0);
  assert.strictEqual(accounts.listWorkers().length, 0);
  assert.strictEqual(accounts.findAccount('100001', 'employee'), null);

  const worker = accounts.createAccount({
    nickname: '测试工作者',
    qq: '12345678',
    role: constants.ROLES.EMPLOYEE,
  });
  assert.strictEqual(worker.role, constants.ROLES.EMPLOYEE);
  assert.strictEqual(worker.qq, '12345678');
  assert.strictEqual(worker.name, '测试工作者');
  assert.strictEqual(worker.active, true);
  assert.ok(worker.id);
  assert.ok(accounts.findAccount('12345678', constants.ROLES.EMPLOYEE));

  assert.throws(
    () =>
      accounts.createAccount({
        nickname: '重复工作者',
        qq: '12345678',
        role: constants.ROLES.EMPLOYEE,
      }),
    /已登记工作者/
  );

  const admin = accounts.createAccount({
    nickname: '测试管理员',
    qq: '12345678',
    role: constants.ROLES.ADMIN,
  });
  assert.strictEqual(admin.role, constants.ROLES.ADMIN);
  assert.strictEqual(accounts.listWorkers().length, 1);
  assert.strictEqual(accounts.listAccounts().length, 2);

  assert.throws(
    () =>
      accounts.createAccount({
        nickname: '重复管理员',
        qq: '12345678',
        role: constants.ROLES.ADMIN,
      }),
    /已登记管理员/
  );

  assert.throws(
    () =>
      accounts.createAccount({
        nickname: '错误 QQ',
        qq: 'abc',
        role: constants.ROLES.EMPLOYEE,
      }),
    /QQ 号/
  );

  const signed = session.signIn(worker);
  assert.strictEqual(signed.role, constants.ROLES.EMPLOYEE);
  assert.strictEqual(session.getSession().user.qq, '12345678');
  session.clearSession();
  assert.strictEqual(session.getSession(), null);

  console.log('PASS  new installations start with no member profiles');
  console.log('PASS  one admin and one employee account per QQ');
  console.log('PASS  account validation and session sign-in');
}

run();
