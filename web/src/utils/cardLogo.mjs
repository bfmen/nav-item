export const DEFAULT_LOGO = '/uploads/default-favicon.png';
export const LOGO_TIMEOUT_MS = 8000;

const nonEmpty = value => typeof value === 'string' ? value.trim() : '';

export function getCardLogoSources(card = {}) {
  const uploaded = nonEmpty(card.custom_logo_path);
  const custom = nonEmpty(card.logo) || nonEmpty(card.logo_url)
    || (uploaded ? `/uploads/${uploaded.replace(/^\/+/, '')}` : '');
  if (custom) return [custom, DEFAULT_LOGO];

  try {
    const site = new URL(nonEmpty(card.url));
    if (!['http:', 'https:'].includes(site.protocol)) return [DEFAULT_LOGO];
    return [`/api/favicon?url=${encodeURIComponent(site.href)}`, DEFAULT_LOGO];
  } catch {
    return [DEFAULT_LOGO];
  }
}

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
    timer = clock.setTimeout(advance, source.startsWith('/api/favicon?') ? 30000 : LOGO_TIMEOUT_MS);
  }

  attempt();
  return stop;
}
