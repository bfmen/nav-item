<template>
  <div class="container card-grid" :class="{ 'animate-fadeUp': animating }">
    <div
      v-for="(card, index) in cards"
      :key="card.id"
      :data-card-id="card.id"
      class="link-item"
      :style="getCardStyle(index)"
    >
      <a :href="card.url" target="_blank" rel="noopener noreferrer">
        <div class="icon-badge">
          <CardLogo class="link-icon" :card="card" />
        </div>
        <span class="link-text">{{ card.title }}</span>
      </a>

      <!-- 优雅悬停 Tooltip：完整标题 + AI 中文描述 + 域名 -->
      <div class="card-tooltip" role="tooltip">
        <div class="tooltip-title">{{ card.title }}</div>
        <div v-if="card.desc" class="tooltip-desc">{{ card.desc }}</div>
        <div class="tooltip-meta">
          <span v-if="showCategory && (card.menu_name || card.sub_menu_name)" class="tooltip-cat">
            {{ card.menu_name }}<template v-if="card.sub_menu_name"> / {{ card.sub_menu_name }}</template>
          </span>
          <span class="tooltip-host">{{ formatHost(card.url) }}</span>
        </div>
      </div>
    </div>

    <div v-if="!cards || cards.length === 0" class="empty-grid-hint">
      暂无匹配的导航卡片
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';
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
let animTimer = null;

watch(
  () => (props.cards || []).map(c => c.id).join(','),
  (nextIds, prevIds) => {
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
  background: rgba(15, 23, 42, 0.34);
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
  z-index: 30;
  background: rgba(255, 255, 255, 0.24);
  border-color: rgba(255, 255, 255, 0.35);
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

/* 图标浅色半透明圆角底衬：避免深色图标（如 GitHub）在深色背景中看不清 */
.icon-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.18s ease, background-color 0.18s ease;
}

.link-item:hover .icon-badge {
  transform: scale(1.06);
  background: rgba(255, 255, 255, 0.98);
}

.link-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
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

/* 悬停 Tooltip */
.card-tooltip {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  transform: translateX(-50%) translateY(6px);
  width: max-content;
  min-width: 170px;
  max-width: 260px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.94);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
  color: #f8fafc;
  text-align: left;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
  z-index: 60;
}

.card-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: rgba(15, 23, 42, 0.94);
}

.link-item:hover .card-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

.tooltip-title {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.35;
  word-break: keep-all;
  overflow-wrap: break-word;
}

.tooltip-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #cbd5e1;
  line-height: 1.45;
  word-break: break-word;
}

.tooltip-meta {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #94a3b8;
}

.tooltip-cat {
  background: rgba(59, 130, 246, 0.24);
  color: #93c5fd;
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 500;
}

.tooltip-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
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
  .card-tooltip {
    display: none;
  }

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
