const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const taskService = require('../../services/task-service');
const { getLayout } = require('../../utils/layout');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    user: null,
    role: constants.ROLES.EMPLOYEE,
    isAdmin: false,
    task: null,
    loading: true,
    loadError: '',
    canClaim: false,
    canSubmit: false,
    canReview: false,
    canCancel: false,
    reviewNote: '',
    submitting: false,
  },

  onLoad(options) {
    this.taskId = options.id || '';
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
    if (!this.taskId) {
      this.setData({
        loading: false,
        loadError: '缺少委托编号，无法翻开卷轴',
      });
      return;
    }
    this.setData({
      user: session.user,
      role: session.role,
      isAdmin: session.role === constants.ROLES.ADMIN,
    });
    this.loadTask();
  },

  async loadTask() {
    if (!this.session || !this.taskId) {
      return;
    }
    this.setData({ loading: !this.data.task });
    try {
      const task = await taskService.getTask(this.taskId, this.session.user);
      const isAdmin = this.session.role === constants.ROLES.ADMIN;
      const canReview = isAdmin && task.status === 'in_review';
      const canCancel =
        isAdmin && task.status !== 'done' && task.status !== 'cancelled';
      this.setData({
        task,
        loading: false,
        loadError: '',
        isAdmin,
        canClaim: !isAdmin && task.status === 'open',
        canSubmit:
          !isAdmin &&
          task.isMine &&
          task.status === 'in_progress',
        canReview,
        canCancel,
        reviewNote: canReview ? this.data.reviewNote : '',
      });
    } catch (error) {
      this.setData({
        loading: false,
        task: null,
        loadError: error.message || '委托加载失败',
      });
    }
  },

  handleReviewInput(event) {
    this.setData({ reviewNote: event.detail.value });
  },

  async handleClaim() {
    const result = await feedback.confirm({
      title: '接取这份委托？',
      content: '接取后卷轴会记入你的工作日志，其他工作者将无法再接取。',
      confirmText: '接取委托',
    });
    if (!result.confirm) {
      return;
    }
    await this.runAction(
      () => taskService.claimTask(this.taskId, this.session.user),
      '委托已接取'
    );
  },

  async handleSubmit() {
    const result = await feedback.confirm({
      title: '确认提交验收？',
      content: '提交后部门管理员会翻开你的交付，委托状态将进入「待验收」。',
      confirmText: '提交验收',
    });
    if (!result.confirm) {
      return;
    }
    await this.runAction(
      () => taskService.submitTask(this.taskId, this.session.user),
      '已提交验收'
    );
  },

  async handleApprove() {
    const result = await feedback.confirm({
      title: '验收通过这份交付？',
      content: '通过后委托将标记为已归档，赏金会记入接取人的名册。',
      confirmText: '验收通过',
    });
    if (!result.confirm) {
      return;
    }
    await this.runReview('approve', '验收通过');
  },

  async handleReturn() {
    const note = this.data.reviewNote.trim();
    if (!note) {
      feedback.error('请先填写退回修改的意见');
      return;
    }
    const result = await feedback.confirm({
      title: '退回修改？',
      content: '委托会回到「进行中」，接取人可以看到你的修改意见。',
      confirmText: '退回修改',
    });
    if (!result.confirm) {
      return;
    }
    await this.runReview('return', '已退回修改');
  },

  async runAction(action, successMessage) {
    if (this.data.submitting) {
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      await action();
      wx.hideLoading();
      feedback.vibrate();
      feedback.success(successMessage);
      await this.loadTask();
      this.setData({ submitting: false });
    } catch (error) {
      wx.hideLoading();
      this.setData({ submitting: false });
      feedback.error(error.message || '操作失败，请稍后重试');
    }
  },

  async runReview(decision, successMessage) {
    if (this.data.submitting) {
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      await taskService.reviewTask(
        this.taskId,
        this.session.user,
        decision,
        this.data.reviewNote
      );
      wx.hideLoading();
      feedback.vibrate();
      feedback.success(successMessage);
      this.setData({ reviewNote: '' });
      await this.loadTask();
      this.setData({ submitting: false });
    } catch (error) {
      wx.hideLoading();
      this.setData({ submitting: false });
      feedback.error(error.message || '验收操作失败');
    }
  },

  async handleCancelTask() {
    const result = await feedback.confirm({
      title: '取消这项任务？',
      content: '取消后任务会标记为「已取消」，不再允许接取或提交；已接取的工作者会收到取消通知。',
      confirmText: '取消任务',
      cancelText: '保留任务',
      confirmColor: '#A6402F',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '取消中', mask: true });
    try {
      await taskService.cancelTask(this.taskId, this.session.user);
      wx.hideLoading();
      feedback.vibrate();
      feedback.success('任务已取消');
      await this.loadTask();
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '任务取消失败');
    }
  },

  handleEmptyAction() {
    feedback.navigateBack('/pages/board/index');
  },

  onShareAppMessage() {
    const task = this.data.task;
    return {
      title: task ? `APRS 动画部 · ${task.title}` : 'APRS 动画部 · 工作者委托告示栏',
      path: `/pages/detail/index?id=${this.taskId}`,
    };
  },
});
