<template>
  <div class="card-grid" :class="{ 'animate-fadeUp': animating }">
    <a
      v-for="(card, index) in cards"
      :key="card.id"
      :data-card-id="card.id"
      :href="card.url"
      target="_blank"
      rel="noopener noreferrer"
      :title="getNativeTitle(card)"
      class="card-item"
      :style="getCardStyle(index)"
    >
      <div class="icon-badge">
        <CardLogo class="link-icon" :card="card" />
      </div>
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">{{ card.title }}</span>
          <span v-if="showCategory && getCategoryLabel(card)" class="card-cat-tag">
            {{ getCategoryLabel(card) }}
          </span>
        </div>
        <div class="card-desc">{{ card.desc || formatHost(card.url) }}</div>
      </div>
    </a>

    <div v-if="!cards || cards.length === 0" class="empty-grid-hint">
      暂无匹配的导航卡片
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
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
        }, 380);
      });
    });
  }
);

onBeforeUnmount(() => {
  window.clearTimeout(animTimer);
});

function getCardStyle(index) {
  if (!animating.value) return {};
  const delay = Math.min(index * 0.012, 0.16);
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

function getCategoryLabel(card) {
  if (card.sub_menu_name) return card.sub_menu_name;
  if (card.menu_name) return card.menu_name;
  return '';
}

function getNativeTitle(card) {
  const parts = [card.title];
  if (card.desc) parts.push(card.desc);
  if (card.url) parts.push(card.url);
  return parts.join('\n');
}
</script>

<style scoped>
.card-grid {
  width: min(92vw, 1240px);
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  box-sizing: border-box;
}

@media (min-width: 1480px) {
  .card-grid {
    width: min(90vw, 1380px);
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

@media (max-width: 1120px) {
  .card-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .card-grid {
    width: 94vw;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
}

@media (max-width: 520px) {
  .card-grid {
    width: calc(100vw - 24px);
    grid-template-columns: 1fr;
    gap: 10px;
  }
}

/* 横向信息卡片：白天清透白磨砂 / 夜晚暗色毛玻璃自适应 */
.card-item {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 74px;
  padding: 12px 14px;
  box-sizing: border-box;
  border-radius: 14px;
  text-decoration: none;
  color: var(--card-title, #f8fafc);
  background: var(--card-bg, rgba(15, 23, 42, 0.45));
  backdrop-filter: blur(var(--card-blur, 14px));
  -webkit-backdrop-filter: blur(var(--card-blur, 14px));
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
  box-shadow: var(--card-shadow, 0 4px 16px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.04));
  transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  min-width: 0;
}

.card-item:hover {
  transform: translateY(-2px);
  background: var(--card-hover-bg, rgba(30, 41, 59, 0.62));
  border-color: var(--card-hover-border, rgba(255, 255, 255, 0.22));
  box-shadow: var(--card-hover-shadow, 0 12px 28px rgba(0, 0, 0, 0.28), 0 0 20px rgba(129, 140, 248, 0.1));
}

.icon-badge {
  width: 40px;
  height: 40px;
  padding: 6px;
  box-sizing: border-box;
  border-radius: 10px;
  background: var(--card-icon-bg, rgba(241, 245, 249, 0.24));
  border: 1px solid var(--card-icon-border, rgba(255, 255, 255, 0.22));
  box-shadow: var(--card-icon-shadow, inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 2px 6px rgba(2, 6, 23, 0.16));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.card-item:hover .icon-badge {
  background: var(--card-icon-hover-bg, rgba(241, 245, 249, 0.34));
  border-color: var(--card-icon-hover-border, rgba(255, 255, 255, 0.34));
  transform: scale(1.04);
}

.link-icon {
  width: 22px;
  height: 22px;
  object-fit: contain;
  display: block;
  filter: var(--card-icon-filter, drop-shadow(0 1px 2px rgba(15, 23, 42, 0.28)));
}

.card-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  text-align: left;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.card-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--card-title, rgba(255, 255, 255, 0.95));
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-cat-tag {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--card-cat-text, rgba(199, 210, 254, 0.88));
  background: var(--card-cat-bg, rgba(99, 102, 241, 0.22));
  border: 1px solid var(--card-cat-border, rgba(129, 140, 248, 0.24));
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 82px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-desc {
  font-size: 12px;
  color: var(--card-desc, rgba(255, 255, 255, 0.58));
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-grid-hint {
  grid-column: 1 / -1;
  text-align: center;
  padding: 2.6rem 1rem;
  color: var(--empty-text, rgba(226, 232, 240, 0.7));
  font-size: 14px;
  background: var(--empty-bg, rgba(15, 23, 42, 0.36));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 14px;
  border: 1px solid var(--empty-border, rgba(255, 255, 255, 0.08));
}

.animate-fadeUp .card-item {
  animation: fadeUpQuick 0.22s ease-out both;
}

@keyframes fadeUpQuick {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 768px) {
  .card-item {
    height: 68px;
    padding: 10px 12px;
    gap: 10px;
  }

  .icon-badge {
    width: 36px;
    height: 36px;
    padding: 5px;
    border-radius: 9px;
  }

  .link-icon {
    width: 20px;
    height: 20px;
  }

  .card-title {
    font-size: 13.5px;
  }

  .card-desc {
    font-size: 11.5px;
  }
}

@media (max-width: 520px) {
  .card-item {
    height: auto;
    min-height: 68px;
    padding: 12px 14px;
    gap: 12px;
  }

  .icon-badge {
    width: 40px;
    height: 40px;
    padding: 6px;
    border-radius: 10px;
  }

  .link-icon {
    width: 22px;
    height: 22px;
  }

  .card-title {
    font-size: 14px;
  }

  .card-desc {
    font-size: 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-fadeUp .card-item {
    animation: none;
  }
}
</style>
