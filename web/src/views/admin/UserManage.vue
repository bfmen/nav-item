<template>
  <section class="settings-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">ACCOUNT, APPEARANCE & DATA</p>
        <h2>账号与站点设置</h2>
        <p class="page-description">管理后台密码、分别配置白天与夜晚首页壁纸及遮罩暗度，并安全备份或还原 Nav-Item 数据。</p>
      </div>
    </div>

    <div class="settings-grid">
      <article class="settings-card appearance-card">
        <div class="card-heading">
          <span class="card-icon">🖼️</span>
          <div>
            <h3>首页背景设置</h3>
            <p>支持为白天 / 夜晚模式分别配置壁纸与遮罩，内置全量纯 SVG 精选预设，更换壁纸时自动保留最近 2 条历史记录。</p>
          </div>
        </div>

        <!-- 顶部模式切换 Tab + 默认主题设置 -->
        <div class="appearance-toolbar">
          <div class="mode-tabs" role="tablist" aria-label="白天与夜晚背景配置切换">
            <button
              type="button"
              role="tab"
              :aria-selected="editingTheme === 'light'"
              :class="['mode-tab', { active: editingTheme === 'light' }]"
              @click="switchEditingTheme('light')"
            >
              <span aria-hidden="true">☀</span>
              <span>白天模式配置</span>
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="editingTheme === 'dark'"
              :class="['mode-tab', { active: editingTheme === 'dark' }]"
              @click="switchEditingTheme('dark')"
            >
              <span aria-hidden="true">🌙</span>
              <span>夜晚模式配置</span>
            </button>
          </div>

          <label class="default-theme-field">
            <span>默认主题模式</span>
            <select v-model="defaultTheme" aria-label="默认主题模式">
              <option value="auto">自动跟随系统 (Auto)</option>
              <option value="light">默认白天模式 (Light)</option>
              <option value="dark">默认夜晚模式 (Dark)</option>
            </select>
          </label>
        </div>

        <div class="appearance-layout">
          <div class="bg-preview-panel">
            <div class="bg-preview-box" :class="`theme-${editingTheme}`" :style="{ backgroundImage: `url(${fallbackBgForEditing})` }">
              <img
                v-if="trimmedBgUrl && !previewError"
                class="bg-preview-img"
                :src="trimmedBgUrl"
                :alt="editingTheme === 'light' ? '白天模式背景实时预览' : '夜晚模式背景实时预览'"
                @load="previewError = false"
                @error="previewError = true"
              />
              <div class="bg-preview-overlay" :style="{ background: previewOverlayBg }"></div>
              <div class="bg-preview-mockup" :class="{ 'is-light': editingTheme === 'light' }" aria-hidden="true">
                <div class="mockup-pill"></div>
                <div class="mockup-search"></div>
                <div class="mockup-cards">
                  <span class="mockup-card"></span>
                  <span class="mockup-card"></span>
                  <span class="mockup-card"></span>
                </div>
              </div>
              <span :class="['preview-badge', { warning: previewError }]">{{ previewStatusText }}</span>
            </div>
            <p class="hint preview-caption">
              当前正在预览<strong>{{ editingTheme === 'light' ? '白天浅色模式' : '夜晚深色模式' }}</strong>（遮罩 {{ currentBgOverlay }}%）；若自定义外链图片无法加载，首页将自动回退至对应内置校园矢量壁纸。
            </p>
          </div>

          <div class="bg-controls">
            <label>
              {{ editingTheme === 'light' ? '白天模式' : '夜晚模式' }}壁纸地址（支持预设路径、本地上传或网络 URL）
              <input
                v-model="currentBgUrl"
                type="text"
                placeholder="输入 http:// 或 https:// 图片地址，或点击下方预设 / 上传本地图片"
                autocomplete="off"
              />
            </label>

            <div class="slider-field">
              <div class="slider-header">
                <span class="slider-label">{{ editingTheme === 'light' ? '白天遮罩暗度（推荐 0% ~ 10%）' : '夜晚遮罩暗度（推荐 20% ~ 28%）' }}</span>
                <span class="slider-value">{{ currentBgOverlay }}%</span>
              </div>
              <input
                v-model.number="currentBgOverlay"
                class="overlay-slider"
                type="range"
                min="0"
                max="80"
                step="1"
                aria-label="背景遮罩暗度"
              />
              <div class="slider-scale">
                <span>0% 透亮</span>
                <span>{{ editingTheme === 'light' ? '6% 清透推荐' : '24% 暮色推荐' }}</span>
                <span>80% 深暗</span>
              </div>
            </div>

            <div class="bg-actions">
              <label class="secondary-button file-button" :class="{ 'is-disabled': bgUploading }">
                {{ bgUploading ? '上传中…' : `上传${editingTheme === 'light' ? '白天' : '夜晚'}壁纸` }}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,.jpg,.jpeg,.png,.webp,.gif,.svg"
                  :disabled="bgUploading || bgSaving"
                  @change="handleUploadBackground"
                />
              </label>
              <button
                class="primary-button"
                type="button"
                :disabled="bgSaving || bgUploading"
                @click="handleSaveAppearance"
              >
                {{ bgSaving ? '保存中…' : '保存背景设置' }}
              </button>
              <button
                class="ghost-button"
                type="button"
                :disabled="bgSaving || bgUploading"
                @click="handleResetCurrentMode"
              >
                恢复{{ editingTheme === 'light' ? '白天' : '夜晚' }}默认
              </button>
            </div>
            <p class="hint">本地上传支持 JPG / PNG / WebP / GIF / SVG（自动安全过滤）格式，单张不超过 10MB，上传后自动应用到当前模式并将旧壁纸记入历史槽位。</p>
          </div>
        </div>

        <!-- 内置精选纯 SVG 背景预设 -->
        <div v-if="bgPresets.length" class="preset-section">
          <div class="preset-header">
            <span class="preset-title">内置精选纯 SVG 背景预设</span>
            <small>点击预设即可填入当前「{{ editingTheme === 'light' ? '白天模式' : '夜晚模式' }}」地址与推荐遮罩，点击“保存背景设置”生效</small>
          </div>
          <div class="preset-grid" role="list" aria-label="内置背景预设">
            <button
              v-for="preset in bgPresets"
              :key="preset.id"
              type="button"
              role="listitem"
              :class="['preset-card', { active: activePresetId === preset.id }]"
              :title="preset.desc"
              @click="selectBgPreset(preset)"
            >
              <div class="preset-thumb" :style="{ backgroundImage: `url(${preset.preview_url || preset.url})` }">
                <span class="preset-thumb-overlay" :style="{ background: buildOverlayCss(preset.overlay, preset.recommended_theme || 'dark') }"></span>
                <span :class="['preset-tag', preset.recommended_theme === 'light' ? 'tag-day' : 'tag-night']">{{ preset.tag }}</span>
                <span v-if="activePresetId === preset.id" class="preset-check" aria-label="当前选中">✓</span>
              </div>
              <div class="preset-meta">
                <span class="preset-name">{{ preset.name }}</span>
                <span class="preset-overlay-hint">推荐遮罩 {{ preset.overlay }}%</span>
              </div>
            </button>
          </div>
        </div>

        <!-- 2 个「历史壁纸」恢复槽位 -->
        <div class="history-section">
          <div class="preset-header">
            <span class="preset-title">历史壁纸（最近 2 次）</span>
            <small>更换或上传壁纸时自动保留变更前的旧壁纸，点击即可一键恢复至当前模式</small>
          </div>
          <div class="history-grid" role="list" aria-label="历史壁纸恢复槽位">
            <template v-for="(slot, idx) in historySlots" :key="idx">
              <button
                v-if="slot"
                type="button"
                role="listitem"
                class="history-card filled"
                :disabled="bgSaving || bgUploading"
                @click="restoreHistoryWallpaper(slot)"
              >
                <div class="history-thumb" :style="{ backgroundImage: `url(${slot.url})` }">
                  <span class="preset-thumb-overlay" :style="{ background: buildOverlayCss(slot.overlay, slot.theme) }"></span>
                  <span :class="['preset-tag', slot.theme === 'light' ? 'tag-day' : 'tag-night']">
                    {{ slot.theme === 'light' ? '☀ 白天记录' : '🌙 夜晚记录' }}
                  </span>
                  <span class="history-restore-pill">恢复此壁纸</span>
                </div>
                <div class="history-meta">
                  <span class="history-name">{{ formatWallpaperLabel(slot.url) }}</span>
                  <span class="history-sub">遮罩 {{ slot.overlay }}% · {{ formatShortTime(slot.savedAt) }}</span>
                </div>
              </button>

              <div v-else role="listitem" class="history-card empty">
                <div class="history-empty-inner">
                  <span class="history-empty-icon" aria-hidden="true">🕘</span>
                  <span class="history-empty-title">历史槽位 {{ idx + 1 }}</span>
                  <span class="history-empty-text">暂无历史记录，更换壁纸后自动保留最近 2 次</span>
                </div>
              </div>
            </template>
          </div>
        </div>
      </article>

      <article class="settings-card password-card">
        <div class="card-heading">
          <span class="card-icon">🔐</span>
          <div>
            <h3>修改密码</h3>
            <p>修改后当前登录会话将自动退出。</p>
          </div>
        </div>
        <form class="form" @submit.prevent="handleChangePassword">
          <label>当前密码<input v-model="oldPassword" type="password" autocomplete="current-password" placeholder="请输入当前密码" /></label>
          <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 6 位字符" /></label>
          <label>确认新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label>
          <button class="primary-button" type="submit" :disabled="passwordLoading">{{ passwordLoading ? '保存中…' : '保存新密码' }}</button>
        </form>
      </article>

      <article class="settings-card backup-card">
        <div class="card-heading">
          <span class="card-icon">💾</span>
          <div>
            <h3>备份还原</h3>
            <p>导出栏目、卡片、双模式背景配置与历史记录及账户数据，便于迁移与恢复。</p>
          </div>
        </div>
        <div class="backup-actions">
          <button class="secondary-button" type="button" :disabled="backupLoading" @click="downloadBackup">{{ backupLoading ? '生成中…' : '下载本地备份' }}</button>
          <label class="secondary-button file-button">选择备份还原<input type="file" accept="application/json,.json" @change="restoreFromFile" /></label>
        </div>
        <div class="webdav-box">
          <div class="subheading"><span>WebDAV 远程备份</span><small>支持坚果云、Nextcloud 等 WebDAV 服务</small></div>
          <input v-model="webdav.url" type="url" placeholder="https://dav.example.com/backups/" />
          <div class="two-fields"><input v-model="webdav.username" type="text" placeholder="用户名（可选）" autocomplete="username" /><input v-model="webdav.password" type="password" placeholder="密码（可选）" autocomplete="current-password" /></div>
          <div class="webdav-buttons"><button class="secondary-button" type="button" :disabled="webdavListLoading" @click="loadWebdavBackups">{{ webdavListLoading ? '读取中…' : '读取云端备份列表' }}</button><button class="primary-button" type="button" :disabled="webdavLoading" @click="backupWebdav">{{ webdavLoading ? '上传中…' : '备份到 WebDAV' }}</button></div>
          <div v-if="webdavFiles.length" class="cloud-list">
            <label>选择云端备份（默认最新）<select v-model="selectedWebdavUrl"><option v-for="(file, index) in webdavFiles" :key="file.url" :value="file.url">{{ formatBackupTag(file) }} {{ file.name }}{{ index === 0 ? '（最新）' : '' }}{{ file.modified ? ` · ${formatDate(file.modified)}` : '' }}</option></select></label>
            <button class="restore-button" type="button" :disabled="webdavRestoreLoading" @click="restoreFromWebdav">{{ webdavRestoreLoading ? '还原中…' : '还原选中的云端备份' }}</button>
          </div>
          <p v-else class="hint">输入 WebDAV 地址和账户后点击“读取云端备份列表”。地址以 / 结尾时，上传会自动生成带时间的备份文件名。</p>
        </div>
      </article>
    </div>
    <p v-if="message" :class="['notice', messageType]">{{ message }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import {
  backupToWebdav,
  changePassword,
  exportBackup,
  getSiteAppearance,
  getSiteBgPresets,
  getWebdavConfig,
  listWebdavBackups,
  logout,
  restoreBackup,
  restoreWebdavBackup,
  saveWebdavConfig,
  updateSiteAppearance,
  uploadSiteBackground
} from '../../api';

const DEFAULT_DAY_BG_URL = '/backgrounds/campus-day.svg';
const DEFAULT_DAY_OVERLAY = 0;
const DEFAULT_NIGHT_BG_URL = '/backgrounds/campus-night.svg';
const DEFAULT_NIGHT_OVERLAY = 24;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const FALLBACK_PRESETS = [
  { id: 'campus-day', name: '青春晴空校园', desc: '晴空白云、绿茵操场与红跑道，清爽明亮', tag: '白天推荐', recommended_theme: 'light', type: 'svg', url: '/backgrounds/campus-day.svg', preview_url: '/backgrounds/campus-day.svg', overlay: 0 },
  { id: 'campus-night', name: '青春暮色校园', desc: '日落紫霞、暮色星光与暖灯校园剪影', tag: '夜晚推荐', recommended_theme: 'dark', type: 'svg', url: '/backgrounds/campus-night.svg', preview_url: '/backgrounds/campus-night.svg', overlay: 24 },
  { id: 'dawn-horizon', name: '微光晨曦云海', desc: '柔和蓝粉渐变天际线与轻盈云海', tag: '白天推荐', recommended_theme: 'light', type: 'svg', url: '/backgrounds/dawn-horizon.svg', preview_url: '/backgrounds/dawn-horizon.svg', overlay: 8 },
  { id: 'deep-blue-geo', name: '极简深蓝几何', desc: '沉静深蓝几何光面，百搭暗色毛玻璃', tag: '夜晚推荐', recommended_theme: 'dark', type: 'svg', url: '/backgrounds/deep-blue-geo.svg', preview_url: '/backgrounds/deep-blue-geo.svg', overlay: 20 },
  { id: 'aurora-peaks', name: '极光雪峰夜景', desc: '翠紫极光映照雪山轮廓与繁星', tag: '夜晚推荐', recommended_theme: 'dark', type: 'svg', url: '/backgrounds/aurora-peaks.svg', preview_url: '/backgrounds/aurora-peaks.svg', overlay: 24 },
  { id: 'misty-forest', name: '青岚月影山林', desc: '层叠青墨远山与柔和清月微光', tag: '夜晚推荐', recommended_theme: 'dark', type: 'svg', url: '/backgrounds/misty-forest.svg', preview_url: '/backgrounds/misty-forest.svg', overlay: 28 }
];

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const passwordLoading = ref(false);
const backupLoading = ref(false);
const webdavLoading = ref(false);
const webdavListLoading = ref(false);
const webdavRestoreLoading = ref(false);
const webdavFiles = ref([]);
const selectedWebdavUrl = ref('');
const message = ref('');
const messageType = ref('success');
const webdav = ref({ url: '', username: '', password: '' });

// 双模式首页背景设置状态
const bgPresets = ref(FALLBACK_PRESETS);
const editingTheme = ref('light'); // 'light' | 'dark'
const defaultTheme = ref('auto');
const dayBgUrl = ref(DEFAULT_DAY_BG_URL);
const dayBgOverlay = ref(DEFAULT_DAY_OVERLAY);
const nightBgUrl = ref(DEFAULT_NIGHT_BG_URL);
const nightBgOverlay = ref(DEFAULT_NIGHT_OVERLAY);
const bgHistory = ref([]);
const bgSaving = ref(false);
const bgUploading = ref(false);
const previewError = ref(false);

const currentBgUrl = computed({
  get: () => (editingTheme.value === 'light' ? dayBgUrl.value : nightBgUrl.value),
  set: (val) => {
    if (editingTheme.value === 'light') dayBgUrl.value = val;
    else nightBgUrl.value = val;
  }
});

const currentBgOverlay = computed({
  get: () => (editingTheme.value === 'light' ? dayBgOverlay.value : nightBgOverlay.value),
  set: (val) => {
    const num = Number(val);
    const safe = Number.isFinite(num) ? Math.min(80, Math.max(0, Math.round(num))) : 0;
    if (editingTheme.value === 'light') dayBgOverlay.value = safe;
    else nightBgOverlay.value = safe;
  }
});

const fallbackBgForEditing = computed(() => (
  editingTheme.value === 'light' ? DEFAULT_DAY_BG_URL : DEFAULT_NIGHT_BG_URL
));

const trimmedBgUrl = computed(() => String(currentBgUrl.value || '').trim());

const activePresetObj = computed(() => {
  const url = trimmedBgUrl.value;
  return bgPresets.value.find(item => item.url === url) || null;
});

const activePresetId = computed(() => activePresetObj.value?.id || '');

// 固定展示 2 个历史壁纸恢复槽位
const historySlots = computed(() => {
  const items = Array.isArray(bgHistory.value) ? bgHistory.value.slice(0, 2) : [];
  return [items[0] || null, items[1] || null];
});

function buildOverlayCss(percent, theme = 'dark') {
  const num = Number(percent);
  const fallback = theme === 'light' ? DEFAULT_DAY_OVERLAY : DEFAULT_NIGHT_OVERLAY;
  const clamped = Number.isFinite(num) ? Math.min(80, Math.max(0, num)) : fallback;
  const alpha = clamped / 100;
  if (alpha <= 0) return 'transparent';
  if (theme === 'light') {
    const top = (alpha * 0.42).toFixed(3);
    const bottom = Math.min(0.65, alpha * 0.62).toFixed(3);
    return `linear-gradient(180deg, rgba(15, 23, 42, ${top}) 0%, rgba(15, 23, 42, ${bottom}) 100%)`;
  }
  const top = (alpha * 0.82).toFixed(3);
  const bottom = Math.min(0.92, alpha * 1.12).toFixed(3);
  return `radial-gradient(circle at 50% 0%, rgba(15, 23, 42, ${top}) 0%, rgba(2, 6, 23, ${bottom}) 100%)`;
}

const previewOverlayBg = computed(() => buildOverlayCss(currentBgOverlay.value, editingTheme.value));

const previewStatusText = computed(() => {
  const modePrefix = editingTheme.value === 'light' ? '☀ 白天' : '🌙 夜晚';
  if (!trimmedBgUrl.value) return `${modePrefix} · 默认内置壁纸`;
  if (previewError.value) return `${modePrefix} · 图片加载失败将自动回退`;
  if (activePresetObj.value) return `${modePrefix} · ${activePresetObj.value.name}`;
  if (trimmedBgUrl.value.startsWith('/uploads/')) return `${modePrefix} · 本地已上传壁纸`;
  return `${modePrefix} · 网络背景图片`;
});

watch([trimmedBgUrl, editingTheme], () => {
  previewError.value = false;
});

function switchEditingTheme(theme) {
  editingTheme.value = theme === 'light' ? 'light' : 'dark';
  previewError.value = false;
}

function applyAppearanceResponse(data) {
  if (!data || typeof data !== 'object') return;
  dayBgUrl.value = data.day_bg_url || DEFAULT_DAY_BG_URL;
  dayBgOverlay.value = data.day_bg_overlay !== undefined ? Number(data.day_bg_overlay) : DEFAULT_DAY_OVERLAY;
  nightBgUrl.value = data.night_bg_url || data.site_bg_url || DEFAULT_NIGHT_BG_URL;
  nightBgOverlay.value = data.night_bg_overlay !== undefined
    ? Number(data.night_bg_overlay)
    : (data.site_bg_overlay !== undefined ? Number(data.site_bg_overlay) : DEFAULT_NIGHT_OVERLAY);
  defaultTheme.value = ['light', 'dark', 'auto'].includes(data.default_theme) ? data.default_theme : 'auto';
  bgHistory.value = Array.isArray(data.bg_history) ? data.bg_history.slice(0, 2) : [];
  previewError.value = false;
}

function selectBgPreset(preset) {
  currentBgUrl.value = preset.url || fallbackBgForEditing.value;
  currentBgOverlay.value = Number(preset.overlay ?? (editingTheme.value === 'light' ? DEFAULT_DAY_OVERLAY : DEFAULT_NIGHT_OVERLAY));
  previewError.value = false;
  const modeLabel = editingTheme.value === 'light' ? '白天模式' : '夜晚模式';
  notify(`已为「${modeLabel}」填入预设「${preset.name}」（推荐遮罩 ${currentBgOverlay.value}%），点击“保存背景设置”生效`);
}

function validateUrlForSave(url) {
  const clean = String(url || '').trim();
  if (!clean) return true;
  return clean.startsWith('/uploads/') || clean.startsWith('/backgrounds/') || /^https?:\/\//i.test(clean);
}

async function loadAppearance() {
  try {
    const { data } = await getSiteAppearance();
    applyAppearanceResponse(data);
  } catch (error) {
    notify(error.response?.data?.message || '读取首页背景配置失败', 'error');
  }
}

async function loadBgPresets() {
  try {
    const { data } = await getSiteBgPresets();
    if (Array.isArray(data?.data) && data.data.length > 0) {
      bgPresets.value = data.data;
    }
  } catch {
    // 预设读取失败时平滑沿用内置纯 SVG 兜底列表
  }
}

onMounted(async () => {
  const [webdavRes] = await Promise.allSettled([getWebdavConfig(), loadBgPresets(), loadAppearance()]);
  if (webdavRes.status === 'fulfilled') {
    const data = webdavRes.value.data;
    webdav.value = { url: data.data?.url || '', username: data.data?.username || '', password: data.data?.password || '' };
    if (webdav.value.url) await loadWebdavBackups();
  } else {
    notify(webdavRes.reason?.response?.data?.message || '读取 WebDAV 配置失败', 'error');
  }
});

function notify(text, type = 'success') {
  message.value = text;
  messageType.value = type;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { message.value = ''; }, 4500);
}

async function handleSaveAppearance() {
  const cleanDay = String(dayBgUrl.value || '').trim();
  const cleanNight = String(nightBgUrl.value || '').trim();
  if (!validateUrlForSave(cleanDay)) {
    return notify('白天模式壁纸地址无效，请输入 http:// 或 https:// 链接', 'error');
  }
  if (!validateUrlForSave(cleanNight)) {
    return notify('夜晚模式壁纸地址无效，请输入 http:// 或 https:// 链接', 'error');
  }
  bgSaving.value = true;
  try {
    const { data } = await updateSiteAppearance({
      day_bg_url: cleanDay,
      day_bg_overlay: dayBgOverlay.value,
      night_bg_url: cleanNight,
      night_bg_overlay: nightBgOverlay.value,
      default_theme: defaultTheme.value
    });
    applyAppearanceResponse(data);
    notify(data.message || '白天 / 夜晚背景设置已保存');
  } catch (error) {
    notify(error.response?.data?.message || '保存背景设置失败', 'error');
  } finally {
    bgSaving.value = false;
  }
}

async function handleResetCurrentMode() {
  bgSaving.value = true;
  try {
    const payload = editingTheme.value === 'light'
      ? { day_bg_url: DEFAULT_DAY_BG_URL, day_bg_overlay: DEFAULT_DAY_OVERLAY, day_bg_preset: 'campus-day' }
      : { night_bg_url: DEFAULT_NIGHT_BG_URL, night_bg_overlay: DEFAULT_NIGHT_OVERLAY, night_bg_preset: 'campus-night' };
    const { data } = await updateSiteAppearance(payload);
    applyAppearanceResponse(data);
    notify(editingTheme.value === 'light' ? '已恢复白天默认「青春晴空校园」壁纸' : '已恢复夜晚默认「青春暮色校园」壁纸');
  } catch (error) {
    notify(error.response?.data?.message || '恢复默认背景失败', 'error');
  } finally {
    bgSaving.value = false;
  }
}

async function restoreHistoryWallpaper(slot) {
  if (!slot || !slot.url) return;
  bgSaving.value = true;
  try {
    const isLight = editingTheme.value === 'light';
    const payload = isLight
      ? { day_bg_url: slot.url, day_bg_overlay: Number(slot.overlay ?? DEFAULT_DAY_OVERLAY) }
      : { night_bg_url: slot.url, night_bg_overlay: Number(slot.overlay ?? DEFAULT_NIGHT_OVERLAY) };
    const { data } = await updateSiteAppearance(payload);
    applyAppearanceResponse(data);
    notify(`已将历史壁纸一键恢复至「${isLight ? '白天模式' : '夜晚模式'}」`);
  } catch (error) {
    notify(error.response?.data?.message || '恢复历史壁纸失败', 'error');
  } finally {
    bgSaving.value = false;
  }
}

async function handleUploadBackground(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > MAX_UPLOAD_BYTES) {
    return notify('图片大小不能超过 10MB', 'error');
  }
  bgUploading.value = true;
  try {
    const { data } = await uploadSiteBackground(file, currentBgOverlay.value, editingTheme.value);
    applyAppearanceResponse(data);
    notify(data.message || '背景图片上传成功并已生效');
  } catch (error) {
    notify(error.response?.data?.message || '上传背景图片失败', 'error');
  } finally {
    bgUploading.value = false;
  }
}

function formatWallpaperLabel(url) {
  const clean = String(url || '').trim();
  const matched = bgPresets.value.find(item => item.url === clean);
  if (matched) return matched.name;
  if (clean.startsWith('/uploads/')) return `已上传 · ${clean.split('/').pop()}`;
  try {
    const parsed = new URL(clean);
    const tail = parsed.pathname.split('/').filter(Boolean).pop();
    return tail ? `${parsed.hostname}/${tail}` : parsed.hostname;
  } catch {
    return clean || '历史壁纸';
  }
}

function formatShortTime(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function handleChangePassword() {
  if (!oldPassword.value || !newPassword.value || !confirmPassword.value) return notify('请填写完整的密码信息', 'error');
  if (newPassword.value.length < 6) return notify('新密码长度至少 6 位', 'error');
  if (newPassword.value !== confirmPassword.value) return notify('两次输入的新密码不一致', 'error');
  passwordLoading.value = true;
  try {
    await changePassword(oldPassword.value, newPassword.value);
    notify('密码已修改，2 秒后退出登录');
    oldPassword.value = newPassword.value = confirmPassword.value = '';
    window.setTimeout(async () => { await logout().catch(() => {}); window.location.reload(); }, 2000);
  } catch (error) {
    notify(error.response?.data?.message || '密码修改失败', 'error');
  } finally { passwordLoading.value = false; }
}

async function downloadBackup() {
  backupLoading.value = true;
  try {
    const { data } = await exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `nav-item-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify('本地备份已下载');
  } catch (error) { notify(error.response?.data?.message || '备份生成失败', 'error'); }
  finally { backupLoading.value = false; }
}

async function restoreFromFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!window.confirm('还原后将覆盖当前栏目、卡片、背景配置和账户数据，确定继续吗？')) return;
    await restoreBackup(data);
    await loadAppearance();
    notify('备份还原成功，请刷新页面');
  } catch (error) { notify(error.response?.data?.message || '备份文件无效或还原失败', 'error'); }
}

async function backupWebdav() {
  if (!webdav.value.url) return notify('请输入 WebDAV 地址', 'error');
  webdavLoading.value = true;
  try {
    await saveWebdavConfig(webdav.value);
    const { data } = await backupToWebdav(webdav.value);
    notify(data.message || 'WebDAV 备份成功');
  } catch (error) { notify(error.response?.data?.message || 'WebDAV 备份失败', 'error'); }
  finally { webdavLoading.value = false; }
}

async function loadWebdavBackups() {
  if (!webdav.value.url) return notify('请输入 WebDAV 地址', 'error');
  webdavListLoading.value = true;
  try {
    await saveWebdavConfig(webdav.value);
    const { data } = await listWebdavBackups(webdav.value);
    webdavFiles.value = data.data || [];
    selectedWebdavUrl.value = webdavFiles.value[0]?.url || '';
    notify(webdavFiles.value.length ? `已找到 ${webdavFiles.value.length} 个云端备份，默认选择最新备份` : '云端暂时没有 Nav-Item JSON 备份', webdavFiles.value.length ? 'success' : 'error');
  } catch (error) { webdavFiles.value = []; selectedWebdavUrl.value = ''; notify(error.response?.data?.message || '读取云端备份失败', 'error'); }
  finally { webdavListLoading.value = false; }
}

async function restoreFromWebdav() {
  if (!selectedWebdavUrl.value) return notify('请先读取并选择云端备份', 'error');
  if (!window.confirm('还原后将覆盖当前栏目、卡片、背景配置和账户数据，确定继续吗？')) return;
  webdavRestoreLoading.value = true;
  try {
    await saveWebdavConfig(webdav.value);
    await restoreWebdavBackup({ ...webdav.value, fileUrl: selectedWebdavUrl.value });
    await loadAppearance();
    notify('云端备份还原成功，请刷新页面');
  } catch (error) { notify(error.response?.data?.message || '云端备份还原失败', 'error'); }
  finally { webdavRestoreLoading.value = false; }
}

function formatBackupTag(file) {
  if (file?.label) return file.label;
  if (/^nav-item-ai-backup-/i.test(file?.name || '')) return '[AI变更前]';
  if (/^nav-item-backup-/i.test(file?.name || '')) return '[手动]';
  return '[云端]';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<style scoped>
.settings-page { width: 100%; max-width: 1600px; margin: 0 auto; padding: 4px 0 36px; box-sizing: border-box; color: #172033; }
.page-heading { margin-bottom: 24px; }
.eyebrow { margin: 0 0 6px; color: #4f7cff; font-size: 11px; font-weight: 700; letter-spacing: 2px; }
h2, h3, p { margin-top: 0; }
h2 { margin-bottom: 8px; font-size: 28px; }
.page-description { color: #72809a; margin-bottom: 0; }

.settings-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.85fr) minmax(380px, 1.15fr);
  gap: 20px;
  align-items: start;
}

.settings-card {
  border: 1px solid #e7ecf5;
  border-radius: 18px;
  padding: 24px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(36, 60, 105, .07);
}

.appearance-card {
  grid-column: 1 / -1;
}

.card-heading { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 18px; }
.card-heading h3 { margin: 0 0 5px; font-size: 18px; }
.card-heading p, .hint, .subheading small { color: #8190a9; font-size: 13px; margin-bottom: 0; }
.card-icon { width: 38px; height: 38px; display: grid; place-items: center; background: #eef3ff; border-radius: 11px; font-size: 19px; flex-shrink: 0; }

/* 白天 / 夜晚模式配置顶部切换栏 */
.appearance-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 18px;
  margin-bottom: 20px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #f6f8fd;
  border: 1px solid #e7ecf5;
}

.mode-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border-radius: 11px;
  background: #eaf0fa;
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13.5px;
  font-weight: 600;
  color: #52617a;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.mode-tab:hover {
  color: #172033;
}

.mode-tab.active {
  color: #1d4ed8;
  background: #ffffff;
  box-shadow: 0 2px 8px rgba(36, 60, 105, 0.12);
}

.default-theme-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: #52617a;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.default-theme-field select {
  width: auto;
  min-width: 185px;
  padding: 8px 12px;
  font-size: 13px;
}

/* 首页背景设置双栏布局：左侧实时缩略图预览 · 右侧参数控制 */
.appearance-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.95fr) minmax(320px, 1.25fr);
  gap: 24px;
  align-items: start;
}

.bg-preview-panel {
  display: grid;
  gap: 10px;
}

.bg-preview-box {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 14px;
  overflow: hidden;
  background-color: #0b1224;
  background-size: cover;
  background-position: center;
  border: 1px solid #dce3ef;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 8px 22px rgba(15, 23, 42, 0.12);
}

.bg-preview-box.theme-light {
  background-color: #5eaaf5;
}

.bg-preview-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  display: block;
}

.bg-preview-overlay {
  position: absolute;
  inset: 0;
  transition: background 0.2s ease;
}

.bg-preview-mockup {
  position: relative;
  z-index: 2;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  box-sizing: border-box;
  pointer-events: none;
}

.mockup-pill {
  width: 44%;
  height: 12px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.58);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.mockup-search {
  width: 62%;
  height: 16px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.56);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.mockup-cards {
  width: 78%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 2px;
}

.mockup-card {
  height: 24px;
  border-radius: 7px;
  background: rgba(17, 24, 39, 0.52);
  border: 1px solid rgba(255, 255, 255, 0.14);
}

.bg-preview-mockup.is-light .mockup-pill,
.bg-preview-mockup.is-light .mockup-search,
.bg-preview-mockup.is-light .mockup-card {
  background: rgba(255, 255, 255, 0.78);
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.1);
}

.preview-badge {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 3;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: rgba(248, 250, 252, 0.94);
  background: rgba(15, 23, 42, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(8px);
}

.preview-badge.warning {
  color: #fde68a;
  border-color: rgba(251, 191, 36, 0.45);
}

.preview-caption {
  font-size: 12.5px;
  line-height: 1.5;
}

.bg-controls {
  display: grid;
  gap: 16px;
}

.slider-field {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8faff;
  border: 1px solid #e7ecf5;
}

.slider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.slider-label {
  color: #52617a;
  font-size: 13px;
  font-weight: 600;
}

.slider-value {
  color: #4f7cff;
  font-size: 13px;
  font-weight: 700;
  padding: 2px 9px;
  border-radius: 999px;
  background: #eef3ff;
  flex-shrink: 0;
}

.overlay-slider {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  accent-color: #4f7cff;
  cursor: pointer;
}

.overlay-slider:focus {
  outline: none;
}

.slider-scale {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: #8190a9;
}

.bg-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

/* 内置背景预设快捷选择区 & 历史壁纸槽位区 */
.preset-section,
.history-section {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid #edf0f6;
  display: grid;
  gap: 14px;
}

.preset-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px 12px;
}

.preset-title {
  font-size: 14px;
  font-weight: 700;
  color: #33425d;
}

.preset-header small {
  color: #8190a9;
  font-size: 12.5px;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}

.preset-card {
  display: grid;
  gap: 7px;
  padding: 6px;
  border-radius: 12px;
  border: 1.5px solid #e7ecf5;
  background: #fbfcff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.preset-card:hover {
  border-color: #9bb7ff;
  background: #f5f8ff;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(79, 124, 255, 0.12);
}

.preset-card.active {
  border-color: #4f7cff;
  background: #eef3ff;
  box-shadow: 0 0 0 3px rgba(79, 124, 255, 0.16);
}

.preset-thumb,
.history-thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background-color: #0b1224;
  background-size: cover;
  background-position: center;
}

.preset-thumb-overlay {
  position: absolute;
  inset: 0;
}

.preset-tag {
  position: absolute;
  left: 6px;
  top: 6px;
  z-index: 2;
  font-size: 10px;
  font-weight: 600;
  color: #f8fafc;
  background: rgba(15, 23, 42, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 2px 7px;
  border-radius: 999px;
}

.preset-tag.tag-day {
  color: #7c2d12;
  background: rgba(255, 247, 237, 0.92);
  border-color: rgba(251, 146, 60, 0.45);
}

.preset-tag.tag-night {
  color: #e0e7ff;
  background: rgba(15, 23, 42, 0.76);
  border-color: rgba(129, 140, 248, 0.35);
}

.preset-check {
  position: absolute;
  right: 6px;
  top: 6px;
  z-index: 2;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: #4f7cff;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.32);
}

.preset-meta,
.history-meta {
  display: grid;
  gap: 2px;
  padding: 0 2px 2px;
}

.preset-name,
.history-name {
  font-size: 12.5px;
  font-weight: 600;
  color: #1f2b44;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preset-overlay-hint,
.history-sub {
  font-size: 11px;
  color: #7c8ba4;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 2 个历史壁纸槽位 */
.history-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  max-width: 640px;
}

.history-card {
  display: grid;
  gap: 8px;
  padding: 8px;
  border-radius: 12px;
  text-align: left;
  box-sizing: border-box;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.history-card.filled {
  border: 1.5px solid #dce5f4;
  background: #fbfcff;
  cursor: pointer;
}

.history-card.filled:hover:not(:disabled) {
  border-color: #4f7cff;
  background: #f2f6ff;
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(79, 124, 255, 0.14);
}

.history-restore-pill {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  background: rgba(79, 124, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.28);
}

.history-card.empty {
  border: 1.5px dashed #cfd9ea;
  background: #f8faff;
  min-height: 132px;
  place-items: center;
}

.history-empty-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 5px;
  padding: 14px 10px;
}

.history-empty-icon {
  font-size: 18px;
  opacity: 0.72;
}

.history-empty-title {
  font-size: 12.5px;
  font-weight: 700;
  color: #52617a;
}

.history-empty-text {
  font-size: 11.5px;
  color: #8a98b0;
  line-height: 1.45;
}

.form, .webdav-box { display: grid; gap: 14px; }
label { display: grid; gap: 7px; color: #52617a; font-size: 13px; font-weight: 600; }
input:not([type='range']) { width: 100%; box-sizing: border-box; border: 1px solid #dce3ef; border-radius: 10px; padding: 11px 12px; color: #172033; background: #fbfcff; font-size: 14px; }
input:not([type='range']):focus { outline: 2px solid rgba(79,124,255,.18); border-color: #4f7cff; }
button, .file-button { border: 0; border-radius: 10px; padding: 11px 16px; font-size: 14px; font-weight: 600; cursor: pointer; transition: .2s; box-sizing: border-box; }
button:disabled, .file-button.is-disabled { opacity: .55; cursor: not-allowed; pointer-events: none; }
.primary-button { color: #fff; background: linear-gradient(135deg, #4f7cff, #6c5ce7); }
.secondary-button { color: #4561a8; background: #eef3ff; }
.ghost-button { color: #52617a; background: #f3f6fb; border: 1px solid #e1e7f2; }
.primary-button:hover:not(:disabled), .secondary-button:hover:not(:disabled), .ghost-button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(.98); }
.backup-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
.file-button { display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.file-button input { display: none; }
.webdav-box { padding-top: 20px; border-top: 1px solid #edf0f6; }
.subheading { display: grid; gap: 4px; font-weight: 700; color: #33425d; }
.two-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.webdav-buttons { display: flex; flex-wrap: wrap; gap: 10px; }
.cloud-list { display: grid; gap: 12px; padding: 14px; border: 1px solid #e7ecf5; border-radius: 12px; background: #fafbff; }
select { width: 100%; box-sizing: border-box; border: 1px solid #dce3ef; border-radius: 10px; padding: 11px 12px; color: #172033; background: #fff; font-size: 14px; }
.restore-button { color: #9b5b13; background: #fff3df; }
.hint { line-height: 1.5; }
.notice { max-width: 700px; margin: 18px auto 0; padding: 11px 14px; border-radius: 10px; text-align: center; font-size: 14px; }
.notice.success { color: #176b4c; background: #e8f8f0; }
.notice.error { color: #a33b49; background: #fff0f1; }

@media (max-width: 1240px) {
  .preset-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 960px) {
  .appearance-layout { grid-template-columns: 1fr; gap: 18px; }
}

@media (max-width: 820px) {
  .settings-grid { grid-template-columns: 1fr; }
  .settings-page { padding-top: 0; }
  .appearance-toolbar { flex-direction: column; align-items: stretch; }
  .mode-tabs { width: 100%; display: grid; grid-template-columns: 1fr 1fr; }
  .mode-tab { justify-content: center; padding: 9px 10px; }
  .default-theme-field { display: grid; grid-template-columns: auto 1fr; align-items: center; }
  .default-theme-field select { width: 100%; min-width: 0; }
}

@media (max-width: 640px) {
  .preset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .history-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; max-width: none; }
}

@media (max-width: 480px) {
  .settings-card { padding: 18px; }
  .two-fields { grid-template-columns: 1fr; }
  .backup-actions button,
  .backup-actions .file-button,
  .webdav-buttons button,
  .bg-actions button,
  .bg-actions .file-button { width: 100%; justify-content: center; }
}
</style>
