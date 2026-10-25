const constants = require('../utils/constants');

const ACCOUNTS_KEY = 'animflow:accounts:v1';
const ACCOUNTS_VERSION = 2;
const QQ_PATTERN = /^\d{5,12}$/;

const AVATAR_PALETTE = [
  { color: '#a6402f', soft: '#f3ddd2' },
  { color: '#35675d', soft: '#dfeae2' },
  { color: '#a17826', soft: '#f2e6c8' },
  { color: '#6a537f', soft: '#e9e1f0' },
  { color: '#4b5f78', soft: '#e1e6ee' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveAccounts(accounts) {
  const envelope = {
    version: ACCOUNTS_VERSION,
    updatedAt: Date.now(),
    accounts,
  };
  try {
    wx.setStorageSync(ACCOUNTS_KEY, envelope);
  } catch (error) {
    throw new Error('身份资料保存失败，请检查设备存储空间');
  }
  return envelope;
}

function isValidAccount(account) {
  return (
    !!account &&
    typeof account === 'object' &&
    typeof account.id === 'string' &&
    typeof account.qq === 'string' &&
    QQ_PATTERN.test(account.qq) &&
    (account.role === constants.ROLES.ADMIN ||
      account.role === constants.ROLES.EMPLOYEE) &&
    typeof account.nickname === 'string'
  );
}

function loadAccounts() {
  let envelope;
  try {
    envelope = wx.getStorageSync(ACCOUNTS_KEY);
  } catch (error) {
    envelope = null;
  }

  if (
    envelope &&
    envelope.version === ACCOUNTS_VERSION &&
    Array.isArray(envelope.accounts) &&
    envelope.accounts.every(isValidAccount)
  ) {
    return clone(envelope.accounts);
  }

  const empty = [];
  saveAccounts(empty);
  return empty;
}

function listAccounts() {
  return loadAccounts();
}

function listWorkers() {
  return loadAccounts().filter(
    (account) => account.role === constants.ROLES.EMPLOYEE
  );
}

function getAccount(accountId) {
  if (!accountId) {
    return null;
  }
  const list = loadAccounts();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].id === accountId) {
      return clone(list[index]);
    }
  }
  return null;
}

function findAccount(qq, role) {
  const normalizedQQ = String(qq || '').trim();
  if (!QQ_PATTERN.test(normalizedQQ)) {
    return null;
  }
  const list = loadAccounts();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].qq === normalizedQQ && list[index].role === role) {
      return clone(list[index]);
    }
  }
  return null;
}

function findByName(name) {
  if (!name) {
    return null;
  }
  const list = loadAccounts();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].nickname === name) {
      return clone(list[index]);
    }
  }
  return null;
}

function roleName(role) {
  return role === constants.ROLES.ADMIN ? '管理员' : '工作者';
}

function createAccount(input) {
  const source = input || {};
  const nickname = String(source.nickname || '').trim();
  const qq = String(source.qq || '').trim();
  const role = source.role;

  if (nickname.length < 2 || nickname.length > 12) {
    throw new Error('昵称需要 2 到 12 个字符');
  }
  if (!QQ_PATTERN.test(qq)) {
    throw new Error('QQ 号需要 5 到 12 位数字');
  }
  if (role !== constants.ROLES.ADMIN && role !== constants.ROLES.EMPLOYEE) {
    throw new Error('请选择有效的身份');
  }
  if (findAccount(qq, role)) {
    throw new Error(`该 QQ 已登记${roleName(role)}身份`);
  }

  const paletteIndex =
    (Number(qq.slice(-2)) + (role === constants.ROLES.ADMIN ? 2 : 0)) %
    AVATAR_PALETTE.length;
  const palette = AVATAR_PALETTE[paletteIndex];

  const account = {
    id: `acct_${role}_${qq}`,
    role,
    nickname,
    name: nickname,
    qq,
    title: role === constants.ROLES.ADMIN ? '部门主管' : '动画部工作者',
    avatarColor: palette.color,
    avatarSoft: palette.soft,
    active: true,
    createdAt: Date.now(),
  };

  const list = loadAccounts();
  list.push(account);
  saveAccounts(list);
  return clone(account);
}

function setAccountActive(accountId, active) {
  const list = loadAccounts();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].id === accountId) {
      list[index].active = !!active;
      saveAccounts(list);
      return clone(list[index]);
    }
  }
  throw new Error('成员资料不存在');
}

function deleteAccount(accountId) {
  const list = loadAccounts();
  const next = list.filter((account) => account.id !== accountId);
  if (next.length === list.length) {
    throw new Error('成员资料不存在');
  }
  saveAccounts(next);
  return true;
}

module.exports = {
  ACCOUNTS_KEY,
  ACCOUNTS_VERSION,
  loadAccounts,
  listAccounts,
  listWorkers,
  getAccount,
  findAccount,
  findByName,
  createAccount,
  setAccountActive,
  deleteAccount,
};
