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
const projectService = require('../services/project-service');
const rankingService = require('../services/ranking-service');
const store = require('../services/store');
const taskService = require('../services/task-service');

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

async function run() {
  const admin = accounts.createAccount({
    nickname: '结算管理员',
    qq: '700000',
    role: constants.ROLES.ADMIN,
  });
  const chen = accounts.createAccount({
    nickname: '甲工作者',
    qq: '700001',
    role: constants.ROLES.EMPLOYEE,
  });
  const su = accounts.createAccount({
    nickname: '乙工作者',
    qq: '700002',
    role: constants.ROLES.EMPLOYEE,
  });

  const published = projectService.publishProject(
    {
      name: '月度结算项目',
      code: 'RANK01',
      deadline: '2099-01-01',
      tasks: projectService.buildDraftTasks(),
    },
    admin
  );

  const byCategory = {};
  published.tasks.forEach((task) => {
    byCategory[task.category] = task;
  });

  async function complete(task, worker) {
    await taskService.claimTask(task.id, worker);
    await taskService.submitTask(task.id, worker);
    await taskService.reviewTask(task.id, admin, 'approve', '通过');
    return task;
  }

  await complete(byCategory.composite, chen);
  await complete(byCategory.scene_paint, su);
  await complete(byCategory.voice, su);
  await complete(byCategory.planning, chen);

  const now = new Date();
  const currentKey = monthKey(now);
  const currentStamp = new Date(
    now.getFullYear(),
    now.getMonth(),
    15,
    12,
    0,
    0
  ).getTime();
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
  const previousKey = monthKey(previousDate);
  const previousStamp = previousDate.getTime();

  const tasks = store.loadTasks();
  tasks.forEach((task) => {
    if (task.id === byCategory.composite.id) {
      task.completedAt = currentStamp;
    }
    if (task.id === byCategory.scene_paint.id) {
      task.completedAt = currentStamp;
    }
    if (task.id === byCategory.voice.id) {
      task.completedAt = currentStamp;
    }
    if (task.id === byCategory.planning.id) {
      task.completedAt = previousStamp;
    }
  });
  store.saveTasks(tasks);

  const current = rankingService.getMonthlyRanking(admin, {
    month: currentKey,
  });
  assert.strictEqual(current.rows.length, 2);
  assert.strictEqual(current.rows[0].name, '甲工作者');
  assert.strictEqual(current.rows[0].rank, 1);
  assert.strictEqual(current.rows[0].reward, byCategory.composite.reward);
  assert.strictEqual(current.rows[0].taskCount, 1);
  assert.ok(
    current.rows[0].unitStats.some(
      (unit) => unit.key === 'second' && unit.quantity > 0
    )
  );
  assert.strictEqual(current.rows[1].name, '乙工作者');
  assert.strictEqual(current.rows[1].reward, byCategory.scene_paint.reward + byCategory.voice.reward);
  assert.strictEqual(current.rows[1].taskCount, 2);
  assert.strictEqual(
    current.summary.totalReward,
    current.rows[0].reward + current.rows[1].reward
  );
  assert.strictEqual(current.summary.totalTasks, 3);
  assert.strictEqual(current.monthLabel, `${now.getFullYear()} 年 ${now.getMonth() + 1} 月`);
  assert.ok(current.months.some((month) => month.key === previousKey));
  assert.strictEqual(current.months[0].key, currentKey);
  assert.strictEqual(current.isAdmin, true);

  const workerView = rankingService.getMonthlyRanking(su, {
    month: currentKey,
  });
  assert.strictEqual(workerView.rows[1].isMe, true);
  assert.strictEqual(workerView.myRank, 2);
  assert.strictEqual(workerView.myReward, current.rows[1].reward);

  const previous = rankingService.getMonthlyRanking(admin, {
    month: previousKey,
  });
  assert.strictEqual(previous.rows.length, 1);
  assert.strictEqual(previous.rows[0].name, '甲工作者');
  assert.strictEqual(previous.rows[0].reward, byCategory.planning.reward);

  const empty = rankingService.getMonthlyRanking(admin, {
    month: '2000-01',
  });
  assert.strictEqual(empty.rows.length, 0);
  assert.strictEqual(empty.summary.totalReward, 0);

  const deletedWorker = accounts.createAccount({
    nickname: '丙工作者',
    qq: '700003',
    role: constants.ROLES.EMPLOYEE,
  });
  await complete(byCategory.sound, deletedWorker);
  const afterDeleteTasks = store.loadTasks();
  afterDeleteTasks.forEach((task) => {
    if (task.id === byCategory.sound.id) {
      task.completedAt = currentStamp;
    }
  });
  store.saveTasks(afterDeleteTasks);
  accounts.deleteAccount(deletedWorker.id);
  const withRemoved = rankingService.getMonthlyRanking(admin, {
    month: currentKey,
  });
  assert.ok(withRemoved.rows.some((row) => row.removed && row.name === '丙工作者'));
  assert.strictEqual(withRemoved.rows.length, 3);

  console.log('PASS  monthly ranking aggregates settlement reward and tasks');
  console.log('PASS  workload units and stage distribution are preserved');
  console.log('PASS  month switcher includes current and historical months');
  console.log('PASS  worker view highlights own rank and rewards');
  console.log('PASS  removed members keep their historical settlement rows');
}

run().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
