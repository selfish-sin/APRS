function nextTaskId(tasks) {
  let max = 1000;
  for (let index = 0; index < tasks.length; index += 1) {
    const match = /^AF-(\d+)$/.exec(tasks[index].id || '');
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `AF-${max + 1}`;
}

function logId() {
  return `log_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
}

function projectId() {
  return `proj_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

function noticeId() {
  return `notice_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

module.exports = {
  nextTaskId,
  logId,
  projectId,
  noticeId,
};
