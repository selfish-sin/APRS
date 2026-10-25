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
const store = require('../services/store');
const taskService = require('../services/task-service');

async function run() {
  const admin = accounts.createAccount({
    nickname: '归档管理员',
    qq: '600000',
    role: constants.ROLES.ADMIN,
  });
  const worker = accounts.createAccount({
    nickname: '归档工作者',
    qq: '600001',
    role: constants.ROLES.EMPLOYEE,
  });

  const first = projectService.publishProject(
    {
      name: '待归档项目',
      code: 'ARCH01',
      deadline: '2099-01-01',
      tasks: projectService.buildDraftTasks(),
    },
    admin
  );

  const openTask = first.tasks.find((task) => task.category === 'planning');
  const progressTask = first.tasks.find((task) => task.category === 'keyframe');
  const reviewTask = first.tasks.find((task) => task.category === 'paint');

  await taskService.claimTask(progressTask.id, worker);
  await taskService.claimTask(reviewTask.id, worker);
  await taskService.submitTask(reviewTask.id, worker);
  assert.strictEqual(openTask.status, 'open');

  const archived = projectService.archiveProject(first.project.id, admin);
  assert.strictEqual(archived.cancelledCount, constants.PROCESSES.length);
  const archivedTasks = store
    .loadTasks()
    .filter((task) => task.projectId === first.project.id);
  assert.strictEqual(archivedTasks.length, constants.PROCESSES.length);
  assert.ok(
    archivedTasks.every(
      (task) => task.status === 'cancelled' && task.archivedFromStatus
    )
  );

  const activeAfterArchive = projectService.listActiveProjects(admin);
  assert.strictEqual(activeAfterArchive.length, 0);

  const archiveList = projectService.listArchivedProjects(admin);
  assert.strictEqual(archiveList.length, 1);
  const entry = archiveList[0];
  assert.strictEqual(entry.name, '待归档项目');
  assert.strictEqual(entry.archiveStats.total, constants.PROCESSES.length);
  assert.strictEqual(entry.archiveStats.recruiting, constants.PROCESSES.length - 2);
  assert.strictEqual(entry.archiveStats.inProgress, 1);
  assert.strictEqual(entry.archiveStats.inReview, 1);
  assert.strictEqual(entry.archiveStats.done, 0);

  const detail = projectService.getProjectWithTasks(first.project.id);
  assert.strictEqual(detail.archiveStats.recruiting, constants.PROCESSES.length - 2);
  assert.strictEqual(detail.archiveStats.inProgress, 1);
  assert.strictEqual(detail.archiveStats.inReview, 1);

  const second = projectService.publishProject(
    {
      name: '继续中的项目',
      code: 'ARCH02',
      deadline: '2099-01-01',
      tasks: projectService.buildDraftTasks(),
    },
    admin
  );
  assert.strictEqual(projectService.listActiveProjects(admin).length, 1);

  const third = projectService.publishProject(
    {
      name: '第二个归档项目',
      code: 'ARCH03',
      deadline: '2099-01-01',
      tasks: projectService.buildDraftTasks(),
    },
    admin
  );
  projectService.archiveProject(third.project.id, admin);
  assert.strictEqual(projectService.listArchivedProjects(admin).length, 2);

  assert.throws(
    () => projectService.listArchivedProjects(worker),
    /只有部门管理员/
  );
  assert.throws(
    () => projectService.clearArchivedProject(first.project.id, worker),
    /只有部门管理员/
  );
  assert.throws(
    () => projectService.clearArchivedProject(second.project.id, admin),
    /只能清除已归档项目/
  );

  const singleCleared = projectService.clearArchivedProject(
    first.project.id,
    admin
  );
  assert.strictEqual(singleCleared.name, '待归档项目');
  assert.strictEqual(singleCleared.taskCount, constants.PROCESSES.length);
  assert.strictEqual(projectService.listArchivedProjects(admin).length, 1);
  assert.strictEqual(projectService.listActiveProjects(admin).length, 1);
  assert.ok(
    !store
      .loadTasks()
      .some((task) => task.projectId === first.project.id)
  );

  const cleared = projectService.clearArchivedProjects(admin);
  assert.strictEqual(cleared.projectCount, 1);
  assert.strictEqual(cleared.taskCount, constants.PROCESSES.length);
  assert.strictEqual(projectService.listArchivedProjects(admin).length, 0);
  assert.strictEqual(projectService.listActiveProjects(admin).length, 1);
  assert.strictEqual(
    store.loadTasks().filter((task) => task.projectId === second.project.id)
      .length,
    constants.PROCESSES.length
  );

  const again = projectService.clearArchivedProjects(admin);
  assert.strictEqual(again.projectCount, 0);
  assert.strictEqual(again.taskCount, 0);

  console.log('PASS  archived projects live in a dedicated archive list');
  console.log('PASS  archive keeps recruiting, in-progress and review states apart');
  console.log('PASS  single and full archive clearing remove only archived data');
  console.log('PASS  active projects and worker permissions are protected');
}

run().catch((error) => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
