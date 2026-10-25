const store = require('./store');
const projectStore = require('./project-store');
const notices = require('./notices');
const constants = require('../utils/constants');
const dateUtil = require('../utils/date');
const idUtil = require('../utils/id');

const DEFAULT_RATES = {
  once: { quantity: 1, unitPrice: 300 },
  sheet: { quantity: 10, unitPrice: 30 },
  second: { quantity: 30, unitPrice: 20 },
  scene: { quantity: 4, unitPrice: 80 },
  char: { quantity: 200, unitPrice: 1 },
  asset: { quantity: 20, unitPrice: 5 },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function toInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.round(number);
}

function toPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    return -1;
  }
  return Math.round(number);
}

function calculateTotal(quantity, unitPrice) {
  return Math.round(quantity * unitPrice);
}

function buildDraftTasks() {
  return constants.PROCESSES.map((process) => {
    const rate = DEFAULT_RATES[process.unitKey] || DEFAULT_RATES.sheet;
    const quantity = process.unitKey === 'once' ? 1 : rate.quantity;
    const unitPrice = rate.unitPrice;
    return {
      key: process.key,
      processKey: process.key,
      name: process.name,
      stageKey: process.stage,
      stageName: process.stageName,
      stageColor: constants.getStage(process.stage).color,
      stageSoft: constants.getStage(process.stage).soft,
      unitKey: process.unitKey,
      unitLabel: process.unitLabel,
      unitName: process.unitName,
      quantity,
      unitPrice,
      total: calculateTotal(quantity, unitPrice),
      title: process.name,
      description: `请补充本项目的${process.name}交付要求。`,
      enabled: true,
      editable: true,
      taskId: '',
    };
  });
}

function archiveGroupOf(task) {
  if (task.status === 'done') {
    return 'done';
  }
  if (task.status !== 'cancelled') {
    return 'other';
  }
  if (task.archivedFromStatus === 'open') {
    return 'recruiting';
  }
  if (task.archivedFromStatus === 'in_progress') {
    return 'inProgress';
  }
  if (task.archivedFromStatus === 'in_review') {
    return 'inReview';
  }
  return task.assigneeId ? 'inProgress' : 'recruiting';
}

function archiveLabelOf(task) {
  const group = archiveGroupOf(task);
  if (group === 'recruiting') {
    return '归档时招揽中';
  }
  if (group === 'inProgress') {
    return '归档时进行中';
  }
  if (group === 'inReview') {
    return '归档时待验收';
  }
  if (group === 'done') {
    return '已完成';
  }
  return constants.getStatus(task.status).name;
}

function archiveToneOf(task) {
  const group = archiveGroupOf(task);
  if (group === 'inProgress') {
    return 'progress';
  }
  if (group === 'inReview') {
    return 'review';
  }
  return group;
}

function summarizeArchiveTasks(tasks) {
  const stats = {
    total: tasks.length,
    recruiting: 0,
    inProgress: 0,
    inReview: 0,
    done: 0,
    other: 0,
  };
  tasks.forEach((task) => {
    const group = archiveGroupOf(task);
    if (stats[group] !== undefined) {
      stats[group] += 1;
    } else {
      stats.other += 1;
    }
  });
  return stats;
}

function toDraftTask(task) {
  const process = constants.getCategory(task.category);
  const stage = constants.getStageOfCategory(task.category);
  const workload = task.workload || {
    quantity: 1,
    unitKey: 'once',
    unitLabel: '项',
    unitPrice: Number(task.reward) || 0,
    total: Number(task.reward) || 0,
  };
  return {
    key: process.key,
    taskId: task.id,
    processKey: process.key,
    name: process.name,
    stageKey: stage.key,
    stageName: stage.name,
    stageColor: stage.color,
    stageSoft: stage.soft,
    unitKey: workload.unitKey || process.unitKey,
    unitLabel: workload.unitLabel || process.unitLabel,
    unitName: process.unitName,
    quantity: workload.quantity,
    unitPrice: workload.unitPrice,
    total: Number(task.reward) || workload.total,
    title: task.title,
    description: task.description,
    enabled: task.status !== 'cancelled',
    editable: task.status !== 'cancelled',
    cancellable: task.status !== 'done' && task.status !== 'cancelled',
    status: task.status,
    statusName: constants.getStatus(task.status).name,
    statusColor: constants.getStatus(task.status).color,
    assigneeName: task.assigneeName || '',
    archiveGroup: archiveGroupOf(task),
    archiveTone: archiveToneOf(task),
    archiveLabel: archiveLabelOf(task),
  };
}

function ensureAdmin(actor) {
  assert(
    actor && actor.role === constants.ROLES.ADMIN,
    '只有部门管理员可以管理项目'
  );
}

function publishProject(input, actor) {
  ensureAdmin(actor);
  const source = input || {};
  const name = String(source.name || '').trim();
  const code = String(source.code || '').trim();
  const description = String(source.description || '').trim();
  const deadline = dateUtil.parseDateKey(source.deadline)
    ? source.deadline
    : dateUtil.addDaysKey(30);
  const draftTasks = Array.isArray(source.tasks) ? source.tasks : [];

  assert(name.length >= 2 && name.length <= 30, '项目名称需要 2 到 30 个字符');
  assert(code.length <= 20, '项目编号不能超过 20 个字符');
  assert(description.length <= 300, '项目说明不能超过 300 个字符');

  const tasks = store.loadTasks();
  const projectId = idUtil.projectId();
  const now = Date.now();
  const createdTasks = [];
  let totalAmount = 0;

  draftTasks.forEach((draft) => {
    if (!draft || draft.enabled === false) {
      return;
    }
    const process = constants.findProcess(draft.processKey);
    assert(!!process, '项目包含无效的任务工序');
    const quantity = process.unitKey === 'once' ? 1 : toInteger(draft.quantity);
    const unitPrice = toPrice(draft.unitPrice);
    assert(quantity > 0, `${process.name}的工作量需要大于 0`);
    assert(unitPrice >= 0, `${process.name}的单价不能小于 0`);
    const relativeTitle = String(draft.title || '').trim();
    const title =
      relativeTitle && relativeTitle !== process.name
        ? relativeTitle
        : `${name} · ${process.name}`;
    assert(title.length <= 40, `${process.name}的任务标题不能超过 40 个字符`);
    const taskDescription =
      String(draft.description || '').trim() ||
      `完成《${name}》的${process.name}工作。`;
    assert(
      taskDescription.length <= 500,
      `${process.name}的任务说明不能超过 500 个字符`
    );

    const workload = {
      quantity,
      unitKey: process.unitKey,
      unitLabel: process.unitLabel,
      unitPrice,
      total: calculateTotal(quantity, unitPrice),
    };
    totalAmount += workload.total;

    const taskId = idUtil.nextTaskId(tasks);
    const task = {
      id: taskId,
      projectId,
      projectName: name,
      title,
      description: taskDescription,
      stage: process.stage,
      category: process.key,
      priority: 'normal',
      status: 'open',
      batch: code || name,
      dueDate: deadline,
      reward: workload.total,
      workload,
      assigneeId: '',
      assigneeName: '',
      creatorId: actor.id,
      creatorName: actor.name,
      reviewNote: '',
      createdAt: now,
      updatedAt: now,
      completedAt: 0,
      logs: [
        {
          id: idUtil.logId(),
          type: 'create',
          actor: actor.name,
          text: `项目立项发布：${name} · ${process.name}`,
          at: now,
        },
      ],
    };
    tasks.push(task);
    createdTasks.push(task);
  });

  assert(createdTasks.length > 0, '请至少启用一项任务');

  store.saveTasks(tasks);

  const project = {
    id: projectId,
    name,
    code,
    description,
    status: 'published',
    deadline,
    createdBy: actor.id,
    createdByName: actor.name,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    taskIds: createdTasks.map((task) => task.id),
    taskCount: createdTasks.length,
    totalAmount,
  };
  projectStore.createProject(project);

  return { project, tasks: createdTasks };
}

function getProjectWithTasks(projectId) {
  const project = projectStore.getProject(projectId);
  if (!project) {
    throw new Error('项目不存在或已被移除');
  }
  const allTasks = store.loadTasks();
  const byId = {};
  allTasks.forEach((task) => {
    byId[task.id] = task;
  });
  const tasks = project.taskIds
    .map((taskId) => byId[taskId])
    .filter(Boolean)
    .sort(
      (left, right) =>
        constants.getStageOfCategory(left.category).order -
          constants.getStageOfCategory(right.category).order ||
        constants.getCategory(left.category).order -
          constants.getCategory(right.category).order
    );
  return {
    project,
    tasks,
    archiveStats: summarizeArchiveTasks(tasks),
  };
}

function listProjects(actor) {
  ensureAdmin(actor);
  const projects = projectStore.listProjects();
  projects.sort((left, right) => {
    const leftArchived = left.status === 'archived' ? 1 : 0;
    const rightArchived = right.status === 'archived' ? 1 : 0;
    if (leftArchived !== rightArchived) {
      return leftArchived - rightArchived;
    }
    return right.createdAt - left.createdAt;
  });
  return projects;
}

function listActiveProjects(actor) {
  return listProjects(actor).filter(
    (project) => project.status !== 'archived'
  );
}

function listArchivedProjects(actor) {
  ensureAdmin(actor);
  const tasks = store.loadTasks();
  const byId = {};
  tasks.forEach((task) => {
    byId[task.id] = task;
  });

  return projectStore
    .listProjects()
    .filter((project) => project.status === 'archived')
    .sort((left, right) => (right.archivedAt || 0) - (left.archivedAt || 0))
    .map((project) => {
      const projectTasks = project.taskIds
        .map((taskId) => byId[taskId])
        .filter(Boolean);
      const stats = summarizeArchiveTasks(projectTasks);
      return Object.assign({}, project, {
        archivedLabel: dateUtil.formatDateTime(
          project.archivedAt || project.updatedAt
        ),
        totalTasks: stats.total,
        totalReward: projectTasks.reduce(
          (sum, task) => sum + (Number(task.reward) || 0),
          0
        ),
        archiveStats: stats,
      });
    });
}

function clearArchivedProject(projectId, actor) {
  ensureAdmin(actor);
  const project = projectStore.getProject(projectId);
  assert(!!project, '项目不存在或已被移除');
  assert(project.status === 'archived', '只能清除已归档项目');

  const tasks = store.loadTasks();
  const removedTasks = tasks.filter((task) => task.projectId === projectId);
  const remainingTasks = tasks.filter((task) => task.projectId !== projectId);
  store.saveTasks(remainingTasks);
  notices.removeForTasks(removedTasks.map((task) => task.id));
  projectStore.deleteProject(projectId);

  return {
    name: project.name,
    taskCount: removedTasks.length,
  };
}

function clearArchivedProjects(actor) {
  ensureAdmin(actor);
  const archived = projectStore
    .listProjects()
    .filter((project) => project.status === 'archived');
  if (!archived.length) {
    return { projectCount: 0, taskCount: 0 };
  }

  const ids = {};
  archived.forEach((project) => {
    ids[project.id] = true;
  });

  const tasks = store.loadTasks();
  const removedTasks = tasks.filter((task) => ids[task.projectId]);
  const remainingTasks = tasks.filter((task) => !ids[task.projectId]);
  store.saveTasks(remainingTasks);
  notices.removeForTasks(removedTasks.map((task) => task.id));
  projectStore.clearArchived();

  return {
    projectCount: archived.length,
    taskCount: removedTasks.length,
  };
}

function updateProjectTask(taskId, patch, actor) {
  ensureAdmin(actor);
  const tasks = store.loadTasks();
  let task = null;
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].id === taskId) {
      task = tasks[index];
      break;
    }
  }
  assert(!!task, '委托不存在或已被移除');
  assert(!!task.projectId, '只有项目委托可以在这里修改');
  assert(task.status !== 'cancelled', '已取消的任务不能再修改');
  const project = projectStore.getProject(task.projectId);
  assert(!!project, '项目不存在或已被移除');
  assert(project.status !== 'archived', '已归档项目不能再修改任务');

  const process = constants.getCategory(task.category);
  const oldWorkload = task.workload || {
    quantity: 1,
    unitKey: 'once',
    unitLabel: '项',
    unitPrice: Number(task.reward) || 0,
    total: Number(task.reward) || 0,
  };
  const source = patch || {};
  const nextTitle =
    source.title === undefined
      ? task.title
      : String(source.title || '').trim();
  const nextDescription =
    source.description === undefined
      ? task.description
      : String(source.description || '').trim();
  const nextQuantity =
    process.unitKey === 'once'
      ? 1
      : source.quantity === undefined
        ? oldWorkload.quantity
        : toInteger(source.quantity);
  const nextUnitPrice =
    source.unitPrice === undefined
      ? oldWorkload.unitPrice
      : toPrice(source.unitPrice);

  assert(nextTitle.length >= 1 && nextTitle.length <= 40, '任务标题需要 1 到 40 个字符');
  assert(nextDescription.length <= 500, '任务说明不能超过 500 个字符');
  assert(nextQuantity > 0, '工作量需要大于 0');
  assert(nextUnitPrice >= 0, '单价不能小于 0');

  const changes = [];
  if (nextTitle !== task.title) {
    changes.push('任务标题已更新');
  }
  if (nextDescription !== task.description) {
    changes.push('任务说明已更新');
  }
  if (nextQuantity !== oldWorkload.quantity) {
    changes.push(
      `工作量 ${oldWorkload.quantity} ${process.unitLabel} → ${nextQuantity} ${process.unitLabel}`
    );
  }
  if (nextUnitPrice !== oldWorkload.unitPrice) {
    changes.push(
      `单价 ${oldWorkload.unitPrice} → ${nextUnitPrice} 金币/${process.unitLabel}`
    );
  }

  if (changes.length === 0) {
    return task;
  }

  const workload = {
    quantity: nextQuantity,
    unitKey: process.unitKey,
    unitLabel: process.unitLabel,
    unitPrice: nextUnitPrice,
    total: calculateTotal(nextQuantity, nextUnitPrice),
  };

  task.title = nextTitle;
  task.description = nextDescription;
  task.workload = workload;
  task.reward = workload.total;
  task.updatedAt = Date.now();
  task.logs = task.logs || [];
  task.logs.push({
    id: idUtil.logId(),
    type: 'update',
    actor: actor.name,
    text: `更新任务：${changes.join('；')}`,
    at: task.updatedAt,
  });

  if (task.assigneeId) {
    notices.pushNotice({
      accountId: task.assigneeId,
      taskId: task.id,
      taskTitle: task.title,
      projectName: task.projectName || project.name,
      message: `任务已更新：${changes.join('；')}`,
    });
  }

  store.saveTasks(tasks);

  const remaining = tasks.filter(
    (item) => item.projectId === project.id && item.status !== 'cancelled'
  );
  project.taskCount = remaining.length;
  project.totalAmount = remaining.reduce(
    (sum, item) => sum + (Number(item.reward) || 0),
    0
  );
  project.updatedAt = Date.now();
  projectStore.updateProject(project);

  return task;
}

function archiveProject(projectId, actor) {
  ensureAdmin(actor);
  const project = projectStore.getProject(projectId);
  assert(!!project, '项目不存在或已被移除');
  assert(project.status !== 'archived', '项目已经归档');

  const tasks = store.loadTasks();
  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  const now = Date.now();
  let cancelledCount = 0;
  let notifiedCount = 0;

  projectTasks.forEach((task) => {
    if (task.status === 'done' || task.status === 'cancelled') {
      return;
    }
    task.archivedFromStatus = task.status;
    task.archivedAt = now;
    task.status = 'cancelled';
    task.updatedAt = now;
    task.cancelledAt = now;
    task.logs = task.logs || [];
    task.logs.push({
      id: idUtil.logId(),
      type: 'cancel',
      actor: actor.name,
      text: '项目已归档，任务取消',
      at: now,
    });
    cancelledCount += 1;
    if (task.assigneeId) {
      notices.pushNotice({
        accountId: task.assigneeId,
        taskId: task.id,
        taskTitle: task.title,
        projectName: project.name,
        message: '项目已归档，任务取消',
      });
      notifiedCount += 1;
    }
  });

  if (cancelledCount > 0) {
    store.saveTasks(tasks);
  }

  project.status = 'archived';
  project.archivedAt = now;
  project.archivedBy = actor.id;
  project.updatedAt = now;
  projectStore.updateProject(project);

  return {
    name: project.name,
    taskCount: projectTasks.length,
    cancelledCount,
    notifiedCount,
  };
}

module.exports = {
  DEFAULT_RATES,
  buildDraftTasks,
  toDraftTask,
  publishProject,
  getProjectWithTasks,
  listProjects,
  listActiveProjects,
  listArchivedProjects,
  clearArchivedProject,
  clearArchivedProjects,
  summarizeArchiveTasks,
  updateProjectTask,
  archiveProject,
};
