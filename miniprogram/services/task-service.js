const store = require('./store');
const accounts = require('./accounts');
const projectStore = require('./project-store');
const notices = require('./notices');
const constants = require('../utils/constants');
const dateUtil = require('../utils/date');
const idUtil = require('../utils/id');

const STATUS_RANK = {
  open: 0,
  in_progress: 1,
  in_review: 2,
  done: 3,
  cancelled: 4,
};
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureAdmin(actor) {
  assert(actor && actor.role === constants.ROLES.ADMIN, '只有部门管理员可以执行这个操作');
}

function ensureEmployee(actor) {
  assert(actor && actor.role === constants.ROLES.EMPLOYEE, '只有工作者可以接取委托和提交验收');
}

function ensureActiveWorker(actor) {
  ensureEmployee(actor);
  const account = accounts.getAccount(actor.id);
  assert(
    !!account && account.active !== false,
    '该身份已被停用执行权，请联系管理员恢复'
  );
}

function findTaskOrThrow(tasks, taskId) {
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].id === taskId) {
      return tasks[index];
    }
  }
  throw new Error('委托不存在或已被移除');
}

function makeLog(type, actorName, text) {
  return {
    id: idUtil.logId(),
    type,
    actor: actorName,
    text,
    at: Date.now(),
  };
}

function profileColorByName(name) {
  const account = accounts.findByName(name);
  if (account) {
    return account.avatarColor;
  }
  return '#8f7b5c';
}

function decorateLogs(logs) {
  const sorted = (logs || []).slice().sort((left, right) => right.at - left.at);
  return sorted.map((log, index) => ({
    id: log.id,
    type: log.type,
    actor: log.actor,
    text: log.text,
    at: log.at,
    timeLabel: dateUtil.formatDateTime(log.at),
    actorInitial: constants.avatarText(log.actor),
    actorColor: profileColorByName(log.actor),
    last: index === sorted.length - 1,
  }));
}

function decorateTask(task, viewer) {
  const category = constants.getCategory(task.category);
  const stage = constants.getStageOfCategory(task.category);
  const priority = constants.getPriority(task.priority);
  const status = constants.getStatus(task.status);
  const assignee = task.assigneeId ? accounts.getAccount(task.assigneeId) : null;
  const due =
    task.status === 'done'
      ? { label: '已归档', tone: 'muted', overdue: false }
      : task.status === 'cancelled'
        ? { label: '已取消', tone: 'muted', overdue: false }
        : dateUtil.describeDue(task.dueDate, false);
  const isMine = !!viewer && task.assigneeId === viewer.id;
  const isAdmin = !!viewer && viewer.role === constants.ROLES.ADMIN;

  let action = 'detail';
  let actionLabel = '查看';
  if (task.status === 'cancelled') {
    actionLabel = '';
  } else if (isAdmin) {
    if (task.status === 'in_review') {
      action = 'review';
      actionLabel = '验收';
    }
  } else if (viewer) {
    if (task.status === 'open') {
      action = 'claim';
      actionLabel = '接取';
    } else if (isMine && task.status === 'in_progress') {
      action = 'submit';
      actionLabel = '提交验收';
    } else if (isMine && task.status === 'in_review') {
      actionLabel = '待验收';
    } else if (isMine && task.status === 'done') {
      actionLabel = '已归档';
    }
  }

  const workload =
    task.workload || {
      quantity: 1,
      unitKey: 'once',
      unitLabel: '项',
      unitPrice: Number(task.reward) || 0,
      total: Number(task.reward) || 0,
    };
  const workloadQuantity = Number(workload.quantity) || 0;
  const workloadUnitLabel = workload.unitLabel || category.unitLabel || '项';
  const workloadUnitKey = workload.unitKey || category.unitKey || 'once';
  const unitPrice = Number(workload.unitPrice) || 0;
  const reward = Number(task.reward) || Number(workload.total) || 0;
  const workloadSummary =
    workloadUnitKey === 'once'
      ? `一次性 · ${reward} 金币`
      : `${workloadQuantity} ${workloadUnitLabel} × ${unitPrice} 金币/${workloadUnitLabel} = ${reward} 金币`;
  const workloadBrief =
    workloadUnitKey === 'once'
      ? `一次性 · ${unitPrice} 金币`
      : `${workloadQuantity} ${workloadUnitLabel} × ${unitPrice} 金币/${workloadUnitLabel}`;

  return Object.assign({}, task, {
    categoryName: category.name,
    categoryEn: category.en,
    categoryColor: category.color,
    categorySoft: category.soft,
    categoryShort: category.shortName,
    processKey: category.key,
    processOrder: category.order,
    stageKey: stage.key,
    stageName: stage.name,
    stageShort: stage.shortName,
    stageEn: stage.en,
    stageColor: stage.color,
    stageSoft: stage.soft,
    stageOrder: stage.order,
    priorityName: priority.name,
    priorityRank: priority.rank,
    priorityStars: priority.stars,
    priorityColor: priority.color,
    prioritySoft: priority.soft,
    statusName: status.name,
    statusColor: status.color,
    statusSoft: status.soft,
    dueLabel: due.label,
    dueTone: due.tone,
    overdue: due.overdue,
    projectName: task.projectName || '',
    workload,
    workloadQuantity,
    workloadUnitKey,
    workloadUnitLabel,
    unitPrice,
    workloadSummary,
    workloadBrief,
    reward,
    assigneeInitial: assignee
      ? constants.avatarText(assignee.name)
      : task.assigneeName
        ? constants.avatarText(task.assigneeName)
        : '·',
    assigneeColor: assignee ? assignee.avatarColor : '#8f7b5c',
    assigneeTitle: assignee
      ? assignee.title
      : task.assigneeName
        ? '资料已移除'
        : '等待一位工作者',
    isMine,
    action,
    actionLabel,
    isActionable: action === 'claim' || action === 'submit' || action === 'review',
    logs: decorateLogs(task.logs),
    logCount: (task.logs || []).length,
    createdLabel: dateUtil.formatDateTime(task.createdAt),
    updatedLabel: dateUtil.formatDateTime(task.updatedAt),
  });
}

function buildStats(tasks, actor) {
  const stats = {
    total: tasks.length,
    open: 0,
    in_progress: 0,
    in_review: 0,
    done: 0,
    cancelled: 0,
    mineActive: 0,
    mineInProgress: 0,
    mineReview: 0,
    mineDone: 0,
    earnedPoints: 0,
  };

  tasks.forEach((task) => {
    if (stats[task.status] !== undefined) {
      stats[task.status] += 1;
    }
    if (task.assigneeId === actor.id) {
      if (task.status === 'in_progress' || task.status === 'in_review') {
        stats.mineActive += 1;
      }
      if (task.status === 'in_progress') {
        stats.mineInProgress += 1;
      }
      if (task.status === 'in_review') {
        stats.mineReview += 1;
      }
      if (task.status === 'done') {
        stats.mineDone += 1;
        stats.earnedPoints += Number(task.reward) || 0;
      }
    }
  });

  const activeTotal = stats.total - stats.cancelled;
  stats.progress = activeTotal
    ? Math.round((stats.done / activeTotal) * 100)
    : 0;
  return stats;
}

function buildHero(stats, actor) {
  if (stats.total === 0) {
    return actor.role === constants.ROLES.ADMIN
      ? {
          number: 0,
          lead: '张委托卷轴待张贴',
          body: '张贴第一份制作委托，让工作者们在告示栏看到它。',
          ctaLabel: '张贴委托',
          ctaAction: 'create',
        }
      : {
          number: 0,
          lead: '份委托等待张贴',
          body: '部门管理员张贴卷轴后，可以接取的委托会出现在这里。',
          ctaLabel: '查看全部',
          ctaAction: 'all',
        };
  }
  if (actor.role === constants.ROLES.ADMIN) {
    if (stats.in_review > 0) {
      return {
        number: stats.in_review,
        lead: '份委托等待验收',
        body: '验收通过后，委托的赏金才会记入工作者名册。',
        ctaLabel: '去验收',
        ctaAction: 'in_review',
      };
    }
    if (stats.open > 0) {
      return {
        number: stats.open,
        lead: '份委托等待接取',
        body: '把合适的卷轴交给合适的手，让动画部的灯火继续亮着。',
        ctaLabel: '张贴委托',
        ctaAction: 'create',
      };
    }
    return {
      number: stats.done,
      lead: '份委托已顺利归档',
      body: '本期的卷轴都收进了资料柜，可以筹备下一段冒险了。',
      ctaLabel: '查看归档',
      ctaAction: 'done',
    };
  }

  if (stats.open > 0) {
    return {
      number: stats.open,
      lead: '份委托等待接取',
      body: '去告示栏挑一份合适的卷轴，接取后会记入你的工作日志。',
      ctaLabel: '查看可接取',
      ctaAction: 'open',
    };
  }
  if (stats.mineActive > 0) {
    return {
      number: stats.mineActive,
      lead: '份委托正在推进',
      body: '完成手上的镜头后记得提交验收，让赏金早日入袋。',
      ctaLabel: '我的委托',
      ctaAction: 'mine',
    };
  }
  return {
    number: stats.done,
    lead: '份委托已归档',
    body: '当前没有待接取的委托，稍作休整或等待新的卷轴。',
    ctaLabel: '查看归档',
    ctaAction: 'done',
  };
}

function buildFilters(tasks, actor) {
  const isAdmin = actor.role === constants.ROLES.ADMIN;
  const mine = tasks.filter((task) => task.assigneeId === actor.id);

  if (isAdmin) {
    return [
      { key: 'all', label: '全部', count: tasks.length },
      { key: 'open', label: '待接取', count: tasks.filter((task) => task.status === 'open').length },
      {
        key: 'in_progress',
        label: '进行中',
        count: tasks.filter((task) => task.status === 'in_progress').length,
      },
      {
        key: 'in_review',
        label: '待验收',
        count: tasks.filter((task) => task.status === 'in_review').length,
      },
      { key: 'done', label: '已归档', count: tasks.filter((task) => task.status === 'done').length },
      {
        key: 'cancelled',
        label: '已取消',
        count: tasks.filter((task) => task.status === 'cancelled').length,
      },
    ];
  }

  return [
    { key: 'open', label: '可接取', count: tasks.filter((task) => task.status === 'open').length },
    {
      key: 'mine',
      label: '我的委托',
      count: mine.filter(
        (task) => task.status !== 'done' && task.status !== 'cancelled'
      ).length,
    },
    {
      key: 'in_review',
      label: '待验收',
      count: mine.filter((task) => task.status === 'in_review').length,
    },
    {
      key: 'done',
      label: '已归档',
      count: mine.filter((task) => task.status === 'done').length,
    },
    {
      key: 'cancelled',
      label: '已取消',
      count: mine.filter((task) => task.status === 'cancelled').length,
    },
    { key: 'all', label: '全部', count: tasks.length },
  ];
}

function defaultFilter(actor) {
  return actor.role === constants.ROLES.ADMIN ? 'all' : 'open';
}

function filterTasks(tasks, filter, actor) {
  if (filter === 'mine') {
    return tasks.filter(
      (task) =>
        task.assigneeId === actor.id &&
        task.status !== 'done' &&
        task.status !== 'cancelled'
    );
  }
  if (filter === 'done') {
    if (actor.role === constants.ROLES.EMPLOYEE) {
      return tasks.filter(
        (task) => task.assigneeId === actor.id && task.status === 'done'
      );
    }
    return tasks.filter((task) => task.status === 'done');
  }
  if (filter === 'in_review') {
    if (actor.role === constants.ROLES.EMPLOYEE) {
      return tasks.filter(
        (task) => task.assigneeId === actor.id && task.status === 'in_review'
      );
    }
    return tasks.filter((task) => task.status === 'in_review');
  }
  if (filter === 'cancelled') {
    if (actor.role === constants.ROLES.EMPLOYEE) {
      return tasks.filter(
        (task) =>
          task.assigneeId === actor.id && task.status === 'cancelled'
      );
    }
    return tasks.filter((task) => task.status === 'cancelled');
  }
  if (filter === 'all') {
    return tasks.slice();
  }
  return tasks.filter((task) => task.status === filter);
}

function sortTasks(tasks, filter) {
  const list = tasks.slice();
  if (filter === 'done') {
    list.sort((left, right) => {
      const leftAt = left.completedAt || left.updatedAt || left.createdAt;
      const rightAt = right.completedAt || right.updatedAt || right.createdAt;
      return rightAt - leftAt;
    });
    return list;
  }

  list.sort((left, right) => {
    const leftDone =
      left.status === 'done' || left.status === 'cancelled' ? 1 : 0;
    const rightDone =
      right.status === 'done' || right.status === 'cancelled' ? 1 : 0;
    if (leftDone !== rightDone) {
      return leftDone - rightDone;
    }
    if (STATUS_RANK[left.status] !== STATUS_RANK[right.status]) {
      return STATUS_RANK[left.status] - STATUS_RANK[right.status];
    }
    const leftStage = constants.getStageOfCategory(left.category).order;
    const rightStage = constants.getStageOfCategory(right.category).order;
    if (leftStage !== rightStage) {
      return leftStage - rightStage;
    }
    const leftProcess = constants.getCategory(left.category).order;
    const rightProcess = constants.getCategory(right.category).order;
    if (leftProcess !== rightProcess) {
      return leftProcess - rightProcess;
    }
    if (PRIORITY_RANK[left.priority] !== PRIORITY_RANK[right.priority]) {
      return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    }
    return String(left.dueDate).localeCompare(String(right.dueDate));
  });
  return list;
}

function matchesKeyword(task, keyword) {
  if (!keyword) {
    return true;
  }
  const needle = keyword.toLowerCase();
  const process = constants.getCategory(task.category);
  const stage = constants.getStageOfCategory(task.category);
  const haystack = [
    task.title,
    task.description,
    task.batch,
    task.assigneeName,
    task.projectName,
    task.id,
    process.name,
    stage.name,
  ]
    .join(' ')
    .toLowerCase();
  return haystack.indexOf(needle) >= 0;
}

async function getBoard(actor, options) {
  const config = options || {};
  const tasks = store.loadTasks();
  const stats = buildStats(tasks, actor);
  const filters = buildFilters(tasks, actor);
  let filter = config.filter || defaultFilter(actor);
  const validFilter = filters.some((item) => item.key === filter);
  if (!validFilter) {
    filter = defaultFilter(actor);
  }
  const keyword = String(config.keyword || '').trim();
  const base = filterTasks(tasks, filter, actor).filter((task) =>
    matchesKeyword(task, keyword)
  );

  const stages = constants.STAGES.map((stage) =>
    Object.assign({}, stage, {
      count: base.filter(
        (task) => constants.getStageOfCategory(task.category).key === stage.key
      ).length,
    })
  );

  let activeStage = config.stage || 'all';
  if (activeStage !== 'all' && !constants.STAGES.some((stage) => stage.key === activeStage)) {
    activeStage = 'all';
  }

  const stageTasks = base.filter((task) => {
    if (activeStage === 'all') {
      return true;
    }
    return constants.getStageOfCategory(task.category).key === activeStage;
  });

  const processes =
    activeStage === 'all'
      ? []
      : constants.getProcessesForStage(activeStage).map((process) =>
          Object.assign({}, process, {
            count: stageTasks.filter(
              (task) => constants.getCategory(task.category).key === process.key
            ).length,
          })
        );

  let activeProcess = String(config.process || '');
  if (activeProcess && !processes.some((process) => process.key === activeProcess)) {
    activeProcess = '';
  }

  const filtered = activeProcess
    ? stageTasks.filter(
        (task) => constants.getCategory(task.category).key === activeProcess
      )
    : stageTasks;

  const decorated = sortTasks(filtered, filter).map((task) =>
    decorateTask(task, actor)
  );

  return {
    tasks: decorated,
    stats,
    filters,
    stages,
    processes,
    activeFilter: filter,
    activeStage,
    activeProcess,
    stageTotal: stageTasks.length,
    stageAllTotal: base.length,
    keyword,
    hero: buildHero(stats, actor),
    workspace: constants.WORKSPACE,
    defaultFilter: defaultFilter(actor),
  };
}

async function getTask(taskId, actor) {
  const tasks = store.loadTasks();
  const task = findTaskOrThrow(tasks, taskId);
  return decorateTask(task, actor);
}

async function createTask(input, actor) {
  ensureAdmin(actor);
  const source = input || {};
  const title = String(source.title || '').trim();
  const description = String(source.description || '').trim();
  const batch = String(source.batch || '').trim();
  const categoryKey = source.category;
  const priorityKey = source.priority || 'normal';
  const dueDate = String(source.dueDate || '');
  const reward = Number(source.reward);
  const assigneeId = source.assigneeId || '';

  assert(title.length >= 2, '请填写至少 2 个字的委托标题');
  assert(title.length <= 40, '委托标题不能超过 40 个字');
  assert(description.length <= 500, '委托说明不能超过 500 个字');
  assert(batch.length <= 30, '集数 / 场次不能超过 30 个字');

  const category = constants.findProcess(categoryKey);
  assert(!!category, '请选择有效的制作工序');
  assert(
    constants.PRIORITIES.some((item) => item.key === priorityKey),
    '请选择有效的悬赏等级'
  );

  const parsedDue = dateUtil.parseDateKey(dueDate);
  assert(!!parsedDue, '请选择交付期限');
  assert(
    parsedDue.getTime() >= dateUtil.startOfDay(new Date()).getTime(),
    '交付期限不能早于今天'
  );
  assert(
    Number.isFinite(reward) && reward >= 0 && reward <= 10000,
    '赏金需要是 0 到 10000 之间的数字'
  );

  let assignee = null;
  if (assigneeId) {
    assignee = accounts.getAccount(assigneeId);
    assert(
      !!assignee && assignee.role === constants.ROLES.EMPLOYEE,
      '未找到指定的工作者'
    );
  }

  const tasks = store.loadTasks();
  const now = Date.now();
  const taskId = idUtil.nextTaskId(tasks);
  const logText = assignee
    ? `张贴委托并指派给${assignee.name}`
    : '张贴委托到告示栏';

  const task = {
    id: taskId,
    title,
    description,
    stage: category.stage,
    category: category.key,
    priority: priorityKey,
    status: assignee ? 'in_progress' : 'open',
    batch: batch || '待补充场次',
    dueDate,
    reward: Math.round(reward),
    assigneeId: assignee ? assignee.id : '',
    assigneeName: assignee ? assignee.name : '',
    creatorId: actor.id,
    creatorName: actor.name,
    reviewNote: '',
    createdAt: now,
    updatedAt: now,
    completedAt: 0,
    logs: [makeLog('create', actor.name, logText)],
  };

  tasks.unshift(task);
  store.saveTasks(tasks);
  return decorateTask(task, actor);
}

async function claimTask(taskId, actor) {
  ensureActiveWorker(actor);
  const tasks = store.loadTasks();
  const task = findTaskOrThrow(tasks, taskId);
  assert(task.status === 'open', '这份委托已经被接取或进入下一阶段了');
  assert(!task.assigneeId, '这份委托已经有接取人了');

  task.status = 'in_progress';
  task.assigneeId = actor.id;
  task.assigneeName = actor.name;
  task.updatedAt = Date.now();
  task.logs = task.logs || [];
  task.logs.push(makeLog('claim', actor.name, '接取了委托，开始制作'));

  store.saveTasks(tasks);
  return decorateTask(task, actor);
}

async function submitTask(taskId, actor) {
  ensureActiveWorker(actor);
  const tasks = store.loadTasks();
  const task = findTaskOrThrow(tasks, taskId);
  assert(task.assigneeId === actor.id, '只能提交自己接取的委托');
  assert(task.status === 'in_progress', '只有进行中的委托可以提交验收');

  task.status = 'in_review';
  task.updatedAt = Date.now();
  task.reviewNote = '';
  task.logs = task.logs || [];
  task.logs.push(makeLog('submit', actor.name, '完成委托并提交验收'));

  store.saveTasks(tasks);
  return decorateTask(task, actor);
}

async function reviewTask(taskId, actor, decision, note) {
  ensureAdmin(actor);
  const tasks = store.loadTasks();
  const task = findTaskOrThrow(tasks, taskId);
  assert(task.status === 'in_review', '这份委托当前不在待验收状态');
  const comment = String(note || '').trim();
  assert(comment.length <= 200, '验收意见不能超过 200 个字');

  if (decision === 'approve') {
    task.status = 'done';
    task.reviewNote = comment;
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    task.logs = task.logs || [];
    task.logs.push(
      makeLog(
        'approve',
        actor.name,
        comment ? `验收通过：${comment}` : '验收通过，委托归档'
      )
    );
  } else if (decision === 'return') {
    assert(comment.length > 0, '退回委托时请填写修改意见');
    task.status = 'in_progress';
    task.reviewNote = comment;
    task.completedAt = 0;
    task.updatedAt = Date.now();
    task.logs = task.logs || [];
    task.logs.push(makeLog('return', actor.name, `退回修改：${comment}`));
  } else {
    throw new Error('未知的验收操作');
  }

  store.saveTasks(tasks);
  return decorateTask(task, actor);
}

async function cancelTask(taskId, actor) {
  ensureAdmin(actor);
  const tasks = store.loadTasks();
  const task = findTaskOrThrow(tasks, taskId);
  assert(
    task.status !== 'done' && task.status !== 'cancelled',
    '已完成或已取消的委托不能再取消'
  );
  if (task.projectId) {
    const project = projectStore.getProject(task.projectId);
    assert(
      !project || project.status !== 'archived',
      '已归档项目不能再取消任务'
    );
  }

  const now = Date.now();
  task.status = 'cancelled';
  task.updatedAt = now;
  task.cancelledAt = now;
  task.logs = task.logs || [];
  task.logs.push(makeLog('cancel', actor.name, '管理员取消了任务'));

  if (task.assigneeId) {
    notices.pushNotice({
      accountId: task.assigneeId,
      taskId: task.id,
      taskTitle: task.title,
      projectName: task.projectName || '',
      message: '任务已被管理员取消',
    });
  }

  store.saveTasks(tasks);

  if (task.projectId) {
    const project = projectStore.getProject(task.projectId);
    if (project) {
      const remaining = tasks.filter(
        (item) =>
          item.projectId === project.id && item.status !== 'cancelled'
      );
      project.taskCount = remaining.length;
      project.totalAmount = remaining.reduce(
        (sum, item) => sum + (Number(item.reward) || 0),
        0
      );
      project.updatedAt = now;
      projectStore.updateProject(project);
    }
  }

  return decorateTask(task, actor);
}

async function resetDemoData() {
  projectStore.clearProjects();
  notices.clearAll();
  store.resetDemoData();
  return true;
}

function summarizeTask(task, viewer) {
  const decorated = decorateTask(task, viewer);
  return {
    id: decorated.id,
    title: decorated.title,
    stageName: decorated.stageName,
    categoryName: decorated.categoryName,
    statusName: decorated.statusName,
    statusColor: decorated.statusColor,
    statusSoft: decorated.statusSoft,
    dueLabel: decorated.dueLabel,
    dueTone: decorated.dueTone,
    reward: decorated.reward,
    action: decorated.action,
    actionLabel: decorated.actionLabel,
    isActionable: decorated.isActionable,
  };
}

function buildTeam(tasks, viewer) {
  const isAdmin = !!viewer && viewer.role === constants.ROLES.ADMIN;
  return accounts.listWorkers().map((account) => {
    const assigned = sortTasks(
      tasks.filter((task) => task.assigneeId === account.id),
      'all'
    );
    return {
      id: account.id,
      name: account.nickname,
      nickname: account.nickname,
      qq: isAdmin ? account.qq : '',
      title: account.title,
      avatarColor: account.avatarColor,
      avatarSoft: account.avatarSoft,
      initial: constants.avatarText(account.nickname),
      executionActive: account.active !== false,
      active: assigned.filter(
        (task) => task.status === 'in_progress' || task.status === 'in_review'
      ).length,
      done: assigned.filter((task) => task.status === 'done').length,
      total: assigned.length,
      tasks: assigned.map((task) => summarizeTask(task, viewer)),
    };
  });
}

async function getProfile(actor) {
  const tasks = store.loadTasks();
  const stats = buildStats(tasks, actor);
  const team = buildTeam(tasks, actor);
  const myTasks = sortTasks(
    tasks.filter((task) => task.assigneeId === actor.id),
    'all'
  ).map((task) => summarizeTask(task, actor));
  return {
    user: actor,
    roleMeta: constants.getRoleMeta(actor.role),
    stats,
    team,
    myTasks,
    myTaskCount: myTasks.length,
    myDone: stats.mineDone,
    score: stats.earnedPoints,
    workspace: constants.WORKSPACE,
    isAdmin: actor.role === constants.ROLES.ADMIN,
  };
}

module.exports = {
  getBoard,
  getTask,
  createTask,
  claimTask,
  submitTask,
  reviewTask,
  cancelTask,
  resetDemoData,
  getProfile,
  decorateTask,
};
