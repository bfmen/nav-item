<template>
  <nav class="menu-bar" aria-label="主导航">
    <button
      v-for="menu in menus"
      :key="menu.id"
      type="button"
      class="menu-pill"
      :class="{ active: menu.id === activeId }"
      @click="$emit('select', menu)"
    >
      {{ menu.name }}
    </button>
  </nav>
</template>

<script setup>
defineProps({
  menus: {
    type: Array,
    default: () => []
  },
  activeId: Number
});

defineEmits(['select']);
</script>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  padding: 6px 10px;
  width: fit-content;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  background: var(--glass-menu-bg, rgba(15, 23, 42, 0.55));
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid var(--glass-menu-border, rgba(255, 255, 255, 0.1));
  border-radius: 9999px;
  box-shadow: var(--glass-menu-shadow, 0 10px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08));
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  transition: background-color 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease;
}

.menu-bar::-webkit-scrollbar {
  display: none;
}

.menu-pill {
  position: relative;
  border: 1px solid transparent;
  background: transparent;
  color: var(--menu-text, rgba(226, 232, 240, 0.78));
  font-size: 14px;
  font-weight: 500;
  padding: 7px 16px;
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  letter-spacing: 0.2px;
  transition: color 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.menu-pill:hover {
  color: var(--menu-text-hover, #ffffff);
  background: var(--menu-hover-bg, rgba(255, 255, 255, 0.08));
}

.menu-pill.active {
  color: var(--menu-active-text, #ffffff);
  font-weight: 600;
  background: var(--menu-active-bg, rgba(255, 255, 255, 0.16));
  border-color: var(--menu-active-border, rgba(255, 255, 255, 0.18));
  box-shadow: var(--menu-active-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 10px rgba(0, 0, 0, 0.2));
}

@media (max-width: 768px) {
  .menu-bar {
    max-width: calc(100vw - 24px);
    padding: 5px 8px;
    gap: 2px;
  }

  .menu-pill {
    font-size: 13px;
    padding: 6px 13px;
  }
}
</style>
