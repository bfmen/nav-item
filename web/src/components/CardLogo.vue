<template>
  <img ref="image" :src="DEFAULT_LOGO" alt="" referrerpolicy="no-referrer" decoding="async">
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { DEFAULT_LOGO, getCardLogoSources, loadCardLogo } from '../utils/cardLogo.mjs';

const props = defineProps({ card: { type: Object, required: true } });
const image = ref(null);
let observer;
let stopLoading;

function cleanup() {
  observer?.disconnect();
  observer = undefined;
  stopLoading?.();
  stopLoading = undefined;
}

function setup() {
  cleanup();
  if (!image.value) return;
  const sources = getCardLogoSources(props.card);
  image.value.src = DEFAULT_LOGO;
  const start = () => { stopLoading = loadCardLogo(image.value, sources); };

  // 接近可见区域才开始请求和超时计时，避免离屏卡片提前耗尽重试。
  if (typeof IntersectionObserver === 'undefined') {
    start();
    return;
  }
  const currentObserver = new IntersectionObserver(entries => {
    if (observer !== currentObserver || !entries.some(entry => entry.isIntersecting)) return;
    currentObserver.disconnect();
    observer = undefined;
    start();
  }, { rootMargin: '150px' });
  observer = currentObserver;
  observer.observe(image.value);
}

// 搜索过滤或动画重渲染不重试已失败的源；编辑 Logo/网址时才重新加载。
watch(() => JSON.stringify(getCardLogoSources(props.card)), setup, { flush: 'post' });
onMounted(setup);
onBeforeUnmount(cleanup);
</script>
