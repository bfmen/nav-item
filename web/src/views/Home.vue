<template>
  <div class="home-container">
    <!-- 右上角低调半透明后台入口 -->
    <router-link to="/admin" class="admin-entry-btn" title="进入后台管理" aria-label="进入后台管理">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </router-link>

    <div class="menu-bar-fixed">
      <MenuBar
        :menus="menus"
        :activeId="activeMenu?.id"
        :activeSubMenuId="activeSubMenu?.id"
        @select="selectMenu"
      />
    </div>

    <div :class="['search-section', { 'dropdown-open': showDropdown }]">
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
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            :placeholder="selectedEngine.placeholder"
            class="search-input"
            @focus="onSearchFocus"
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <button type="button" @click="handleSearch" class="search-btn" title="搜索">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
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
    </div>

    <div v-if="isGlobalSearching" class="search-status-bar">
      <span>全站搜索 “{{ searchQuery.trim() }}”：共找到 <strong>{{ globalMatches.length }}</strong> 张卡片</span>
      <button type="button" class="reset-search-btn" @click="clearSearch">返回当前分类</button>
    </div>

    <CardGrid :cards="displayedCards" :showCategory="isGlobalSearching" />

    <footer class="footer">
      <div class="footer-content">
        <p class="copyright">Nav-Item</p>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { getMenus, getCards, getFilteredCards } from '../api';
import MenuBar from '../components/MenuBar.vue';
import CardGrid from '../components/CardGrid.vue';
import CardLogo from '../components/CardLogo.vue';

const menus = ref([]);
const activeMenu = ref(null);
const activeSubMenu = ref(null);
const cards = ref([]);
const allCards = ref([]);
const searchQuery = ref('');
const searchFocused = ref(false);
const dropdownOpen = ref(false);
const selectedMatchIndex = ref(0);
const searchInputRef = ref(null);
const searchWrapperRef = ref(null);

const searchEngines = [
  {
    name: 'site',
    label: '站内',
    placeholder: '实时模糊搜全站卡片（按 / 或 ⌘K 聚焦）...',
    url: q => `/search?query=${encodeURIComponent(q)}`
  },
  {
    name: 'google',
    label: 'Google',
    placeholder: 'Google 搜索（输入时同步筛选站内卡片）...',
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
const selectedEngine = ref(searchEngines[1]); // 默认 Google，按 / 或 Cmd+K 立即切站内直达

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

async function selectMenu(menu, parentMenu = null) {
  clearSearch();
  if (parentMenu) {
    activeMenu.value = parentMenu;
    activeSubMenu.value = menu;
  } else {
    activeMenu.value = menu;
    activeSubMenu.value = null;
  }
  await loadCards();
}

async function loadCards() {
  if (!activeMenu.value) return;
  const res = await getCards(activeMenu.value.id, activeSubMenu.value?.id);
  cards.value = res.data || [];
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown);
  document.addEventListener('click', handleDocumentClick);

  const [menuRes, allCardsRes] = await Promise.allSettled([getMenus(), getFilteredCards()]);
  if (menuRes.status === 'fulfilled') {
    menus.value = menuRes.value.data || [];
    if (menus.value.length) {
      activeMenu.value = menus.value[0];
      await loadCards();
    }
  }
  if (allCardsRes.status === 'fulfilled') {
    allCards.value = allCardsRes.value.data || [];
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<style scoped>
.admin-entry-btn {
  position: fixed;
  top: 14px;
  right: 18px;
  z-index: 140;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.58);
  background: rgba(15, 23, 42, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  text-decoration: none;
  transition: color 0.2s ease, background-color 0.2s ease, transform 0.28s ease, border-color 0.2s ease;
}

.admin-entry-btn:hover {
  color: #ffffff;
  background: rgba(15, 23, 42, 0.68);
  border-color: rgba(255, 255, 255, 0.34);
  transform: rotate(35deg);
}

.menu-bar-fixed {
  position: fixed;
  top: 0.6rem;
  left: 0;
  width: 100vw;
  z-index: 100;
}

.search-engine-select {
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-bottom: 0.4rem;
  gap: 6px;
  z-index: 2;
}

.engine-btn {
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.84rem;
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;
}

.engine-btn.active,
.engine-btn:hover {
  color: #60a5fa;
  background: rgba(255, 255, 255, 0.14);
}

.search-container {
  display: flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 22px;
  padding: 0.28rem 0.35rem 0.28rem 0.85rem;
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  max-width: 520px;
  width: 92%;
  position: relative;
  transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
}

.search-container.focused {
  background: rgba(15, 23, 42, 0.64);
  border-color: rgba(96, 165, 250, 0.68);
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3);
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  padding: 0.3rem 0.35rem;
  font-size: 1rem;
  color: #ffffff;
  outline: none;
}

.search-input::placeholder {
  color: rgba(226, 232, 240, 0.65);
  font-size: 0.92rem;
}

.shortcut-hint {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(226, 232, 240, 0.76);
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 6px;
  cursor: pointer;
  margin-right: 4px;
  white-space: nowrap;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.shortcut-hint:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
}

.clear-btn {
  background: none;
  border: none;
  outline: none;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.78);
  margin-right: 0.15rem;
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 50%;
}

.clear-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

.search-btn {
  background: transparent;
  color: #ffffff;
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.2s ease;
  flex-shrink: 0;
}

.search-btn:hover {
  background: rgba(59, 130, 246, 0.55);
}

/* 实时搜索下拉列表 */
.search-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45);
  padding: 6px;
  z-index: 120;
  max-height: 380px;
  overflow-y: auto;
}

.dropdown-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 10px 7px;
  font-size: 11px;
  color: #94a3b8;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 4px;
}

.dropdown-keys {
  opacity: 0.85;
}

.dropdown-empty {
  padding: 14px 12px;
  text-align: center;
  font-size: 13px;
  color: #94a3b8;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 9px;
  text-decoration: none;
  color: #f8fafc;
  transition: background-color 0.14s ease;
}

.dropdown-item:hover,
.dropdown-item.active {
  background: rgba(59, 130, 246, 0.28);
}

.dropdown-logo-wrap {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(226, 232, 240, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.16);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dropdown-logo {
  width: 18px;
  height: 18px;
  object-fit: contain;
  filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.3));
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
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.24);
  color: #93c5fd;
  white-space: nowrap;
  flex-shrink: 0;
}

.dropdown-sub {
  font-size: 11.5px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-status-bar {
  position: relative;
  z-index: 2;
  max-width: 58rem;
  width: 94%;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 14px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: rgba(241, 245, 249, 0.92);
  font-size: 13px;
  box-sizing: border-box;
}

.reset-search-btn {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.reset-search-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.home-container {
  min-height: 100vh;
  background-image: url('https://main.ssss.nyc.mn/background.webp');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-attachment: fixed;
  display: flex;
  flex-direction: column;
  position: relative;
  padding-top: 72px;
  box-sizing: border-box;
}

.home-container::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.34);
  z-index: 1;
}

.search-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-top: 0.75rem;
  padding: 2.5rem 0 2.1rem;
  position: relative;
  z-index: 20;
}

.search-section.dropdown-open {
  z-index: 90;
}

.search-box-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 520px;
}

.footer {
  margin-top: auto;
  text-align: center;
  padding: 1.8rem 0 1.5rem;
  position: relative;
  z-index: 2;
}

.footer-content {
  display: flex;
  align-items: center;
  justify-content: center;
}

.copyright {
  color: rgba(255, 255, 255, 0.56);
  font-size: 12.5px;
  letter-spacing: 0.6px;
  margin: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

:deep(.menu-bar) {
  position: relative;
  z-index: 2;
}

:deep(.card-grid) {
  position: relative;
  z-index: 2;
}

@media (max-width: 768px) {
  .home-container {
    padding-top: 72px;
  }

  .admin-entry-btn {
    top: 10px;
    right: 10px;
    width: 30px;
    height: 30px;
  }

  .shortcut-hint,
  .dropdown-keys {
    display: none;
  }

  .search-section {
    padding: 1.6rem 0 1.2rem;
  }
}
</style>
