<template>
  <Teleport to="body">
    <div v-if="visible" class="ai-modal-overlay" @click.self="handleClose">
      <div class="ai-modal" role="dialog" aria-modal="true" aria-label="AI 整理栏目">
        <div class="ai-modal-header">
          <div class="ai-header-title">
            <span class="ai-sparkle">✨</span>
            <h3>AI 智能整理栏目（主菜单 + 子菜单）</h3>
            <span class="ai-step-badge">{{ step === 'preview' ? '栏目变更预览' : '执行配置' }}</span>
          </div>
          <button type="button" class="ai-close-btn" @click="handleClose" title="关闭">✕</button>
        </div>

        <div class="ai-modal-body">
          <!-- 错误/状态提示 + WebDAV 失败时提供忽略备份强制应用按钮 -->
          <div v-if="notice.text" :class="['ai-notice', notice.type]">
            <div>{{ notice.text }}</div>
            <div v-if="backupFailedPrompt" class="force-apply-row">
              <button
                type="button"
                class="ai-btn ai-btn-xs ai-btn-danger-outline"
                :disabled="applying"
                @click="handleForceApplyWithoutBackup"
              >
                忽略备份并强制应用栏目更改
              </button>
            </div>
          </div>

          <!-- 异步任务进度条 -->
          <div v-if="organizing" class="task-progress-panel">
            <div class="progress-top">
              <div class="progress-status">
                <span class="spinner dark"></span>
                <span>{{ taskProgress.message || '正在分析主菜单与子菜单结构...' }}</span>
              </div>
              <div class="progress-right">
                <span class="progress-pct">{{ taskProgress.progress }}%</span>
                <button type="button" class="ai-btn ai-btn-xs ai-btn-danger-outline" @click="handleCancelTask">
                  取消任务
                </button>
              </div>
            </div>
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: `${Math.max(5, taskProgress.progress)}%` }"></div>
            </div>
          </div>

          <!-- 阶段一：配置 -->
          <div v-if="step === 'config'" class="ai-config-view">
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">1</span>
                  <span>当前激活 AI 接口（复用全局配置）</span>
                </div>
              </div>
              <div v-if="activeConfig" class="active-api-card">
                <div class="active-api-row">
                  <strong>{{ activeConfig.name }}</strong>
                  <span v-if="activeConfig.model" class="model-tag">{{ activeConfig.model }}</span>
                  <span v-else class="model-missing-tag">未配置模型</span>
                </div>
                <div class="active-api-url">{{ activeConfig.base_url }}</div>
              </div>
              <div v-else class="empty-config-tip">
                尚未配置 AI 接口，请先前往「卡片管理 → ✨ AI 智能整理」中添加并激活 AI 接口与模型。
              </div>
            </section>

            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">2</span>
                  <span>栏目整理要求（选填）</span>
                </div>
              </div>
              <textarea
                v-model="customPrompt"
                class="ai-textarea"
                rows="4"
                :disabled="organizing"
                placeholder="选填。留空将执行默认栏目优化规则：规范主/子菜单名称大小写与格式（如 Al chat -> AI Chat、ai自建 -> AI 自建）、优化展示排序、识别并建议合并高度重叠的子菜单（自动迁移下属卡片）、清理完全空置栏目。&#10;也可输入自定义指令，如：“把所有英文栏目名统一翻译为中文，并将 Dev Tools 与 Tools 下的相似子菜单合并”。"
              ></textarea>
            </section>
          </div>

          <!-- 阶段二：栏目 Diff 预览 -->
          <div v-else class="ai-preview-view">
            <div class="preview-summary">
              <div class="summary-left">
                <span>已分析 <strong>{{ previewMeta.totalMenus }}</strong> 个主菜单、<strong>{{ previewMeta.totalSubMenus }}</strong> 个子菜单</span>
                <span class="divider">·</span>
                <span>共 <strong>{{ totalChangeCount }}</strong> 项建议，已勾选 <strong>{{ selectedTotalCount }}</strong> 项</span>
                <span v-if="previewMeta.model" class="model-tag">{{ previewMeta.model }}</span>
              </div>
              <button type="button" class="ai-btn ai-btn-sm ai-btn-ghost" @click="step = 'config'">
                ← 返回修改要求
              </button>
            </div>

            <div v-if="totalChangeCount === 0" class="empty-diff">
              <div class="empty-diff-icon">✅</div>
              <p>AI 分析完成，当前主菜单和子菜单的命名、排序与结构都很清晰，暂无需要调整的项目。</p>
            </div>

            <div v-else class="diff-groups">
              <!-- 1. 重命名 -->
              <section v-if="plan.renames.length" class="diff-group">
                <div class="diff-group-head">🏷 名称规范与重命名 ({{ plan.renames.length }})</div>
                <div class="diff-items">
                  <label v-for="item in plan.renames" :key="item.key" class="diff-item">
                    <input type="checkbox" :checked="selectedKeys.has(item.key)" @change="toggleKey(item.key)" />
                    <div class="diff-item-body">
                      <div class="diff-line">
                        <span class="kind-pill">{{ item.kind === 'menu' ? '主菜单' : `子菜单 · ${item.parent_name}` }}</span>
                        <span class="diff-old">{{ item.old_name }}</span>
                        <span class="diff-arrow">→</span>
                        <span class="diff-new">{{ item.new_name }}</span>
                      </div>
                      <div v-if="item.reason" class="diff-reason">{{ item.reason }}</div>
                    </div>
                  </label>
                </div>
              </section>

              <!-- 2. 合并子菜单 -->
              <section v-if="plan.merges.length" class="diff-group merge-group">
                <div class="diff-group-head">🔀 合并重叠子菜单 ({{ plan.merges.length }})</div>
                <div class="diff-items">
                  <label v-for="item in plan.merges" :key="item.key" class="diff-item">
                    <input type="checkbox" :checked="selectedKeys.has(item.key)" @change="toggleKey(item.key)" />
                    <div class="diff-item-body">
                      <div class="diff-line">
                        <span class="cat-badge old">{{ item.source_parent_name }} / {{ item.source_name }}</span>
                        <span class="diff-arrow">合并至 →</span>
                        <span class="cat-badge new">{{ item.target_parent_name }} / {{ item.target_name }}</span>
                        <span class="migrate-badge">将自动迁移 {{ item.card_count }} 张卡片</span>
                      </div>
                      <div v-if="item.reason" class="diff-reason">{{ item.reason }}</div>
                    </div>
                  </label>
                </div>
              </section>

              <!-- 3. 排序调整 -->
              <section v-if="plan.reorders.length" class="diff-group">
                <div class="diff-group-head">↕ 排序优化 ({{ plan.reorders.length }})</div>
                <div class="diff-items">
                  <label v-for="item in plan.reorders" :key="item.key" class="diff-item">
                    <input type="checkbox" :checked="selectedKeys.has(item.key)" @change="toggleKey(item.key)" />
                    <div class="diff-item-body">
                      <div class="diff-line">
                        <span class="kind-pill">{{ item.kind === 'menu' ? '主菜单排序' : `子菜单排序 · ${item.parent_name}` }}</span>
                      </div>
                      <div class="order-compare">
                        <div><span class="order-label">原顺序：</span>{{ item.old_order_names.join(' → ') }}</div>
                        <div><span class="order-label new">新顺序：</span><strong>{{ item.new_order_names.join(' → ') }}</strong></div>
                      </div>
                      <div v-if="item.reason" class="diff-reason">{{ item.reason }}</div>
                    </div>
                  </label>
                </div>
              </section>

              <!-- 4. 新增栏目 -->
              <section v-if="plan.additions.length" class="diff-group">
                <div class="diff-group-head">➕ 新增栏目 ({{ plan.additions.length }})</div>
                <div class="diff-items">
                  <label v-for="item in plan.additions" :key="item.key" class="diff-item">
                    <input type="checkbox" :checked="selectedKeys.has(item.key)" @change="toggleKey(item.key)" />
                    <div class="diff-item-body">
                      <div class="diff-line">
                        <span class="kind-pill">{{ item.kind === 'menu' ? '新增主菜单' : `新增子菜单 · ${item.parent_name}` }}</span>
                        <span class="diff-new">{{ item.name }}</span>
                      </div>
                      <div v-if="item.reason" class="diff-reason">{{ item.reason }}</div>
                    </div>
                  </label>
                </div>
              </section>

              <!-- 5. 删除空栏目 -->
              <section v-if="plan.deletions.length" class="diff-group danger-group">
                <div class="diff-group-head">🗑 清理空栏目 ({{ plan.deletions.length }})</div>
                <div class="diff-items">
                  <label v-for="item in plan.deletions" :key="item.key" class="diff-item">
                    <input type="checkbox" :checked="selectedKeys.has(item.key)" @change="toggleKey(item.key)" />
                    <div class="diff-item-body">
                      <div class="diff-line">
                        <span class="kind-pill">{{ item.kind === 'menu' ? '空主菜单' : `空子菜单 · ${item.parent_name}` }}</span>
                        <span class="diff-old">{{ item.name }}</span>
                        <span class="empty-safe-pill">0 张活跃卡片</span>
                      </div>
                      <div v-if="item.reason" class="diff-reason">{{ item.reason }}</div>
                    </div>
                  </label>
                </div>
              </section>
            </div>
          </div>
        </div>

        <div class="ai-modal-footer">
          <template v-if="step === 'config'">
            <button type="button" class="ai-btn ai-btn-ghost" @click="handleClose">
              {{ organizing ? '取消并关闭' : '关闭' }}
            </button>
            <button
              type="button"
              class="ai-btn ai-btn-primary"
              :disabled="organizing || !activeConfig || !activeConfig.model"
              @click="handleStart"
            >
              <span v-if="organizing" class="spinner"></span>
              {{ organizing ? '后台分析中...' : '✨ 开始 AI 整理栏目' }}
            </button>
          </template>
          <template v-else>
            <label :class="['webdav-backup-toggle', { disabled: !webdavConfigured }]">
              <input
                v-model="autoBackupWebdav"
                type="checkbox"
                :disabled="!webdavConfigured || applying"
              />
              <span v-if="webdavConfigured">变更前自动备份到 WebDAV 云端</span>
              <span v-else>未配置 WebDAV，可在「用户管理」中设置</span>
            </label>
            <div class="footer-buttons">
              <button type="button" class="ai-btn ai-btn-ghost" @click="step = 'config'">重新整理</button>
              <button
                v-if="totalChangeCount > 0"
                type="button"
                class="ai-btn ai-btn-primary"
                :disabled="applying || selectedTotalCount === 0"
                @click="handleApply(false)"
              >
                {{ applying ? '正在应用更改...' : `应用栏目更改 (${selectedTotalCount})` }}
              </button>
              <button v-else type="button" class="ai-btn ai-btn-primary" @click="handleClose">完成</button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import {
  getAiConfigs,
  getWebdavConfig,
  startAiMenuOrganize,
  getAiOrganizeStatus,
  cancelAiOrganize,
  applyAiMenuOrganize
} from '../api';

const POLL_INTERVAL_MS = 2000;

const props = defineProps({
  visible: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'applied']);

const step = ref('config');
const configs = ref([]);
const customPrompt = ref('');
const organizing = ref(false);
const applying = ref(false);
const currentTaskId = ref('');
let pollTimer = null;

const taskProgress = ref({ progress: 0, message: '' });
const plan = ref({ renames: [], reorders: [], merges: [], additions: [], deletions: [] });
const selectedKeys = ref(new Set());
const previewMeta = ref({ totalMenus: 0, totalSubMenus: 0, model: '' });
const notice = ref({ text: '', type: 'info' });
const webdavConfigured = ref(false);
const autoBackupWebdav = ref(false);
const backupFailedPrompt = ref(false);

const activeConfig = computed(() => configs.value.find(c => c.is_active) || configs.value[0] || null);
const allItems = computed(() => [
  ...plan.value.renames,
  ...plan.value.merges,
  ...plan.value.reorders,
  ...plan.value.additions,
  ...plan.value.deletions
]);
const totalChangeCount = computed(() => allItems.value.length);
const selectedTotalCount = computed(() => allItems.value.filter(i => selectedKeys.value.has(i.key)).length);

function setNotice(text, type = 'info') {
  notice.value = { text, type };
}

function clearNotice() {
  notice.value = { text: '', type: 'info' };
  backupFailedPrompt.value = false;
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function formatError(err, fallback) {
  const data = err?.response?.data;
  const detail = data?.message || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || err?.message;
  return detail || fallback;
}

watch(() => props.visible, async (val) => {
  if (val) {
    clearNotice();
    stopPolling();
    organizing.value = false;
    currentTaskId.value = '';
    step.value = 'config';
    await Promise.all([loadConfigs(), loadWebdavStatus()]);
  } else {
    stopPolling();
  }
});

onBeforeUnmount(() => {
  stopPolling();
  if (organizing.value && currentTaskId.value) {
    cancelAiOrganize(currentTaskId.value).catch(() => {});
  }
});

async function loadConfigs() {
  try {
    const { data } = await getAiConfigs();
    configs.value = data.data || [];
  } catch (err) {
    setNotice(formatError(err, '读取 AI 接口配置失败'), 'error');
  }
}

async function loadWebdavStatus() {
  try {
    const { data } = await getWebdavConfig();
    const configured = Boolean(String(data?.data?.url || '').trim());
    webdavConfigured.value = configured;
    autoBackupWebdav.value = configured;
  } catch {
    webdavConfigured.value = false;
    autoBackupWebdav.value = false;
  }
}

async function pollOnce(taskId) {
  if (!organizing.value || currentTaskId.value !== taskId) return;
  try {
    const { data } = await getAiOrganizeStatus(taskId);
    if (!organizing.value || currentTaskId.value !== taskId) return;

    taskProgress.value = {
      progress: Number(data.progress || 0),
      message: data.message || '正在分析栏目结构...'
    };

    if (data.status === 'completed') {
      stopPolling();
      organizing.value = false;
      currentTaskId.value = '';
      const result = data.result || {};
      plan.value = {
        renames: result.renames || [],
        reorders: result.reorders || [],
        merges: result.merges || [],
        additions: result.additions || [],
        deletions: result.deletions || []
      };
      selectedKeys.value = new Set(allItems.value.map(i => i.key));
      previewMeta.value = {
        totalMenus: result.total_menus || 0,
        totalSubMenus: result.total_sub_menus || 0,
        model: result.model || activeConfig.value?.model || ''
      };
      step.value = 'preview';
      return;
    }

    if (data.status === 'failed') {
      stopPolling();
      organizing.value = false;
      currentTaskId.value = '';
      setNotice(data.message || `AI 整理栏目失败：${data.error || '未知错误'}`, 'error');
      return;
    }

    if (data.status === 'cancelled') {
      stopPolling();
      organizing.value = false;
      currentTaskId.value = '';
      setNotice('栏目整理任务已取消', 'info');
      return;
    }

    pollTimer = setTimeout(() => pollOnce(taskId), POLL_INTERVAL_MS);
  } catch (err) {
    stopPolling();
    organizing.value = false;
    currentTaskId.value = '';
    setNotice(formatError(err, '查询栏目整理进度失败'), 'error');
  }
}

async function handleStart() {
  if (!activeConfig.value) {
    setNotice('请先前往「卡片管理 → ✨ AI 智能整理」配置并激活 AI 接口', 'error');
    return;
  }
  if (!String(activeConfig.value.model || '').trim()) {
    setNotice('当前激活的 AI 接口尚未配置模型，请先在接口配置中设置模型', 'error');
    return;
  }

  organizing.value = true;
  clearNotice();
  taskProgress.value = { progress: 5, message: '正在启动栏目整理任务...' };

  try {
    const { data } = await startAiMenuOrganize({
      config_id: activeConfig.value.id,
      model: activeConfig.value.model,
      prompt: customPrompt.value.trim()
    });
    currentTaskId.value = data.taskId;
    taskProgress.value.message = data.message || '正在分析主菜单与子菜单结构...';
    pollTimer = setTimeout(() => pollOnce(data.taskId), POLL_INTERVAL_MS);
  } catch (err) {
    organizing.value = false;
    currentTaskId.value = '';
    setNotice(formatError(err, '启动栏目整理失败'), 'error');
  }
}

async function handleCancelTask() {
  const taskId = currentTaskId.value;
  stopPolling();
  organizing.value = false;
  currentTaskId.value = '';
  if (taskId) await cancelAiOrganize(taskId).catch(() => {});
  setNotice('栏目整理任务已取消', 'info');
}

function toggleKey(key) {
  const next = new Set(selectedKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedKeys.value = next;
}

async function handleApply(forceIgnoreBackup = false) {
  const payload = {
    renames: plan.value.renames.filter(i => selectedKeys.value.has(i.key)),
    reorders: plan.value.reorders.filter(i => selectedKeys.value.has(i.key)),
    merges: plan.value.merges.filter(i => selectedKeys.value.has(i.key)),
    additions: plan.value.additions.filter(i => selectedKeys.value.has(i.key)),
    deletions: plan.value.deletions.filter(i => selectedKeys.value.has(i.key)),
    auto_backup: forceIgnoreBackup ? false : Boolean(webdavConfigured.value && autoBackupWebdav.value)
  };
  if (selectedTotalCount.value === 0) {
    setNotice('请至少勾选一条要应用的栏目更改', 'error');
    return;
  }

  applying.value = true;
  clearNotice();
  try {
    const { data } = await applyAiMenuOrganize(payload);
    emit('applied', data);
    emit('close');
  } catch (err) {
    if (err?.response?.data?.backup_failed) {
      backupFailedPrompt.value = true;
    }
    setNotice(formatError(err, '应用栏目更改失败'), 'error');
  } finally {
    applying.value = false;
  }
}

function handleForceApplyWithoutBackup() {
  if (!window.confirm('确定忽略 WebDAV 云端备份并直接将栏目更改写入数据库吗？')) return;
  return handleApply(true);
}

async function handleClose() {
  if (applying.value) return;
  if (organizing.value) {
    const taskId = currentTaskId.value;
    stopPolling();
    organizing.value = false;
    currentTaskId.value = '';
    if (taskId) await cancelAiOrganize(taskId).catch(() => {});
  }
  emit('close');
}
</script>

<style scoped>
.ai-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 16px;
}

.ai-modal {
  background: #ffffff;
  border-radius: 16px;
  width: min(920px, 95vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.25);
  overflow: hidden;
  color: #1e293b;
}

.ai-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.ai-header-title { display: flex; align-items: center; gap: 10px; }
.ai-header-title h3 { margin: 0; font-size: 1.05rem; font-weight: 600; }
.ai-step-badge { font-size: 0.74rem; background: rgba(255, 255, 255, 0.2); padding: 2px 10px; border-radius: 999px; }
.ai-close-btn { background: rgba(255, 255, 255, 0.16); border: none; color: #fff; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; }
.ai-close-btn:hover { background: rgba(255, 255, 255, 0.28); }

.ai-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
.ai-notice { padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; line-height: 1.5; word-break: break-word; }
.ai-notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.ai-notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.ai-notice.info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
.force-apply-row { margin-top: 8px; }

.task-progress-panel { padding: 12px 15px; border-radius: 11px; background: #eef2ff; border: 1px solid #c7d2fe; display: flex; flex-direction: column; gap: 8px; }
.progress-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.progress-status { display: flex; align-items: center; gap: 8px; font-size: 0.86rem; font-weight: 600; color: #312e81; }
.progress-right { display: flex; align-items: center; gap: 10px; }
.progress-pct { font-size: 0.85rem; font-weight: 700; color: #4f46e5; }
.progress-track { width: 100%; height: 8px; border-radius: 999px; background: #dbeafe; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #667eea 0%, #764ba2 100%); transition: width 0.35s ease; }

.ai-config-view, .ai-preview-view { display: flex; flex-direction: column; gap: 14px; }
.ai-section { border: 1px solid #e2e8f0; border-radius: 12px; padding: 13px 16px; background: #f8fafc; }
.ai-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ai-section-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.9rem; }
.step-num { width: 21px; height: 21px; border-radius: 50%; background: #667eea; color: #fff; font-size: 0.76rem; display: inline-flex; align-items: center; justify-content: center; }

.active-api-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 9px; padding: 10px 12px; }
.active-api-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.active-api-url { font-size: 0.76rem; color: #64748b; margin-top: 3px; }
.model-tag { font-size: 0.72rem; padding: 1px 7px; border-radius: 4px; background: #e0e7ff; color: #4338ca; }
.model-missing-tag { font-size: 0.72rem; padding: 1px 7px; border-radius: 4px; background: #ffedd5; color: #c2410c; }
.empty-config-tip { padding: 14px; text-align: center; font-size: 0.85rem; color: #64748b; background: #fff; border-radius: 8px; border: 1px dashed #cbd5e1; }

.ai-textarea { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.85rem; font-family: inherit; resize: vertical; background: #fff; line-height: 1.5; }

.preview-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 9px 13px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.84rem; }
.summary-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.divider { color: #cbd5e1; }
.empty-diff { text-align: center; padding: 34px 20px; color: #475569; }
.empty-diff-icon { font-size: 2rem; margin-bottom: 6px; }

.diff-groups { display: flex; flex-direction: column; gap: 12px; }
.diff-group { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; background: #fff; }
.diff-group.merge-group { border-color: #bfdbfe; }
.diff-group.danger-group { border-color: #fecaca; }
.diff-group-head { padding: 8px 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-size: 0.84rem; font-weight: 600; color: #334155; }
.merge-group .diff-group-head { background: #eff6ff; color: #1d4ed8; }
.danger-group .diff-group-head { background: #fef2f2; color: #b91c1c; }

.diff-items { display: flex; flex-direction: column; }
.diff-item { display: flex; align-items: flex-start; gap: 10px; padding: 9px 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
.diff-item:last-child { border-bottom: none; }
.diff-item:hover { background: #f8fafc; }
.diff-item-body { flex: 1; min-width: 0; font-size: 0.83rem; }
.diff-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kind-pill { font-size: 0.72rem; padding: 1px 7px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 600; }
.diff-old { color: #b91c1c; background: #fee2e2; padding: 1px 6px; border-radius: 4px; text-decoration: line-through; }
.diff-new { color: #047857; background: #d1fae5; padding: 1px 6px; border-radius: 4px; font-weight: 600; }
.diff-arrow { color: #64748b; font-weight: 600; }
.cat-badge { display: inline-block; padding: 2px 7px; border-radius: 5px; font-size: 0.78rem; }
.cat-badge.old { background: #fee2e2; color: #991b1b; }
.cat-badge.new { background: #dbeafe; color: #1d4ed8; font-weight: 600; }
.migrate-badge { font-size: 0.74rem; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #b45309; font-weight: 600; }
.empty-safe-pill { font-size: 0.72rem; padding: 1px 7px; border-radius: 999px; background: #ecfdf5; color: #047857; }
.order-compare { margin-top: 5px; font-size: 0.79rem; color: #475569; display: flex; flex-direction: column; gap: 3px; }
.order-label { color: #64748b; }
.order-label.new { color: #047857; }
.diff-reason { font-size: 0.76rem; color: #64748b; margin-top: 4px; }

.ai-modal-footer { padding: 12px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.webdav-backup-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; color: #334155; cursor: pointer; }
.webdav-backup-toggle.disabled { color: #94a3b8; cursor: not-allowed; }
.footer-buttons { display: flex; align-items: center; gap: 10px; margin-left: auto; }

.ai-btn { border: none; border-radius: 8px; padding: 8px 15px; font-size: 0.86rem; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ai-btn-sm { padding: 5px 11px; font-size: 0.8rem; }
.ai-btn-xs { padding: 3px 9px; font-size: 0.76rem; }
.ai-btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
.ai-btn-danger-outline { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
.ai-btn-ghost { background: #e2e8f0; color: #334155; }

.spinner { width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.35); border-top-color: #fff; border-radius: 50%; animation: ai-spin 0.7s linear infinite; }
.spinner.dark { border-color: rgba(79, 70, 229, 0.25); border-top-color: #4f46e5; }
@keyframes ai-spin { to { transform: rotate(360deg); } }
</style>
