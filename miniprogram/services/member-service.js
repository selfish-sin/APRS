const constants = require('../utils/constants');
const accounts = require('./accounts');
const notices = require('./notices');
const store = require('./store');
const idUtil = require('../utils/id');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureAdmin(actor) {
  assert(
    actor && actor.role === constants.ROLES.ADMIN,
    '只有部门管理员可以管理人员资料'
  );
}

function releaseActiveTasks(account, actor, reason) {
  const tasks = store.loadTasks();
  const now = Date.now();
  let released = 0;
  tasks.forEach((task) => {
    if (
      task.assigneeId === account.id &&
      (task.status === 'in_progress' || task.status === 'in_review')
    ) {
      task.status = 'open';
      task.assigneeId = '';
      task.assigneeName = '';
      task.reviewNote = '';
      task.updatedAt = now;
      task.logs = task.logs || [];
      task.logs.push({
        id: idUtil.logId(),
        type: 'update',
        actor: actor.name,
        text: `${reason}，任务退回待接取`,
        at: now,
      });
      released += 1;
    }
  });
  if (released > 0) {
    store.saveTasks(tasks);
  }
  return released;
}

function setExecutionRight(accountId, enabled, actor) {
  ensureAdmin(actor);
  const account = accounts.getAccount(accountId);
  assert(!!account, '成员资料不存在');
  assert(
    account.role === constants.ROLES.EMPLOYEE,
    '只可以管理工作者资料'
  );
  assert(typeof enabled === 'boolean', '请选择执行权状态');

  accounts.setAccountActive(accountId, enabled);
  let releasedCount = 0;
  if (!enabled) {
    releasedCount = releaseActiveTasks(
      account,
      actor,
      '工作者执行权被停用'
    );
    notices.removeForAccount(accountId);
  }

  return {
    account: accounts.getAccount(accountId),
    releasedCount,
  };
}

function deleteMember(accountId, actor) {
  ensureAdmin(actor);
  const account = accounts.getAccount(accountId);
  assert(!!account, '成员资料不存在');
  assert(
    account.role === constants.ROLES.EMPLOYEE,
    '只可以管理工作者资料'
  );

  const releasedCount = releaseActiveTasks(
    account,
    actor,
    '成员资料被删除'
  );
  notices.removeForAccount(accountId);
  accounts.deleteAccount(accountId);
  return {
    name: account.nickname,
    releasedCount,
  };
}

module.exports = {
  setExecutionRight,
  deleteMember,
};
