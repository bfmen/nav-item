<template>
  <div class="nav-manage">
    <!-- 左侧栏目树（260px，独立滚动，顶部与右侧严格齐平） -->
    <aside class="tree-pane">
      <div class="tree-header">
        <div class="tree-add-row">
          <input
            v-model="newMenuName"
            type="text"
            class="tree-input"
            placeholder="新建主菜单..."
            @keyup.enter="handleAddMenu"
          />
          <button type="button" class="tree-add-btn" title="添加主菜单" @click="handleAddMenu">+</button>
        </div>
      </div>

      <div class="tree-scroll">
        <!-- 全部栏目入口 -->
        <div
          :class="['tree-node', 'all-node', { active: selectedMenuId === 'all' }]"
          @click="selectAll"
        >
          <span class="node-icon">📚</span>
          <span class="node-label">全部栏目</span>
          <span class="node-count">{{ totalAllCards }}</span>
        </div>

        <!-- 主菜单列表 -->
        <div
          v-for="(menu, menuIndex) in menus"
          :key="menu.id"
          class="tree-group"
          :draggable="armedMenuId === menu.id"
          :class="{
            'is-dragging': draggingMenuId === menu.id,
            'drop-before': dragType === 'menu' && menuDropIndex === menuIndex && menuDropPos === 'before' && draggingMenuId !== menu.id,
            'drop-after': dragType === 'menu' && menuDropIndex === menuIndex && menuDropPos === 'after' && draggingMenuId !== menu.id
          }"
          @dragstart="onMenuDragStart($event, menuIndex, menu)"
          @dragover="onMenuGroupDragOver($event, menuIndex, menu)"
          @dragleave="onMenuGroupDragLeave($event, menuIndex, menu)"
          @drop="onMenuGroupDrop($event, menuIndex, menu)"
          @dragend="onMenuDragEnd"
        >
          <div
            :class="[
              'tree-node',
              'main-node',
              {
                active: selectedMenuId === menu.id && (selectedSubMenuId === 'main' || selectedSubMenuId === 'all'),
                'card-drop-target': dragType === 'card' && cardDropTargetKey === `menu:${menu.id}`
              }
            ]"
            @click="selectMenu(menu)"
            @dragover.prevent="onCardDragOverTree($event, `menu:${menu.id}`)"
            @dragleave="onCardDragLeaveTree(`menu:${menu.id}`)"
            @drop.prevent="onCardDropOnTree($event, menu.id, null)"
          >
            <span
              class="tree-drag-handle"
              title="拖动调整主菜单顺序"
              @mousedown.stop="armedMenuId = menu.id"
              @mouseup.stop="armedMenuId = null"
              @click.stop
            >⋮⋮</span>

            <button
              type="button"
              class="tree-expand-btn"
              :class="{ expanded: isExpanded(menu.id), empty: !menu.subMenus?.length }"
              :title="menu.subMenus?.length ? (isExpanded(menu.id) ? '收起子菜单' : '展开子菜单') : '暂无子菜单'"
              @click.stop="toggleExpand(menu.id)"
            >
              ▸
            </button>

            <input
              v-if="editingTreeKey === `menu:${menu.id}`"
              ref="treeEditInputRef"
              v-model="editingTreeName"
              type="text"
              class="tree-inline-input"
              @click.stop
              @keyup.enter="saveInlineRenameMenu(menu)"
              @keyup.esc="cancelInlineRename"
              @blur="saveInlineRenameMenu(menu)"
            />
            <span
              v-else
              class="node-label"
              :title="`${menu.name}（双击重命名；直属 ${menu.direct_card_count || 0} / 总计 ${menu.total_card_count || 0}）`"
              @dblclick.stop="startInlineRename(`menu:${menu.id}`, menu.name)"
            >{{ menu.name }}</span>

            <span class="node-count" :title="`直属 ${menu.direct_card_count || 0} 张，含子菜单共 ${menu.total_card_count || 0} 张`">
              {{ menu.total_card_count || 0 }}
            </span>

            <div class="node-actions" @click.stop>
              <button type="button" class="mini-btn" title="添加子菜单" @click="handleAddSubMenu(menu)">+</button>
              <button type="button" class="mini-btn" title="重命名" @click="startInlineRename(`menu:${menu.id}`, menu.name)">✎</button>
              <button type="button" class="mini-btn danger" title="删除主菜单" @click="handleDeleteMenu(menu)">✕</button>
            </div>
          </div>

          <!-- 子菜单树节点 -->
          <div v-if="isExpanded(menu.id) && menu.subMenus?.length" class="sub-tree-list">
            <div
              v-for="(sub, subIndex) in menu.subMenus"
              :key="sub.id"
              :draggable="armedSubMenuId === sub.id"
              :class="[
                'tree-node',
                'sub-node',
                {
                  active: selectedMenuId === menu.id && selectedSubMenuId === sub.id,
                  'is-dragging': draggingSubMenuId === sub.id,
                  'drop-before': dragType === 'submenu' && dragSubParentId === menu.id && subDropIndex === subIndex && subDropPos === 'before' && draggingSubMenuId !== sub.id,
                  'drop-after': dragType === 'submenu' && dragSubParentId === menu.id && subDropIndex === subIndex && subDropPos === 'after' && draggingSubMenuId !== sub.id,
                  'card-drop-target': dragType === 'card' && cardDropTargetKey === `sub:${sub.id}`
                }
              ]"
              @click="selectSubMenu(menu, sub)"
              @dragstart.stop="onSubMenuDragStart($event, menu.id, subIndex, sub)"
              @dragover.stop.prevent="onSubNodeDragOver($event, menu.id, subIndex, sub)"
              @dragleave.stop="onSubNodeDragLeave($event, subIndex, sub)"
              @drop.stop.prevent="onSubNodeDrop($event, menu, subIndex, sub)"
              @dragend.stop="onSubMenuDragEnd"
            >
              <span
                class="tree-drag-handle sub"
                title="拖动调整子菜单顺序"
                @mousedown.stop="armedSubMenuId = sub.id"
                @mouseup.stop="armedSubMenuId = null"
                @click.stop
              >⋮⋮</span>

              <input
                v-if="editingTreeKey === `sub:${sub.id}`"
                ref="treeEditInputRef"
                v-model="editingTreeName"
                type="text"
                class="tree-inline-input"
                @click.stop
                @keyup.enter="saveInlineRenameSubMenu(sub)"
                @keyup.esc="cancelInlineRename"
                @blur="saveInlineRenameSubMenu(sub)"
              />
              <span
                v-else
                class="node-label"
                :title="`${sub.name}（双击重命名）`"
                @dblclick.stop="startInlineRename(`sub:${sub.id}`, sub.name)"
              >{{ sub.name }}</span>

              <span class="node-count sub">{{ sub.card_count || 0 }}</span>

              <div class="node-actions" @click.stop>
                <button type="button" class="mini-btn" title="重命名" @click="startInlineRename(`sub:${sub.id}`, sub.name)">✎</button>
                <button type="button" class="mini-btn danger" title="删除子菜单" @click="handleDeleteSubMenu(sub)">✕</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右侧卡片工作区（自适应宽度） -->
    <section class="cards-pane">
      <!-- 顶部单行功能栏（面包屑 + 快速添加 + AI 智能整理） -->
      <div class="cards-header">
        <div class="header-top-row">
          <div class="breadcrumb-group">
            <span class="breadcrumb-text">{{ currentBreadcrumb }}</span>
            <div v-if="activeMenuObj && activeMenuObj.subMenus?.length && (selectedSubMenuId === 'main' || selectedSubMenuId === 'all')" class="view-mode-pills">
              <button
                type="button"
                :class="['mode-pill', { active: selectedSubMenuId === 'main' }]"
                @click="switchMainViewMode('main')"
              >
                主菜单直属 ({{ activeMenuObj.direct_card_count || 0 }})
              </button>
              <button
                type="button"
                :class="['mode-pill', { active: selectedSubMenuId === 'all' }]"
                @click="switchMainViewMode('all')"
              >
                全部含子菜单 ({{ activeMenuObj.total_card_count || 0 }})
              </button>
            </div>
          </div>

          <div class="header-actions">
            <button type="button" class="btn btn-ai" @click="showAiModal = true">
              ✨ AI 智能整理
            </button>
          </div>
        </div>

        <!-- 单行添加卡片工具栏 -->
        <div class="card-add-row">
          <input v-model="newCardTitle" placeholder="卡片标题" class="add-input title-in" @keyup.enter="handleAddCard" />
          <input v-model="newCardUrl" placeholder="卡片网址 (https://...)" class="add-input url-in" @keyup.enter="handleAddCard" />
          <input v-model="newCardLogo" placeholder="Logo链接(可选)" class="add-input logo-in" @keyup.enter="handleAddCard" />
          <input v-model="newCardDesc" placeholder="描述(可选)" class="add-input desc-in" @keyup.enter="handleAddCard" />
          <button type="button" class="btn btn-add" @click="handleAddCard">
            + 添加卡片
          </button>
        </div>
      </div>

      <div class="cards-card">
        <!-- 搜索过滤 + 提示条 -->
        <div class="table-toolbar">
          <div class="toolbar-left">
            <input
              v-model="searchKeyword"
              type="text"
              class="filter-search"
              placeholder="搜索当前列表标题 / 网址 / 描述..."
            />
            <span class="count-badge">{{ displayedCards.length }} 张</span>
            <span v-if="canDragSort" class="drag-hint">
              ↕ 拖动 ⋮⋮ 可排序，或直接拖到左侧栏目移动
            </span>
            <span v-else class="drag-hint muted">
              拖动 ⋮⋮ 到左侧栏目树可直接移动分类
            </span>
          </div>
          <div v-if="toastMessage" :class="['inline-toast', toastType]">
            {{ toastMessage }}
          </div>
        </div>

        <!-- 批量操作条 -->
        <div v-if="selectedIds.length > 0" class="batch-bar">
          <span class="batch-count">已选 <strong>{{ selectedIds.length }}</strong> 张</span>
          <div class="batch-move-group">
            <span>移动到：</span>
            <select v-model="batchTargetMenuId" class="filter-select sm" @change="batchTargetSubMenuId = ''">
              <option v-for="menu in menus" :key="menu.id" :value="menu.id">{{ menu.name }}</option>
            </select>
            <select v-model="batchTargetSubMenuId" class="filter-select sm">
              <option value="">主菜单直属</option>
              <option v-for="sub in batchTargetSubMenus" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
            </select>
            <button type="button" class="btn btn-sm btn-primary" :disabled="batchBusy" @click="handleBatchMove">确认移动</button>
          </div>
          <button type="button" class="btn btn-sm btn-danger" :disabled="batchBusy" @click="handleBatchRecycle">批量移入回收站</button>
          <button type="button" class="btn btn-sm btn-ghost" @click="selectedIds = []">取消选择</button>
        </div>

        <!-- 卡片表格 -->
        <div class="table-scroll">
          <table class="card-table">
            <thead>
              <tr>
                <th class="col-drag"></th>
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
                :draggable="dragArmedCardId === card.id"
                :class="{
                  'is-dragging': draggingCardId === card.id,
                  'drop-before': dragType === 'card' && canDragSort && cardDropIndex === index && cardDropPos === 'before' && draggingCardId !== card.id,
                  'drop-after': dragType === 'card' && canDragSort && cardDropIndex === index && cardDropPos === 'after' && draggingCardId !== card.id,
                  'is-selected': selectedIds.includes(card.id)
                }"
                @dragstart="onCardDragStart($event, index, card)"
                @dragover="onCardRowDragOver($event, index)"
                @dragleave="onCardRowDragLeave($event, index)"
                @drop="onCardRowDrop($event, index)"
                @dragend="onCardDragEnd"
              >
                <td class="col-drag">
                  <span
                    class="drag-handle"
                    :title="canDragSort ? '按住上下拖动排序，或拖到左侧栏目树移动分类' : '按住拖动到左侧栏目树移动分类'"
                    @mousedown="dragArmedCardId = card.id"
                    @mouseup="dragArmedCardId = null"
                  >⋮⋮</span>
                </td>
                <td class="col-check">
                  <input
                    type="checkbox"
                    :checked="selectedIds.includes(card.id)"
                    @change="toggleSelectCard(card.id)"
                  />
                </td>
                <td class="col-logo">
                  <button
                    type="button"
                    class="logo-preview-btn"
                    :title="card.logo_url ? `Logo: ${card.logo_url}（点击编辑）` : '自动获取 Favicon（点击自定义链接）'"
                    @click.stop="openLogoEditor($event, card)"
                  >
                    <CardLogo :card="card" class="logo-thumb-img" />
                    <span class="logo-edit-badge">✎</span>
                  </button>
                </td>
                <td class="col-title">
                  <input v-model="card.title" @blur="saveCardField(card)" class="table-input title-cell-input" />
                </td>
                <td class="col-url">
                  <input v-model="card.url" @blur="saveCardField(card)" class="table-input" />
                </td>
                <td class="col-desc">
                  <input v-model="card.desc" @blur="saveCardField(card)" class="table-input" placeholder="描述（可选）" />
                </td>
                <td v-if="showCategoryColumn" class="col-category">
                  <span class="category-pill">{{ formatCardCategory(card) }}</span>
                </td>
                <td class="col-actions">
                  <button type="button" class="btn btn-danger btn-icon" @click="handleRecycleCard(card.id)" title="移入回收站">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                      <path d="M10 11v6M14 11v6"/>
                    </svg>
                  </button>
                </td>
              </tr>
              <tr v-if="!displayedCards.length">
                <td :colspan="showCategoryColumn ? 8 : 7" class="empty-row">
                  当前栏目下暂无卡片，可在上方直接添加
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Logo 浮动编辑框 -->
    <Teleport to="body">
      <div v-if="editingLogoCard" class="logo-popover-floating" :style="logoPopoverStyle" @click.stop>
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

    <!-- 统一 AI 智能整理弹窗（内置「卡片整理与死链检测」与「栏目结构整理」双 Tab） -->
    <AiOrganizeModal
      :visible="showAiModal"
      :current-menu-id="selectedMenuId"
      :current-sub-menu-id="selectedSubMenuId"
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
  addMenu as apiAddMenu,
  updateMenu as apiUpdateMenu,
  deleteMenu as apiDeleteMenu,
  reorderMenus as apiReorderMenus,
  addSubMenu as apiAddSubMenu,
  updateSubMenu as apiUpdateSubMenu,
  deleteSubMenu as apiDeleteSubMenu,
  reorderSubMenus as apiReorderSubMenus,
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

const selectedMenuId = ref('all');
const selectedSubMenuId = ref('main');
const expandedIds = ref(new Set());
const searchKeyword = ref('');

const newMenuName = ref('');
const editingTreeKey = ref('');
const editingTreeName = ref('');
const treeEditInputRef = ref(null);

const newCardTitle = ref('');
const newCardUrl = ref('');
const newCardLogo = ref('');
const newCardDesc = ref('');

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

// 统一拖拽类型：'menu' | 'submenu' | 'card' | ''
const dragType = ref('');
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

const dragArmedCardId = ref(null);
const draggingCardId = ref(null);
const cardDragStartIndex = ref(-1);
const cardDropIndex = ref(-1);
const cardDropPos = ref('before');
const cardDropTargetKey = ref('');

const totalAllCards = computed(() =>
  menus.value.reduce((sum, m) => sum + Number(m.total_card_count || 0), 0)
);

const activeMenuObj = computed(() =>
  selectedMenuId.value !== 'all' ? menus.value.find(m => m.id === selectedMenuId.value) || null : null
);

const activeSubMenuObj = computed(() => {
  if (!activeMenuObj.value || selectedSubMenuId.value === 'main' || selectedSubMenuId.value === 'all') return null;
  return (activeMenuObj.value.subMenus || []).find(s => s.id === selectedSubMenuId.value) || null;
});

const currentBreadcrumb = computed(() => {
  if (selectedMenuId.value === 'all') return '全部栏目';
  if (!activeMenuObj.value) return '导航管理';
  if (activeSubMenuObj.value) return `${activeMenuObj.value.name}  ›  ${activeSubMenuObj.value.name}`;
  return selectedSubMenuId.value === 'all'
    ? `${activeMenuObj.value.name}  ›  全部（含子菜单）`
    : `${activeMenuObj.value.name}  ›  主菜单直属`;
});

const showCategoryColumn = computed(() =>
  selectedMenuId.value === 'all' || selectedSubMenuId.value === 'all'
);

const canDragSort = computed(() =>
  selectedMenuId.value !== 'all' &&
  selectedSubMenuId.value !== 'all' &&
  !searchKeyword.value.trim()
);

const batchTargetSubMenus = computed(() => {
  const menu = menus.value.find(m => m.id === batchTargetMenuId.value);
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
  toastTimer = setTimeout(() => { toastMessage.value = ''; }, 3200);
}

function handleWindowClick() {
  if (editingLogoCard.value !== null) closeLogoEditor();
}

onMounted(async () => {
  window.addEventListener('click', handleWindowClick);
  await loadMenus({ selectFirstIfUnset: true });
  await loadCards();
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleWindowClick);
  clearTimeout(toastTimer);
});

function isExpanded(menuId) {
  return expandedIds.value.has(menuId);
}

function toggleExpand(menuId) {
  const next = new Set(expandedIds.value);
  if (next.has(menuId)) next.delete(menuId);
  else next.add(menuId);
  expandedIds.value = next;
}

async function loadMenus({ selectFirstIfUnset = false } = {}) {
  const res = await getMenus();
  menus.value = res.data || [];
  if (menus.value.length) {
    if (!batchTargetMenuId.value || !menus.value.some(m => m.id === batchTargetMenuId.value)) {
      batchTargetMenuId.value = menus.value[0].id;
      batchTargetSubMenuId.value = '';
    }
    if (selectFirstIfUnset) {
      selectedMenuId.value = menus.value[0].id;
      selectedSubMenuId.value = 'main';
      // 默认展开有子菜单的前两项方便浏览
      const next = new Set(expandedIds.value);
      menus.value.slice(0, 2).forEach(m => { if (m.subMenus?.length) next.add(m.id); });
      expandedIds.value = next;
    } else if (selectedMenuId.value !== 'all') {
      const stillMenu = menus.value.find(m => m.id === selectedMenuId.value);
      if (!stillMenu) {
        selectedMenuId.value = menus.value[0].id;
        selectedSubMenuId.value = 'main';
      } else if (selectedSubMenuId.value !== 'main' && selectedSubMenuId.value !== 'all') {
        const stillSub = (stillMenu.subMenus || []).find(s => s.id === selectedSubMenuId.value);
        if (!stillSub) selectedSubMenuId.value = 'main';
      }
    }
  } else {
    selectedMenuId.value = 'all';
    selectedSubMenuId.value = 'all';
  }
}

function snapshotKey(card) {
  return JSON.stringify([card.title || '', card.url || '', card.logo_url || '', card.desc || '']);
}

async function loadCards() {
  const params = {};
  if (selectedMenuId.value !== 'all' && selectedMenuId.value) {
    params.menuId = selectedMenuId.value;
    if (selectedSubMenuId.value && selectedSubMenuId.value !== 'all') {
      params.subMenuId = selectedSubMenuId.value;
    }
  }
  const res = await getFilteredCards(params);
  cards.value = res.data || [];
  cardSnapshots.clear();
  cards.value.forEach(c => cardSnapshots.set(c.id, snapshotKey(c)));
  const validIds = new Set(cards.value.map(c => c.id));
  selectedIds.value = selectedIds.value.filter(id => validIds.has(id));
}

function selectAll() {
  selectedMenuId.value = 'all';
  selectedSubMenuId.value = 'all';
  selectedIds.value = [];
  loadCards();
}

function selectMenu(menu) {
  selectedMenuId.value = menu.id;
  selectedSubMenuId.value = 'main';
  selectedIds.value = [];
  if (menu.subMenus?.length) {
    const next = new Set(expandedIds.value);
    next.add(menu.id);
    expandedIds.value = next;
  }
  loadCards();
}

function switchMainViewMode(mode) {
  selectedSubMenuId.value = mode;
  selectedIds.value = [];
  loadCards();
}

function selectSubMenu(menu, sub) {
  selectedMenuId.value = menu.id;
  selectedSubMenuId.value = sub.id;
  selectedIds.value = [];
  loadCards();
}

// 栏目增删改
async function handleAddMenu() {
  const name = newMenuName.value.trim();
  if (!name) return;
  const maxOrder = menus.value.length ? Math.max(...menus.value.map(m => m.order || 0)) : 0;
  const { data } = await apiAddMenu({ name, order: maxOrder + 1 });
  newMenuName.value = '';
  await loadMenus();
  if (data?.id) {
    selectedMenuId.value = data.id;
    selectedSubMenuId.value = 'main';
    await loadCards();
  }
  showToast(`已创建主菜单「${name}」`);
}

function startInlineRename(key, currentName) {
  editingTreeKey.value = key;
  editingTreeName.value = currentName;
  nextTick(() => {
    const el = Array.isArray(treeEditInputRef.value) ? treeEditInputRef.value[0] : treeEditInputRef.value;
    el?.focus();
    el?.select();
  });
}

function cancelInlineRename() {
  editingTreeKey.value = '';
  editingTreeName.value = '';
}

async function saveInlineRenameMenu(menu) {
  if (editingTreeKey.value !== `menu:${menu.id}`) return;
  const nextName = editingTreeName.value.trim();
  cancelInlineRename();
  if (!nextName || nextName === menu.name) return;
  await apiUpdateMenu(menu.id, { name: nextName, order: menu.order || 0 });
  menu.name = nextName;
  showToast('主菜单名称已更新');
}

async function saveInlineRenameSubMenu(sub) {
  if (editingTreeKey.value !== `sub:${sub.id}`) return;
  const nextName = editingTreeName.value.trim();
  cancelInlineRename();
  if (!nextName || nextName === sub.name) return;
  await apiUpdateSubMenu(sub.id, { name: nextName, order: sub.order || 0 });
  sub.name = nextName;
  showToast('子菜单名称已更新');
}

async function handleAddSubMenu(menu) {
  const name = window.prompt(`在「${menu.name}」下新建子菜单名称：`);
  if (!name?.trim()) return;
  const maxOrder = menu.subMenus?.length ? Math.max(...menu.subMenus.map(s => s.order || 0)) : 0;
  const { data } = await apiAddSubMenu(menu.id, { name: name.trim(), order: maxOrder + 1 });
  const next = new Set(expandedIds.value);
  next.add(menu.id);
  expandedIds.value = next;
  await loadMenus();
  if (data?.id) {
    selectedMenuId.value = menu.id;
    selectedSubMenuId.value = data.id;
    await loadCards();
  }
  showToast(`已添加子菜单「${name.trim()}」`);
}

async function handleDeleteMenu(menu) {
  if (!window.confirm(`确定删除主菜单「${menu.name}」吗？其下子菜单和卡片将一并删除！`)) return;
  await apiDeleteMenu(menu.id);
  await loadMenus();
  await loadCards();
  window.dispatchEvent(new Event('recycle:updated'));
  showToast(`已删除主菜单「${menu.name}」`);
}

async function handleDeleteSubMenu(sub) {
  if (!window.confirm(`确定删除子菜单「${sub.name}」吗？其下卡片将一并删除！`)) return;
  await apiDeleteSubMenu(sub.id);
  await loadMenus();
  await loadCards();
  window.dispatchEvent(new Event('recycle:updated'));
  showToast(`已删除子菜单「${sub.name}」`);
}

// 卡片增删改查
function formatCardCategory(card) {
  if (card.menu_name && card.sub_menu_name) return `${card.menu_name} / ${card.sub_menu_name}`;
  if (card.menu_name) return card.menu_name;
  if (card.sub_menu_name) return card.sub_menu_name;
  return '未分类';
}

async function handleAddCard() {
  if (!newCardTitle.value.trim() || !newCardUrl.value.trim()) {
    showToast('请填写卡片标题和网址', 'error');
    return;
  }
  const targetMenuId = selectedMenuId.value !== 'all' && selectedMenuId.value
    ? selectedMenuId.value
    : (menus.value[0]?.id || null);
  const targetSubMenuId = (selectedSubMenuId.value && selectedSubMenuId.value !== 'main' && selectedSubMenuId.value !== 'all')
    ? selectedSubMenuId.value
    : null;
  if (!targetMenuId) {
    showToast('请先在左侧创建主菜单', 'error');
    return;
  }

  await apiAddCard({
    menu_id: targetMenuId,
    sub_menu_id: targetSubMenuId,
    title: newCardTitle.value.trim(),
    url: newCardUrl.value.trim(),
    logo_url: newCardLogo.value.trim(),
    desc: newCardDesc.value.trim(),
    description: newCardDesc.value.trim()
  });
  newCardTitle.value = '';
  newCardUrl.value = '';
  newCardLogo.value = '';
  newCardDesc.value = '';
  await Promise.all([loadMenus(), loadCards()]);
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
  } catch {
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

async function handleRecycleCard(id) {
  await apiDeleteCard(id);
  selectedIds.value = selectedIds.value.filter(item => item !== id);
  await Promise.all([loadMenus(), loadCards()]);
  window.dispatchEvent(new Event('recycle:updated'));
  showToast('已移入回收站');
}

function toggleSelectAll(event) {
  selectedIds.value = event.target.checked ? displayedCards.value.map(c => c.id) : [];
}

function toggleSelectCard(id) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter(item => item !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
}

async function handleBatchRecycle() {
  if (!selectedIds.value.length) return;
  if (!window.confirm(`确定要将选中的 ${selectedIds.value.length} 张卡片移入回收站吗？可在回收站中随时还原。`)) return;
  batchBusy.value = true;
  try {
    const { data } = await batchDeleteCards(selectedIds.value, 'manual');
    selectedIds.value = [];
    await Promise.all([loadMenus(), loadCards()]);
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
    await Promise.all([loadMenus(), loadCards()]);
    showToast(`已移动 ${data.moved || 0} 张卡片`);
  } catch (err) {
    showToast(err.response?.data?.error || '批量移动失败', 'error');
  } finally {
    batchBusy.value = false;
  }
}

// 左侧主菜单拖拽排序
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

function onMenuGroupDragOver(event, index) {
  if (dragType.value !== 'menu') return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  menuDropIndex.value = index;
  menuDropPos.value = (event.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
}

function onMenuGroupDragLeave(event, index) {
  if (dragType.value === 'menu' && menuDropIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    menuDropIndex.value = -1;
  }
}

async function onMenuGroupDrop(event, targetIndex) {
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

// 左侧子菜单拖拽排序 & 接收右侧卡片拖放移动
function onSubMenuDragStart(event, parentId, index, sub) {
  if (armedSubMenuId.value !== sub.id) {
    event.preventDefault();
    return;
  }
  dragType.value = 'submenu';
  dragSubParentId.value = parentId;
  draggingSubMenuId.value = sub.id;
  subDragStartIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `submenu:${sub.id}`);
}

function onSubNodeDragOver(event, parentId, index, sub) {
  if (dragType.value === 'card') {
    onCardDragOverTree(event, `sub:${sub.id}`);
    return;
  }
  if (dragType.value !== 'submenu' || dragSubParentId.value !== parentId) return;
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  subDropIndex.value = index;
  subDropPos.value = (event.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
}

function onSubNodeDragLeave(event, index, sub) {
  if (dragType.value === 'card') {
    onCardDragLeaveTree(`sub:${sub.id}`);
    return;
  }
  if (dragType.value === 'submenu' && subDropIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    subDropIndex.value = -1;
  }
}

async function onSubNodeDrop(event, parentMenu, targetIndex, sub) {
  if (dragType.value === 'card') {
    await onCardDropOnTree(event, parentMenu.id, sub.id);
    return;
  }
  if (dragType.value !== 'submenu' || dragSubParentId.value !== parentMenu.id) return;
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

// 右侧卡片拖拽（支持同列排序 + 拖放至左侧栏目树移动）
function onCardDragStart(event, index, card) {
  if (dragArmedCardId.value !== card.id) {
    event.preventDefault();
    return;
  }
  dragType.value = 'card';
  draggingCardId.value = card.id;
  cardDragStartIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', `card:${card.id}`);
}

function onCardRowDragOver(event, index) {
  if (dragType.value !== 'card' || !canDragSort.value) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const rect = event.currentTarget.getBoundingClientRect();
  cardDropIndex.value = index;
  cardDropPos.value = (event.clientY - rect.top) > rect.height / 2 ? 'after' : 'before';
}

function onCardRowDragLeave(event, index) {
  if (dragType.value === 'card' && cardDropIndex.value === index && !event.currentTarget.contains(event.relatedTarget)) {
    cardDropIndex.value = -1;
  }
}

async function onCardRowDrop(event, targetIndex) {
  if (dragType.value !== 'card' || !canDragSort.value) {
    onCardDragEnd();
    return;
  }
  event.preventDefault();
  const fromIndex = cardDragStartIndex.value;
  let insertIndex = cardDropPos.value === 'after' ? targetIndex + 1 : targetIndex;
  if (fromIndex < insertIndex) insertIndex -= 1;
  onCardDragEnd();

  if (fromIndex < 0 || fromIndex === insertIndex || insertIndex < 0 || insertIndex >= cards.value.length) return;
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
  } catch {
    cards.value = previous;
    showToast('排序保存失败，已恢复原顺序', 'error');
  }
}

function onCardDragOverTree(event, targetKey) {
  if (dragType.value !== 'card') return;
  event.dataTransfer.dropEffect = 'move';
  cardDropTargetKey.value = targetKey;
}

function onCardDragLeaveTree(targetKey) {
  if (cardDropTargetKey.value === targetKey) {
    cardDropTargetKey.value = '';
  }
}

async function onCardDropOnTree(event, targetMenuId, targetSubMenuId) {
  if (dragType.value !== 'card' || !draggingCardId.value) return;
  const draggedId = draggingCardId.value;
  const moveIds = selectedIds.value.includes(draggedId) ? [...selectedIds.value] : [draggedId];
  onCardDragEnd();
  try {
    const { data } = await batchMoveCards({
      ids: moveIds,
      menu_id: targetMenuId,
      sub_menu_id: targetSubMenuId || null
    });
    selectedIds.value = [];
    await Promise.all([loadMenus(), loadCards()]);
    showToast(`已拖放移动 ${data.moved || moveIds.length} 张卡片`);
  } catch (err) {
    showToast(err.response?.data?.error || '移动卡片失败', 'error');
  }
}

function onCardDragEnd() {
  dragType.value = '';
  dragArmedCardId.value = null;
  draggingCardId.value = null;
  cardDragStartIndex.value = -1;
  cardDropIndex.value = -1;
  cardDropTargetKey.value = '';
}

async function onAiApplied(result) {
  await Promise.all([loadMenus(), loadCards()]);
  window.dispatchEvent(new Event('recycle:updated'));
  if (result?.mode === 'menus') {
    showToast(result?.message || '✨ AI 栏目结构整理已应用');
    return;
  }
  const updated = typeof result === 'number' ? result : (result?.updated || 0);
  const recycled = typeof result === 'object' ? (result?.recycled || 0) : 0;
  const backupFile = typeof result === 'object' ? result?.backup?.filename : '';
  if (updated || recycled) {
    showToast(`✨ AI 整理已应用：更新 ${updated} 张，移入回收站 ${recycled} 张${backupFile ? '（已云端备份）' : ''}`);
  }
}
</script>

<style scoped>
.nav-manage {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  padding: 0;
  box-sizing: border-box;
}

/* 左侧栏目树（固定 260px，独立滚动，顶部与右侧严格齐平） */
.tree-pane {
  width: 260px;
  flex-shrink: 0;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 110px);
  position: sticky;
  top: 80px;
  margin-top: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.tree-header {
  padding: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex-shrink: 0;
}

.tree-add-row {
  display: flex;
  gap: 6px;
}

.tree-input {
  flex: 1;
  min-width: 0;
  height: 31px;
  padding: 4px 9px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.96);
  color: #1e293b;
  font-size: 0.82rem;
  box-sizing: border-box;
}
.tree-input:focus { outline: none; border-color: #fff; }

.tree-add-btn {
  width: 31px;
  height: 31px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.38);
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 1.05rem;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tree-add-btn:hover { background: rgba(255, 255, 255, 0.34); }

.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 6px 12px;
}

.tree-group {
  margin-bottom: 2px;
  border-radius: 8px;
}
.tree-group.is-dragging { opacity: 0.45; }
.tree-group.drop-before { box-shadow: inset 0 2.5px 0 0 #4f46e5; }
.tree-group.drop-after { box-shadow: inset 0 -2.5px 0 0 #4f46e5; }

.tree-node {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 7px;
  border-radius: 8px;
  cursor: pointer;
  color: #334155;
  font-size: 0.84rem;
  transition: background 0.12s ease, color 0.12s ease;
  user-select: none;
  position: relative;
}

.tree-node:hover {
  background: #f1f5f9;
}

.tree-node.active {
  background: #eef2ff;
  color: #4338ca;
  font-weight: 600;
}

.tree-node.card-drop-target {
  background: #dbeafe !important;
  color: #1d4ed8 !important;
  outline: 2px dashed #3b82f6;
}

.all-node {
  margin-bottom: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid #f1f5f9;
}

.node-icon { font-size: 0.85rem; }

.tree-drag-handle {
  color: #94a3b8;
  cursor: grab;
  font-size: 0.82rem;
  letter-spacing: -1.5px;
  padding: 2px 2px;
  border-radius: 4px;
  flex-shrink: 0;
}
.tree-drag-handle:hover { color: #4f46e5; background: #e0e7ff; }
.tree-drag-handle:active { cursor: grabbing; }

.tree-expand-btn {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  transition: transform 0.16s ease;
  flex-shrink: 0;
  padding: 0;
}
.tree-expand-btn.expanded { transform: rotate(90deg); color: #4f46e5; }
.tree-expand-btn.empty { opacity: 0.25; }

.node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-inline-input {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  border: 1.5px solid #667eea;
  border-radius: 5px;
  font-size: 0.82rem;
  background: #fff;
  color: #0f172a;
}
.tree-inline-input:focus { outline: none; }

.node-count {
  font-size: 0.72rem;
  color: #64748b;
  background: #f1f5f9;
  padding: 1px 6px;
  border-radius: 999px;
  flex-shrink: 0;
}
.tree-node.active .node-count {
  background: #c7d2fe;
  color: #3730a3;
}

.node-actions {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.tree-node:hover .node-actions { display: flex; }

.mini-btn {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 0.74rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.mini-btn:hover { background: #e2e8f0; color: #0f172a; }
.mini-btn.danger:hover { background: #fee2e2; color: #dc2626; }

.sub-tree-list {
  padding-left: 20px;
  margin: 2px 0 4px;
  border-left: 1.5px solid #e2e8f0;
  margin-left: 15px;
}

.sub-node {
  padding: 5px 7px;
  font-size: 0.81rem;
  color: #475569;
}
.sub-node.is-dragging { opacity: 0.45; }
.sub-node.drop-before { box-shadow: inset 0 2px 0 0 #10b981; }
.sub-node.drop-after { box-shadow: inset 0 -2px 0 0 #10b981; }

/* 右侧卡片工作区（flex: 1 + min-width: 0，防止宽表格撑爆页面） */
.cards-pane {
  flex: 1;
  min-width: 0;
  margin-top: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}

.cards-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 10px 14px;
  color: #fff;
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.22);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.header-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.breadcrumb-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.breadcrumb-text {
  font-size: 0.92rem;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.view-mode-pills {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.16);
  padding: 2px;
  border-radius: 7px;
  gap: 2px;
}

.mode-pill {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.75rem;
  padding: 3px 9px;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 500;
}
.mode-pill.active {
  background: #fff;
  color: #4f46e5;
  font-weight: 600;
}

.card-add-row {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: nowrap;
}

.add-input {
  height: 32px;
  padding: 5px 9px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.96);
  color: #1e293b;
  font-size: 0.83rem;
  box-sizing: border-box;
  min-width: 0;
}
.add-input:focus { outline: none; border-color: #fff; }
.add-input.title-in { flex: 1 1 120px; max-width: 170px; }
.add-input.url-in { flex: 1.5 1 160px; }
.add-input.logo-in { flex: 1 1 120px; max-width: 175px; }
.add-input.desc-in { flex: 1.1 1 130px; max-width: 210px; }

.cards-card {
  width: 100%;
  min-width: 0;
  background: #fff;
  border-radius: 14px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 18px rgba(15, 23, 42, 0.05);
  overflow: hidden;
  box-sizing: border-box;
}

.table-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #edf2f7;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-search {
  height: 30px;
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #1e293b;
  font-size: 0.82rem;
  width: 210px;
  box-sizing: border-box;
}
.filter-search:focus { outline: none; border-color: #667eea; }

.count-badge {
  font-size: 0.76rem;
  color: #4f46e5;
  background: #eef2ff;
  padding: 2px 9px;
  border-radius: 999px;
  font-weight: 600;
}

.drag-hint {
  font-size: 0.75rem;
  color: #059669;
  background: #ecfdf5;
  padding: 2px 9px;
  border-radius: 999px;
}
.drag-hint.muted { color: #64748b; background: #f1f5f9; }

.inline-toast { font-size: 0.8rem; padding: 3px 10px; border-radius: 6px; font-weight: 500; }
.inline-toast.success { background: #ecfdf5; color: #047857; }
.inline-toast.error { background: #fef2f2; color: #b91c1c; }

.batch-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #eef2ff;
  border-bottom: 1px solid #c7d2fe;
  font-size: 0.82rem;
  flex-wrap: wrap;
}
.batch-count { color: #3730a3; }
.batch-move-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.filter-select.sm {
  height: 28px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #fff;
  font-size: 0.8rem;
}

.table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
}

.card-table {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}
.card-table th,
.card-table td {
  padding: 6px 7px;
  text-align: left;
  border-bottom: 1px solid #eef2f7;
  vertical-align: middle;
}
.card-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #475569;
  font-size: 0.8rem;
  white-space: nowrap;
}
.card-table tbody tr:hover { background: #f8fafc; }
.card-table tbody tr.is-selected { background: #f5f7ff; }
.card-table tbody tr.is-dragging { opacity: 0.45; background: #eef2ff; }
.card-table tbody tr.drop-before td { box-shadow: inset 0 2px 0 0 #4f46e5; }
.card-table tbody tr.drop-after td { box-shadow: inset 0 -2px 0 0 #4f46e5; }

/* 优化列宽：给予标题充裕空间避免过早截断 */
.col-drag { width: 28px; text-align: center !important; }
.col-check { width: 28px; text-align: center !important; }
.col-logo { width: 46px; text-align: center !important; }
.col-title { width: 24%; min-width: 170px; }
.col-url { width: 28%; min-width: 170px; }
.col-desc { width: 28%; min-width: 160px; }
.col-category { width: 14%; min-width: 105px; }
.col-actions { width: 44px; text-align: center !important; }

.drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 26px;
  color: #94a3b8;
  cursor: grab;
  font-size: 0.96rem;
  letter-spacing: -1px;
  user-select: none;
  border-radius: 5px;
}
.drag-handle:hover { color: #4f46e5; background: #eef2ff; }
.drag-handle:active { cursor: grabbing; }

.logo-preview-btn {
  position: relative;
  width: 32px;
  height: 32px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.logo-preview-btn:hover { border-color: #667eea; background: #eef2ff; }
.logo-thumb-img { width: 20px; height: 20px; object-fit: contain; border-radius: 4px; }
.logo-edit-badge {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #667eea;
  color: #fff;
  font-size: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}
.logo-preview-btn:hover .logo-edit-badge { opacity: 1; }

.logo-popover-floating {
  position: fixed;
  z-index: 1100;
  width: 310px;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
  box-sizing: border-box;
}
.logo-popover-title { font-size: 0.76rem; color: #475569; margin-bottom: 6px; font-weight: 500; }
.logo-popover-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  font-size: 0.84rem;
}
.logo-popover-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }

.table-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 7px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #1e293b;
  font-size: 0.84rem;
}
.title-cell-input { font-weight: 500; }
.table-input:hover { border-color: #e2e8f0; background: #fff; }
.table-input:focus { outline: none; border-color: #667eea; background: #fff; box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.12); }

.category-pill {
  display: inline-block;
  font-size: 0.74rem;
  padding: 2px 7px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #334155;
  white-space: nowrap;
}

.empty-row { text-align: center !important; padding: 36px !important; color: #94a3b8; font-size: 0.88rem; }

/* 按钮 */
.btn {
  padding: 6px 12px;
  height: 32px;
  border: none;
  border-radius: 7px;
  color: #fff;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.83rem;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  box-sizing: border-box;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn-add { background: rgba(255, 255, 255, 0.22); border: 1px solid rgba(255, 255, 255, 0.35); }
.btn-add:hover { background: rgba(255, 255, 255, 0.32); }
.btn-ai {
  background: linear-gradient(135deg, #f59e0b 0%, #ec4899 100%);
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(236, 72, 153, 0.35);
}
.btn-ai:hover { filter: brightness(1.06); }
.btn-primary { background: #4f46e5; }
.btn-danger { background: #ef4444; }
.btn-ghost { background: #e2e8f0; color: #334155; }
.btn-sm { height: 28px; padding: 3px 10px; font-size: 0.78rem; }
.btn-xs { height: 25px; padding: 2px 8px; font-size: 0.75rem; }
.btn-icon { width: 28px; height: 28px; padding: 0; justify-content: center; border-radius: 6px; }

@media (max-width: 1080px) {
  .card-add-row { flex-wrap: wrap; }
  .add-input.title-in,
  .add-input.url-in,
  .add-input.logo-in,
  .add-input.desc-in { flex: 1 1 160px; max-width: none; }
}

@media (max-width: 860px) {
  .nav-manage {
    flex-direction: column;
  }
  .tree-pane {
    width: 100%;
    position: static;
    max-height: 280px;
  }
  .cards-pane {
    width: 100%;
  }
}
</style>
