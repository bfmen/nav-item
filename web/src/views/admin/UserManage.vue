<template>
  <section class="settings-page">
    <div class="page-heading">
      <div>
        <p class="eyebrow">ACCOUNT & DATA</p>
        <h2>账号与数据</h2>
        <p class="page-description">管理后台密码，并安全备份或还原 Nav-Item 数据。</p>
      </div>
    </div>

    <div class="settings-grid">
      <article class="settings-card">
        <div class="card-heading"><span class="card-icon">🔐</span><div><h3>修改密码</h3><p>修改后当前登录会话将自动退出。</p></div></div>
        <form class="form" @submit.prevent="handleChangePassword">
          <label>当前密码<input v-model="oldPassword" type="password" autocomplete="current-password" placeholder="请输入当前密码" /></label>
          <label>新密码<input v-model="newPassword" type="password" autocomplete="new-password" placeholder="至少 6 位字符" /></label>
          <label>确认新密码<input v-model="confirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label>
          <button class="primary-button" type="submit" :disabled="passwordLoading">{{ passwordLoading ? '保存中…' : '保存新密码' }}</button>
        </form>
      </article>

      <article class="settings-card backup-card">
        <div class="card-heading"><span class="card-icon">💾</span><div><h3>备份还原</h3><p>导出栏目、卡片、友链和账户数据，便于迁移与恢复。</p></div></div>
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
            <label>选择云端备份（默认最新）<select v-model="selectedWebdavUrl"><option v-for="(file, index) in webdavFiles" :key="file.url" :value="file.url">{{ file.name }}{{ index === 0 ? '（最新）' : '' }}{{ file.modified ? ` · ${formatDate(file.modified)}` : '' }}</option></select></label>
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
import { onMounted, ref } from 'vue';
import { backupToWebdav, changePassword, exportBackup, getWebdavConfig, listWebdavBackups, logout, restoreBackup, restoreWebdavBackup, saveWebdavConfig } from '../../api';

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

onMounted(async () => {
  try {
    const { data } = await getWebdavConfig();
    webdav.value = { url: data.data?.url || '', username: data.data?.username || '', password: data.data?.password || '' };
    if (webdav.value.url) await loadWebdavBackups();
  } catch (error) { notify(error.response?.data?.message || '读取 WebDAV 配置失败', 'error'); }
});
const message = ref('');
const messageType = ref('success');
const webdav = ref({ url: '', username: '', password: '' });

function notify(text, type = 'success') {
  message.value = text;
  messageType.value = type;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { message.value = ''; }, 4500);
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
    if (!window.confirm('还原后将覆盖当前栏目、卡片、友链和账户数据，确定继续吗？')) return;
    await restoreBackup(data);
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
  if (!window.confirm('还原后将覆盖当前栏目、卡片、友链和账户数据，确定继续吗？')) return;
  webdavRestoreLoading.value = true;
  try {
    await saveWebdavConfig(webdav.value);
    await restoreWebdavBackup({ ...webdav.value, fileUrl: selectedWebdavUrl.value });
    notify('云端备份还原成功，请刷新页面');
  } catch (error) { notify(error.response?.data?.message || '云端备份还原失败', 'error'); }
  finally { webdavRestoreLoading.value = false; }
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
</script>

<style scoped>
.settings-page { max-width: 1180px; margin: 0 auto; padding: 12px 2vw 36px; color: #172033; }
.page-heading { margin-bottom: 24px; }
.eyebrow { margin: 0 0 6px; color: #4f7cff; font-size: 11px; font-weight: 700; letter-spacing: 2px; }
h2, h3, p { margin-top: 0; }
h2 { margin-bottom: 8px; font-size: 28px; }
.page-description { color: #72809a; margin-bottom: 0; }
.settings-grid { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(380px, 1.2fr); gap: 20px; }
.settings-card { border: 1px solid #e7ecf5; border-radius: 18px; padding: 24px; background: #fff; box-shadow: 0 10px 28px rgba(36, 60, 105, .07); }
.card-heading { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 22px; }
.card-heading h3 { margin: 0 0 5px; font-size: 18px; }
.card-heading p, .hint, .subheading small { color: #8190a9; font-size: 13px; margin-bottom: 0; }
.card-icon { width: 38px; height: 38px; display: grid; place-items: center; background: #eef3ff; border-radius: 11px; font-size: 19px; }
.form, .webdav-box { display: grid; gap: 14px; }
label { display: grid; gap: 7px; color: #52617a; font-size: 13px; font-weight: 600; }
input { width: 100%; box-sizing: border-box; border: 1px solid #dce3ef; border-radius: 10px; padding: 11px 12px; color: #172033; background: #fbfcff; font-size: 14px; }
input:focus { outline: 2px solid rgba(79,124,255,.18); border-color: #4f7cff; }
button { border: 0; border-radius: 10px; padding: 11px 16px; font-size: 14px; font-weight: 600; cursor: pointer; transition: .2s; }
button:disabled { opacity: .55; cursor: not-allowed; }
.primary-button { color: #fff; background: linear-gradient(135deg, #4f7cff, #6c5ce7); }
.secondary-button { color: #4561a8; background: #eef3ff; }
.primary-button:hover:not(:disabled), .secondary-button:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(.98); }
.backup-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 22px; }
.file-button { display: inline-flex; align-items: center; cursor: pointer; }
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
@media (max-width: 820px) { .settings-grid { grid-template-columns: 1fr; } .settings-page { padding-top: 0; } }
@media (max-width: 480px) { .settings-card { padding: 18px; } .two-fields { grid-template-columns: 1fr; } .backup-actions button, .backup-actions .file-button, .webdav-buttons button { width: 100%; justify-content: center; } }
</style>
