const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const projectService = require('../../services/project-service');
const { getLayout } = require('../../utils/layout');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    projects: [],
    summary: {
      projectCount: 0,
      totalTasks: 0,
      recruiting: 0,
      inProgress: 0,
      inReview: 0,
      done: 0,
      totalReward: 0,
    },
    loading: true,
    showList: false,
    showEmpty: false,
    clearing: false,
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
    if (session.role !== constants.ROLES.ADMIN) {
      feedback.error('仅部门管理员可以查看归档项目');
      feedback.navigateBack('/pages/projects/index');
      return;
    }
    this.session = session;
    this.loadArchive();
  },

  loadArchive() {
    this.setData({ loading: true });
    try {
      const projects = projectService.listArchivedProjects(
        this.session.user
      );
      const summary = {
        projectCount: projects.length,
        totalTasks: 0,
        recruiting: 0,
        inProgress: 0,
        inReview: 0,
        done: 0,
        totalReward: 0,
      };
      projects.forEach((project) => {
        const stats = project.archiveStats;
        summary.totalTasks += stats.total;
        summary.recruiting += stats.recruiting;
        summary.inProgress += stats.inProgress;
        summary.inReview += stats.inReview;
        summary.done += stats.done;
        summary.totalReward += project.totalReward;
      });
      this.setData({
        projects,
        summary,
        loading: false,
        showList: projects.length > 0,
        showEmpty: projects.length === 0,
      });
    } catch (error) {
      this.setData({
        loading: false,
        showList: false,
        showEmpty: true,
      });
      feedback.error(error.message || '归档项目加载失败');
    }
  },

  handleOpen(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.opening) {
      return;
    }
    this.opening = true;
    wx.navigateTo({
      url: `/pages/project/index?id=${id}`,
      fail: () => feedback.error('归档项目打开失败'),
      complete: () => {
        this.opening = false;
      },
    });
  },

  async handleClearProject(event) {
    const id = event.currentTarget.dataset.id;
    const name = event.currentTarget.dataset.name || '该项目';
    const project = this.data.projects.find((item) => item.id === id);
    if (!project) {
      return;
    }
    const result = await feedback.confirm({
      title: '清除此归档项目？',
      content: `将永久删除「${name}」及其 ${project.totalTasks} 项任务、工作日志和排行结算记录。此操作不可撤销。`,
      confirmText: '清除项目',
      cancelText: '保留归档',
      confirmColor: '#A6402F',
    });
    if (!result.confirm) {
      return;
    }
    wx.showLoading({ title: '清除中', mask: true });
    try {
      const outcome = projectService.clearArchivedProject(
        id,
        this.session.user
      );
      wx.hideLoading();
      feedback.success(
        `已清除 ${outcome.name}，${outcome.taskCount} 项任务`
      );
      this.loadArchive();
    } catch (error) {
      wx.hideLoading();
      feedback.error(error.message || '归档项目清除失败');
    }
  },

  async handleClearArchive() {
    if (!this.data.projects.length || this.data.clearing) {
      return;
    }
    const result = await feedback.confirm({
      title: '彻底清除归档项目？',
      content: `将永久删除 ${this.data.summary.projectCount} 个归档项目、${this.data.summary.totalTasks} 项任务，以及相关通知和排行结算记录。此操作不可撤销。`,
      confirmText: '彻底清除',
      cancelText: '保留归档',
      confirmColor: '#A6402F',
    });
    if (!result.confirm) {
      return;
    }

    this.setData({ clearing: true });
    wx.showLoading({ title: '清除中', mask: true });
    try {
      const outcome = projectService.clearArchivedProjects(
        this.session.user
      );
      wx.hideLoading();
      this.setData({ clearing: false });
      feedback.success(
        `已清除 ${outcome.projectCount} 个项目、${outcome.taskCount} 项任务`
      );
      this.loadArchive();
    } catch (error) {
      wx.hideLoading();
      this.setData({ clearing: false });
      feedback.error(error.message || '归档项目清除失败');
    }
  },

  goProjects() {
    feedback.navigateBack('/pages/projects/index');
  },
});
