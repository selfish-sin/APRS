const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const taskService = require('../../services/task-service');
const memberService = require('../../services/member-service');
const { getLayout } = require('../../utils/layout');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    user: {
      name: '',
      title: '',
      avatarColor: '#8a5a2b',
    },
    userInitial: '',
    isAdmin: false,
    roleLabel: '工作者',
    roleMeta: null,
    workspace: constants.WORKSPACE,
    statsItems: [],
    reviewCount: 0,
    score: 0,
    myDone: 0,
    team: [],
    myTasks: [],
    myTaskCount: 0,
    myTasksExpanded: false,
    expandedMemberId: '',
    loading: true,
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
    this.loadProfile();
  },

  async loadProfile() {
    try {
      const profile = await taskService.getProfile(this.session.user);
      const isAdmin = this.session.role === constants.ROLES.ADMIN;
      const statsItems = isAdmin
        ? [
            { value: profile.stats.in_review, label: '待验收' },
            { value: profile.stats.in_progress, label: '进行中' },
            { value: profile.stats.done, label: '已归档' },
          ]
        : [
            { value: profile.stats.mineInProgress, label: '进行中' },
            { value: profile.stats.mineReview, label: '待验收' },
            { value: profile.stats.mineDone, label: '已归档' },
          ];
      this.setData({
        user: profile.user,
        userInitial: constants.avatarText(profile.user.name),
        isAdmin,
        roleLabel: constants.getRoleMeta(profile.user.role).label,
        roleMeta: profile.roleMeta,
        workspace: profile.workspace,
        statsItems,
        reviewCount: profile.stats.in_review,
        score: profile.score,
        myDone: profile.myDone,
        team: profile.team,
        myTasks: profile.myTasks,
        myTaskCount: profile.myTaskCount,
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      feedback.error(error.message || '身份资料加载失败');
    }
  },

  handleToggleMyWork() {
    feedback.vibrate();
    this.setData({ myTasksExpanded: !this.data.myTasksExpanded });
  },

  handleToggleMember(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    feedback.vibrate();
    this.setData({
      expandedMemberId: this.data.expandedMemberId === id ? '' : id,
    });
  },

  handleTaskOpen(event) {
    const id = event.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: `/pages/detail/index?id=${id}` });
    }
  },

  async handleToggleExecution(event) {
    const id = event.currentTarget.dataset.id;
    const member = this.data.team.find((item) => item.id === id);
    if (!member) {
      return;
    }
    const nextActive = !member.executionActive;
    const result = await feedback.confirm({
      title: nextActive ? '恢复执行权？' : '取消执行权？',
      content: nextActive
        ? `恢复后 ${member.name} 可以重新登录、接取和提交任务。`
        : `取消后 ${member.name} 将无法登录、接取或提交任务；进行中和待验收的委托会退回告示栏。`,
      confirmText: nextActive ? '确认恢复' : '确认停用',
      confirmColor: nextActive ? '#35675D' : '#A6402F',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const outcome = memberService.setExecutionRight(
        member.id,
        nextActive,
        this.session.user
      );
      wx.hideLoading();
      feedback.success(
        nextActive
          ? '执行权已恢复'
          : `执行权已停用${
              outcome.releasedCount ? `，${outcome.releasedCount} 份任务已退回` : ''
            }`
      );
      await this.loadProfile();
      this.setData({ expandedMemberId: member.id });
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '执行权操作失败');
    }
  },

  async handleDeleteMember(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name || '该成员';
    const member = this.data.team.find((item) => item.id === id);
    if (!member) {
      return;
    }
    const result = await feedback.confirm({
      title: '删除成员资料？',
      content: `将永久删除 ${name} 的资料和 QQ。其进行中或待验收的委托会退回告示栏，已归档记录保留。此操作不可撤销。`,
      confirmText: '确认删除',
      cancelText: '保留资料',
      confirmColor: '#A6402F',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '删除中', mask: true });
    try {
      const outcome = memberService.deleteMember(member.id, this.session.user);
      wx.hideLoading();
      feedback.success(
        outcome.releasedCount
          ? `成员资料已删除，${outcome.releasedCount} 份任务已退回`
          : '成员资料已删除'
      );
      this.setData({ expandedMemberId: '' });
      await this.loadProfile();
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '成员资料删除失败');
    }
  },

  handleSwitchIdentity() {
    feedback.vibrate();
    sessionService.clearSession();
    try {
      wx.reLaunch({
        url: '/pages/login/index',
        fail: () => {
          wx.redirectTo({
            url: '/pages/login/index',
            fail: () => feedback.error('无法打开身份页，请重试'),
          });
        },
      });
    } catch (error) {
      feedback.error('无法打开身份页，请重试');
    }
  },

  async handleResetDemoData() {
    const result = await feedback.confirm({
      title: '清空工作台数据？',
      content: '所有任务、项目和变更通知都会被清除，账号资料保留。此操作不可撤销。',
      confirmText: '确认清空',
      cancelText: '保留数据',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '清空中', mask: true });
    try {
      await taskService.resetDemoData();
      wx.hideLoading();
      feedback.success('工作台数据已清空');
      await this.loadProfile();
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '清空失败');
    }
  },

  handleAbout() {
    wx.showModal({
      title: 'APRS 动画部 AnimFlow',
      content:
        'APRS艺术生产力研究实验室 · 动画部\n\nRPG 委托主题的动画制作协作小程序 v0.11.7\n\n部门管理员张贴与指派委托，工作者接取、提交验收，形成完整的委托流转闭环。当前为本地演示模式。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#A17826',
    });
  },

  handleDataInfo() {
    wx.showModal({
      title: '数据存储说明',
      content:
        '当前版本使用微信本地缓存保存委托数据，数据仅存在于当前设备。\n\n正式投入双端协作时，需要接入云开发或自建服务端，并将 services 中的本地数据层替换为远端数据层。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#A17826',
    });
  },

  goProjects() {
    wx.navigateTo({ url: '/pages/projects/index' });
  },

  goBoard() {
    wx.switchTab({ url: '/pages/board/index' });
  },
});
