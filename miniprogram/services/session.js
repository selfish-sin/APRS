const constants = require('../utils/constants');
const accounts = require('./accounts');

const SESSION_KEY = 'animflow:session:v2';
const LAST_ROLE_KEY = 'animflow:last-role:v1';

function normalizeAccount(candidate) {
  if (!candidate || !candidate.id) {
    return null;
  }
  const account = accounts.getAccount(candidate.id);
  if (!account) {
    return null;
  }
  if (account.active === false) {
    return null;
  }
  if (candidate.role && candidate.role !== account.role) {
    return null;
  }
  return account;
}

function getSession() {
  let saved;
  try {
    saved = wx.getStorageSync(SESSION_KEY);
  } catch (error) {
    return null;
  }
  if (!saved || !saved.user) {
    return null;
  }
  const normalized = normalizeAccount(saved.user);
  if (!normalized) {
    return null;
  }
  return {
    role: normalized.role,
    user: normalized,
    signedInAt: saved.signedInAt || Date.now(),
  };
}

function signIn(accountOrRole, userId) {
  let account;
  if (typeof accountOrRole === 'string') {
    const candidate = accounts.getAccount(userId);
    if (!candidate || candidate.role !== accountOrRole) {
      throw new Error('身份资料不存在，请先登记');
    }
    account = candidate;
  } else {
    const candidate =
      accountOrRole && accountOrRole.id
        ? accounts.getAccount(accountOrRole.id)
        : null;
    if (candidate && candidate.active === false) {
      throw new Error('该身份已被停用执行权，请联系管理员恢复');
    }
    account = normalizeAccount(accountOrRole);
  }

  if (!account) {
    throw new Error('身份资料不存在，请先登记');
  }
  if (account.active === false) {
    throw new Error('该身份已被停用执行权，请联系管理员恢复');
  }

  const session = {
    role: account.role,
    user: account,
    signedInAt: Date.now(),
  };
  try {
    wx.setStorageSync(SESSION_KEY, session);
    wx.setStorageSync(LAST_ROLE_KEY, account.role);
  } catch (error) {
    throw new Error('身份资料保存失败');
  }
  return session;
}

function clearSession() {
  try {
    wx.removeStorageSync(SESSION_KEY);
  } catch (error) {
    // Ignore storage failures while signing out.
  }
}

function getLastRole() {
  try {
    const role = wx.getStorageSync(LAST_ROLE_KEY);
    if (role === constants.ROLES.ADMIN || role === constants.ROLES.EMPLOYEE) {
      return role;
    }
  } catch (error) {
    // Use the default role below.
  }
  return constants.ROLES.EMPLOYEE;
}

function isAdmin(session) {
  return !!session && session.role === constants.ROLES.ADMIN;
}

function requireSession() {
  const session = getSession();
  if (!session) {
    throw new Error('身份资料已失效，请重新选择身份');
  }
  return session;
}

module.exports = {
  getSession,
  signIn,
  clearSession,
  getLastRole,
  isAdmin,
  requireSession,
};
