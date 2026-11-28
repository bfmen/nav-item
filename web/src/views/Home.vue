<template>
  <div class="home-container" :data-theme="activeTheme">
    <!-- 独立固定底层壁纸与遮罩容器（避免 iOS Safari 移动端背景放大与滚动抖动） -->
    <div class="bg-backdrop" :style="bgBackdropStyle" aria-hidden="true"></div>
    <div class="bg-overlay" :style="bgOverlayStyle" aria-hidden="true"></div>

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

    <!-- 搜索区：全胶囊毛玻璃风格 + 柔和聚焦微光 -->
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

    <!-- 底部轻量毛玻璃页脚胶囊：整合白天/夜晚模式切换与后台入口，绝不遮挡页面主体 -->
    <footer class="footer">
      <div class="footer-capsule">
        <span class="copyright">Nav-Item</span>
        <span class="footer-sep" aria-hidden="true">·</span>
        <div class="footer-theme-toggle" role="group" aria-label="白天与夜晚模式切换">
          <button
            type="button"
            :class="['footer-theme-btn', { active: activeTheme === 'light' }]"
            :aria-pressed="activeTheme === 'light'"
            title="切换为白天浅色模式"
            @click="switchTheme('light')"
          >
            <span aria-hidden="true">☀</span>
            <span>浅色</span>
          </button>
          <span class="footer-theme-slash" aria-hidden="true">/</span>
          <button
            type="button"
            :class="['footer-theme-btn', { active: activeTheme === 'dark' }]"
            :aria-pressed="activeTheme === 'dark'"
            title="切换为夜晚深色模式"
            @click="switchTheme('dark')"
          >
            <span aria-hidden="true">🌙</span>
            <span>深色</span>
          </button>
        </div>
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

const THEME_STORAGE_KEY = 'nav_item_theme';
const DEFAULT_DAY_BG = '/backgrounds/campus-day.svg';
const DEFAULT_NIGHT_BG = '/backgrounds/campus-night.svg';
const DEFAULT_DAY_OVERLAY = 0;
const DEFAULT_NIGHT_OVERLAY = 24;

function readStoredTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

function getSystemTheme() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

function applyRootTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', normalized);
  }
}

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

// 双模式外观配置
const appearance = ref({
  day_bg_url: DEFAULT_DAY_BG,
  day_bg_overlay: DEFAULT_DAY_OVERLAY,
  night_bg_url: DEFAULT_NIGHT_BG,
  night_bg_overlay: DEFAULT_NIGHT_OVERLAY,
  default_theme: 'auto'
});

const initialTheme = readStoredTheme() || getSystemTheme();
const activeTheme = ref(initialTheme);
applyRootTheme(initialTheme);

const activeBgUrl = ref(initialTheme === 'light' ? DEFAULT_DAY_BG : DEFAULT_NIGHT_BG);
let bgPreloadToken = 0;
let colorSchemeQuery = null;

function escapeCssUrl(url) {
  return String(url || '').replace(/["\\\r\n]/g, '\\$&');
}

function buildOverlayBackground(percent, theme = 'dark') {
  const num = Number(percent);
  const fallback = theme === 'light' ? DEFAULT_DAY_OVERLAY : DEFAULT_NIGHT_OVERLAY;
  const clamped = Number.isFinite(num) ? Math.min(80, Math.max(0, num)) : fallback;
  const alpha = clamped / 100;
  if (alpha <= 0) return 'transparent';
  if (theme === 'light') {
    // 白天模式仅使用通透轻柔滤层，不把晴空蒙灰
    const top = (alpha * 0.42).toFixed(3);
    const bottom = Math.min(0.65, alpha * 0.62).toFixed(3);
    return `linear-gradient(180deg, rgba(15, 23, 42, ${top}) 0%, rgba(15, 23, 42, ${bottom}) 100%)`;
  }
  const top = (alpha * 0.82).toFixed(3);
  const bottom = Math.min(0.92, alpha * 1.12).toFixed(3);
  return `radial-gradient(circle at 50% 0%, rgba(15, 23, 42, ${top}) 0%, rgba(2, 6, 23, ${bottom}) 100%)`;
}

const currentFallbackBg = computed(() => (activeTheme.value === 'light' ? DEFAULT_DAY_BG : DEFAULT_NIGHT_BG));

const currentTargetBgUrl = computed(() => {
  if (activeTheme.value === 'light') {
    return String(appearance.value.day_bg_url || DEFAULT_DAY_BG).trim() || DEFAULT_DAY_BG;
  }
  return String(appearance.value.night_bg_url || DEFAULT_NIGHT_BG).trim() || DEFAULT_NIGHT_BG;
});

const currentOverlayPercent = computed(() => {
  if (activeTheme.value === 'light') {
    return Number(appearance.value.day_bg_overlay ?? DEFAULT_DAY_OVERLAY);
  }
  return Number(appearance.value.night_bg_overlay ?? DEFAULT_NIGHT_OVERLAY);
});

const bgBackdropStyle = computed(() => {
  const primary = activeBgUrl.value || currentFallbackBg.value;
  const fallback = currentFallbackBg.value;
  return {
    backgroundImage: primary === fallback
      ? `url("${escapeCssUrl(fallback)}")`
      : `url("${escapeCssUrl(primary)}"), url("${escapeCssUrl(fallback)}")`
  };
});

const bgOverlayStyle = computed(() => ({
  background: buildOverlayBackground(currentOverlayPercent.value, activeTheme.value)
}));

function preloadAndApplyBackground(url, fallbackUrl) {
  const clean = String(url || '').trim() || fallbackUrl;
  const token = ++bgPreloadToken;
  if (clean.startsWith('/backgrounds/')) {
    activeBgUrl.value = clean;
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
      activeBgUrl.value = fallbackUrl;
    }
  };
  probe.src = clean;
}

watch(
  [currentTargetBgUrl, currentFallbackBg],
  ([nextUrl, fallbackUrl]) => {
    preloadAndApplyBackground(nextUrl, fallbackUrl);
  },
  { immediate: true }
);

function switchTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  activeTheme.value = normalized;
  applyRootTheme(normalized);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch {
    // 隐私模式可能禁用 localStorage
  }
}

function handleSystemThemeChange(e) {
  if (readStoredTheme()) return;
  if (appearance.value.default_theme !== 'auto') return;
  const next = e.matches ? 'dark' : 'light';
  activeTheme.value = next;
  applyRootTheme(next);
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
  if (directCount > 0 || subs.length === 0) return 'main';
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

  if (window.matchMedia) {
    colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (colorSchemeQuery.addEventListener) {
      colorSchemeQuery.addEventListener('change', handleSystemThemeChange);
    } else if (colorSchemeQuery.addListener) {
      colorSchemeQuery.addListener(handleSystemThemeChange);
    }
  }

  const [menuRes, allCardsRes, appearanceRes] = await Promise.allSettled([
    getMenus(),
    getFilteredCards(),
    getSiteAppearance()
  ]);
  if (appearanceRes.status === 'fulfilled') {
    const cfg = appearanceRes.value?.data || {};
    appearance.value = {
      day_bg_url: cfg.day_bg_url || DEFAULT_DAY_BG,
      day_bg_overlay: cfg.day_bg_overlay !== undefined ? Number(cfg.day_bg_overlay) : DEFAULT_DAY_OVERLAY,
      night_bg_url: cfg.night_bg_url || cfg.site_bg_url || DEFAULT_NIGHT_BG,
      night_bg_overlay: cfg.night_bg_overlay !== undefined
        ? Number(cfg.night_bg_overlay)
        : (cfg.site_bg_overlay !== undefined ? Number(cfg.site_bg_overlay) : DEFAULT_NIGHT_OVERLAY),
      default_theme: cfg.default_theme || 'auto'
    };
    const stored = readStoredTheme();
    if (!stored) {
      const resolved = appearance.value.default_theme === 'light'
        ? 'light'
        : (appearance.value.default_theme === 'dark' ? 'dark' : getSystemTheme());
      activeTheme.value = resolved;
      applyRootTheme(resolved);
    }
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
  if (colorSchemeQuery) {
    if (colorSchemeQuery.removeEventListener) {
      colorSchemeQuery.removeEventListener('change', handleSystemThemeChange);
    } else if (colorSchemeQuery.removeListener) {
      colorSchemeQuery.removeListener(handleSystemThemeChange);
    }
  }
});
</script>

<style scoped>
/* 夜晚暗色模式（默认）：保持暗色毛玻璃星空质感 */
.home-container {
  --glass-menu-bg: rgba(15, 23, 42, 0.55);
  --glass-menu-border: rgba(255, 255, 255, 0.1);
  --glass-menu-shadow: 0 10px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --menu-text: rgba(226, 232, 240, 0.78);
  --menu-text-hover: #ffffff;
  --menu-hover-bg: rgba(255, 255, 255, 0.08);
  --menu-active-text: #ffffff;
  --menu-active-bg: rgba(255, 255, 255, 0.16);
  --menu-active-border: rgba(255, 255, 255, 0.18);
  --menu-active-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 10px rgba(0, 0, 0, 0.2);

  --card-bg: rgba(15, 23, 42, 0.45);
  --card-blur: 14px;
  --card-border: rgba(255, 255, 255, 0.08);
  --card-shadow: 0 4px 16px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --card-hover-bg: rgba(30, 41, 59, 0.64);
  --card-hover-border: rgba(255, 255, 255, 0.22);
  --card-hover-shadow: 0 12px 28px rgba(0, 0, 0, 0.28), 0 0 20px rgba(129, 140, 248, 0.12);
  --card-title: rgba(255, 255, 255, 0.95);
  --card-desc: rgba(255, 255, 255, 0.6);
  --card-icon-bg: rgba(241, 245, 249, 0.24);
  --card-icon-border: rgba(255, 255, 255, 0.22);
  --card-icon-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 6px rgba(2, 6, 23, 0.16);
  --card-icon-hover-bg: rgba(241, 245, 249, 0.34);
  --card-icon-hover-border: rgba(255, 255, 255, 0.34);
  --card-icon-filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.28));
  --card-cat-text: rgba(199, 210, 254, 0.9);
  --card-cat-bg: rgba(99, 102, 241, 0.22);
  --card-cat-border: rgba(129, 140, 248, 0.26);
  --empty-bg: rgba(15, 23, 42, 0.38);
  --empty-text: rgba(226, 232, 240, 0.74);
  --empty-border: rgba(255, 255, 255, 0.08);

  --engine-text: rgba(226, 232, 240, 0.68);
  --engine-bg: transparent;
  --engine-border: transparent;
  --engine-hover-text: rgba(255, 255, 255, 0.94);
  --engine-hover-bg: rgba(255, 255, 255, 0.09);
  --engine-active-text: #ffffff;
  --engine-active-bg: rgba(255, 255, 255, 0.15);
  --engine-active-border: rgba(255, 255, 255, 0.16);
  --engine-active-shadow: none;

  --search-bg: rgba(15, 23, 42, 0.48);
  --search-border: rgba(255, 255, 255, 0.12);
  --search-shadow: 0 10px 30px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  --search-focus-bg: rgba(15, 23, 42, 0.68);
  --search-focus-border: rgba(165, 180, 252, 0.62);
  --search-focus-shadow: 0 0 0 3px rgba(129, 140, 248, 0.22), 0 14px 36px rgba(0, 0, 0, 0.34);
  --search-icon: rgba(203, 213, 225, 0.64);
  --search-text: #ffffff;
  --search-placeholder: rgba(203, 213, 225, 0.54);

  --shortcut-bg: rgba(255, 255, 255, 0.06);
  --shortcut-border: rgba(255, 255, 255, 0.14);
  --shortcut-text: rgba(203, 213, 225, 0.7);
  --shortcut-hover-bg: rgba(255, 255, 255, 0.15);
  --shortcut-hover-border: rgba(255, 255, 255, 0.26);
  --shortcut-hover-text: #ffffff;

  --clear-text: rgba(226, 232, 240, 0.72);
  --clear-hover-text: #ffffff;
  --clear-hover-bg: rgba(255, 255, 255, 0.12);

  --search-btn-bg: rgba(255, 255, 255, 0.1);
  --search-btn-text: rgba(255, 255, 255, 0.9);
  --search-btn-border: rgba(255, 255, 255, 0.1);
  --search-btn-hover-bg: rgba(129, 140, 248, 0.45);
  --search-btn-hover-border: rgba(165, 180, 252, 0.5);
  --search-btn-hover-text: #ffffff;

  --dropdown-bg: rgba(15, 23, 42, 0.92);
  --dropdown-border: rgba(255, 255, 255, 0.14);
  --dropdown-shadow: 0 20px 48px rgba(0, 0, 0, 0.48);
  --dropdown-header-text: rgba(148, 163, 184, 0.88);
  --dropdown-divider: rgba(255, 255, 255, 0.08);
  --dropdown-item-text: #f8fafc;
  --dropdown-item-hover: rgba(129, 140, 248, 0.24);
  --dropdown-sub-text: rgba(148, 163, 184, 0.9);

  --pill-bg: rgba(15, 23, 42, 0.42);
  --pill-border: rgba(255, 255, 255, 0.09);
  --pill-text: rgba(226, 232, 240, 0.8);
  --pill-hover-bg: rgba(30, 41, 59, 0.62);
  --pill-hover-border: rgba(255, 255, 255, 0.2);
  --pill-hover-text: #ffffff;
  --pill-active-bg: rgba(255, 255, 255, 0.16);
  --pill-active-border: rgba(255, 255, 255, 0.28);
  --pill-active-text: #ffffff;
  --pill-active-shadow: 0 4px 14px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  --pill-count-bg: rgba(255, 255, 255, 0.06);
  --pill-count-text: rgba(226, 232, 240, 0.52);
  --pill-active-count-bg: rgba(255, 255, 255, 0.14);
  --pill-active-count-text: rgba(255, 255, 255, 0.88);

  --status-bg: rgba(15, 23, 42, 0.48);
  --status-border: rgba(255, 255, 255, 0.1);
  --status-text: rgba(241, 245, 249, 0.92);
  --status-btn-bg: rgba(255, 255, 255, 0.08);
  --status-btn-border: rgba(255, 255, 255, 0.18);
  --status-btn-text: #ffffff;
  --status-btn-hover-bg: rgba(255, 255, 255, 0.18);

  --footer-bg: rgba(15, 23, 42, 0.52);
  --footer-border: rgba(255, 255, 255, 0.12);
  --footer-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  --footer-text: rgba(226, 232, 240, 0.72);
  --footer-text-hover: #ffffff;
  --footer-btn-hover-bg: rgba(255, 255, 255, 0.1);
  --footer-btn-active-bg: rgba(255, 255, 255, 0.18);
  --footer-btn-active-text: #ffffff;

  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
  isolation: isolate;
  padding-top: 96px;
  box-sizing: border-box;
}

/* 白天亮色模式：清透白磨砂玻璃 + 高对比度深蓝灰文字 */
.home-container[data-theme='light'] {
  --glass-menu-bg: rgba(255, 255, 255, 0.72);
  --glass-menu-border: rgba(255, 255, 255, 0.8);
  --glass-menu-shadow: 0 8px 28px rgba(15, 23, 42, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --menu-text: #334155;
  --menu-text-hover: #0f172a;
  --menu-hover-bg: rgba(15, 23, 42, 0.06);
  --menu-active-text: #0f172a;
  --menu-active-bg: rgba(255, 255, 255, 0.92);
  --menu-active-border: rgba(15, 23, 42, 0.08);
  --menu-active-shadow: 0 2px 10px rgba(15, 23, 42, 0.08);

  --card-bg: rgba(255, 255, 255, 0.72);
  --card-blur: 16px;
  --card-border: rgba(255, 255, 255, 0.75);
  --card-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
  --card-hover-bg: rgba(255, 255, 255, 0.88);
  --card-hover-border: rgba(255, 255, 255, 0.95);
  --card-hover-shadow: 0 12px 28px rgba(15, 23, 42, 0.14);
  --card-title: #0f172a;
  --card-desc: #475569;
  --card-icon-bg: rgba(241, 245, 249, 0.9);
  --card-icon-border: rgba(15, 23, 42, 0.08);
  --card-icon-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 1px 3px rgba(15, 23, 42, 0.06);
  --card-icon-hover-bg: rgba(255, 255, 255, 0.98);
  --card-icon-hover-border: rgba(15, 23, 42, 0.12);
  --card-icon-filter: none;
  --card-cat-text: #3730a3;
  --card-cat-bg: rgba(99, 102, 241, 0.12);
  --card-cat-border: rgba(99, 102, 241, 0.22);
  --empty-bg: rgba(255, 255, 255, 0.72);
  --empty-text: #475569;
  --empty-border: rgba(255, 255, 255, 0.78);

  --engine-text: #1e293b;
  --engine-bg: rgba(255, 255, 255, 0.56);
  --engine-border: rgba(255, 255, 255, 0.68);
  --engine-hover-text: #0f172a;
  --engine-hover-bg: rgba(255, 255, 255, 0.8);
  --engine-active-text: #0f172a;
  --engine-active-bg: rgba(255, 255, 255, 0.94);
  --engine-active-border: rgba(255, 255, 255, 0.98);
  --engine-active-shadow: 0 3px 12px rgba(15, 23, 42, 0.1);

  --search-bg: rgba(255, 255, 255, 0.76);
  --search-border: rgba(255, 255, 255, 0.84);
  --search-shadow: 0 10px 30px rgba(15, 23, 42, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.92);
  --search-focus-bg: rgba(255, 255, 255, 0.92);
  --search-focus-border: rgba(59, 130, 246, 0.58);
  --search-focus-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18), 0 14px 34px rgba(15, 23, 42, 0.14);
  --search-icon: #475569;
  --search-text: #0f172a;
  --search-placeholder: #64748b;

  --shortcut-bg: rgba(15, 23, 42, 0.05);
  --shortcut-border: rgba(15, 23, 42, 0.12);
  --shortcut-text: #475569;
  --shortcut-hover-bg: rgba(15, 23, 42, 0.1);
  --shortcut-hover-border: rgba(15, 23, 42, 0.2);
  --shortcut-hover-text: #0f172a;

  --clear-text: #475569;
  --clear-hover-text: #0f172a;
  --clear-hover-bg: rgba(15, 23, 42, 0.08);

  --search-btn-bg: rgba(15, 23, 42, 0.07);
  --search-btn-text: #0f172a;
  --search-btn-border: rgba(15, 23, 42, 0.09);
  --search-btn-hover-bg: rgba(59, 130, 246, 0.16);
  --search-btn-hover-border: rgba(59, 130, 246, 0.34);
  --search-btn-hover-text: #1d4ed8;

  --dropdown-bg: rgba(255, 255, 255, 0.95);
  --dropdown-border: rgba(255, 255, 255, 0.92);
  --dropdown-shadow: 0 20px 48px rgba(15, 23, 42, 0.18);
  --dropdown-header-text: #64748b;
  --dropdown-divider: rgba(15, 23, 42, 0.08);
  --dropdown-item-text: #0f172a;
  --dropdown-item-hover: rgba(59, 130, 246, 0.1);
  --dropdown-sub-text: #475569;

  --pill-bg: rgba(255, 255, 255, 0.7);
  --pill-border: rgba(255, 255, 255, 0.78);
  --pill-text: #334155;
  --pill-hover-bg: rgba(255, 255, 255, 0.88);
  --pill-hover-border: rgba(255, 255, 255, 0.95);
  --pill-hover-text: #0f172a;
  --pill-active-bg: rgba(255, 255, 255, 0.95);
  --pill-active-border: rgba(255, 255, 255, 0.98);
  --pill-active-text: #0f172a;
  --pill-active-shadow: 0 4px 14px rgba(15, 23, 42, 0.1);
  --pill-count-bg: rgba(15, 23, 42, 0.07);
  --pill-count-text: #475569;
  --pill-active-count-bg: rgba(59, 130, 246, 0.12);
  --pill-active-count-text: #1d4ed8;

  --status-bg: rgba(255, 255, 255, 0.78);
  --status-border: rgba(255, 255, 255, 0.86);
  --status-text: #0f172a;
  --status-btn-bg: rgba(15, 23, 42, 0.07);
  --status-btn-border: rgba(15, 23, 42, 0.14);
  --status-btn-text: #0f172a;
  --status-btn-hover-bg: rgba(15, 23, 42, 0.12);

  --footer-bg: rgba(255, 255, 255, 0.76);
  --footer-border: rgba(255, 255, 255, 0.85);
  --footer-shadow: 0 6px 20px rgba(15, 23, 42, 0.1);
  --footer-text: #334155;
  --footer-text-hover: #0f172a;
  --footer-btn-hover-bg: rgba(15, 23, 42, 0.07);
  --footer-btn-active-bg: rgba(15, 23, 42, 0.1);
  --footer-btn-active-text: #0f172a;
}

/* 独立固定背景容器与遮罩层：确保移动端与 iOS Safari 上下滑动丝滑无拉伸 */
.bg-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
  transform: translateZ(0);
  transition: background-image 0.28s ease;
}

.bg-overlay {
  position: fixed;
  inset: 0;
  z-index: -1;
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
  max-width: 100%;
}

.engine-btn {
  border: 1px solid var(--engine-border);
  background: var(--engine-bg);
  color: var(--engine-text);
  font-size: 13px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  transition: color 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.engine-btn:hover {
  color: var(--engine-hover-text);
  background: var(--engine-hover-bg);
}

.engine-btn.active {
  color: var(--engine-active-text);
  font-weight: 600;
  background: var(--engine-active-bg);
  border-color: var(--engine-active-border);
  box-shadow: var(--engine-active-shadow);
}

.search-container {
  display: flex;
  align-items: center;
  width: 100%;
  height: 48px;
  padding: 0 6px 0 16px;
  box-sizing: border-box;
  border-radius: 9999px;
  background: var(--search-bg);
  border: 1px solid var(--search-border);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow: var(--search-shadow);
  position: relative;
  transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
}

.search-container.focused {
  background: var(--search-focus-bg);
  border-color: var(--search-focus-border);
  box-shadow: var(--search-focus-shadow);
}

.search-leading-icon {
  display: inline-flex;
  align-items: center;
  color: var(--search-icon);
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
  color: var(--search-text);
  outline: none;
}

.search-input::placeholder {
  color: var(--search-placeholder);
  font-size: 14px;
}

.shortcut-hint {
  border: 1px solid var(--shortcut-border);
  background: var(--shortcut-bg);
  color: var(--shortcut-text);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 9999px;
  cursor: pointer;
  margin-right: 6px;
  white-space: nowrap;
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.shortcut-hint:hover {
  background: var(--shortcut-hover-bg);
  border-color: var(--shortcut-hover-border);
  color: var(--shortcut-hover-text);
}

.clear-btn {
  background: none;
  border: none;
  outline: none;
  cursor: pointer;
  color: var(--clear-text);
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
  color: var(--clear-hover-text);
  background: var(--clear-hover-bg);
}

.search-btn {
  background: var(--search-btn-bg);
  color: var(--search-btn-text);
  border: 1px solid var(--search-btn-border);
  border-radius: 9999px;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
}

.search-btn:hover {
  background: var(--search-btn-hover-bg);
  border-color: var(--search-btn-hover-border);
  color: var(--search-btn-hover-text);
}

/* 实时站内模糊搜索下拉框 */
.search-dropdown {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  right: 0;
  background: var(--dropdown-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--dropdown-border);
  border-radius: 16px;
  box-shadow: var(--dropdown-shadow);
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
  color: var(--dropdown-header-text);
  border-bottom: 1px solid var(--dropdown-divider);
  margin-bottom: 4px;
}

.dropdown-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--dropdown-header-text);
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 8px 10px;
  border-radius: 10px;
  text-decoration: none;
  color: var(--dropdown-item-text);
  transition: background-color 0.14s ease;
}

.dropdown-item:hover,
.dropdown-item.active {
  background: var(--dropdown-item-hover);
}

.dropdown-logo-wrap {
  width: 32px;
  height: 32px;
  padding: 4px;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--card-icon-bg);
  border: 1px solid var(--card-icon-border);
  box-shadow: var(--card-icon-shadow);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dropdown-logo {
  width: 18px;
  height: 18px;
  object-fit: contain;
  filter: var(--card-icon-filter);
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
  color: var(--dropdown-item-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-cat {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--card-cat-bg);
  color: var(--card-cat-text);
  white-space: nowrap;
  flex-shrink: 0;
}

.dropdown-sub {
  font-size: 11.5px;
  color: var(--dropdown-sub-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 横向子菜单胶囊筛选栏（PC 自动居中换行，移动端单行平滑横滑） */
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
  border: 1px solid var(--pill-border);
  background: var(--pill-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  color: var(--pill-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.submenu-pill:hover {
  color: var(--pill-hover-text);
  background: var(--pill-hover-bg);
  border-color: var(--pill-hover-border);
}

.submenu-pill.active {
  color: var(--pill-active-text);
  font-weight: 600;
  background: var(--pill-active-bg);
  border-color: var(--pill-active-border);
  box-shadow: var(--pill-active-shadow);
}

.submenu-pill-count {
  font-size: 11px;
  font-weight: 500;
  color: var(--pill-count-text);
  background: var(--pill-count-bg);
  padding: 1px 6px;
  border-radius: 9999px;
  line-height: 1.3;
}

.submenu-pill.active .submenu-pill-count {
  color: var(--pill-active-count-text);
  background: var(--pill-active-count-bg);
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
  gap: 10px;
  padding: 8px 16px;
  border-radius: 12px;
  background: var(--status-bg);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--status-border);
  color: var(--status-text);
  font-size: 13px;
  box-sizing: border-box;
}

.reset-search-btn {
  border: 1px solid var(--status-btn-border);
  background: var(--status-btn-bg);
  color: var(--status-btn-text);
  font-size: 12px;
  padding: 4px 11px;
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background-color 0.18s ease;
}

.reset-search-btn:hover {
  background: var(--status-btn-hover-bg);
}

.cards-main {
  position: relative;
  z-index: 2;
  padding-bottom: 1.5rem;
}

/* 底部页脚胶囊（居中、轻量毛玻璃、安全区适配） */
.footer {
  margin-top: auto;
  text-align: center;
  padding: 2rem 16px calc(1.4rem + env(safe-area-inset-bottom, 0px));
  position: relative;
  z-index: 2;
}

.footer-capsule {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 14px;
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
  border-radius: 9999px;
  background: var(--footer-bg);
  border: 1px solid var(--footer-border);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: var(--footer-shadow);
  color: var(--footer-text);
  font-size: 12px;
  letter-spacing: 0.4px;
  transition: background-color 0.24s ease, border-color 0.24s ease, color 0.24s ease;
}

.copyright {
  margin: 0;
  font-weight: 600;
}

.footer-sep {
  opacity: 0.5;
  user-select: none;
}

.footer-theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.footer-theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 0;
  background: transparent;
  color: var(--footer-text);
  font-size: 12px;
  font-weight: 500;
  padding: 3px 8px;
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.18s ease, background-color 0.18s ease;
}

.footer-theme-btn:hover {
  color: var(--footer-text-hover);
  background: var(--footer-btn-hover-bg);
}

.footer-theme-btn.active {
  color: var(--footer-btn-active-text);
  font-weight: 600;
  background: var(--footer-btn-active-bg);
}

.footer-theme-slash {
  opacity: 0.4;
  user-select: none;
  font-size: 11px;
}

.footer-admin-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--footer-text);
  text-decoration: none;
  padding: 3px 8px;
  border-radius: 9999px;
  white-space: nowrap;
  transition: color 0.2s ease, background-color 0.2s ease;
}

.footer-admin-link:hover {
  color: var(--footer-text-hover);
  background: var(--footer-btn-hover-bg);
}

.footer-admin-icon {
  transition: transform 0.28s ease;
}

.footer-admin-link:hover .footer-admin-icon {
  transform: rotate(35deg);
}

/* 移动端响应式优化 */
@media (max-width: 768px) {
  .home-container {
    padding-top: 74px;
  }

  .top-bar {
    top: 12px;
    padding: 0 12px;
  }

  .search-section {
    padding: 1.15rem 12px 1.2rem;
  }

  .search-engine-select {
    flex-wrap: nowrap;
    overflow-x: auto;
    justify-content: center;
    gap: 4px;
    margin-bottom: 10px;
    scrollbar-width: none;
    -ms-overflow-style: none;
    -webkit-overflow-scrolling: touch;
  }

  .search-engine-select::-webkit-scrollbar {
    display: none;
  }

  .engine-btn {
    font-size: 12px;
    padding: 4px 10px;
  }

  .search-container {
    height: 44px;
    padding: 0 5px 0 14px;
  }

  /* 移动端单行横向平滑滚动，不折行挤占首屏 */
  .submenu-pill-bar {
    width: calc(100vw - 24px);
    margin-bottom: 14px;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    -ms-overflow-style: none;
    padding-bottom: 2px;
  }

  .submenu-pill-bar::-webkit-scrollbar {
    display: none;
  }

  .submenu-pill {
    padding: 5px 11px;
    font-size: 12.5px;
  }

  .search-status-bar {
    width: calc(100vw - 24px);
    padding: 8px 12px;
    font-size: 12.5px;
  }
}

@media (max-width: 640px) {
  .shortcut-hint,
  .dropdown-keys {
    display: none;
  }

  .search-section {
    padding: 0.95rem 12px 1.05rem;
  }

  .search-input {
    font-size: 14px;
  }

  .search-input::placeholder {
    font-size: 13px;
  }

  .footer {
    padding: 1.5rem 12px calc(1.2rem + env(safe-area-inset-bottom, 0px));
  }

  .footer-capsule {
    padding: 6px 11px;
    gap: 4px;
    font-size: 11.5px;
  }

  .footer-theme-btn,
  .footer-admin-link {
    padding: 3px 6px;
    font-size: 11.5px;
  }
}
</style>
