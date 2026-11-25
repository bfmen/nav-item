<template>
  <div class="card-manage">
    <!-- 紧凑单行功能工具栏 -->
    <div class="card-header">
      <div class="card-add">
        <input v-model="newCardTitle" placeholder="卡片标题" class="input narrow" @keyup.enter="addCard" />
        <input v-model="newCardUrl" placeholder="卡片网址 (https://...)" class="input wide" @keyup.enter="addCard" />
        <input v-model="newCardLogo" placeholder="Logo链接(可选)" class="input medium" @keyup.enter="addCard" />
        <button class="btn btn-add" @click="addCard">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          添加卡片
        </button>
      </div>
      <div class="header-right">
        <button class="btn btn-ai" @click="showAiModal = true">
          ✨ AI 智能整理
        </button>
      </div>
    </div>

    <div class="card-card">
      <!-- 筛选过滤栏 + 批量操作条 -->
      <div class="table-toolbar">
        <div class="filter-group">
          <label class="filter-label">筛选：</label>
          <select v-model="filterMenuId" class="filter-select" @change="onFilterMenuChange">
            <option value="all">全部主菜单</option>
            <option v-for="menu in menus" :key="menu.id" :value="menu.id">{{ menu.name }}</option>
          </select>
          <select
            v-model="filterSubMenuId"
            class="filter-select"
            :disabled="filterMenuId === 'all'"
            @change="loadCards"
          >
            <option value="main">主菜单直属</option>
            <option v-if="currentFilterSubMenus.length" value="all">全部（含子菜单）</option>
            <option v-for="sub in currentFilterSubMenus" :key="sub.id" :value="sub.id">
              {{ sub.name }}
            </option>
          </select>
          <input
            v-model="searchKeyword"
            type="text"
            class="filter-search"
            placeholder="搜索标题 / 网址 / 描述..."
          />
          <span class="count-badge">{{ displayedCards.length }} 张</span>
          <span v-if="canDragSort" class="drag-hint" title="按住每行最左侧 ⋮⋮ 手柄上下拖动可调整排序">
            ↕ 支持拖拽排序
          </span>
          <span v-else class="drag-hint muted" title="选择单一主菜单或子菜单并清空搜索词后可拖拽排序">
            选定具体栏目可拖拽排序
          </span>
        </div>

        <div v-if="toastMessage" :class="['inline-toast', toastType]">
          {{ toastMessage }}
        </div>
      </div>

      <!-- 批量操作栏 -->
      <div v-if="selectedIds.length > 0" class="batch-bar">
        <span class="batch-count">已选中 <strong>{{ selectedIds.length }}</strong> 张卡片</span>
        <div class="batch-move-group">
          <span>移动到：</span>
          <select v-model="batchTargetMenuId" class="filter-select sm" @change="batchTargetSubMenuId = ''">
            <option v-for="menu in menus" :key="menu.id" :value="menu.id">{{ menu.name }}</option>
          </select>
          <select v-model="batchTargetSubMenuId" class="filter-select sm">
            <option value="">主菜单直属</option>
            <option v-for="sub in batchTargetSubMenus" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
          </select>
          <button class="btn btn-sm btn-primary" :disabled="batchBusy" @click="handleBatchMove">确认移动</button>
        </div>
        <button class="btn btn-sm btn-danger" :disabled="batchBusy" @click="handleBatchDelete">批量移入回收站</button>
        <button class="btn btn-sm btn-ghost" @click="selectedIds = []">取消选择</button>
      </div>

      <div class="table-scroll">
        <table class="card-table">
          <thead>
            <tr>
              <th class="col-drag" title="拖拽排序"></th>
              <th class="col-check">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate.prop="someSelected"
                  @change="toggleSelectAll"
                  title="全选/取消全选"
                />
              </th>
              <th class="col-logo">Logo</th>
              <th class="col-title">标题</th>
              <th class="col-url">网址</th>
              <th class="col-desc">描述</th>
              <th v-if="showCategoryColumn" class="col-category">所属栏目</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(card, index) in displayedCards"
              :key="card.id"
              :draggable="canDragSort && dragArmedId === card.id"
              :class="{
                'is-dragging': draggingCardId === card.id,
                'drop-before': dragOverIndex === index && dragOverPosition === 'before' && draggingCardId !== card.id,
                'drop-after': dragOverIndex === index && dragOverPosition === 'after' && draggingCardId !== card.id,
                'is-selected': selectedIds.includes(card.id)
              }"
              @dragstart="onDragStart($event, index, card)"
              @dragover="onDragOver($event, index)"
              @dragleave="onDragLeave($event, index)"
              @drop="onDrop($event, index)"
              @dragend="onDragEnd"
            >
              <!-- 拖拽手柄 -->
              <td class="col-drag">
                <span
                  :class="['drag-handle', { disabled: !canDragSort }]"
                  :title="canDragSort ? '按住上下拖动调整顺序' : '选定单一栏目且无搜索过滤时可拖拽排序'"
                  @mousedown="canDragSort && (dragArmedId = card.id)"
                  @mouseup="dragArmedId = null"
                >⋮⋮</span>
              </td>

              <!-- 复选框 -->
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(card.id)"
                  @change="toggleSelectCard(card.id)"
                />
              </td>

              <!-- Favicon 缩略图预览 + 点击编辑 Logo 链接 -->
              <td class="col-logo">
                <div class="logo-cell">
                  <button
                    type="button"
                    class="logo-preview-btn"
                    :title="card.logo_url ? `Logo: ${card.logo_url}（点击编辑）` : '自动获取 Favicon（点击自定义链接）'"
                    @click.stop="openLogoEditor($event, card)"
                  >
                    <CardLogo :card="card" class="logo-thumb-img" />
                    <span class="logo-edit-badge">✎</span>
                  </button>
                </div>
              </td>

              <!-- 标题 -->
              <td class="col-title">
                <input v-model="card.title" @blur="saveCardField(card)" class="table-input" />
              </td>

              <!-- 网址 -->
              <td class="col-url">
                <input v-model="card.url" @blur="saveCardField(card)" class="table-input" />
              </td>

              <!-- 描述 -->
              <td class="col-desc">
                <input v-model="card.desc" @blur="saveCardField(card)" class="table-input" placeholder="描述（可选）" />
              </td>

              <!-- 所属栏目（混合视图时显示） -->
              <td v-if="showCategoryColumn" class="col-category">
                <span class="category-pill">{{ formatCardCategory(card) }}</span>
              </td>

              <!-- 操作 -->
              <td class="col-actions">
                <button class="btn btn-danger btn-icon" @click="deleteCard(card.id)" title="移入回收站">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                    <path d="M10 11v6M14 11v6"/>
                  </svg>
                </button>
              </td>
            </tr>
            <tr v-if="!displayedCards.length">
              <td :colspan="showCategoryColumn ? 8 : 7" class="empty-row">
                当前筛选条件下暂无卡片
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Logo 链接浮动编辑框（Teleport 避免被表格滚动容器裁切） -->
    <Teleport to="body">
      <div
        v-if="editingLogoCard"
        class="logo-popover-floating"
        :style="logoPopoverStyle"
        @click.stop
      >
        <div class="logo-popover-title">编辑 Logo 链接（留空自动获取 Favicon）</div>
        <input
          ref="logoInputRef"
          v-model="editingLogoValue"
          type="text"
          class="logo-popover-input"
          placeholder="https://example.com/favicon.ico"
          @keyup.enter="saveLogoEditor(editingLogoCard)"
          @keyup.esc="closeLogoEditor"
        />
        <div class="logo-popover-actions">
          <button type="button" class="btn btn-xs btn-ghost" @click="editingLogoValue = ''">清空</button>
          <button type="button" class="btn btn-xs btn-ghost" @click="closeLogoEditor">取消</button>
          <button type="button" class="btn btn-xs btn-primary" @click="saveLogoEditor(editingLogoCard)">保存</button>
        </div>
      </div>
    </Teleport>

    <!-- AI 智能整理弹窗 -->
    <AiOrganizeModal
      :visible="showAiModal"
      :current-menu-id="filterMenuId"
      :current-sub-menu-id="filterSubMenuId"
      @close="showAiModal = false"
      @applied="onAiApplied"
    />
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import CardLogo from '../../components/CardLogo.vue';
import AiOrganizeModal from '../../components/AiOrganizeModal.vue';
import {
  getMenus,
  getFilteredCards,
  addCard as apiAddCard,
  updateCard as apiUpdateCard,
  deleteCard as apiDeleteCard,
  reorderCards as apiReorderCards,
  batchDeleteCards,
  batchMoveCards
} from '../../api';

const menus = ref([]);
const cards = ref([]);
const cardSnapshots = new Map();

const filterMenuId = ref('all');
const filterSubMenuId = ref('main');
const searchKeyword = ref('');

const newCardTitle = ref('');
const newCardUrl = ref('');
const newCardLogo = ref('');

const selectedIds = ref([]);
const batchTargetMenuId = ref('');
const batchTargetSubMenuId = ref('');
const batchBusy = ref(false);

const editingLogoCard = ref(null);
const editingLogoValue = ref('');
const logoPopoverStyle = ref({ top: '0px', left: '0px' });
const logoInputRef = ref(null);

const showAiModal = ref(false);
const toastMessage = ref('');
const toastType = ref('success');
let toastTimer = null;

// 拖拽状态
const dragArmedId = ref(null);
const draggingCardId = ref(null);
const dragStartIndex = ref(-1);
const dragOverIndex = ref(-1);
const dragOverPosition = ref('before');

const currentFilterSubMenus = computed(() => {
  if (filterMenuId.value === 'all' || !filterMenuId.value) return [];
  const menu = menus.value.find(m => m.id === filterMenuId.value);
  return menu?.subMenus || [];
});

const batchTargetSubMenus = computed(() => {
  const menu = menus.value.find(m => m.id === batchTargetMenuId.value);
  return menu?.subMenus || [];
});

const showCategoryColumn = computed(() =>
  filterMenuId.value === 'all' || filterSubMenuId.value === 'all'
);

const canDragSort = computed(() =>
  filterMenuId.value !== 'all' &&
  filterSubMenuId.value !== 'all' &&
  !searchKeyword.value.trim()
);

const displayedCards = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return cards.value;
  return cards.value.filter(c =>
    (c.title || '').toLowerCase().includes(kw) ||
    (c.url || '').toLowerCase().includes(kw) ||
    (c.desc || '').toLowerCase().includes(kw)
  );
});

const allSelected = computed(() =>
  displayedCards.value.length > 0 &&
  displayedCards.value.every(c => selectedIds.value.includes(c.id))
);

const someSelected = computed(() =>
  selectedIds.value.length > 0 && !allSelected.value
);

function showToast(msg, type = 'success') {
  toastMessage.value = msg;
  toastType.value = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMessage.value = '';
  }, 3000);
}

function handleWindowClick() {
  if (editingLogoCard.value !== null) {
    closeLogoEditor();
  }
}

onMounted(async () => {
  window.addEventListener('click', handleWindowClick);
  const res = await getMenus();
  menus.value = res.data || [];
  if (menus.value.length) {
    filterMenuId.value = menus.value[0].id;
    filterSubMenuId.value = 'main';
    batchTargetMenuId.value = menus.value[0].id;
    batchTargetSubMenuId.value = '';
  }
  await loadCards();
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleWindowClick);
  clearTimeout(toastTimer);
});

function onFilterMenuChange() {
  filterSubMenuId.value = filterMenuId.value === 'all' ? 'all' : 'main';
  selectedIds.value = [];
  loadCards();
}

function snapshotKey(card) {
  return JSON.stringify([card.title || '', card.url || '', card.logo_url || '', card.desc || '']);
}

async function loadCards() {
  const params = {};
  if (filterMenuId.value !== 'all' && filterMenuId.value) {
    params.menuId = filterMenuId.value;
    if (filterSubMenuId.value && filterSubMenuId.value !== 'all') {
      params.subMenuId = filterSubMenuId.value;
    }
  }
  const res = await getFilteredCards(params);
  cards.value = res.data || [];
  cardSnapshots.clear();
  cards.value.forEach(c => cardSnapshots.set(c.id, snapshotKey(c)));
  const validIds = new Set(cards.value.map(c => c.id));
  selectedIds.value = selectedIds.value.filter(id => validIds.has(id));
}

function formatCardCategory(card) {
  if (card.menu_name && card.sub_menu_name) return `${card.menu_name} / ${card.sub_menu_name}`;
  if (card.menu_name) return card.menu_name;
  if (card.sub_menu_name) return card.sub_menu_name;
  return '未分类';
}

async function addCard() {
  if (!newCardTitle.value.trim() || !newCardUrl.value.trim()) {
    showToast('请填写卡片标题和网址', 'error');
    return;
  }
  const targetMenuId = filterMenuId.value !== 'all' && filterMenuId.value
    ? filterMenuId.value
    : (menus.value[0]?.id || null);
  const targetSubMenuId = (filterSubMenuId.value && filterSubMenuId.value !== 'main' && filterSubMenuId.value !== 'all')
    ? filterSubMenuId.value
    : null;

  if (!targetMenuId) {
    showToast('请先在栏目管理中创建主菜单', 'error');
    return;
  }

  await apiAddCard({
    menu_id: targetMenuId,
    sub_menu_id: targetSubMenuId,
    title: newCardTitle.value.trim(),
    url: newCardUrl.value.trim(),
    logo_url: newCardLogo.value.trim()
  });
  newCardTitle.value = '';
  newCardUrl.value = '';
  newCardLogo.value = '';
  await loadCards();
  showToast('卡片已添加');
}

async function saveCardField(card) {
  const currentKey = snapshotKey(card);
  if (cardSnapshots.get(card.id) === currentKey) return;

  try {
    await apiUpdateCard(card.id, {
      menu_id: card.effective_menu_id || card.menu_id || null,
      sub_menu_id: card.sub_menu_id || null,
      title: card.title,
      url: card.url,
      logo_url: card.logo_url || '',
      desc: card.desc || '',
      order: card.order || 0
    });
    cardSnapshots.set(card.id, currentKey);
  } catch (err) {
    showToast('保存失败，请重试', 'error');
  }
}

function openLogoEditor(event, card) {
  if (editingLogoCard.value?.id === card.id) {
    closeLogoEditor();
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  const popoverWidth = 310;
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - popoverWidth - 12);
  const preferTop = rect.bottom + 120 > window.innerHeight ? Math.max(12, rect.top - 118) : rect.bottom + 6;
  logoPopoverStyle.value = { top: `${preferTop}px`, left: `${left}px` };
  editingLogoCard.value = card;
  editingLogoValue.value = card.logo_url || '';
  nextTick(() => logoInputRef.value?.focus());
}

function closeLogoEditor() {
  editingLogoCard.value = null;
  editingLogoValue.value = '';
}

async function saveLogoEditor(card) {
  card.logo_url = editingLogoValue.value.trim();
  closeLogoEditor();
  await saveCardField(card);
  showToast('Logo 链接已更新');
}

async function deleteCard(id) {
  await apiDeleteCard(id);
  selectedIds.value = selectedIds.value.filter(item => item !== id);
  await loadCards();
  window.dispatchEvent(new Event('recycle:updated'));
  showToast('已移入回收站');
}

// 批量选择与操作
function toggleSelectAll(event) {
  if (event.target.checked) {
    selectedIds.value = displayedCards.value.map(c => c.id);
  } else {
    selectedIds.value = [];
  }
}

function toggleSelectCard(id) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(item => item !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

async function handleBatchDelete() {
  if (!selectedIds.value.length) return;
  if (!window.confirm(`确定要将选中的 ${selectedIds.value.length} 张卡片移入回收站吗？可在回收站中随时还原。`)) return;
  batchBusy.value = true;
  try {
    const { data } = await batchDeleteCards(selectedIds.value, 'manual');
    selectedIds.value = [];
    await loadCards();
    window.dispatchEvent(new Event('recycle:updated'));
    showToast(`已将 ${data.recycled ?? data.deleted ?? 0} 张卡片移入回收站`);
  } catch (err) {
    showToast(err.response?.data?.error || '移入回收站失败', 'error');
  } finally {
    batchBusy.value = false;
  }
}

async function handleBatchMove() {
  if (!selectedIds.value.length || !batchTargetMenuId.value) return;
  batchBusy.value = true;
  try {
    const { data } = await batchMoveCards({
      ids: selectedIds.value,
      menu_id: batchTargetMenuId.value,
      sub_menu_id: batchTargetSubMenuId.value || null
    });
    selectedIds.value = [];
    await loadCards();
    showToast(`已移动 ${data.moved || 0} 张卡片`);
  } catch (err) {
    showToast(err.response?.data?.error || '批量移动失败', 'error');
  } finally {
    batchBusy.value = false;
  }
}

// 拖拽排序逻辑
function onDragStart(event, index, card) {
  if (!canDragSort.value || dragArmedId.value !== card.id) {
    event.preventDefault();
    return;
  }
  draggingCardId.value = card.id;
  dragStartIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(card.id));
}

function onDragOver(event, index) {
  if (!canDragSort.value || draggingCardId.value === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  const isAfter = (event.clientY - rect.top) > rect.height / 2;
  dragOverIndex.value = index;
  dragOverPosition.value = isAfter ? 'after' : 'before';
}

function onDragLeave(event, index) {
  if (dragOverIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    dragOverIndex.value = -1;
  }
}

async function onDrop(event, targetIndex) {
  event.preventDefault();
  const fromIndex = dragStartIndex.value;
  if (!canDragSort.value || fromIndex < 0) {
    onDragEnd();
    return;
  }

  let insertIndex = dragOverPosition.value === 'after' ? targetIndex + 1 : targetIndex;
  if (fromIndex < insertIndex) insertIndex -= 1;

  onDragEnd();

  if (fromIndex === insertIndex || insertIndex < 0 || insertIndex >= cards.value.length) return;

  const previous = [...cards.value];
  const reordered = [...cards.value];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(insertIndex, 0, moved);

  const payload = reordered.map((item, idx) => {
    item.order = idx + 1;
    return { id: item.id, order: idx + 1 };
  });
  cards.value = reordered;

  try {
    await apiReorderCards(payload);
  } catch (err) {
    cards.value = previous;
    showToast('排序保存失败，已恢复原顺序', 'error');
  }
}

function onDragEnd() {
  dragArmedId.value = null;
  draggingCardId.value = null;
  dragStartIndex.value = -1;
  dragOverIndex.value = -1;
}

async function onAiApplied(result) {
  if (result?.menusChanged) {
    const res = await getMenus();
    menus.value = res.data || [];
  }
  await loadCards();
  window.dispatchEvent(new Event('recycle:updated'));
  const updated = typeof result === 'number' ? result : (result?.updated || 0);
  const recycled = typeof result === 'object' ? (result?.recycled || 0) : 0;
  if (updated || recycled) {
    showToast(`✨ AI 整理已应用：更新 ${updated} 张，移入回收站 ${recycled} 张`);
  }
}
</script>

<style scoped>
.card-manage {
  max-width: 1280px;
  width: 96%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 压缩后的单行功能工具栏 */
.card-header {
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
  gap: 10px;
  flex-wrap: wrap;
}

.card-add {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  flex-wrap: wrap;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.input {
  padding: 7px 11px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.96);
  color: #1e293b;
  font-size: 0.86rem;
  height: 34px;
  box-sizing: border-box;
  transition: all 0.2s ease;
}

.input:focus {
  outline: none;
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}

.input.narrow { width: 145px; }
.input.medium { width: 175px; }
.input.wide { flex: 1; min-width: 180px; max-width: 280px; }

.card-card {
  background: white;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  border: 1px solid #e5e7eb;
  width: 100%;
  overflow: visible;
}

/* 筛选栏 */
.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid #edf2f7;
  background: #f8fafc;
  border-radius: 14px 14px 0 0;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 0.84rem;
  font-weight: 600;
  color: #475569;
}

.filter-select {
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1e293b;
  font-size: 0.84rem;
  height: 32px;
}

.filter-select.sm {
  height: 30px;
  padding: 4px 8px;
  font-size: 0.82rem;
}

.filter-select:disabled {
  background: #f1f5f9;
  color: #94a3b8;
}

.filter-search {
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1e293b;
  font-size: 0.84rem;
  height: 32px;
  box-sizing: border-box;
  width: 190px;
}

.filter-search:focus,
.filter-select:focus {
  outline: none;
  border-color: #667eea;
}

.count-badge {
  font-size: 0.78rem;
  color: #4f46e5;
  background: #eef2ff;
  padding: 3px 9px;
  border-radius: 999px;
  font-weight: 600;
}

.drag-hint {
  font-size: 0.76rem;
  color: #059669;
  background: #ecfdf5;
  padding: 3px 9px;
  border-radius: 999px;
}

.drag-hint.muted {
  color: #64748b;
  background: #f1f5f9;
}

.inline-toast {
  font-size: 0.82rem;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 500;
}
.inline-toast.success { background: #ecfdf5; color: #047857; }
.inline-toast.error { background: #fef2f2; color: #b91c1c; }

/* 批量操作栏 */
.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  background: #eef2ff;
  border-bottom: 1px solid #c7d2fe;
  font-size: 0.84rem;
  color: #1e293b;
  flex-wrap: wrap;
}

.batch-count {
  color: #3730a3;
}

.batch-move-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.table-scroll {
  width: 100%;
  overflow-x: auto;
}

.card-table {
  width: 100%;
  border-collapse: collapse;
}

.card-table th,
.card-table td {
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid #eef2f7;
  vertical-align: middle;
}

.card-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #475569;
  font-size: 0.82rem;
  white-space: nowrap;
}

.card-table tbody tr {
  transition: background 0.12s ease;
}

.card-table tbody tr:hover {
  background: #f8fafc;
}

.card-table tbody tr.is-selected {
  background: #f5f7ff;
}

.card-table tbody tr.is-dragging {
  opacity: 0.45;
  background: #eef2ff;
}

.card-table tbody tr.drop-before td {
  box-shadow: inset 0 2px 0 0 #4f46e5;
}

.card-table tbody tr.drop-after td {
  box-shadow: inset 0 -2px 0 0 #4f46e5;
}

.col-drag { width: 32px; text-align: center !important; }
.col-check { width: 32px; text-align: center !important; }
.col-logo { width: 54px; text-align: center !important; }
.col-title { width: 17%; min-width: 120px; }
.col-url { width: 31%; min-width: 180px; }
.col-desc { width: 28%; min-width: 150px; }
.col-category { width: 14%; min-width: 110px; }
.col-actions { width: 52px; text-align: center !important; }

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 28px;
  color: #94a3b8;
  cursor: grab;
  font-size: 1rem;
  letter-spacing: -1px;
  user-select: none;
  border-radius: 5px;
}

.drag-handle:hover:not(.disabled) {
  color: #4f46e5;
  background: #eef2ff;
}

.drag-handle:active:not(.disabled) {
  cursor: grabbing;
}

.drag-handle.disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Favicon 预览与编辑 Popover */
.logo-cell {
  position: relative;
  display: inline-flex;
  justify-content: center;
}

.logo-preview-btn {
  position: relative;
  width: 34px;
  height: 34px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.logo-preview-btn:hover {
  border-color: #667eea;
  background: #eef2ff;
}

.logo-thumb-img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  border-radius: 4px;
}

.logo-edit-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #667eea;
  color: #fff;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.logo-preview-btn:hover .logo-edit-badge {
  opacity: 1;
}

.logo-popover-floating {
  position: fixed;
  z-index: 1100;
  width: 310px;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
  text-align: left;
  box-sizing: border-box;
}

.logo-popover-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1e293b;
  font-size: 0.84rem;
}

.logo-popover-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.14);
}

.logo-popover-title {
  font-size: 0.76rem;
  color: #475569;
  margin-bottom: 6px;
  font-weight: 500;
}

.logo-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.category-pill {
  display: inline-block;
  font-size: 0.76rem;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #334155;
  white-space: nowrap;
}

.table-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #1e293b;
  font-size: 0.84rem;
  transition: all 0.15s ease;
}

.table-input:hover {
  border-color: #e2e8f0;
  background: #fff;
}

.table-input:focus {
  outline: none;
  border-color: #667eea;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.12);
}

.empty-row {
  text-align: center !important;
  padding: 32px !important;
  color: #94a3b8;
  font-size: 0.9rem;
}

/* 按钮样式 */
.btn {
  padding: 7px 13px;
  height: 34px;
  border: none;
  border-radius: 7px;
  background: #3b82f6;
  color: white;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.85rem;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  box-sizing: border-box;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-add {
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.btn-add:hover {
  background: rgba(255, 255, 255, 0.32);
}

.btn-ai {
  background: linear-gradient(135deg, #f59e0b 0%, #ec4899 100%);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(236, 72, 153, 0.35);
}

.btn-ai:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.btn-primary {
  background: #4f46e5;
}
.btn-primary:hover:not(:disabled) {
  background: #4338ca;
}

.btn-danger {
  background: #ef4444;
}
.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-ghost {
  background: #e2e8f0;
  color: #334155;
}
.btn-ghost:hover:not(:disabled) {
  background: #cbd5e1;
}

.btn-sm {
  height: 30px;
  padding: 4px 10px;
  font-size: 0.8rem;
}

.btn-xs {
  height: 26px;
  padding: 2px 8px;
  font-size: 0.76rem;
}

.btn-icon {
  width: 30px;
  height: 30px;
  padding: 0;
  justify-content: center;
  border-radius: 6px;
}

@media (max-width: 768px) {
  .card-manage {
    width: 95%;
  }
  .input.narrow,
  .input.medium,
  .input.wide {
    width: 100%;
    max-width: none;
  }
  .header-right {
    width: 100%;
  }
  .btn-ai {
    width: 100%;
    justify-content: center;
  }
  .filter-search {
    width: 100%;
  }
}
</style>
