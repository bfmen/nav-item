import axios from 'axios';
import router from './router';
const BASE = '/api';
axios.defaults.withCredentials = true;

axios.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401) {
    localStorage.removeItem('token');
    window.dispatchEvent(new Event('auth:unauthorized'));
    if (error.config?.url !== `${BASE}/login`) router.replace('/admin');
  }
  return Promise.reject(error);
});

export const login = (username, password) => axios.post(`${BASE}/login`, { username, password });
export const logout = () => axios.post(`${BASE}/logout`);
export const getLoginInfo = () => axios.get(`${BASE}/users/me`);

// 菜单相关API
export const getMenus = () => axios.get(`${BASE}/menus`);
export const addMenu = (data) => axios.post(`${BASE}/menus`, data);
export const updateMenu = (id, data) => axios.put(`${BASE}/menus/${id}`, data);
export const deleteMenu = (id) => axios.delete(`${BASE}/menus/${id}`);
export const reorderMenus = (items) => axios.put(`${BASE}/menus/reorder`, { items });

// 子菜单相关API
export const getSubMenus = (menuId) => axios.get(`${BASE}/menus/${menuId}/submenus`);
export const addSubMenu = (menuId, data) => axios.post(`${BASE}/menus/${menuId}/submenus`, data);
export const updateSubMenu = (id, data) => axios.put(`${BASE}/menus/submenus/${id}`, data);
export const deleteSubMenu = (id) => axios.delete(`${BASE}/menus/submenus/${id}`);
export const reorderSubMenus = (items) => axios.put(`${BASE}/menus/submenus/reorder`, { items });

// 卡片相关API
export const getCards = (menuId, subMenuId = null) => {
  const params = subMenuId ? { subMenuId } : {};
  return axios.get(`${BASE}/cards/${menuId}`, { params });
};
export const getFilteredCards = (params = {}) => axios.get(`${BASE}/cards`, { params });
export const addCard = (data) => axios.post(`${BASE}/cards`, data);
export const updateCard = (id, data) => axios.put(`${BASE}/cards/${id}`, data);
export const deleteCard = (id) => axios.delete(`${BASE}/cards/${id}`);
export const reorderCards = (items) => axios.put(`${BASE}/cards/reorder`, { items });
export const batchDeleteCards = (ids, reason = 'manual') => axios.post(`${BASE}/cards/batch-delete`, { ids, reason });
export const batchMoveCards = (data) => axios.post(`${BASE}/cards/batch-move`, data);

// 回收站相关API
export const getRecycleCards = (params = {}) => axios.get(`${BASE}/cards/recycle`, { params });
export const getRecycleCount = () => axios.get(`${BASE}/cards/recycle/count`);
export const restoreRecycleCards = (ids) => axios.post(`${BASE}/cards/recycle/restore`, { ids });
export const permanentDeleteCards = (ids) => axios.post(`${BASE}/cards/recycle/permanent-delete`, { ids });
export const emptyRecycleBin = (params = {}) => axios.delete(`${BASE}/cards/recycle/empty`, { params });

export const uploadLogo = (file) => {
  const formData = new FormData();
  formData.append('logo', file);
  return axios.post(`${BASE}/upload`, formData);
};

// AI 智能整理与配置API
export const getAiConfigs = () => axios.get(`${BASE}/ai/configs`);
export const addAiConfig = (data) => axios.post(`${BASE}/ai/configs`, data);
export const updateAiConfig = (id, data) => axios.put(`${BASE}/ai/configs/${id}`, data);
export const activateAiConfig = (id) => axios.put(`${BASE}/ai/configs/${id}/activate`);
export const deleteAiConfig = (id) => axios.delete(`${BASE}/ai/configs/${id}`);
export const fetchAiModels = (data) => axios.post(`${BASE}/ai/models`, data, { timeout: 30000 });
export const startAiOrganize = (data) => axios.post(`${BASE}/ai/organize/start`, data, { timeout: 30000 });
export const getAiOrganizeStatus = (taskId) => axios.get(`${BASE}/ai/organize/status/${encodeURIComponent(taskId)}`, { timeout: 20000 });
export const cancelAiOrganize = (taskId) => axios.post(`${BASE}/ai/organize/cancel/${encodeURIComponent(taskId)}`, {}, { timeout: 15000 });
export const runAiOrganize = (data) => axios.post(`${BASE}/ai/organize`, data, { timeout: 300000 });
export const applyAiOrganize = (payload) => axios.post(`${BASE}/ai/apply`, Array.isArray(payload) ? { updates: payload } : payload, { timeout: 60000 });

// 友链API
export const getFriends = () => axios.get(`${BASE}/friends`);
export const addFriend = (data) => axios.post(`${BASE}/friends`, data);
export const updateFriend = (id, data) => axios.put(`${BASE}/friends/${id}`, data);
export const deleteFriend = (id) => axios.delete(`${BASE}/friends/${id}`);

// 用户API
export const getUserProfile = () => axios.get(`${BASE}/users/profile`);
export const changePassword = (oldPassword, newPassword) => axios.put(`${BASE}/users/password`, { oldPassword, newPassword });
export const getUsers = () => axios.get(`${BASE}/users`);
export const exportBackup = () => axios.get(`${BASE}/backup/export`);
export const restoreBackup = (backup) => axios.post(`${BASE}/backup/restore`, backup);
export const backupToWebdav = (data) => axios.post(`${BASE}/backup/webdav`, data);
export const listWebdavBackups = (data) => axios.post(`${BASE}/backup/webdav/list`, data);
export const restoreWebdavBackup = (data) => axios.post(`${BASE}/backup/webdav/restore`, data);
export const getWebdavConfig = () => axios.get(`${BASE}/backup/webdav/config`);
export const saveWebdavConfig = (data) => axios.put(`${BASE}/backup/webdav/config`, data);
