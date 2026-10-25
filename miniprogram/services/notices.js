const idUtil = require('../utils/id');

const NOTICES_KEY = 'animflow:notices:v1';
const NOTICES_VERSION = 2;
const MAX_NOTICES = 100;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadNotices() {
  let envelope;
  try {
    envelope = wx.getStorageSync(NOTICES_KEY);
  } catch (error) {
    envelope = null;
  }
  if (
    envelope &&
    envelope.version === NOTICES_VERSION &&
    Array.isArray(envelope.notices)
  ) {
    return clone(envelope.notices);
  }
  return [];
}

function saveNotices(notices) {
  try {
    wx.setStorageSync(NOTICES_KEY, {
      version: NOTICES_VERSION,
      updatedAt: Date.now(),
      notices,
    });
  } catch (error) {
    throw new Error('通知保存失败');
  }
}

function pushNotice(input) {
  const source = input || {};
  if (!source.accountId) {
    return null;
  }
  const notice = {
    id: idUtil.noticeId(),
    accountId: source.accountId,
    taskId: source.taskId || '',
    taskTitle: source.taskTitle || '委托',
    projectName: source.projectName || '',
    message: source.message || '委托内容已更新',
    read: false,
    createdAt: Date.now(),
  };
  const list = loadNotices();
  list.unshift(notice);
  saveNotices(list.slice(0, MAX_NOTICES));
  return clone(notice);
}

function listFor(accountId) {
  return loadNotices()
    .filter((notice) => notice.accountId === accountId)
    .sort((left, right) => right.createdAt - left.createdAt);
}

function unreadCount(accountId) {
  return listFor(accountId).filter((notice) => !notice.read).length;
}

function markAllRead(accountId) {
  const list = loadNotices();
  let changed = false;
  list.forEach((notice) => {
    if (notice.accountId === accountId && !notice.read) {
      notice.read = true;
      changed = true;
    }
  });
  if (changed) {
    saveNotices(list);
  }
}

function markRead(noticeId) {
  const list = loadNotices();
  let changed = false;
  list.forEach((notice) => {
    if (notice.id === noticeId && !notice.read) {
      notice.read = true;
      changed = true;
    }
  });
  if (changed) {
    saveNotices(list);
  }
}

function clearAll() {
  try {
    wx.removeStorageSync(NOTICES_KEY);
  } catch (error) {
    // Clearing demo data is best-effort.
  }
}

function removeForAccount(accountId) {
  const list = loadNotices();
  const next = list.filter((notice) => notice.accountId !== accountId);
  if (next.length !== list.length) {
    saveNotices(next);
  }
}

function removeForTasks(taskIds) {
  const ids = {};
  (taskIds || []).forEach((taskId) => {
    ids[taskId] = true;
  });
  if (!Object.keys(ids).length) {
    return;
  }
  const list = loadNotices();
  const next = list.filter((notice) => !ids[notice.taskId]);
  if (next.length !== list.length) {
    saveNotices(next);
  }
}

module.exports = {
  NOTICES_KEY,
  loadNotices,
  pushNotice,
  listFor,
  unreadCount,
  markAllRead,
  markRead,
  removeForAccount,
  removeForTasks,
  clearAll,
};
