const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const rankingService = require('../../services/ranking-service');
const { getLayout } = require('../../utils/layout');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    user: null,
    isAdmin: false,
    loading: true,
    month: '',
    monthLabel: '',
    months: [],
    summary: {
      totalReward: 0,
      totalTasks: 0,
      workerCount: 0,
      averageReward: 0,
    },
    rows: [],
    myRank: 0,
    myReward: 0,
    expandedKey: '',
  },

  onLoad() {
    this.setData({ layout: getLayout() });
  },

  onResize() {
    this.setData({ layout: getLayout() });
  },

  onShow() {
    const session = sessionService.getSession();
    if (!session) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.session = session;
    this.setData({
      user: session.user,
      isAdmin: session.role === constants.ROLES.ADMIN,
    });
    this.loadRanking(this.data.month);
  },

  async loadRanking(month) {
    this.setData({ loading: true });
    try {
      const result = rankingService.getMonthlyRanking(this.session.user, {
        month,
      });
      this.setData({
        loading: false,
        month: result.month,
        monthLabel: result.monthLabel,
        months: result.months,
        summary: result.summary,
        rows: result.rows,
        myRank: result.myRank,
        myReward: result.myReward,
        isAdmin: result.isAdmin,
      });
    } catch (error) {
      this.setData({ loading: false });
      feedback.error(error.message || '排行加载失败');
    }
  },

  handleMonthChange(event) {
    const month = event.currentTarget.dataset.month;
    if (!month || month === this.data.month) {
      return;
    }
    feedback.vibrate();
    this.setData({ expandedKey: '' });
    this.loadRanking(month);
  },

  handleToggleRow(event) {
    const key = event.currentTarget.dataset.key;
    if (!key) {
      return;
    }
    feedback.vibrate();
    this.setData({
      expandedKey: this.data.expandedKey === key ? '' : key,
    });
  },

  goBoard() {
    wx.switchTab({ url: '/pages/board/index' });
  },
});
