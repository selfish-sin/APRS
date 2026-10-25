const constants = require('../../utils/constants');
const sessionService = require('../../services/session');
const projectService = require('../../services/project-service');
const { getLayout } = require('../../utils/layout');
const dateUtil = require('../../utils/date');
const feedback = require('../../utils/feedback');

Page({
  data: {
    layout: {
      safeBottom: 0,
    },
    projects: [],
    archiveCount: 0,
    loading: true,
  },

  onLoad() {
    this.setData({ layout: getLayout() });
  },

  onShow() {
    const session = sessionService.getSession();
    if (!session) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    if (session.role !== constants.ROLES.ADMIN) {
      feedback.error('仅部门管理员可以管理项目');
      feedback.navigateBack('/pages/board/index');
      return;
    }
    this.session = session;
    this.loadProjects();
  },

  loadProjects() {
    try {
      const projects = projectService
        .listActiveProjects(this.session.user)
        .map((project) =>
          Object.assign({}, project, {
            createdLabel: dateUtil.formatDateTime(project.createdAt),
          })
        );
      const archiveCount = projectService.listArchivedProjects(
        this.session.user
      ).length;
      this.setData({ projects, archiveCount, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      feedback.error(error.message || '项目加载失败');
    }
  },

  goArchive() {
    if (this.openingArchive) {
      return;
    }
    this.openingArchive = true;
    wx.navigateTo({
      url: '/pages/archive/index',
      fail: () => feedback.error('归档项目打开失败'),
      complete: () => {
        this.openingArchive = false;
      },
    });
  },

  handleCreate() {
    wx.navigateTo({ url: '/pages/project/index' });
  },

  handleOpen(event) {
    const id = event.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: `/pages/project/index?id=${id}` });
    }
  },
});
