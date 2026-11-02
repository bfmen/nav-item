export const DEFAULT_LOGO = '/default-favicon.png';
export const GOOGLE_TIMEOUT_MS = 3000;
export const LOGO_TIMEOUT_MS = 8000;

const nonEmpty = value => typeof value === 'string' ? value.trim() : '';

export function getCardLogoSources(card = {}) {
  // 后台的历史字段是 logo_url；logo 与本地上传也需要兼容。
  const uploaded = nonEmpty(card.custom_logo_path);
  const custom = nonEmpty(card.logo) || nonEmpty(card.logo_url)
    || (uploaded ? `/uploads/${uploaded.replace(/^\/+/, '')}` : '');
  const sources = custom ? [custom] : [];

  try {
    const site = new URL(nonEmpty(card.url));
    if (site.protocol === 'https:' || site.protocol === 'http:') {
      if (!custom) {
        sources.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(site.hostname)}&sz=128`);
      }
      // 从源站根目录读取，不把页面路径、查询参数或 hash 拼进去。
      sources.push(`${site.origin}/favicon.ico`);
    }
  } catch {
    // 无法提取网站域名时仍可使用自定义图片和本地默认图。
  }

  sources.push(DEFAULT_LOGO);
  return [...new Set(sources)];
}

// 使用 DOM 的 onerror 属性，进入本地保底时可以真正解除错误回调。
export function loadCardLogo(image, sources, clock = globalThis) {
  let index = 0;
  let timer;
  let stopped = false;

  function stop() {
    stopped = true;
    clock.clearTimeout(timer);
    image.onerror = null;
    image.onload = null;
  }

  function attempt() {
    clock.clearTimeout(timer);
    const source = sources[index] || DEFAULT_LOGO;
    if (source === DEFAULT_LOGO) {
      stop();
      image.src = DEFAULT_LOGO;
      return;
    }

    const current = index;
    const advance = () => {
      if (stopped || current !== index) return;
      index++;
      attempt();
    };
    image.onerror = advance;
    image.onload = () => {
      if (!stopped && current === index) stop();
    };
    image.src = source;
    // 国内访问 Google 可能一直等待而不触发 error，需主动结束等待。
    const timeout = source.startsWith('https://www.google.com/s2/favicons?')
      ? GOOGLE_TIMEOUT_MS : LOGO_TIMEOUT_MS;
    timer = clock.setTimeout(advance, timeout);
  }

  attempt();
  return stop;
}
