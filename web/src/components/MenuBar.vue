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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  max-width: calc(100vw - 140px);
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.menu-bar::-webkit-scrollbar {
  display: none;
}

.menu-pill {
  position: relative;
  border: 1px solid transparent;
  background: transparent;
  color: rgba(226, 232, 240, 0.78);
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
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}

.menu-pill.active {
  color: #ffffff;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 10px rgba(0, 0, 0, 0.2);
}

@media (max-width: 768px) {
  .menu-bar {
    justify-content: flex-start;
    max-width: calc(100vw - 96px);
    padding: 5px 7px;
    gap: 2px;
  }

  .menu-pill {
    font-size: 13px;
    padding: 6px 12px;
  }
}
</style>
