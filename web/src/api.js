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

// 子菜单相关API
export const getSubMenus = (menuId) => axios.get(`${BASE}/menus/${menuId}/submenus`);
export const addSubMenu = (menuId, data) => axios.post(`${BASE}/menus/${menuId}/submenus`, data);
export const updateSubMenu = (id, data) => axios.put(`${BASE}/menus/submenus/${id}`, data);
export const deleteSubMenu = (id) => axios.delete(`${BASE}/menus/submenus/${id}`);

// 卡片相关API
export const getCards = (menuId, subMenuId = null) => {
  const params = subMenuId ? { subMenuId } : {};
  return axios.get(`${BASE}/cards/${menuId}`, { params });
};
export const addCard = (data) => axios.post(`${BASE}/cards`, data);
export const updateCard = (id, data) => axios.put(`${BASE}/cards/${id}`, data);
export const deleteCard = (id) => axios.delete(`${BASE}/cards/${id}`);

export const uploadLogo = (file) => {
  const formData = new FormData();
  formData.append('logo', file);
  return axios.post(`${BASE}/upload`, formData);
};

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
