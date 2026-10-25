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
const notices = require('../services/notices');
const store = require('../services/store');
const taskService = require('../services/task-service');

async function run() {
  const admin = accounts.createAccount({
    nickname: '项目经理',
    qq: '888888',
    role: constants.ROLES.ADMIN,
  });
  const chen = accounts.createAccount({
    nickname: '测试工作者',
    qq: '100001',
    role: constants.ROLES.EMPLOYEE,
  });

  assert.strictEqual(store.loadTasks().length, 0);

  const draft = projectService.buildDraftTasks();
  assert.strictEqual(draft.length, constants.PROCESSES.length);
  const byKey = {};
  draft.forEach((task) => {
    byKey[task.processKey] = task;
  });
  assert.strictEqual(byKey.planning.unitKey, 'once');
  assert.strictEqual(byKey.storyboard.unitKey, 'sheet');
  assert.strictEqual(byKey.composite.unitKey, 'second');
  assert.strictEqual(byKey.scene_paint.unitKey, 'scene');
  assert.strictEqual(byKey.voice.unitKey, 'char');
  assert.strictEqual(byKey.sound.unitKey, 'asset');
  assert.strictEqual(byKey.planning.quantity, 1);

  const result = projectService.publishProject(
    {
      name: '测试项目',
      code: 'TEST01',
      description: '用于验证立项与任务量',
      deadline: '2099-01-01',
      tasks: draft,
    },
    admin
  );

  assert.strictEqual(result.project.status, 'published');
  assert.strictEqual(result.project.taskCount, constants.PROCESSES.length);
  assert.strictEqual(
    result.project.taskIds.length,
    constants.PROCESSES.length
  );
  assert.ok(result.project.totalAmount > 0);
  assert.ok(
    result.tasks.every(
      (task) => task.projectId === result.project.id && task.workload
    )
  );

  const loaded = projectService.getProjectWithTasks(result.project.id);
  assert.strictEqual(loaded.tasks.length, constants.PROCESSES.length);
  assert.strictEqual(projectService.listProjects(admin).length, 1);

  assert.throws(
    () =>
      projectService.updateProjectTask(
        result.tasks[0].id,
        { title: '越权修改' },
        chen
      ),
    /只有部门管理员/
  );

  const sheetTask = result.tasks.find((task) => task.category === 'keyframe');
  await taskService.claimTask(sheetTask.id, chen);
  const updated = projectService.updateProjectTask(
    sheetTask.id,
    { quantity: 12, unitPrice: 40, title: '原画 · 修订版' },
    admin
  );
  assert.strictEqual(updated.workload.quantity, 12);
  assert.strictEqual(updated.workload.unitPrice, 40);
  assert.strictEqual(updated.reward, 480);
  assert.strictEqual(updated.title, '原画 · 修订版');
  assert.ok(updated.logs.some((log) => log.type === 'update'));

  const unread = notices.listFor(chen.id).filter((notice) => !notice.read);
  assert.strictEqual(unread.length, 1);
  assert.ok(unread[0].message.indexOf('工作量') >= 0);
  notices.markAllRead(chen.id);
  assert.strictEqual(notices.unreadCount(chen.id), 0);

  const onceTask = result.tasks.find((task) => task.category === 'planning');
  const updatedOnce = projectService.updateProjectTask(
    onceTask.id,
    { quantity: 99, unitPrice: 500 },
    admin
  );
  assert.strictEqual(updatedOnce.workload.quantity, 1);
  assert.strictEqual(updatedOnce.reward, 500);

  const projectTasks = store
    .loadTasks()
    .filter((task) => task.projectId === result.project.id);
  const summed = projectTasks.reduce(
    (sum, task) => sum + (Number(task.reward) || 0),
    0
  );
  const project = projectService.listProjects(admin)[0];
  assert.strictEqual(project.totalAmount, summed);

  const cancelledTask = await taskService.cancelTask(sheetTask.id, admin);
  assert.strictEqual(cancelledTask.status, 'cancelled');
  assert.throws(
    () =>
      projectService.updateProjectTask(
        sheetTask.id,
        { unitPrice: 99 },
        admin
      ),
    /已取消/
  );
  const afterCancel = projectService.listProjects(admin)[0];
  const activeSum = store
    .loadTasks()
    .filter(
      (task) =>
        task.projectId === result.project.id && task.status !== 'cancelled'
    )
    .reduce((sum, task) => sum + (Number(task.reward) || 0), 0);
  assert.strictEqual(afterCancel.totalAmount, activeSum);

  const archived = projectService.archiveProject(
    result.project.id,
    admin
  );
  assert.strictEqual(archived.taskCount, constants.PROCESSES.length);
  assert.strictEqual(archived.cancelledCount, constants.PROCESSES.length - 1);
  const archivedProject = projectService.listProjects(admin)[0];
  assert.strictEqual(archivedProject.status, 'archived');
  const archivedTasks = store
    .loadTasks()
    .filter((task) => task.projectId === result.project.id);
  assert.strictEqual(archivedTasks.length, constants.PROCESSES.length);
  assert.ok(
    archivedTasks.every(
      (task) => task.status === 'cancelled' || task.status === 'done'
    )
  );
  assert.throws(
    () => projectService.archiveProject(result.project.id, admin),
    /已经归档/
  );
  assert.throws(
    () => projectService.archiveProject(result.project.id, chen),
    /只有部门管理员/
  );

  assert.throws(
    () =>
      projectService.publishProject(
        {
          name: 'x',
          deadline: '2099-01-01',
          tasks: draft,
        },
        admin
      ),
    /项目名称/
  );

  await taskService.resetDemoData();
  assert.strictEqual(projectService.listProjects(admin).length, 0);
  assert.strictEqual(store.loadTasks().length, 0);
  assert.strictEqual(notices.listFor(chen.id).length, 0);

  console.log('PASS  project draft covers all 23 processes and units');
  console.log('PASS  publish generates workload, price and reward');
  console.log('PASS  published task edit updates reward, log and worker notice');
  console.log('PASS  cancel task and archive project preserve history correctly');
  console.log('PASS  reset clears projects, notices and tasks');
}

run().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
