<template>
  <div class="home-container" :style="homeContainerStyle">
    <!-- 顶部悬浮栏：居中纯净毛玻璃主菜单胶囊条 -->
    <header class="top-bar">
      <div class="top-bar-center">
        <MenuBar
          :menus="menus"
          :activeId="activeMenu?.id"
          @select="selectMainMenu"
        />
      </div>
    </header>

    <!-- 搜索区：全胶囊毛玻璃风格 + 柔和蓝紫聚焦微光 -->
    <section :class="['search-section', { 'dropdown-open': showDropdown }]">
      <div class="search-box-wrapper" ref="searchWrapperRef">
        <div class="search-engine-select">
          <button
            v-for="engine in searchEngines"
            :key="engine.name"
            type="button"
            :class="['engine-btn', { active: selectedEngine.name === engine.name }]"
            @click="selectEngine(engine)"
          >
            {{ engine.label }}
          </button>
        </div>

        <div class="search-container" :class="{ focused: searchFocused }">
          <span class="search-leading-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M21 21l-5.2-5.2m1.7-4.8a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            :placeholder="selectedEngine.placeholder"
            class="search-input"
            @focus="onSearchFocus"
            @blur="searchFocused = false"
            @keydown.down.prevent="moveSelection(1)"
            @keydown.up.prevent="moveSelection(-1)"
            @keydown.enter.prevent="handleEnter"
            @keydown.esc="handleEscape"
          />
          <button
            v-if="!searchQuery"
            type="button"
            class="shortcut-hint"
            title="按 / 或 ⌘K 快速站内搜索"
            @click="focusSiteSearch"
          >
            / · ⌘K
          </button>
          <button v-if="searchQuery" type="button" class="clear-btn" @click="clearSearch" aria-label="清空" title="清空">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <button type="button" @click="handleSearch" class="search-btn" title="搜索">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>

          <!-- 实时全站模糊搜索下拉结果（支持 ↑/↓ 选择 + Enter 直达） -->
          <div v-if="showDropdown" class="search-dropdown">
            <div class="dropdown-header">
              <span>站内匹配 {{ globalMatches.length }} 项</span>
              <span class="dropdown-keys">↑↓ 选择 · Enter 直达 · Esc 关闭</span>
            </div>
            <div v-if="dropdownItems.length === 0" class="dropdown-empty">
              未找到匹配的站内卡片
            </div>
            <a
              v-for="(item, idx) in dropdownItems"
              :key="item.id"
              :href="item.url"
              target="_blank"
              rel="noopener noreferrer"
              :class="['dropdown-item', { active: idx === selectedMatchIndex }]"
              @mouseenter="selectedMatchIndex = idx"
              @click="closeDropdown"
            >
              <span class="dropdown-logo-wrap">
                <CardLogo class="dropdown-logo" :card="item" />
              </span>
              <span class="dropdown-info">
                <span class="dropdown-title-row">
                  <span class="dropdown-title">{{ item.title }}</span>
                  <span v-if="item.menu_name" class="dropdown-cat">
                    {{ item.menu_name }}<template v-if="item.sub_menu_name"> / {{ item.sub_menu_name }}</template>
                  </span>
                </span>
                <span class="dropdown-sub">{{ item.desc || formatHost(item.url) }}</span>
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- 搜索状态栏（全站搜索激活时） -->
    <div v-if="isGlobalSearching" class="search-status-bar">
      <span>全站搜索 “{{ searchQuery.trim() }}”：共找到 <strong>{{ globalMatches.length }}</strong> 张卡片</span>
      <button type="button" class="reset-search-btn" @click="clearSearch">返回当前分类</button>
    </div>

    <!-- 横向子菜单胶囊筛选栏（搜索框下方、卡片网格上方，不遮挡搜索框） -->
    <div v-else-if="subMenuPills.length > 0" class="submenu-pill-bar" role="tablist" aria-label="子菜单筛选">
      <button
        v-for="pill in subMenuPills"
        :key="pill.key"
        type="button"
        role="tab"
        :aria-selected="activeSubKey === pill.key"
        :class="['submenu-pill', { active: activeSubKey === pill.key }]"
        @click="selectSubPill(pill.key)"
      >
        <span class="submenu-pill-label">{{ pill.label }}</span>
        <span v-if="pill.count > 0" class="submenu-pill-count">{{ pill.count }}</span>
      </button>
    </div>

    <!-- 横向信息卡片网格 -->
    <main class="cards-main">
      <CardGrid
        :cards="displayedCards"
        :showCategory="isGlobalSearching || activeSubKey === 'all'"
      />
    </main>

    <footer class="footer">
      <div class="footer-inner">
        <span class="copyright">Nav-Item</span>
        <span class="footer-sep" aria-hidden="true">·</span>
        <router-link to="/admin" class="footer-admin-link" title="进入后台管理" aria-label="进入后台管理">
          <svg class="footer-admin-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>后台管理</span>
        </router-link>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { getMenus, getFilteredCards, getSiteAppearance } from '../api';
import MenuBar from '../components/MenuBar.vue';
import CardGrid from '../components/CardGrid.vue';
import CardLogo from '../components/CardLogo.vue';

const DEFAULT_BG_LAYERS = 'url("https://main.ssss.nyc.mn/background.webp"), url("/background.webp")';

const menus = ref([]);
const activeMenu = ref(null);
// activeSubKey: 'main'（主菜单直属） | 'all'（当前主菜单下全部） | 数字子菜单 ID
const activeSubKey = ref('main');
const cards = ref([]);
const allCards = ref([]);
const searchQuery = ref('');
const searchFocused = ref(false);
const dropdownOpen = ref(false);
const selectedMatchIndex = ref(0);
const searchInputRef = ref(null);
const searchWrapperRef = ref(null);
const activeBgUrl = ref('');
const siteBgOverlay = ref(40);
let bgPreloadToken = 0;

function escapeCssUrl(url) {
  return String(url || '').replace(/["\\\r\n]/g, '\\$&');
}

function buildOverlayBackground(percent) {
  const num = Number(percent);
  const clamped = Number.isFinite(num) ? Math.min(80, Math.max(0, num)) : 40;
  const alpha = clamped / 100;
  if (alpha <= 0) return 'rgba(2, 6, 23, 0)';
  const top = (alpha * 0.82).toFixed(3);
  const bottom = Math.min(0.92, alpha * 1.12).toFixed(3);
  return `radial-gradient(circle at 50% 0%, rgba(15, 23, 42, ${top}) 0%, rgba(2, 6, 23, ${bottom}) 100%)`;
}

const homeContainerStyle = computed(() => ({
  backgroundImage: activeBgUrl.value
    ? `url("${escapeCssUrl(activeBgUrl.value)}"), ${DEFAULT_BG_LAYERS}`
    : DEFAULT_BG_LAYERS,
  '--site-bg-overlay': buildOverlayBackground(siteBgOverlay.value)
}));

function applyCustomBackground(url) {
  const clean = String(url || '').trim();
  const token = ++bgPreloadToken;
  if (!clean) {
    activeBgUrl.value = '';
    return;
  }
  const probe = new Image();
  probe.onload = () => {
    if (token === bgPreloadToken) {
      activeBgUrl.value = clean;
    }
  };
  probe.onerror = () => {
    if (token === bgPreloadToken) {
      activeBgUrl.value = '';
    }
  };
  probe.src = clean;
}

const searchEngines = [
  {
    name: 'site',
    label: '站内',
    placeholder: '实时搜索全站卡片（按 / 或 ⌘K 聚焦）...',
    url: q => `/search?query=${encodeURIComponent(q)}`
  },
  {
    name: 'google',
    label: 'Google',
    placeholder: 'Google 搜索，或输入关键词实时筛选站内卡片...',
    url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  },
  {
    name: 'baidu',
    label: '百度',
    placeholder: '百度搜索...',
    url: q => `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`
  },
  {
    name: 'bing',
    label: 'Bing',
    placeholder: 'Bing 搜索...',
    url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`
  },
  {
    name: 'github',
    label: 'GitHub',
    placeholder: 'GitHub 搜索...',
    url: q => `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`
  }
];
const selectedEngine = ref(searchEngines[1]);

const subMenuPills = computed(() => {
  const menu = activeMenu.value;
  if (!menu || !menu.subMenus || menu.subMenus.length === 0) return [];

  const pills = [];
  const directCount = Number(menu.direct_card_count || 0);
  const totalCount = Number(menu.total_card_count || 0);

  if (directCount > 0) {
    pills.push({ key: 'main', label: '主菜单直属', count: directCount });
  }
  for (const sub of menu.subMenus) {
    pills.push({
      key: sub.id,
      label: sub.name,
      count: Number(sub.card_count || 0)
    });
  }
  if (totalCount > 0 && pills.length > 1) {
    pills.push({ key: 'all', label: '全部', count: totalCount });
  }
  return pills;
});

function pickDefaultSubKey(menu) {
  if (!menu) return 'main';
  const directCount = Number(menu.direct_card_count || 0);
  const subs = menu.subMenus || [];
  // 若主菜单直属包含卡片，默认展示直属卡片
  if (directCount > 0 || subs.length === 0) return 'main';
  // 若直属卡片为 0，自动选中第一个非空子菜单，避免落地空白页
  const firstNonEmptySub = subs.find(s => Number(s.card_count || 0) > 0);
  if (firstNonEmptySub) return firstNonEmptySub.id;
  return 'all';
}

function selectEngine(engine) {
  selectedEngine.value = engine;
  selectedMatchIndex.value = engine.name === 'site' ? 0 : -1;
  searchInputRef.value?.focus();
}

function clearSearch() {
  searchQuery.value = '';
  dropdownOpen.value = false;
  selectedMatchIndex.value = 0;
}

function closeDropdown() {
  dropdownOpen.value = false;
  searchFocused.value = false;
}

function onSearchFocus() {
  searchFocused.value = true;
  if (searchQuery.value.trim()) {
    dropdownOpen.value = true;
  }
}

function focusSiteSearch() {
  selectedEngine.value = searchEngines[0];
  searchFocused.value = true;
  if (searchQuery.value.trim()) dropdownOpen.value = true;
  selectedMatchIndex.value = 0;
  searchInputRef.value?.focus();
  searchInputRef.value?.select();
}

const isGlobalSearching = computed(() => Boolean(searchQuery.value.trim()));

const globalMatches = computed(() => {
  const raw = searchQuery.value.trim().toLowerCase();
  if (!raw) return [];
  const tokens = raw.split(/\s+/).filter(Boolean);
  const pool = allCards.value.length ? allCards.value : cards.value;
  const scored = [];
  for (const card of pool) {
    const title = (card.title || '').toLowerCase();
    const url = (card.url || '').toLowerCase();
    const desc = (card.desc || '').toLowerCase();
    const menuName = (card.menu_name || '').toLowerCase();
    const subMenuName = (card.sub_menu_name || '').toLowerCase();
    const haystack = `${title} ${url} ${desc} ${menuName} ${subMenuName}`;
    if (!tokens.every(t => haystack.includes(t))) continue;

    let score = 0;
    if (title === raw) score += 100;
    else if (title.startsWith(raw)) score += 60;
    else if (title.includes(raw)) score += 35;
    if (url.includes(raw)) score += 20;
    if (desc.includes(raw)) score += 15;
    if (menuName.includes(raw) || subMenuName.includes(raw)) score += 10;
    scored.push({ card, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(item => item.card);
});

const displayedCards = computed(() => (isGlobalSearching.value ? globalMatches.value : cards.value));

const dropdownItems = computed(() => globalMatches.value.slice(0, 8));

const showDropdown = computed(() => {
  if (!dropdownOpen.value || !isGlobalSearching.value) return false;
  if (selectedEngine.value.name === 'site') return true;
  return dropdownItems.value.length > 0;
});

watch(searchQuery, (val) => {
  if (val.trim()) {
    dropdownOpen.value = true;
    selectedMatchIndex.value = selectedEngine.value.name === 'site' ? 0 : -1;
  } else {
    dropdownOpen.value = false;
    selectedMatchIndex.value = 0;
  }
});

function moveSelection(delta) {
  if (!isGlobalSearching.value || dropdownItems.value.length === 0) return;
  dropdownOpen.value = true;
  const max = dropdownItems.value.length - 1;
  if (selectedMatchIndex.value < 0) {
    selectedMatchIndex.value = delta > 0 ? 0 : max;
    return;
  }
  selectedMatchIndex.value = (selectedMatchIndex.value + delta + dropdownItems.value.length) % dropdownItems.value.length;
}

function handleEnter() {
  const q = searchQuery.value.trim();
  if (!q) return;
  if (selectedEngine.value.name === 'site') {
    const target = dropdownItems.value[selectedMatchIndex.value] || dropdownItems.value[0];
    if (target?.url) {
      window.open(target.url, '_blank', 'noopener,noreferrer');
      closeDropdown();
    }
    return;
  }
  if (selectedMatchIndex.value >= 0 && dropdownItems.value[selectedMatchIndex.value]) {
    window.open(dropdownItems.value[selectedMatchIndex.value].url, '_blank', 'noopener,noreferrer');
    closeDropdown();
    return;
  }
  window.open(selectedEngine.value.url(q), '_blank', 'noopener,noreferrer');
}

function handleSearch() {
  handleEnter();
}

function handleEscape() {
  if (searchQuery.value) {
    clearSearch();
  } else {
    closeDropdown();
    searchInputRef.value?.blur();
  }
}

function handleGlobalKeydown(e) {
  const key = e.key?.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'k') {
    e.preventDefault();
    focusSiteSearch();
    return;
  }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const isEditable = document.activeElement?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
    if (!isEditable) {
      e.preventDefault();
      focusSiteSearch();
    }
  }
}

function handleDocumentClick(e) {
  if (searchWrapperRef.value && !searchWrapperRef.value.contains(e.target)) {
    closeDropdown();
  }
}

function formatHost(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}

async function selectMainMenu(menu) {
  clearSearch();
  activeMenu.value = menu;
  activeSubKey.value = pickDefaultSubKey(menu);
  await loadCards();
}

async function selectSubPill(key) {
  if (activeSubKey.value === key) return;
  activeSubKey.value = key;
  await loadCards();
}

async function loadCards() {
  if (!activeMenu.value) return;
  const params = { menuId: activeMenu.value.id };
  if (activeSubKey.value === 'main') {
    params.subMenuId = 'main';
  } else if (activeSubKey.value !== 'all' && activeSubKey.value != null) {
    params.subMenuId = activeSubKey.value;
  }
  const res = await getFilteredCards(params);
  cards.value = res.data || [];
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown);
  document.addEventListener('click', handleDocumentClick);

  const [menuRes, allCardsRes, appearanceRes] = await Promise.allSettled([
    getMenus(),
    getFilteredCards(),
    getSiteAppearance()
  ]);
  if (appearanceRes.status === 'fulfilled') {
    const cfg = appearanceRes.value?.data || {};
    if (cfg.site_bg_overlay !== undefined && cfg.site_bg_overlay !== null) {
      siteBgOverlay.value = Number(cfg.site_bg_overlay);
    }
    applyCustomBackground(cfg.site_bg_url || '');
  }
  if (allCardsRes.status === 'fulfilled') {
    allCards.value = allCardsRes.value.data || [];
  }
  if (menuRes.status === 'fulfilled') {
    menus.value = menuRes.value.data || [];
    if (menus.value.length) {
      activeMenu.value = menus.value[0];
      activeSubKey.value = pickDefaultSubKey(activeMenu.value);
      await loadCards();
    }
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  background-image: url('https://main.ssss.nyc.mn/background.webp'), url('/background.webp');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
  display: flex;
  flex-direction: column;
  position: relative;
  padding-top: 96px;
  box-sizing: border-box;
  transition: background-image 0.25s ease;
}

.home-container::before {
  content: '';
  position: fixed;
  inset: 0;
  background: var(--site-bg-overlay, radial-gradient(circle at 50% 0%, rgba(15, 23, 42, 0.328) 0%, rgba(2, 6, 23, 0.448) 100%));
  z-index: 1;
  pointer-events: none;
  transition: background 0.25s ease;
}

/* 顶部悬浮导航层：居中纯净展示主菜单胶囊 */
.top-bar {
  position: fixed;
  top: 16px;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  box-sizing: border-box;
  pointer-events: none;
}

.top-bar-center {
  pointer-events: auto;
  display: flex;
  justify-content: center;
  max-width: 100%;
}

/* 搜索区（充足呼吸感） */
.search-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.2rem 16px 2.1rem;
  position: relative;
  z-index: 20;
  box-sizing: border-box;
}

.search-section.dropdown-open {
  z-index: 90;
}

.search-box-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 560px;
}

.search-engine-select {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.engine-btn {
  border: 1px solid transparent;
  background: transparent;
  color: rgba(226, 232, 240, 0.62);
  font-size: 13px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 9999px;
  cursor: pointer;
  transition: color 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
}

.engine-btn:hover {
  color: rgba(255, 255, 255, 0.92);
  background: rgba(255, 255, 255, 0.08);
}

.engine-btn.active {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.14);
}

.search-container {
  display: flex;
  align-items: center;
  width: 100%;
  height: 48px;
  padding: 0 6px 0 16px;
  box-sizing: border-box;
  border-radius: 9999px;
  background: rgba(15, 23, 42, 0.48);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  position: relative;
  transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
}

.search-container.focused {
  background: rgba(15, 23, 42, 0.68);
  border-color: rgba(165, 180, 252, 0.62);
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.22), 0 14px 36px rgba(0, 0, 0, 0.34);
}

.search-leading-icon {
  display: inline-flex;
  align-items: center;
  color: rgba(203, 213, 225, 0.62);
  margin-right: 10px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 6px 4px;
  font-size: 15px;
  color: #ffffff;
  outline: none;
}

.search-input::placeholder {
  color: rgba(203, 213, 225, 0.52);
  font-size: 14px;
}

.shortcut-hint {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(203, 213, 225, 0.68);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 9999px;
  cursor: pointer;
  margin-right: 6px;
  white-space: nowrap;
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.shortcut-hint:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.26);
  color: #ffffff;
}

.clear-btn {
  background: none;
  border: none;
  outline: none;
  cursor: pointer;
  color: rgba(226, 232, 240, 0.72);
  margin-right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.clear-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

.search-btn {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.18s ease, border-color 0.18s ease;
}

.search-btn:hover {
  background: rgba(129, 140, 248, 0.45);
  border-color: rgba(165, 180, 252, 0.5);
}

/* 实时站内模糊搜索下拉框 */
.search-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.48);
  padding: 6px;
  z-index: 120;
  max-height: 380px;
  overflow-y: auto;
}

.dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px 8px;
  font-size: 11px;
  color: rgba(148, 163, 184, 0.88);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 4px;
}

.dropdown-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 13px;
  color: rgba(148, 163, 184, 0.9);
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  border-radius: 10px;
  text-decoration: none;
  color: #f8fafc;
  transition: background-color 0.14s ease;
}

.dropdown-item:hover,
.dropdown-item.active {
  background: rgba(129, 140, 248, 0.24);
}

.dropdown-logo-wrap {
  width: 32px;
  height: 32px;
  padding: 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: rgba(241, 245, 249, 0.24);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dropdown-logo {
  width: 18px;
  height: 18px;
  object-fit: contain;
  filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.34));
}

.dropdown-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.dropdown-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dropdown-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-cat {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(129, 140, 248, 0.22);
  color: #c7d2fe;
  white-space: nowrap;
  flex-shrink: 0;
}

.dropdown-sub {
  font-size: 11.5px;
  color: rgba(148, 163, 184, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 横向子菜单胶囊筛选栏（PC 自动居中换行，移动端平滑横滑） */
.submenu-pill-bar {
  position: relative;
  z-index: 5;
  width: min(92vw, 1240px);
  margin: 0 auto 22px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
}

@media (min-width: 1480px) {
  .submenu-pill-bar {
    width: min(90vw, 1380px);
  }
}

.submenu-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: rgba(226, 232, 240, 0.78);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
}

.submenu-pill:hover {
  color: #ffffff;
  background: rgba(30, 41, 59, 0.62);
  border-color: rgba(255, 255, 255, 0.2);
}

.submenu-pill.active {
  color: #ffffff;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.28);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.submenu-pill-count {
  font-size: 11px;
  font-weight: 500;
  color: rgba(226, 232, 240, 0.46);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 9999px;
  line-height: 1.3;
}

.submenu-pill.active .submenu-pill-count {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(255, 255, 255, 0.14);
}

/* 搜索状态栏 */
.search-status-bar {
  position: relative;
  z-index: 5;
  width: min(92vw, 1240px);
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.48);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(241, 245, 249, 0.9);
  font-size: 13px;
  box-sizing: border-box;
}

.reset-search-btn {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  font-size: 12px;
  padding: 4px 11px;
  border-radius: 9999px;
  cursor: pointer;
  transition: background-color 0.18s ease;
}

.reset-search-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.cards-main {
  position: relative;
  z-index: 2;
  padding-bottom: 1.5rem;
}

.footer {
  margin-top: auto;
  text-align: center;
  padding: 2.2rem 16px 1.5rem;
  position: relative;
  z-index: 2;
}

.footer-inner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.36);
  font-size: 12px;
  letter-spacing: 0.6px;
}

.copyright {
  margin: 0;
}

.footer-sep {
  opacity: 0.55;
  user-select: none;
}

.footer-admin-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: rgba(255, 255, 255, 0.36);
  text-decoration: none;
  padding: 3px 8px;
  border-radius: 9999px;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.footer-admin-link:hover {
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.08);
}

.footer-admin-icon {
  transition: transform 0.28s ease;
}

.footer-admin-link:hover .footer-admin-icon {
  transform: rotate(35deg);
}

@media (max-width: 768px) {
  .home-container {
    padding-top: 76px;
  }

  .top-bar {
    top: 12px;
    padding: 0 10px;
  }

  .search-section {
    padding: 1.4rem 12px 1.4rem;
  }

  .search-container {
    height: 44px;
    padding: 0 5px 0 14px;
  }

  .shortcut-hint,
  .dropdown-keys {
    display: none;
  }

  /* 移动端单行横向平滑滚动 */
  .submenu-pill-bar {
    width: 94vw;
    margin-bottom: 16px;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 4px;
  }

  .submenu-pill-bar::-webkit-scrollbar {
    display: none;
  }

  .submenu-pill {
    padding: 5px 11px;
    font-size: 12.5px;
  }
}
</style>
