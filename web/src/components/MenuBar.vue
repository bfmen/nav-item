<template>
  <nav class="menu-bar">
    <div
      v-for="menu in menus"
      :key="menu.id"
      class="menu-item"
      @mouseenter="showSubMenu(menu.id)"
      @mouseleave="hideSubMenu(menu.id)"
    >
      <button
        type="button"
        @click="onSelectMain(menu)"
        :class="{ active: menu.id === activeId }"
      >
        <span>{{ menu.name }}</span>
        <span v-if="menu.subMenus && menu.subMenus.length > 0" class="caret" aria-hidden="true">▾</span>
      </button>

      <!-- 二级菜单：深色毛玻璃 + 最大高度滚动，防止子菜单过多溢出屏幕 -->
      <div
        v-if="menu.subMenus && menu.subMenus.length > 0"
        class="sub-menu"
        :class="{ show: hoveredMenuId === menu.id }"
      >
        <button
          v-for="subMenu in menu.subMenus"
          :key="subMenu.id"
          type="button"
          @click="onSelectSub(subMenu, menu)"
          :class="{ active: subMenu.id === activeSubMenuId }"
          class="sub-menu-item"
        >
          {{ subMenu.name }}
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  menus: {
    type: Array,
    default: () => []
  },
  activeId: Number,
  activeSubMenuId: Number
});

const emit = defineEmits(['select']);
const hoveredMenuId = ref(null);
let hideTimer = null;

function showSubMenu(menuId) {
  window.clearTimeout(hideTimer);
  hoveredMenuId.value = menuId;
}

function hideSubMenu(menuId) {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (hoveredMenuId.value === menuId) {
      hoveredMenuId.value = null;
    }
  }, 120);
}

function onSelectMain(menu) {
  hoveredMenuId.value = null;
  emit('select', menu);
}

function onSelectSub(subMenu, menu) {
  hoveredMenuId.value = null;
  emit('select', subMenu, menu);
}
</script>

<style scoped>
.menu-bar {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  padding: 0 3.2rem;
  gap: 2px;
  position: relative;
}

.menu-item {
  position: relative;
}

.menu-bar > .menu-item > button {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.94);
  font-size: 15px;
  font-weight: 500;
  padding: 0.72rem 1.35rem;
  cursor: pointer;
  transition: color 0.2s ease, transform 0.2s ease;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  box-shadow: none;
  border-radius: 8px;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.caret {
  font-size: 11px;
  opacity: 0.7;
  line-height: 1;
}

.menu-bar > .menu-item > button::before {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  width: 0;
  height: 2px;
  background: #60a5fa;
  border-radius: 2px;
  transition: width 0.22s ease;
  transform: translateX(-50%);
}

.menu-bar > .menu-item > button:hover,
.menu-bar > .menu-item > button.active {
  color: #60a5fa;
}

.menu-bar > .menu-item > button.active::before {
  width: 58%;
}

/* 深色毛玻璃二级菜单 + 独立滚动条 */
.sub-menu {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(-4px);
  background: rgba(15, 23, 42, 0.88);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-radius: 10px;
  min-width: 156px;
  max-width: 240px;
  max-height: 68vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
  z-index: 1000;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.16);
  margin-top: 2px;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.45) transparent;
}

.sub-menu::-webkit-scrollbar {
  width: 5px;
}

.sub-menu::-webkit-scrollbar-track {
  background: transparent;
}

.sub-menu::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.45);
  border-radius: 999px;
}

.sub-menu.show {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(2px);
}

.sub-menu-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: rgba(241, 245, 249, 0.92);
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  border-radius: 6px;
  text-shadow: none;
  line-height: 1.45;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub-menu-item:hover {
  background: rgba(59, 130, 246, 0.25);
  color: #93c5fd;
}

.sub-menu-item.active {
  background: rgba(59, 130, 246, 0.36);
  color: #ffffff;
  font-weight: 600;
}

@media (max-width: 768px) {
  .menu-bar {
    gap: 0.15rem;
    padding: 0 2.6rem 0 0.6rem;
  }

  .menu-bar > .menu-item > button {
    font-size: 13px;
    padding: 0.45rem 0.72rem;
  }

  .sub-menu {
    min-width: 128px;
    max-height: 55vh;
  }

  .sub-menu-item {
    font-size: 12px;
    padding: 6px 10px;
  }
}
</style>
