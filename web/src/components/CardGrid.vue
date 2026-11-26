<template>
  <div class="container card-grid" :class="{ 'animate-fadeUp': animating }">
    <div
      v-for="(card, index) in cards"
      :key="card.id"
      :data-card-id="card.id"
      class="link-item"
      :style="getCardStyle(index)"
      @mouseenter="showTooltip($event, card)"
      @mouseleave="hideTooltip"
    >
      <a :href="card.url" target="_blank" rel="noopener noreferrer" @focus="showTooltip($event, card)" @blur="hideTooltip">
        <div class="icon-badge">
          <CardLogo class="link-icon" :card="card" />
        </div>
        <span class="link-text">{{ card.title }}</span>
      </a>
    </div>

    <div v-if="!cards || cards.length === 0" class="empty-grid-hint">
      暂无匹配的导航卡片
    </div>

    <!-- Teleport 到 body 动态定位的悬停 Tooltip，绝不被搜索框或父容器层叠上下文遮挡 -->
    <Teleport to="body">
      <div
        v-if="activeTooltip"
        :class="['floating-card-tooltip', `placement-${activeTooltip.placement}`]"
        :style="activeTooltip.style"
        role="tooltip"
      >
        <div class="tooltip-title">{{ activeTooltip.card.title }}</div>
        <div v-if="activeTooltip.card.desc" class="tooltip-desc">{{ activeTooltip.card.desc }}</div>
        <div class="tooltip-meta">
          <span v-if="showCategory && (activeTooltip.card.menu_name || activeTooltip.card.sub_menu_name)" class="tooltip-cat">
            {{ activeTooltip.card.menu_name }}<template v-if="activeTooltip.card.sub_menu_name"> / {{ activeTooltip.card.sub_menu_name }}</template>
          </span>
          <span class="tooltip-host">{{ formatHost(activeTooltip.card.url) }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import CardLogo from './CardLogo.vue';

const props = defineProps({
  cards: {
    type: Array,
    default: () => []
  },
  showCategory: {
    type: Boolean,
    default: false
  }
});

const animating = ref(false);
const activeTooltip = ref(null);
let animTimer = null;

watch(
  () => (props.cards || []).map(c => c.id).join(','),
  (nextIds, prevIds) => {
    activeTooltip.value = null;
    if (!nextIds || nextIds === prevIds) return;
    nextTick(() => {
      animating.value = false;
      window.clearTimeout(animTimer);
      requestAnimationFrame(() => {
        animating.value = true;
        animTimer = window.setTimeout(() => {
          animating.value = false;
        }, 420);
      });
    });
  }
);

function showTooltip(event, card) {
  if (typeof window === 'undefined' || window.innerWidth <= 768) return;
  const el = event.currentTarget?.closest?.('.link-item') || event.currentTarget;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const halfMaxWidth = 140;
  const centerX = Math.min(Math.max(halfMaxWidth, rect.left + rect.width / 2), window.innerWidth - halfMaxWidth);
  // 靠近顶部导航栏时自动向下弹出，其余情况向上弹出；通过 Teleport + z-index: 80 彻底避免被搜索框遮挡
  const preferBottom = rect.top < 155;
  const top = preferBottom ? rect.bottom + 10 : rect.top - 10;

  activeTooltip.value = {
    card,
    placement: preferBottom ? 'bottom' : 'top',
    style: {
      left: `${centerX}px`,
      top: `${top}px`
    }
  };
}

function hideTooltip() {
  activeTooltip.value = null;
}

onMounted(() => {
  window.addEventListener('scroll', hideTooltip, { passive: true });
  window.addEventListener('resize', hideTooltip, { passive: true });
});

onBeforeUnmount(() => {
  window.clearTimeout(animTimer);
  window.removeEventListener('scroll', hideTooltip);
  window.removeEventListener('resize', hideTooltip);
});

function getCardStyle(index) {
  if (!animating.value) return {};
  const delay = Math.min(index * 0.015, 0.18);
  return { animationDelay: `${delay}s` };
}

function formatHost(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return url;
  }
}
</script>

<style scoped>
.container {
  max-width: 58rem;
  margin: 0 auto;
  width: 94%;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
  opacity: 1;
}

@media (max-width: 1200px) {
  .container {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .container {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 94%;
  }
}

.link-item {
  position: relative;
  z-index: 1;
  background: rgba(15, 23, 42, 0.36);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  padding: 0;
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.14);
  text-align: center;
  min-height: 92px;
  height: 92px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.link-item:hover {
  z-index: 10;
  background: rgba(255, 255, 255, 0.22);
  border-color: rgba(255, 255, 255, 0.34);
  transform: translateY(-3px);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.24);
}

.link-item a {
  text-decoration: none;
  color: #ffffff;
  font-weight: 500;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  height: 100%;
  padding: 8px 8px 6px;
  box-sizing: border-box;
}

/* 柔和中性半透明磨砂衬底：兼顾深色图标（如 GitHub）与浅色/白色图标（如 Hexa Watch）清晰度 */
.icon-badge {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(226, 232, 240, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 2px 6px rgba(0, 0, 0, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.18s ease, background-color 0.18s ease, border-color 0.18s ease;
}

.link-item:hover .icon-badge {
  transform: scale(1.06);
  background: rgba(226, 232, 240, 0.32);
  border-color: rgba(255, 255, 255, 0.32);
}

.link-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.32));
}

/* 修复英文单词断行问题（不再使用 word-break: break-all） */
.link-text {
  padding: 0 2px;
  font-size: 13px;
  text-align: center;
  word-break: keep-all;
  overflow-wrap: break-word;
  hyphens: auto;
  max-width: 100%;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  line-height: 1.3;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}

.empty-grid-hint {
  grid-column: 1 / -1;
  text-align: center;
  padding: 2.5rem 1rem;
  color: rgba(255, 255, 255, 0.78);
  font-size: 14px;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(8px);
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.animate-fadeUp .link-item {
  animation: fadeUpQuick 0.24s ease-out both;
}

@keyframes fadeUpQuick {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .link-item {
    min-height: 86px;
    height: 86px;
  }

  .link-text {
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-fadeUp .link-item {
    animation: none;
  }
}
</style>

<style>
/* 全局 Teleport 悬停 Tooltip：层级 z-index: 80（低于顶部导航 100，高于搜索区 20 与普通卡片 1） */
.floating-card-tooltip {
  position: fixed;
  z-index: 80;
  width: max-content;
  min-width: 176px;
  max-width: 268px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.44);
  color: #f8fafc;
  text-align: left;
  pointer-events: none;
  animation: tooltipFadeIn 0.14s ease-out both;
}

.floating-card-tooltip.placement-top {
  transform: translate(-50%, -100%);
}

.floating-card-tooltip.placement-top::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(15, 23, 42, 0.95);
}

.floating-card-tooltip.placement-bottom {
  transform: translate(-50%, 0);
}

.floating-card-tooltip.placement-bottom::after {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-bottom-color: rgba(15, 23, 42, 0.95);
}

.floating-card-tooltip .tooltip-title {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.35;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.floating-card-tooltip .tooltip-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.45;
  word-break: break-word;
}

.floating-card-tooltip .tooltip-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #94a3b8;
}

.floating-card-tooltip .tooltip-cat {
  background: rgba(59, 130, 246, 0.24);
  color: #93c5fd;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 500;
}

.floating-card-tooltip .tooltip-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 230px;
}

@keyframes tooltipFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
