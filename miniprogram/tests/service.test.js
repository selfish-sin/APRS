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
const sessionService = require('../services/session');
const taskService = require('../services/task-service');
const projectService = require('../services/project-service');
const store = require('../services/store');

async function run() {
  const admin = accounts.createAccount({
    nickname: '流程管理员',
    qq: '900000',
    role: constants.ROLES.ADMIN,
  });
  const chen = accounts.createAccount({
    nickname: '流程工作者',
    qq: '900001',
    role: constants.ROLES.EMPLOYEE,
  });
  const su = accounts.createAccount({
    nickname: '第二工作者',
    qq: '900002',
    role: constants.ROLES.EMPLOYEE,
  });

  assert.strictEqual(store.loadTasks().length, 0);

  const published = projectService.publishProject(
    {
      name: '流程测试项目',
      code: 'FLOW01',
      deadline: '2099-01-01',
      tasks: projectService.buildDraftTasks(),
    },
    admin
  );

  const adminBoard = await taskService.getBoard(admin, {});
  assert.strictEqual(adminBoard.tasks.length, constants.PROCESSES.length);
  assert.strictEqual(adminBoard.activeFilter, 'all');
  assert.strictEqual(adminBoard.stats.open, constants.PROCESSES.length);
  assert.strictEqual(adminBoard.stats.in_progress, 0);
  assert.strictEqual(adminBoard.stats.in_review, 0);
  assert.strictEqual(adminBoard.stats.done, 0);

  const employeeBoard = await taskService.getBoard(chen, {});
  assert.strictEqual(employeeBoard.activeFilter, 'open');
  assert.strictEqual(employeeBoard.tasks.length, constants.PROCESSES.length);
  assert.ok(employeeBoard.tasks.every((task) => task.status === 'open'));
  assert.ok(employeeBoard.tasks.every((task) => task.action === 'claim'));
  assert.deepStrictEqual(
    employeeBoard.stages.map((stage) => stage.count),
    [5, 5, 13]
  );

  const preBoard = await taskService.getBoard(chen, { stage: 'pre' });
  assert.strictEqual(preBoard.tasks.length, 5);
  assert.ok(preBoard.tasks.every((task) => task.stageKey === 'pre'));
  assert.strictEqual(preBoard.processes.length, 5);

  const midBoard = await taskService.getBoard(chen, {
    stage: 'mid',
    process: 'keyframe',
  });
  assert.strictEqual(midBoard.tasks.length, 1);
  assert.strictEqual(midBoard.tasks[0].category, 'keyframe');

  const target = employeeBoard.tasks[0];

  await assert.rejects(
    () =>
      taskService.createTask(
        {
          title: '非法委托',
          category: 'keyframe',
          priority: 'normal',
          dueDate: '2099-01-01',
          reward: 100,
        },
        chen
      ),
    /只有部门管理员/
  );

  const claimed = await taskService.claimTask(target.id, chen);
  assert.strictEqual(claimed.status, 'in_progress');
  assert.strictEqual(claimed.assigneeId, chen.id);
  assert.strictEqual(claimed.action, 'submit');

  const submitted = await taskService.submitTask(target.id, chen);
  assert.strictEqual(submitted.status, 'in_review');
  assert.strictEqual(submitted.actionLabel, '待验收');

  const adminReview = await taskService.getBoard(admin, {
    filter: 'in_review',
  });
  assert.ok(adminReview.tasks.some((task) => task.id === target.id));

  const myReview = await taskService.getBoard(chen, {
    filter: 'in_review',
  });
  assert.strictEqual(myReview.tasks.length, 1);
  assert.strictEqual(myReview.tasks[0].id, target.id);

  await assert.rejects(
    () => taskService.reviewTask(target.id, admin, 'return', ''),
    /修改意见/
  );

  const returned = await taskService.reviewTask(
    target.id,
    admin,
    'return',
    '请补充交付说明'
  );
  assert.strictEqual(returned.status, 'in_progress');
  assert.strictEqual(returned.reviewNote, '请补充交付说明');

  await taskService.submitTask(target.id, chen);
  const approved = await taskService.reviewTask(
    target.id,
    admin,
    'approve',
    '通过'
  );
  assert.strictEqual(approved.status, 'done');
  assert.strictEqual(approved.dueLabel, '已归档');

  await assert.rejects(
    () => taskService.reviewTask(target.id, chen, 'approve', ''),
    /只有部门管理员/
  );
  await assert.rejects(
    () => taskService.claimTask(target.id, admin),
    /只有工作者/
  );

  const beforeCount = store.loadTasks().length;
  const poolTask = await taskService.createTask(
    {
      title: '测试公开委托',
      description: '用于验证公开接取流程',
      category: 'scene_paint',
      priority: 'normal',
      batch: 'TEST · SC01',
      dueDate: '2099-01-01',
      reward: 80,
    },
    admin
  );
  assert.strictEqual(poolTask.status, 'open');
  assert.strictEqual(poolTask.assigneeId, '');
  assert.strictEqual(poolTask.stageKey, 'post');

  const assignedTask = await taskService.createTask(
    {
      title: '测试指派委托',
      category: 'paint',
      priority: 'urgent',
      batch: 'TEST · SC02',
      dueDate: '2099-01-02',
      reward: 120,
      assigneeId: su.id,
    },
    admin
  );
  assert.strictEqual(assignedTask.status, 'in_progress');
  assert.strictEqual(assignedTask.assigneeId, su.id);
  assert.strictEqual(store.loadTasks().length, beforeCount + 2);

  const searchBoard = await taskService.getBoard(admin, {
    filter: 'all',
    keyword: '测试公开',
  });
  assert.strictEqual(searchBoard.tasks.length, 1);
  assert.strictEqual(searchBoard.tasks[0].id, poolTask.id);

  const secondOpen = await taskService.getBoard(chen, { filter: 'open' });
  const secondTarget = secondOpen.tasks[0];
  await taskService.claimTask(secondTarget.id, chen);

  const mine = await taskService.getBoard(chen, { filter: 'mine' });
  assert.ok(mine.tasks.length >= 1);
  assert.ok(
    mine.tasks.every(
      (task) => task.assigneeId === chen.id && task.status !== 'done'
    )
  );

  const myDone = await taskService.getBoard(chen, { filter: 'done' });
  assert.ok(myDone.tasks.every((task) => task.assigneeId === chen.id));
  assert.ok(myDone.tasks.some((task) => task.id === target.id));

  const profile = await taskService.getProfile(chen);
  assert.strictEqual(profile.user.id, chen.id);
  assert.ok(profile.myTaskCount >= 2);
  assert.strictEqual(profile.team.length, 2);
  assert.ok(
    profile.team.every((member) => member.qq === ''),
    'worker viewer must not receive QQ numbers'
  );

  const adminProfile = await taskService.getProfile(admin);
  assert.ok(
    adminProfile.team.every((member) => member.qq),
    'admin viewer receives member QQ numbers'
  );
  assert.strictEqual(adminProfile.myTasks.length, 0);

  const signed = sessionService.signIn(chen);
  assert.strictEqual(signed.role, 'employee');
  assert.strictEqual(sessionService.getSession().user.name, chen.name);
  sessionService.clearSession();
  assert.strictEqual(sessionService.getSession(), null);

  await taskService.resetDemoData();
  const resetBoard = await taskService.getBoard(admin, {});
  assert.strictEqual(resetBoard.tasks.length, 0);
  assert.strictEqual(projectService.listProjects(admin).length, 0);

  storage[store.DATA_KEY] = { version: 1, tasks: [{ id: 'broken' }] };
  const repaired = store.loadTasks();
  assert.strictEqual(repaired.length, 0);

  assert.strictEqual(published.project.status, 'published');
  console.log('PASS  empty install and project-generated task flow');
  console.log('PASS  pre / mid / post stages and process filters');
  console.log('PASS  claim -> submit -> return -> resubmit -> approve');
  console.log('PASS  permissions, assignment, search, profile, session, reset');
  console.log('PASS  stale local task cache is cleared');
}

run().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
