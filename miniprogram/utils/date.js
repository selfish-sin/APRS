const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function startOfDay(value) {
  const date = value ? new Date(value) : new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateKey(value) {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(key) {
  if (!key || typeof key !== 'string') {
    return null;
  }
  const parts = key.split('-');
  if (parts.length !== 3) {
    return null;
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function addDays(value, amount) {
  const date = value ? new Date(value) : new Date();
  date.setDate(date.getDate() + amount);
  return date;
}

function addDaysKey(amount) {
  return dateKey(addDays(new Date(), amount));
}

function weekdayLabel(value) {
  const date = value ? new Date(value) : new Date();
  return WEEKDAYS[date.getDay()];
}

function formatMonthDay(value) {
  const date = value instanceof Date ? value : parseDateKey(value);
  if (!date) {
    return '';
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDateLong(value) {
  const date = value ? new Date(value) : new Date();
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const today = startOfDay(now).getTime();
  const target = startOfDay(date).getTime();
  const diffDays = Math.round((today - target) / DAY_MS);

  if (diffDays === 0) {
    return `今天 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  if (diffDays === 1) {
    return `昨天 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function describeDue(dueDate, done) {
  const target = parseDateKey(dueDate);
  if (!target) {
    return { label: '未设置截止', tone: 'muted', overdue: false };
  }
  if (done) {
    return { label: `${formatMonthDay(target)}完成`, tone: 'muted', overdue: false };
  }

  const diff = Math.round((target.getTime() - startOfDay(new Date()).getTime()) / DAY_MS);
  if (diff < 0) {
    return {
      label: `已逾期 ${Math.abs(diff)} 天`,
      tone: 'danger',
      overdue: true,
    };
  }
  if (diff === 0) {
    return { label: '今天截止', tone: 'warning', overdue: false };
  }
  if (diff === 1) {
    return { label: '明天截止', tone: 'warning', overdue: false };
  }
  if (diff <= 6) {
    return { label: `${diff} 天后截止`, tone: 'normal', overdue: false };
  }
  return { label: `${formatMonthDay(target)}截止`, tone: 'normal', overdue: false };
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) {
    return '夜深了';
  }
  if (hour < 11) {
    return '早上好';
  }
  if (hour < 14) {
    return '中午好';
  }
  if (hour < 18) {
    return '下午好';
  }
  return '晚上好';
}

function isToday(timestamp) {
  return dateKey(new Date(timestamp)) === dateKey(new Date());
}

module.exports = {
  DAY_MS,
  pad2,
  startOfDay,
  dateKey,
  parseDateKey,
  addDays,
  addDaysKey,
  weekdayLabel,
  formatMonthDay,
  formatDateLong,
  formatDateTime,
  formatTime,
  describeDue,
  greeting,
  isToday,
};
