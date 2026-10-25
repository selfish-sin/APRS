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
const projectService = require('../services/project-service');
const memberService = require('../services/member-service');
const notices = require('../services/notices');
const store = require('../services/store');
const taskService = require('../services/task-service');

async function run() {
  const admin = accounts.createAccount({
    nickname: '管理人员',
    qq: '777777',
    role: constants.ROLES.ADMIN,
  });
  const chen = accounts.createAccount({
    nickname: '测试工作者',
    qq: '100001',
    role: constants.ROLES.EMPLOYEE,
  });

  const published = projectService.publishProject(
    {
      name: '人员管理测试项目',
      code: 'MEMBER01',
      deadline: '2099-01-01',
      tasks: projectService.buildDraftTasks(),
    },
    admin
  );
  const task = published.tasks.find((item) => item.category === 'keyframe');
  await taskService.claimTask(task.id, chen);

  assert.throws(
    () => memberService.setExecutionRight(chen.id, false, chen),
    /只有部门管理员/
  );

  const suspended = memberService.setExecutionRight(chen.id, false, admin);
  assert.strictEqual(suspended.account.active, false);
  assert.strictEqual(suspended.releasedCount, 1);
  const released = store.loadTasks().find((item) => item.id === task.id);
  assert.strictEqual(released.status, 'open');
  assert.strictEqual(released.assigneeId, '');
  assert.ok(released.logs.some((log) => log.text.indexOf('执行权被停用') >= 0));
  assert.throws(() => session.signIn(chen), /停用执行权/);

  const resumed = memberService.setExecutionRight(chen.id, true, admin);
  assert.strictEqual(resumed.account.active, true);
  const signed = session.signIn(accounts.getAccount(chen.id));
  assert.strictEqual(signed.role, constants.ROLES.EMPLOYEE);
  session.clearSession();

  await taskService.claimTask(task.id, accounts.getAccount(chen.id));
  projectService.updateProjectTask(
    task.id,
    { quantity: 14, unitPrice: 40 },
    admin
  );
  assert.ok(notices.listFor(chen.id).length > 0);

  const adminAccount = accounts.createAccount({
    nickname: '测试管理员',
    qq: '222222',
    role: constants.ROLES.ADMIN,
  });
  assert.throws(
    () => memberService.setExecutionRight(adminAccount.id, false, admin),
    /只可以管理工作者/
  );

  const removed = memberService.deleteMember(chen.id, admin);
  assert.strictEqual(removed.releasedCount, 1);
  assert.strictEqual(accounts.getAccount(chen.id), null);
  assert.strictEqual(notices.listFor(chen.id).length, 0);
  const afterDelete = store.loadTasks().find((item) => item.id === task.id);
  assert.strictEqual(afterDelete.status, 'open');
  assert.strictEqual(afterDelete.assigneeId, '');
  assert.ok(
    afterDelete.logs.some((log) => log.text.indexOf('成员资料被删除') >= 0)
  );

  console.log('PASS  admin can suspend and restore worker execution rights');
  console.log('PASS  suspension releases active tasks and invalidates sign-in');
  console.log('PASS  deleting a member removes profile, notices and active tasks');
  console.log('PASS  admin accounts are protected from member management');
}

run().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
