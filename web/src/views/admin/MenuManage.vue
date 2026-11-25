<template>
  <div class="menu-manage">
    <!-- 紧凑单行功能工具栏 -->
    <div class="menu-header">
      <div class="menu-add">
        <input
          v-model="newMenuName"
          placeholder="请输入主菜单名称"
          class="input"
          @keyup.enter="addMenu"
        />
        <button class="btn btn-add" @click="addMenu">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          添加主菜单
        </button>
      </div>
      <div class="header-meta">
        <span class="header-tip">↕ 按住左侧 ⋮⋮ 手柄可拖拽调整主菜单 / 子菜单顺序</span>
        <span v-if="toastMessage" :class="['header-toast', toastType]">{{ toastMessage }}</span>
      </div>
    </div>

    <div class="menu-content">
      <div class="menu-list">
        <div
          v-for="(menu, menuIndex) in menus"
          :key="menu.id"
          class="menu-item"
          :draggable="armedMenuId === menu.id"
          :class="{
            'is-dragging': draggingMenuId === menu.id,
            'drop-before': dragType === 'menu' && menuDropIndex === menuIndex && menuDropPos === 'before' && draggingMenuId !== menu.id,
            'drop-after': dragType === 'menu' && menuDropIndex === menuIndex && menuDropPos === 'after' && draggingMenuId !== menu.id
          }"
          @dragstart="onMenuDragStart($event, menuIndex, menu)"
          @dragover="onMenuDragOver($event, menuIndex)"
          @dragleave="onMenuDragLeave($event, menuIndex)"
          @drop="onMenuDrop($event, menuIndex)"
          @dragend="onMenuDragEnd"
        >
          <!-- 主菜单 -->
          <div class="main-menu">
            <div class="menu-info">
              <span
                class="drag-handle"
                title="按住上下拖动调整主菜单顺序"
                @mousedown="armedMenuId = menu.id"
                @mouseup="armedMenuId = null"
              >⋮⋮</span>
              <div class="menu-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 3h18v18H3zM9 9h6v6H9z"/>
                </svg>
              </div>
              <input v-model="menu.name" @blur="updateMenu(menu)" class="menu-name-input" />
              <span class="sub-count-tag">
                {{ menu.subMenus?.length || 0 }} 个子菜单
              </span>
            </div>
            <div class="menu-actions">
              <button
                class="btn btn-sm btn-outline expand-btn"
                :class="{ expanded: isExpanded(menu.id) }"
                @click="toggleSubMenu(menu.id)"
              >
                <span>{{ isExpanded(menu.id) ? '收起子菜单' : '管理子菜单' }}</span>
                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="m6 9 6 6 6-6"/>
                </svg>
              </button>
              <button class="btn btn-danger btn-icon" @click="deleteMenu(menu.id)" title="删除主菜单">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- 子菜单区域 -->
          <div class="sub-menu-section" :class="{ expanded: isExpanded(menu.id) }">
            <div class="sub-menu-header">
              <div class="sub-menu-title">
                <span>子菜单 ({{ menu.subMenus?.length || 0 }})</span>
                <span v-if="menu.subMenus?.length > 1" class="sub-drag-tip">拖动 ⋮⋮ 可调整子菜单排序</span>
              </div>
              <button class="btn btn-sm btn-outline" @click="addSubMenu(menu.id)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                添加子菜单
              </button>
            </div>

            <div class="sub-menu-list" v-if="menu.subMenus && menu.subMenus.length > 0">
              <div
                v-for="(subMenu, subIndex) in menu.subMenus"
                :key="subMenu.id"
                class="sub-menu-item"
                :draggable="armedSubMenuId === subMenu.id"
                :class="{
                  'is-dragging': draggingSubMenuId === subMenu.id,
                  'drop-before': dragType === 'submenu' && dragSubParentId === menu.id && subDropIndex === subIndex && subDropPos === 'before' && draggingSubMenuId !== subMenu.id,
                  'drop-after': dragType === 'submenu' && dragSubParentId === menu.id && subDropIndex === subIndex && subDropPos === 'after' && draggingSubMenuId !== subMenu.id
                }"
                @dragstart.stop="onSubMenuDragStart($event, menu.id, subIndex, subMenu)"
                @dragover.stop="onSubMenuDragOver($event, menu.id, subIndex)"
                @dragleave.stop="onSubMenuDragLeave($event, subIndex)"
                @drop.stop="onSubMenuDrop($event, menu, subIndex)"
                @dragend.stop="onSubMenuDragEnd"
              >
                <div class="sub-menu-info">
                  <span
                    class="drag-handle sub"
                    title="按住上下拖动调整子菜单顺序"
                    @mousedown.stop="armedSubMenuId = subMenu.id"
                    @mouseup.stop="armedSubMenuId = null"
                  >⋮⋮</span>
                  <div class="sub-menu-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 6h16M4 12h16M4 18h16"/>
                    </svg>
                  </div>
                  <input v-model="subMenu.name" @blur="updateSubMenu(subMenu)" class="sub-menu-name-input" />
                </div>
                <div class="sub-menu-actions">
                  <button class="btn btn-danger btn-icon btn-sm" @click="deleteSubMenu(subMenu.id)" title="删除子菜单">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                      <path d="M10 11v6M14 11v6"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div v-else class="empty-sub-menu">
              <span>暂无子菜单</span>
              <button class="btn btn-sm btn-outline" @click="addSubMenu(menu.id)">+ 添加第一个子菜单</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import {
  getMenus,
  addMenu as apiAddMenu,
  updateMenu as apiUpdateMenu,
  deleteMenu as apiDeleteMenu,
  reorderMenus as apiReorderMenus,
  addSubMenu as apiAddSubMenu,
  updateSubMenu as apiUpdateSubMenu,
  deleteSubMenu as apiDeleteSubMenu,
  reorderSubMenus as apiReorderSubMenus
} from '../../api';

const menus = ref([]);
const newMenuName = ref('');
const expandedIds = ref(new Set());
const toastMessage = ref('');
const toastType = ref('success');
let toastTimer = null;

// 拖拽状态（主菜单与子菜单分离，防止冲突）
const dragType = ref(''); // 'menu' | 'submenu' | ''
const armedMenuId = ref(null);
const draggingMenuId = ref(null);
const menuDragStartIndex = ref(-1);
const menuDropIndex = ref(-1);
const menuDropPos = ref('before');

const armedSubMenuId = ref(null);
const draggingSubMenuId = ref(null);
const dragSubParentId = ref(null);
const subDragStartIndex = ref(-1);
const subDropIndex = ref(-1);
const subDropPos = ref('before');

function showToast(msg, type = 'success') {
  toastMessage.value = msg;
  toastType.value = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = '';
  }, 2500);
}

onMounted(loadMenus);
onBeforeUnmount(() => clearTimeout(toastTimer));

function isExpanded(menuId) {
  return expandedIds.value.has(menuId);
}

function toggleSubMenu(menuId) {
  const next = new Set(expandedIds.value);
  if (next.has(menuId)) next.delete(menuId);
  else next.add(menuId);
  expandedIds.value = next;
}

async function loadMenus() {
  const res = await getMenus();
  menus.value = res.data || [];
}

async function addMenu() {
  if (!newMenuName.value.trim()) return;
  const maxOrder = menus.value.length
    ? Math.max(...menus.value.map(m => m.order || 0))
    : 0;
  await apiAddMenu({ name: newMenuName.value.trim(), order: maxOrder + 1 });
  newMenuName.value = '';
  await loadMenus();
  showToast('主菜单已添加');
}

async function updateMenu(menu) {
  if (!menu.name.trim()) return;
  await apiUpdateMenu(menu.id, { name: menu.name.trim(), order: menu.order || 0 });
}

async function deleteMenu(id) {
  if (!confirm('确定要删除这个主菜单吗？删除后将同时删除其下的所有子菜单和卡片。')) return;
  await apiDeleteMenu(id);
  await loadMenus();
}

async function addSubMenu(menuId) {
  const menu = menus.value.find(m => m.id === menuId);
  const subMenuName = prompt('请输入子菜单名称：');
  if (!subMenuName?.trim()) return;

  const maxOrder = menu?.subMenus?.length
    ? Math.max(...menu.subMenus.map(sm => sm.order || 0))
    : 0;

  await apiAddSubMenu(menuId, { name: subMenuName.trim(), order: maxOrder + 1 });
  const next = new Set(expandedIds.value);
  next.add(menuId);
  expandedIds.value = next;
  await loadMenus();
  showToast('子菜单已添加');
}

async function updateSubMenu(subMenu) {
  if (!subMenu.name.trim()) return;
  await apiUpdateSubMenu(subMenu.id, { name: subMenu.name.trim(), order: subMenu.order || 0 });
}

async function deleteSubMenu(id) {
  if (!confirm('确定要删除这个子菜单吗？删除后将同时删除其下的所有卡片。')) return;
  await apiDeleteSubMenu(id);
  await loadMenus();
}

// 主菜单拖拽排序
function onMenuDragStart(event, index, menu) {
  if (armedMenuId.value !== menu.id) {
    event.preventDefault();
    return;
  }
  dragType.value = 'menu';
  draggingMenuId.value = menu.id;
  menuDragStartIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `menu:${menu.id}`);
}

function onMenuDragOver(event, index) {
  if (dragType.value !== 'menu') return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  menuDropIndex.value = index;
  menuDropPos.value = (event.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
}

function onMenuDragLeave(event, index) {
  if (dragType.value === 'menu' && menuDropIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    menuDropIndex.value = -1;
  }
}

async function onMenuDrop(event, targetIndex) {
  if (dragType.value !== 'menu') return;
  event.preventDefault();
  const fromIndex = menuDragStartIndex.value;
  let insertIndex = menuDropPos.value === 'after' ? targetIndex + 1 : targetIndex;
  if (fromIndex < insertIndex) insertIndex -= 1;

  onMenuDragEnd();

  if (fromIndex < 0 || fromIndex === insertIndex || insertIndex < 0 || insertIndex >= menus.value.length) return;

  const previous = [...menus.value];
  const reordered = [...menus.value];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(insertIndex, 0, moved);

  const payload = reordered.map((item, idx) => {
    item.order = idx + 1;
    return { id: item.id, order: idx + 1 };
  });
  menus.value = reordered;

  try {
    await apiReorderMenus(payload);
  } catch {
    menus.value = previous;
    showToast('主菜单排序保存失败，已恢复', 'error');
  }
}

function onMenuDragEnd() {
  dragType.value = '';
  armedMenuId.value = null;
  draggingMenuId.value = null;
  menuDragStartIndex.value = -1;
  menuDropIndex.value = -1;
}

// 子菜单拖拽排序
function onSubMenuDragStart(event, parentId, index, subMenu) {
  if (armedSubMenuId.value !== subMenu.id) {
    event.preventDefault();
    return;
  }
  dragType.value = 'submenu';
  dragSubParentId.value = parentId;
  draggingSubMenuId.value = subMenu.id;
  subDragStartIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `submenu:${subMenu.id}`);
}

function onSubMenuDragOver(event, parentId, index) {
  if (dragType.value !== 'submenu' || dragSubParentId.value !== parentId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  subDropIndex.value = index;
  subDropPos.value = (event.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
}

function onSubMenuDragLeave(event, index) {
  if (dragType.value === 'submenu' && subDropIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    subDropIndex.value = -1;
  }
}

async function onSubMenuDrop(event, parentMenu, targetIndex) {
  if (dragType.value !== 'submenu' || dragSubParentId.value !== parentMenu.id) return;
  event.preventDefault();
  const fromIndex = subDragStartIndex.value;
  let insertIndex = subDropPos.value === 'after' ? targetIndex + 1 : targetIndex;
  if (fromIndex < insertIndex) insertIndex -= 1;

  onSubMenuDragEnd();

  const list = parentMenu.subMenus || [];
  if (fromIndex < 0 || fromIndex === insertIndex || insertIndex < 0 || insertIndex >= list.length) return;

  const previous = [...list];
  const reordered = [...list];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(insertIndex, 0, moved);

  const payload = reordered.map((item, idx) => {
    item.order = idx + 1;
    return { id: item.id, order: idx + 1 };
  });
  parentMenu.subMenus = reordered;

  try {
    await apiReorderSubMenus(payload);
  } catch {
    parentMenu.subMenus = previous;
    showToast('子菜单排序保存失败，已恢复', 'error');
  }
}

function onSubMenuDragEnd() {
  dragType.value = '';
  armedSubMenuId.value = null;
  draggingSubMenuId.value = null;
  dragSubParentId.value = null;
  subDragStartIndex.value = -1;
  subDropIndex.value = -1;
}
</script>

<style scoped>
.menu-manage {
  max-width: 1120px;
  width: 96%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 压缩后的单行功能工具栏 */
.menu-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 10px 16px;
  color: white;
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.24);
  width: 100%;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.menu-add {
  display: flex;
  gap: 8px;
  align-items: center;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.header-tip {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.9);
}

.header-toast {
  font-size: 0.8rem;
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 500;
}
.header-toast.success { background: rgba(16, 185, 129, 0.92); color: #fff; }
.header-toast.error { background: rgba(239, 68, 68, 0.92); color: #fff; }

.input {
  padding: 7px 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 7px;
  font-size: 0.88rem;
  background: rgba(255, 255, 255, 0.96);
  color: #1e293b;
  height: 34px;
  box-sizing: border-box;
  min-width: 210px;
}

.input:focus {
  outline: none;
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}

.menu-content {
  background: white;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid #e5e7eb;
  overflow: hidden;
  width: 100%;
}

.menu-item {
  border-bottom: 1px solid #eef2f7;
  transition: background 0.15s ease;
}

.menu-item:last-child {
  border-bottom: none;
}

.menu-item.is-dragging {
  opacity: 0.45;
  background: #eef2ff;
}

.menu-item.drop-before {
  box-shadow: inset 0 3px 0 0 #4f46e5;
}

.menu-item.drop-after {
  box-shadow: inset 0 -3px 0 0 #4f46e5;
}

.main-menu {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: white;
  gap: 12px;
}

.main-menu:hover {
  background: #f8fafc;
}

.menu-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 30px;
  color: #94a3b8;
  cursor: grab;
  font-size: 1.05rem;
  letter-spacing: -1px;
  user-select: none;
  border-radius: 6px;
  flex-shrink: 0;
}

.drag-handle:hover {
  color: #4f46e5;
  background: #eef2ff;
}

.drag-handle:active {
  cursor: grabbing;
}

.drag-handle.sub {
  height: 26px;
  font-size: 0.95rem;
}

.menu-icon {
  width: 34px;
  height: 34px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.menu-name-input {
  font-size: 0.98rem;
  font-weight: 600;
  border: 1.5px solid transparent;
  background: transparent;
  padding: 6px 10px;
  border-radius: 7px;
  color: #1e293b;
  min-width: 160px;
  max-width: 260px;
  transition: all 0.15s ease;
}

.menu-name-input:hover {
  border-color: #e2e8f0;
  background: #fff;
}

.menu-name-input:focus {
  outline: none;
  border-color: #667eea;
  background: #fff;
}

.sub-count-tag {
  font-size: 0.76rem;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}

.menu-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-menu-section {
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
}

.sub-menu-section.expanded {
  max-height: 1200px;
}

.sub-menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 20px 8px 46px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}

.sub-menu-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  color: #475569;
  font-size: 0.85rem;
}

.sub-drag-tip {
  font-weight: 400;
  font-size: 0.76rem;
  color: #64748b;
}

.sub-menu-list {
  padding: 10px 20px 12px 46px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sub-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: white;
  border-radius: 9px;
  border: 1px solid #e2e8f0;
  transition: all 0.15s ease;
}

.sub-menu-item:hover {
  border-color: #cbd5e1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.sub-menu-item.is-dragging {
  opacity: 0.45;
  background: #ecfdf5;
}

.sub-menu-item.drop-before {
  box-shadow: inset 0 2.5px 0 0 #10b981;
}

.sub-menu-item.drop-after {
  box-shadow: inset 0 -2.5px 0 0 #10b981;
}

.sub-menu-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.sub-menu-icon {
  width: 26px;
  height: 26px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  flex-shrink: 0;
}

.sub-menu-name-input {
  font-size: 0.9rem;
  border: 1.5px solid transparent;
  background: transparent;
  padding: 5px 8px;
  border-radius: 6px;
  color: #334155;
  min-width: 150px;
  transition: all 0.15s ease;
}

.sub-menu-name-input:hover {
  border-color: #e2e8f0;
}

.sub-menu-name-input:focus {
  outline: none;
  border-color: #10b981;
  background: #f0fdf4;
}

.empty-sub-menu {
  padding: 14px 20px 14px 46px;
  display: flex;
  align-items: center;
  gap: 12px;
  color: #64748b;
  font-size: 0.85rem;
}

/* 按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 13px;
  height: 34px;
  border: none;
  border-radius: 7px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  box-sizing: border-box;
  white-space: nowrap;
}

.btn-add {
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
}

.btn-add:hover {
  background: rgba(255, 255, 255, 0.32);
}

.btn-outline {
  background: #fff;
  color: #4f46e5;
  border: 1px solid #c7d2fe;
}

.btn-outline:hover {
  background: #eef2ff;
}

.expand-btn .chevron {
  transition: transform 0.2s ease;
}

.expand-btn.expanded .chevron {
  transform: rotate(180deg);
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
}

.btn-sm {
  height: 30px;
  padding: 4px 10px;
  font-size: 0.8rem;
}

.btn-icon {
  width: 32px;
  height: 32px;
  padding: 0;
  justify-content: center;
}

.btn-icon.btn-sm {
  width: 28px;
  height: 28px;
}

@media (max-width: 768px) {
  .menu-manage {
    width: 95%;
  }
  .menu-add {
    width: 100%;
  }
  .input {
    flex: 1;
    min-width: 0;
  }
  .main-menu {
    flex-wrap: wrap;
    padding: 12px;
  }
  .sub-menu-header,
  .sub-menu-list,
  .empty-sub-menu {
    padding-left: 16px;
    padding-right: 12px;
  }
}
</style>
