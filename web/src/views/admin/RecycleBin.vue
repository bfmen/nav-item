<template>
  <div class="recycle-page">
    <!-- 紧凑单行顶部工具栏 -->
    <div class="recycle-header">
      <div class="header-left">
        <span class="header-title">🗑 分类回收站</span>
        <span class="header-badge">共 {{ counts.total }} 张失效/已删卡片</span>
      </div>
      <div class="header-right">
        <span v-if="toastMessage" :class="['header-toast', toastType]">{{ toastMessage }}</span>
        <button
          class="btn btn-clear-all"
          :disabled="busy || counts.total === 0"
          @click="handleEmptyBin"
        >
          一键清空回收站
        </button>
      </div>
    </div>

    <div class="recycle-card">
      <!-- 双维度筛选栏：原因 Tab + 原主菜单/子菜单下拉 -->
      <div class="filter-bar">
        <div class="reason-tabs">
          <button
            v-for="tab in reasonTabs"
            :key="tab.value"
            type="button"
            :class="['reason-tab', tab.tone, { active: filterReason === tab.value }]"
            @click="selectReason(tab.value)"
          >
            <span>{{ tab.label }}</span>
            <span class="tab-count">{{ tab.count }}</span>
          </button>
        </div>

        <div class="menu-filters">
          <select v-model="filterMenuId" class="filter-select" @change="onMenuChange">
            <option value="all">全部原主菜单</option>
            <option v-for="menu in menus" :key="menu.id" :value="menu.id">{{ menu.name }}</option>
          </select>
          <select
            v-model="filterSubMenuId"
            class="filter-select"
            :disabled="filterMenuId === 'all'"
            @change="loadRecycleCards"
          >
            <option value="all">全部（含子菜单）</option>
            <option value="main">仅原主菜单直属</option>
            <option v-for="sub in currentSubMenus" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
          </select>
          <input
            v-model="searchKeyword"
            type="text"
            class="filter-search"
            placeholder="搜索标题或网址..."
          />
        </div>
      </div>

      <!-- 批量操作栏 -->
      <div v-if="selectedIds.length > 0" class="batch-bar">
        <span class="batch-count">已选中 <strong>{{ selectedIds.length }}</strong> 张卡片</span>
        <button class="btn btn-sm btn-restore" :disabled="busy" @click="handleBatchRestore">批量还原至原栏目</button>
        <button class="btn btn-sm btn-danger" :disabled="busy" @click="handleBatchPermanentDelete">批量彻底删除</button>
        <button class="btn btn-sm btn-ghost" @click="selectedIds = []">取消选择</button>
      </div>

      <div class="table-scroll">
        <table class="recycle-table">
          <thead>
            <tr>
              <th class="col-check">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :indeterminate.prop="someSelected"
                  @change="toggleSelectAll"
                />
              </th>
              <th class="col-logo">Logo</th>
              <th class="col-title">标题 / 网址</th>
              <th class="col-reason">失效原因</th>
              <th class="col-origin">原所属栏目</th>
              <th class="col-time">移入时间</th>
              <th class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="card in displayedCards" :key="card.id" :class="{ selected: selectedIds.includes(card.id) }">
              <td class="col-check">
                <input
                  type="checkbox"
                  :checked="selectedIds.includes(card.id)"
                  @change="toggleSelect(card.id)"
                />
              </td>
              <td class="col-logo">
                <div class="logo-box">
                  <CardLogo :card="card" class="logo-thumb" />
                </div>
              </td>
              <td class="col-title">
                <div class="card-title">{{ card.title }}</div>
                <a :href="card.url" target="_blank" rel="noopener noreferrer" class="card-url" :title="card.url">
                  {{ card.url }}
                </a>
                <div v-if="card.desc" class="card-desc">{{ card.desc }}</div>
              </td>
              <td class="col-reason">
                <span :class="['reason-badge', card.recycle_reason || 'manual']">
                  {{ formatReason(card.recycle_reason) }}
                </span>
              </td>
              <td class="col-origin">
                <span class="origin-pill">{{ formatOriginCategory(card) }}</span>
              </td>
              <td class="col-time">
                <span class="time-text">{{ formatTime(card.deleted_at) }}</span>
              </td>
              <td class="col-actions">
                <div class="action-group">
                  <button class="btn btn-xs btn-restore" :disabled="busy" @click="handleRestore([card.id])">还原</button>
                  <button class="btn btn-xs btn-danger" :disabled="busy" @click="handlePermanentDelete([card.id])">彻底删除</button>
                </div>
              </td>
            </tr>
            <tr v-if="!displayedCards.length">
              <td colspan="7" class="empty-row">
                {{ loading ? '正在加载回收站...' : '回收站中暂无符合条件的卡片' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import CardLogo from '../../components/CardLogo.vue';
import {
  getMenus,
  getRecycleCards,
  restoreRecycleCards,
  permanentDeleteCards,
  emptyRecycleBin
} from '../../api';

const menus = ref([]);
const cards = ref([]);
const counts = ref({ total: 0, dead_link: 0, domain_expired: 0, duplicate: 0, manual: 0 });
const filterReason = ref('all');
const filterMenuId = ref('all');
const filterSubMenuId = ref('all');
const searchKeyword = ref('');
const selectedIds = ref([]);
const loading = ref(false);
const busy = ref(false);

const toastMessage = ref('');
const toastType = ref('success');
let toastTimer = null;

const reasonTabs = computed(() => [
  { value: 'all', label: '全部', count: counts.value.total, tone: 'neutral' },
  { value: 'dead_link', label: '死链无法访问', count: counts.value.dead_link, tone: 'red' },
  { value: 'domain_expired', label: '域名停用', count: counts.value.domain_expired, tone: 'orange' },
  { value: 'duplicate', label: '重复链接', count: counts.value.duplicate, tone: 'purple' },
  { value: 'manual', label: '手动删除', count: counts.value.manual, tone: 'gray' }
]);

const currentSubMenus = computed(() => {
  if (filterMenuId.value === 'all') return [];
  const menu = menus.value.find(m => m.id === filterMenuId.value);
  return menu?.subMenus || [];
});

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
  displayedCards.value.length > 0 && displayedCards.value.every(c => selectedIds.value.includes(c.id))
);

const someSelected = computed(() =>
  selectedIds.value.length > 0 && !allSelected.value
);

function showToast(msg, type = 'success') {
  toastMessage.value = msg;
  toastType.value = type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastMessage.value = ''; }, 3000);
}

function notifyRecycleUpdated() {
  window.dispatchEvent(new Event('recycle:updated'));
}

onMounted(async () => {
  const menuRes = await getMenus();
  menus.value = menuRes.data || [];
  await loadRecycleCards();
});

onBeforeUnmount(() => clearTimeout(toastTimer));

async function loadRecycleCards() {
  loading.value = true;
  try {
    const params = {};
    if (filterReason.value !== 'all') params.reason = filterReason.value;
    if (filterMenuId.value !== 'all') {
      params.menuId = filterMenuId.value;
      if (filterSubMenuId.value !== 'all') params.subMenuId = filterSubMenuId.value;
    }
    const { data } = await getRecycleCards(params);
    cards.value = data.data || [];
    counts.value = data.counts || { total: 0, dead_link: 0, domain_expired: 0, duplicate: 0, manual: 0 };
    const validIds = new Set(cards.value.map(c => c.id));
    selectedIds.value = selectedIds.value.filter(id => validIds.has(id));
  } catch (err) {
    showToast(err.response?.data?.error || '读取回收站失败', 'error');
  } finally {
    loading.value = false;
  }
}

function selectReason(reason) {
  filterReason.value = reason;
  selectedIds.value = [];
  loadRecycleCards();
}

function onMenuChange() {
  filterSubMenuId.value = 'all';
  selectedIds.value = [];
  loadRecycleCards();
}

function toggleSelectAll(event) {
  selectedIds.value = event.target.checked ? displayedCards.value.map(c => c.id) : [];
}

function toggleSelect(id) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(item => item !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

async function handleRestore(ids) {
  if (!ids.length) return;
  busy.value = true;
  try {
    const { data } = await restoreRecycleCards(ids);
    selectedIds.value = selectedIds.value.filter(id => !ids.includes(id));
    await loadRecycleCards();
    notifyRecycleUpdated();
    showToast(`已还原 ${data.restored || 0} 张卡片至原栏目`);
  } catch (err) {
    showToast(err.response?.data?.error || '还原失败', 'error');
  } finally {
    busy.value = false;
  }
}

async function handlePermanentDelete(ids) {
  if (!ids.length) return;
  if (!window.confirm(`确定要彻底删除这 ${ids.length} 张卡片吗？彻底删除后无法恢复！`)) return;
  busy.value = true;
  try {
    const { data } = await permanentDeleteCards(ids);
    selectedIds.value = selectedIds.value.filter(id => !ids.includes(id));
    await loadRecycleCards();
    notifyRecycleUpdated();
    showToast(`已彻底删除 ${data.deleted || 0} 张卡片`);
  } catch (err) {
    showToast(err.response?.data?.error || '彻底删除失败', 'error');
  } finally {
    busy.value = false;
  }
}

function handleBatchRestore() {
  return handleRestore([...selectedIds.value]);
}

function handleBatchPermanentDelete() {
  return handlePermanentDelete([...selectedIds.value]);
}

async function handleEmptyBin() {
  const scopeText = filterReason.value === 'all'
    ? `全部 ${counts.value.total} 张`
    : `「${formatReason(filterReason.value)}」分类下的`;
  if (!window.confirm(`确定要清空回收站中${scopeText}卡片吗？彻底删除后无法恢复！`)) return;
  busy.value = true;
  try {
    const params = filterReason.value !== 'all' ? { reason: filterReason.value } : {};
    const { data } = await emptyRecycleBin(params);
    selectedIds.value = [];
    await loadRecycleCards();
    notifyRecycleUpdated();
    showToast(`已清空 ${data.deleted || 0} 张卡片`);
  } catch (err) {
    showToast(err.response?.data?.error || '清空失败', 'error');
  } finally {
    busy.value = false;
  }
}

function formatReason(reason) {
  switch (reason) {
    case 'dead_link': return '死链无法访问';
    case 'domain_expired': return '域名停用';
    case 'duplicate': return '重复链接';
    default: return '手动删除';
  }
}

function formatOriginCategory(card) {
  if (card.menu_name && card.sub_menu_name) return `${card.menu_name} / ${card.sub_menu_name}`;
  if (card.menu_name) return card.menu_name;
  if (card.sub_menu_name) return card.sub_menu_name;
  return '原栏目已删除';
}

function formatTime(value) {
  if (!value) return '-';
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<style scoped>
.recycle-page {
  max-width: 1280px;
  width: 96%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recycle-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 10px 16px;
  color: #fff;
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.24);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.header-title {
  font-weight: 600;
  font-size: 0.98rem;
}

.header-badge {
  font-size: 0.78rem;
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 10px;
  border-radius: 999px;
}

.header-toast {
  font-size: 0.8rem;
  padding: 3px 10px;
  border-radius: 999px;
}
.header-toast.success { background: rgba(16, 185, 129, 0.92); color: #fff; }
.header-toast.error { background: rgba(239, 68, 68, 0.92); color: #fff; }

.recycle-card {
  background: #fff;
  border-radius: 14px;
  border: 1px solid #e5e7eb;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid #edf2f7;
  flex-wrap: wrap;
}

.reason-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.reason-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #475569;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.reason-tab:hover {
  border-color: #94a3b8;
}

.reason-tab.active {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}

.reason-tab.red.active { background: #dc2626; border-color: #dc2626; }
.reason-tab.orange.active { background: #d97706; border-color: #d97706; }
.reason-tab.purple.active { background: #7c3aed; border-color: #7c3aed; }
.reason-tab.gray.active { background: #475569; border-color: #475569; }

.tab-count {
  font-size: 0.72rem;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}

.reason-tab.active .tab-count {
  background: rgba(255, 255, 255, 0.25);
}

.menu-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-select,
.filter-search {
  height: 32px;
  padding: 5px 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1e293b;
  font-size: 0.82rem;
  box-sizing: border-box;
}

.filter-select:disabled {
  background: #f1f5f9;
  color: #94a3b8;
}

.filter-search {
  width: 170px;
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: #eef2ff;
  border-bottom: 1px solid #c7d2fe;
  font-size: 0.84rem;
  flex-wrap: wrap;
}

.batch-count {
  color: #3730a3;
}

.table-scroll {
  width: 100%;
  overflow-x: auto;
}

.recycle-table {
  width: 100%;
  border-collapse: collapse;
}

.recycle-table th,
.recycle-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #eef2f7;
  text-align: left;
  vertical-align: middle;
}

.recycle-table th {
  background: #f9fafb;
  color: #475569;
  font-size: 0.82rem;
  font-weight: 600;
  white-space: nowrap;
}

.recycle-table tbody tr:hover {
  background: #f8fafc;
}

.recycle-table tbody tr.selected {
  background: #f5f7ff;
}

.col-check { width: 34px; text-align: center !important; }
.col-logo { width: 48px; text-align: center !important; }
.col-title { width: 35%; min-width: 220px; }
.col-reason { width: 13%; white-space: nowrap; }
.col-origin { width: 16%; }
.col-time { width: 16%; white-space: nowrap; }
.col-actions { width: 135px; text-align: center !important; white-space: nowrap; }

.logo-box {
  width: 32px;
  height: 32px;
  border-radius: 7px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.logo-thumb {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.card-title {
  font-weight: 600;
  font-size: 0.88rem;
  color: #0f172a;
}

.card-url {
  display: block;
  font-size: 0.78rem;
  color: #2563eb;
  text-decoration: none;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-url:hover {
  text-decoration: underline;
}

.card-desc {
  font-size: 0.76rem;
  color: #64748b;
  margin-top: 2px;
}

.reason-badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.reason-badge.dead_link { background: #fee2e2; color: #b91c1c; }
.reason-badge.domain_expired { background: #fef3c7; color: #b45309; }
.reason-badge.duplicate { background: #ede9fe; color: #6d28d9; }
.reason-badge.manual { background: #f1f5f9; color: #475569; }

.origin-pill {
  display: inline-block;
  font-size: 0.78rem;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #334155;
}

.time-text {
  font-size: 0.78rem;
  color: #64748b;
}

.action-group {
  display: inline-flex;
  gap: 6px;
}

.empty-row {
  text-align: center !important;
  padding: 36px !important;
  color: #94a3b8;
  font-size: 0.9rem;
}

.btn {
  border: none;
  border-radius: 7px;
  padding: 6px 12px;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-clear-all {
  background: rgba(239, 68, 68, 0.88);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.btn-clear-all:hover:not(:disabled) {
  background: #dc2626;
}

.btn-restore {
  background: #10b981;
  color: #fff;
}
.btn-restore:hover:not(:disabled) {
  background: #059669;
}

.btn-danger {
  background: #ef4444;
  color: #fff;
}
.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-ghost {
  background: #e2e8f0;
  color: #334155;
}

.btn-sm {
  padding: 5px 10px;
  font-size: 0.8rem;
}

.btn-xs {
  padding: 4px 8px;
  font-size: 0.76rem;
}
</style>
