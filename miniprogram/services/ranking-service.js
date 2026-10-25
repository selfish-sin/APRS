const constants = require('../utils/constants');
const accounts = require('./accounts');
const store = require('./store');
const dateUtil = require('../utils/date');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function monthKeyOf(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function currentMonthKey() {
  return monthKeyOf(Date.now());
}

function normalizeMonth(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)) {
    const month = Number(value.slice(5, 7));
    if (month >= 1 && month <= 12) {
      return value;
    }
  }
  return currentMonthKey();
}

function monthLabel(key) {
  const year = key.slice(0, 4);
  const month = Number(key.slice(5, 7));
  return `${year} 年 ${month} 月`;
}

function monthRange(key) {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month, 1, 0, 0, 0, 0).getTime();
  return { start, end };
}

function buildMonthOptions(tasks, selected) {
  const keys = {};
  keys[currentMonthKey()] = true;
  keys[selected] = true;

  const now = new Date();
  for (let offset = 1; offset <= 5; offset += 1) {
    keys[monthKeyOf(new Date(now.getFullYear(), now.getMonth() - offset, 1).getTime())] = true;
  }

  tasks.forEach((task) => {
    if (task.status === 'done' && task.completedAt) {
      keys[monthKeyOf(task.completedAt)] = true;
    }
  });

  return Object.keys(keys)
    .sort((left, right) => (left < right ? 1 : -1))
    .slice(0, 12)
    .map((key) => ({
      key,
      label: monthLabel(key),
    }));
}

function resolveWorkload(task) {
  if (task.workload && task.workload.unitKey) {
    const unit = constants.getWorkloadUnit(task.workload.unitKey);
    return {
      unitKey: unit.key,
      unitLabel: unit.label,
      quantity: Number(task.workload.quantity) || 1,
    };
  }
  const process = constants.getCategory(task.category);
  const unit = constants.getWorkloadUnit(process ? process.unitKey : 'once');
  return {
    unitKey: unit.key,
    unitLabel: unit.label,
    quantity: 1,
  };
}

function groupKeyFor(task) {
  return task.assigneeId || `name:${task.assigneeName || 'unknown'}`;
}

function createGroup(task) {
  const account = task.assigneeId ? accounts.getAccount(task.assigneeId) : null;
  const name = (account && account.nickname) || task.assigneeName || '已移除成员';
  return {
    key: groupKeyFor(task),
    accountId: task.assigneeId || '',
    name,
    title: account ? account.title : '资料已移除',
    avatarColor: account ? account.avatarColor : '#8f7b5c',
    avatarSoft: account ? account.avatarSoft : '#ece7db',
    initial: constants.avatarText(name),
    removed: !account,
    active: account ? account.active !== false : false,
    reward: 0,
    taskCount: 0,
    units: {},
    stages: {},
    lastCompletedAt: 0,
    taskIds: [],
  };
}

function getMonthlyRanking(actor, options) {
  assert(!!actor && !!actor.id, '请先选择身份');
  const config = options || {};
  const month = normalizeMonth(config.month);
  const tasks = store.loadTasks();
  const months = buildMonthOptions(tasks, month);
  const range = monthRange(month);

  const groups = {};
  tasks.forEach((task) => {
    if (task.status !== 'done' || !task.completedAt) {
      return;
    }
    const completedAt = Number(task.completedAt);
    if (completedAt < range.start || completedAt >= range.end) {
      return;
    }

    const key = groupKeyFor(task);
    if (!groups[key]) {
      groups[key] = createGroup(task);
    }
    const group = groups[key];
    const reward = Number(task.reward) || 0;
    const workload = resolveWorkload(task);
    const stage = constants.getStageOfCategory(task.category);

    group.reward += reward;
    group.taskCount += 1;
    group.taskIds.push(task.id);
    group.lastCompletedAt = Math.max(group.lastCompletedAt, completedAt);
    group.units[workload.unitKey] = group.units[workload.unitKey] || {
      key: workload.unitKey,
      label: workload.unitLabel,
      quantity: 0,
    };
    group.units[workload.unitKey].quantity += workload.quantity;
    group.stages[stage.key] = (group.stages[stage.key] || 0) + 1;
  });

  const rows = Object.keys(groups)
    .map((key) => groups[key])
    .map((group) => {
      const unitOrder = Object.keys(constants.WORKLOAD_UNITS);
      const unitStats = Object.keys(group.units)
        .map((unitKey) => {
          const unit = group.units[unitKey];
          return {
            key: unitKey,
            label: unit.label,
            quantity: Number(unit.quantity.toFixed(1)),
            text: `${Number(unit.quantity.toFixed(1))} ${unit.label}`,
          };
        })
        .sort(
          (left, right) =>
            unitOrder.indexOf(left.key) - unitOrder.indexOf(right.key)
        );
      const stageStats = constants.STAGES.map((stage) => ({
        key: stage.key,
        name: stage.name,
        count: group.stages[stage.key] || 0,
      })).filter((stage) => stage.count > 0);

      return Object.assign({}, group, {
        unitStats,
        workloadText: unitStats.map((unit) => unit.text).join(' · '),
        stageStats,
        lastCompletedLabel: dateUtil.formatDateTime(group.lastCompletedAt),
        isMe: actor.id === group.accountId,
        rank: 0,
        rankTone: '',
      });
    })
    .sort((left, right) => {
      if (right.reward !== left.reward) {
        return right.reward - left.reward;
      }
      if (right.taskCount !== left.taskCount) {
        return right.taskCount - left.taskCount;
      }
      return left.name.localeCompare(right.name, 'zh');
    });

  rows.forEach((row, index) => {
    row.rank = index + 1;
    row.rankTone = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
  });

  const totalReward = rows.reduce((sum, row) => sum + row.reward, 0);
  const totalTasks = rows.reduce((sum, row) => sum + row.taskCount, 0);
  const myRow = rows.filter((row) => row.isMe)[0] || null;

  return {
    month,
    monthLabel: monthLabel(month),
    months,
    rows,
    summary: {
      totalReward,
      totalTasks,
      workerCount: rows.length,
      averageReward: rows.length ? Math.round(totalReward / rows.length) : 0,
    },
    myRank: myRow ? myRow.rank : 0,
    myReward: myRow ? myRow.reward : 0,
    isAdmin: actor.role === constants.ROLES.ADMIN,
  };
}

module.exports = {
  getMonthlyRanking,
  monthKeyOf,
  monthLabel,
};
