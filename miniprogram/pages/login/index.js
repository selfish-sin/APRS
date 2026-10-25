const constants = require('../../utils/constants');
const accounts = require('../../services/accounts');
const session = require('../../services/session');
const { getLayout } = require('../../utils/layout');
const feedback = require('../../utils/feedback');

const LAST_QQ_KEY = 'animflow:last-qq:v1';
const QQ_PATTERN = /^\d{5,12}$/;

const ROLE_OPTIONS = [
  {
    key: constants.ROLES.ADMIN,
    label: '部门管理员',
    icon: '管',
    tag: '部门端 · 张贴委托',
    description: '张贴制作委托，指派工作者，验收交付',
  },
  {
    key: constants.ROLES.EMPLOYEE,
    label: '工作者',
    icon: '工',
    tag: '工作者端 · 接取委托',
    description: '接取公开委托，推进制作，提交验收',
  },
];

function readLastQQ() {
  try {
    const saved = wx.getStorageSync(LAST_QQ_KEY);
    return saved && typeof saved === 'object' ? saved : {};
  } catch (error) {
    return {};
  }
}

function saveLastQQ(role, qq) {
  try {
    const saved = readLastQQ();
    saved[role] = qq;
    wx.setStorageSync(LAST_QQ_KEY, saved);
  } catch (error) {
    // Remembering the QQ is optional.
  }
}

Page({
  data: {
    layout: {
      statusBarHeight: 20,
      safeBottom: 0,
    },
    role: constants.ROLES.EMPLOYEE,
    roleLabel: '工作者',
    roleOptions: ROLE_OPTIONS,
    qq: '',
    nickname: '',
    adminKey: '',
    existingAccount: null,
    isExisting: false,
    isSuspended: false,
    entering: false,
    workspace: constants.WORKSPACE,
  },

  onResize() {
    this.setData({ layout: getLayout() });
  },

  onLoad() {
    const lastRole = session.getLastRole();
    const remembered = readLastQQ()[lastRole] || '';
    this.setData({
      layout: getLayout(),
      role: lastRole,
      roleLabel: constants.getRoleMeta(lastRole).label,
      qq: remembered,
    });
    if (remembered) {
      this.detectAccount(remembered, lastRole, false);
    }
  },

  detectAccount(qq, role, clearNickname) {
    const account = accounts.findAccount(qq, role);
    if (account) {
      this.setData({
        existingAccount: account,
        isExisting: true,
        isSuspended: account.active === false,
        nickname: account.nickname,
        adminKey: '',
      });
      return;
    }

    const wasExisting = this.data.isExisting;
    const patch = {
      existingAccount: null,
      isExisting: false,
      isSuspended: false,
      adminKey: '',
    };
    if (clearNickname || wasExisting) {
      patch.nickname = '';
    }
    this.setData(patch);
  },

  handleRoleChange(event) {
    const role = event.currentTarget.dataset.role;
    if (!role || role === this.data.role) {
      return;
    }
    feedback.vibrate();
    const remembered = this.data.qq || readLastQQ()[role] || '';
    this.setData({
      role,
      roleLabel: constants.getRoleMeta(role).label,
      qq: remembered,
      nickname: '',
      adminKey: '',
      existingAccount: null,
      isExisting: false,
      isSuspended: false,
    });
    if (remembered) {
      this.detectAccount(remembered, role, true);
    }
  },

  handleQQInput(event) {
    const qq = String(event.detail.value || '')
      .replace(/\D/g, '')
      .slice(0, 12);
    this.setData({ qq });
    this.detectAccount(qq, this.data.role, false);
  },

  handleNicknameInput(event) {
    this.setData({ nickname: event.detail.value });
  },

  handleAdminKeyInput(event) {
    this.setData({ adminKey: event.detail.value });
  },

  handleEnter() {
    if (this.data.entering) {
      return;
    }

    const role = this.data.role;
    const qq = this.data.qq;
    if (!QQ_PATTERN.test(qq)) {
      feedback.error('请输入 5 到 12 位 QQ 号');
      return;
    }

    const existing = accounts.findAccount(qq, role);
    if (existing && existing.active === false) {
      feedback.error('该身份已被停用执行权，请联系管理员恢复');
      return;
    }
    if (!existing) {
      const nickname = String(this.data.nickname || '').trim();
      if (nickname.length < 2 || nickname.length > 12) {
        feedback.error('昵称需要 2 到 12 个字符');
        return;
      }
      if (
        role === constants.ROLES.ADMIN &&
        String(this.data.adminKey || '').trim() !== constants.ADMIN_SECRET
      ) {
        feedback.error('管理员秘钥不正确');
        return;
      }
    }

    this.setData({ entering: true });
    try {
      let account = existing;
      if (!account) {
        account = accounts.createAccount({
          nickname: this.data.nickname,
          qq,
          role,
        });
      }
      session.signIn(account);
      saveLastQQ(role, qq);
      feedback.vibrate();
      wx.reLaunch({ url: '/pages/board/index' });
    } catch (error) {
      this.setData({ entering: false });
      feedback.error(error.message || '进入动画部失败');
    }
  },
});
