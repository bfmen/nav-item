<template>
  <section class="settings-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">ACCOUNT, APPEARANCE & DATA</p>
        <h2>账号与站点设置</h2>
        <p class="page-description">管理后台密码、自定义首页背景与遮罩暗度，并安全备份或还原 Nav-Item 数据。</p>
      </div>
    </div>

    <div class="settings-grid">
      <article class="settings-card appearance-card">
        <div class="card-heading">
          <span class="card-icon">🖼️</span>
          <div>
            <h3>首页背景设置</h3>
            <p>支持上传本地图片或使用网络图片链接，并调节暗色遮罩保证文字清晰可读。</p>
          </div>
        </div>

        <div class="appearance-layout">
          <div class="bg-preview-panel">
            <div class="bg-preview-box">
              <img
                v-if="trimmedBgUrl && !previewError"
                class="bg-preview-img"
                :src="trimmedBgUrl"
                alt="首页背景实时预览"
                @load="previewError = false"
                @error="previewError = true"
              />
              <div class="bg-preview-overlay" :style="{ background: previewOverlayBg }"></div>
              <div class="bg-preview-mockup" aria-hidden="true">
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
            <p class="hint preview-caption">预览实时叠加当前 {{ bgOverlay }}% 暗色遮罩；若自定义图片不可访问，首页将自动回退至默认星空背景。</p>
          </div>

          <div class="bg-controls">
            <label>
              网络图片 URL（或已上传本地路径）
              <input
                v-model="bgUrl"
                type="text"
                placeholder="输入 http:// 或 https:// 图片地址，或上传本地图片"
                autocomplete="off"
              />
            </label>

            <div class="slider-field">
              <div class="slider-header">
                <span class="slider-label">背景遮罩暗度</span>
                <span class="slider-value">{{ bgOverlay }}%</span>
              </div>
              <input
                v-model.number="bgOverlay"
                class="overlay-slider"
                type="range"
                min="0"
                max="80"
                step="1"
                aria-label="背景遮罩暗度"
              />
              <div class="slider-scale">
                <span>0% 透亮</span>
                <span>40% 默认</span>
                <span>80% 深暗</span>
              </div>
            </div>

            <div class="bg-actions">
              <label class="secondary-button file-button" :class="{ 'is-disabled': bgUploading }">
                {{ bgUploading ? '上传中…' : '上传本地图片' }}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
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
                @click="handleResetAppearance"
              >
                恢复默认
              </button>
            </div>
            <p class="hint">本地上传支持 JPG / PNG / WebP / GIF 格式，单张不超过 10MB，上传后自动填入并立即生效。</p>
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
            <p>导出栏目、卡片、背景配置和账户数据，便于迁移与恢复。</p>
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
  getWebdavConfig,
  listWebdavBackups,
  logout,
  restoreBackup,
  restoreWebdavBackup,
  saveWebdavConfig,
  updateSiteAppearance,
  uploadSiteBackground
} from '../../api';

const DEFAULT_OVERLAY = 40;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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

// 首页背景设置状态
const bgUrl = ref('');
const bgOverlay = ref(DEFAULT_OVERLAY);
const bgSaving = ref(false);
const bgUploading = ref(false);
const previewError = ref(false);

const trimmedBgUrl = computed(() => String(bgUrl.value || '').trim());

const previewOverlayBg = computed(() => {
  const num = Number(bgOverlay.value);
  const clamped = Number.isFinite(num) ? Math.min(80, Math.max(0, num)) : DEFAULT_OVERLAY;
  const alpha = clamped / 100;
  if (alpha <= 0) return 'rgba(2, 6, 23, 0)';
  const top = (alpha * 0.82).toFixed(3);
  const bottom = Math.min(0.92, alpha * 1.12).toFixed(3);
  return `radial-gradient(circle at 50% 0%, rgba(15, 23, 42, ${top}) 0%, rgba(2, 6, 23, ${bottom}) 100%)`;
});

const previewStatusText = computed(() => {
  if (!trimmedBgUrl.value) return '默认星空背景';
  if (previewError.value) return '图片加载失败 · 将回退默认星空';
  if (trimmedBgUrl.value.startsWith('/uploads/')) return '本地已上传壁纸';
  return '网络背景图片';
});

watch(trimmedBgUrl, () => {
  previewError.value = false;
});

async function loadAppearance() {
  try {
    const { data } = await getSiteAppearance();
    bgUrl.value = data?.site_bg_url || '';
    bgOverlay.value = data?.site_bg_overlay !== undefined ? Number(data.site_bg_overlay) : DEFAULT_OVERLAY;
    previewError.value = false;
  } catch (error) {
    notify(error.response?.data?.message || '读取首页背景配置失败', 'error');
  }
}

onMounted(async () => {
  const [webdavRes] = await Promise.allSettled([getWebdavConfig(), loadAppearance()]);
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
  const cleanUrl = trimmedBgUrl.value;
  if (cleanUrl && !cleanUrl.startsWith('/uploads/') && !/^https?:\/\//i.test(cleanUrl)) {
    return notify('请输入有效的 http:// 或 https:// 图片链接', 'error');
  }
  bgSaving.value = true;
  try {
    const { data } = await updateSiteAppearance({
      site_bg_url: cleanUrl,
      site_bg_overlay: bgOverlay.value
    });
    bgUrl.value = data.site_bg_url || '';
    bgOverlay.value = Number(data.site_bg_overlay ?? DEFAULT_OVERLAY);
    notify(data.message || '背景设置已保存');
  } catch (error) {
    notify(error.response?.data?.message || '保存背景设置失败', 'error');
  } finally {
    bgSaving.value = false;
  }
}

async function handleResetAppearance() {
  bgSaving.value = true;
  try {
    const { data } = await updateSiteAppearance({
      site_bg_url: '',
      site_bg_overlay: DEFAULT_OVERLAY
    });
    bgUrl.value = data.site_bg_url || '';
    bgOverlay.value = Number(data.site_bg_overlay ?? DEFAULT_OVERLAY);
    previewError.value = false;
    notify('已恢复默认星空背景');
  } catch (error) {
    notify(error.response?.data?.message || '恢复默认背景失败', 'error');
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
    const { data } = await uploadSiteBackground(file, bgOverlay.value);
    bgUrl.value = data.site_bg_url || data.url || '';
    if (data.site_bg_overlay !== undefined) {
      bgOverlay.value = Number(data.site_bg_overlay);
    }
    previewError.value = false;
    notify(data.message || '背景图片上传成功并已生效');
  } catch (error) {
    notify(error.response?.data?.message || '上传背景图片失败', 'error');
  } finally {
    bgUploading.value = false;
  }
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

.card-heading { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 20px; }
.card-heading h3 { margin: 0 0 5px; font-size: 18px; }
.card-heading p, .hint, .subheading small { color: #8190a9; font-size: 13px; margin-bottom: 0; }
.card-icon { width: 38px; height: 38px; display: grid; place-items: center; background: #eef3ff; border-radius: 11px; font-size: 19px; flex-shrink: 0; }

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
  background-image: url('https://main.ssss.nyc.mn/background.webp'), url('/background.webp');
  background-size: cover;
  background-position: center;
  border: 1px solid #dce3ef;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 8px 22px rgba(15, 23, 42, 0.12);
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

@media (max-width: 960px) {
  .appearance-layout { grid-template-columns: 1fr; gap: 18px; }
}

@media (max-width: 820px) {
  .settings-grid { grid-template-columns: 1fr; }
  .settings-page { padding-top: 0; }
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
