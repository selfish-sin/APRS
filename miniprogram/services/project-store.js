const PROJECTS_KEY = 'animflow:projects:v1';
const PROJECTS_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function saveProjects(projects) {
  const envelope = {
    version: PROJECTS_VERSION,
    updatedAt: Date.now(),
    projects,
  };
  try {
    wx.setStorageSync(PROJECTS_KEY, envelope);
  } catch (error) {
    throw new Error('项目数据保存失败，请检查设备存储空间');
  }
  return envelope;
}

function isValidProject(project) {
  return (
    !!project &&
    typeof project === 'object' &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    Array.isArray(project.taskIds)
  );
}

function loadProjects() {
  let envelope;
  try {
    envelope = wx.getStorageSync(PROJECTS_KEY);
  } catch (error) {
    envelope = null;
  }
  if (
    envelope &&
    envelope.version === PROJECTS_VERSION &&
    Array.isArray(envelope.projects) &&
    envelope.projects.every(isValidProject)
  ) {
    return clone(envelope.projects);
  }
  return [];
}

function listProjects() {
  return loadProjects().sort((left, right) => right.createdAt - left.createdAt);
}

function getProject(projectId) {
  const list = loadProjects();
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].id === projectId) {
      return clone(list[index]);
    }
  }
  return null;
}

function createProject(project) {
  const list = loadProjects();
  list.push(clone(project));
  saveProjects(list);
  return clone(project);
}

function updateProject(project) {
  const list = loadProjects();
  let found = false;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].id === project.id) {
      list[index] = clone(project);
      found = true;
      break;
    }
  }
  if (!found) {
    throw new Error('项目不存在');
  }
  saveProjects(list);
  return clone(project);
}

function clearProjects() {
  try {
    wx.removeStorageSync(PROJECTS_KEY);
  } catch (error) {
    // Clearing demo data is best-effort.
  }
}

function clearArchived() {
  const list = loadProjects();
  const next = list.filter((project) => project.status !== 'archived');
  const removed = list.length - next.length;
  if (removed > 0) {
    saveProjects(next);
  }
  return removed;
}

function deleteProject(projectId) {
  const list = loadProjects();
  const next = list.filter((project) => project.id !== projectId);
  if (next.length === list.length) {
    throw new Error('项目不存在');
  }
  saveProjects(next);
  return true;
}

module.exports = {
  PROJECTS_KEY,
  loadProjects,
  listProjects,
  getProject,
  createProject,
  updateProject,
  clearProjects,
  clearArchived,
  deleteProject,
};
