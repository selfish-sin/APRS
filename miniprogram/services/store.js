const DATA_KEY = 'animflow:tasks:v1';
const DATA_VERSION = 5;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isValidTask(task) {
  if (!task || typeof task !== 'object') {
    return false;
  }
  const validStatuses = [
    'open',
    'in_progress',
    'in_review',
    'done',
    'cancelled',
  ];
  return (
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.dueDate === 'string' &&
    validStatuses.indexOf(task.status) >= 0
  );
}

function saveTasks(tasks) {
  const envelope = {
    version: DATA_VERSION,
    updatedAt: Date.now(),
    tasks,
  };
  try {
    wx.setStorageSync(DATA_KEY, envelope);
  } catch (error) {
    throw new Error('委托数据保存失败，请检查设备存储空间');
  }
  return envelope;
}

function loadTasks() {
  let envelope;
  try {
    envelope = wx.getStorageSync(DATA_KEY);
  } catch (error) {
    envelope = null;
  }

  if (
    envelope &&
    envelope.version === DATA_VERSION &&
    Array.isArray(envelope.tasks) &&
    envelope.tasks.every(isValidTask)
  ) {
    return clone(envelope.tasks);
  }

  saveTasks([]);
  return [];
}

function getTask(taskId) {
  const tasks = loadTasks();
  for (let index = 0; index < tasks.length; index += 1) {
    if (tasks[index].id === taskId) {
      return tasks[index];
    }
  }
  return null;
}

function resetDemoData() {
  saveTasks([]);
  return [];
}

module.exports = {
  DATA_KEY,
  loadTasks,
  saveTasks,
  getTask,
  resetDemoData,
};
