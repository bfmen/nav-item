<template>
  <Teleport to="body">
    <div v-if="visible" class="ai-modal-overlay" @click.self="handleClose">
      <div class="ai-modal" role="dialog" aria-modal="true" aria-label="AI 智能整理">
        <div class="ai-modal-header">
          <div class="ai-header-title">
            <span class="ai-sparkle">✨</span>
            <h3>AI 智能整理</h3>
            <span class="ai-step-badge">{{ step === 'preview' ? '变更预览确认' : '接口配置与执行' }}</span>
          </div>
          <button type="button" class="ai-close-btn" @click="handleClose" title="关闭">✕</button>
        </div>

        <div class="ai-modal-body">
          <div v-if="notice.text" :class="['ai-notice', notice.type]">
            {{ notice.text }}
          </div>

          <!-- 阶段一：配置与执行 -->
          <div v-if="step === 'config'" class="ai-config-view">
            <!-- 1. 多 API 接口配置管理 -->
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">1</span>
                  <span>AI 接口配置（支持 OpenAI 官方与第三方中转）</span>
                </div>
                <button type="button" class="ai-btn ai-btn-sm ai-btn-outline" @click="openNewConfigForm">
                  + 新增接口
                </button>
              </div>

              <!-- 已有接口列表 -->
              <div v-if="configs.length" class="config-list">
                <div
                  v-for="cfg in configs"
                  :key="cfg.id"
                  :class="['config-item', { active: cfg.is_active }]"
                  @click="handleActivate(cfg)"
                >
                  <div class="config-radio">
                    <span :class="['radio-dot', { checked: cfg.is_active }]"></span>
                  </div>
                  <div class="config-meta">
                    <div class="config-name-row">
                      <span class="config-name">{{ cfg.name }}</span>
                      <span v-if="cfg.is_active" class="active-tag">当前激活</span>
                      <span v-if="cfg.model" class="model-tag">{{ cfg.model }}</span>
                    </div>
                    <div class="config-url">{{ cfg.base_url }}</div>
                  </div>
                  <div class="config-actions" @click.stop>
                    <button type="button" class="ai-icon-btn" title="编辑配置" @click="openEditConfigForm(cfg)">✎</button>
                    <button type="button" class="ai-icon-btn danger" title="删除配置" @click="handleDeleteConfig(cfg)">🗑</button>
                  </div>
                </div>
              </div>
              <div v-else-if="!showConfigForm" class="empty-config-tip">
                尚未配置 AI 接口，请点击右上角「+ 新增接口」添加 OpenAI 或兼容中转服务。
              </div>

              <!-- 新增 / 编辑配置表单 -->
              <div v-if="showConfigForm" class="config-form">
                <div class="config-form-title">{{ editingConfigId ? '编辑 AI 接口' : '新增 AI 接口' }}</div>
                <div class="form-grid">
                  <label class="form-field">
                    <span>配置名称 *</span>
                    <input v-model="configForm.name" type="text" placeholder="如：OpenAI 官方 / OneAPI 中转" />
                  </label>
                  <label class="form-field">
                    <span>API Base URL *</span>
                    <input v-model="configForm.base_url" type="url" placeholder="https://api.openai.com/v1" />
                  </label>
                  <label class="form-field">
                    <span>API Key *</span>
                    <div class="key-input-wrap">
                      <input
                        v-model="configForm.api_key"
                        :type="showApiKey ? 'text' : 'password'"
                        placeholder="sk-..."
                        autocomplete="off"
                      />
                      <button type="button" class="toggle-key-btn" @click="showApiKey = !showApiKey" :title="showApiKey ? '隐藏' : '显示'">
                        {{ showApiKey ? '🙈' : '👁' }}
                      </button>
                    </div>
                  </label>
                  <label class="form-field">
                    <span>默认模型（可选）</span>
                    <input v-model="configForm.model" type="text" placeholder="如：gpt-4o-mini / deepseek-chat" />
                  </label>
                </div>
                <div class="form-actions">
                  <button type="button" class="ai-btn ai-btn-sm ai-btn-ghost" @click="cancelConfigForm">取消</button>
                  <button type="button" class="ai-btn ai-btn-sm ai-btn-primary" :disabled="savingConfig" @click="handleSaveConfig">
                    {{ savingConfig ? '保存中...' : '保存配置' }}
                  </button>
                </div>
              </div>
            </section>

            <!-- 2. 模型选择 -->
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">2</span>
                  <span>选择模型</span>
                </div>
                <button
                  type="button"
                  class="ai-btn ai-btn-sm ai-btn-outline"
                  :disabled="fetchingModels || !activeConfig"
                  @click="handleFetchModels"
                >
                  {{ fetchingModels ? '拉取中...' : '🔄 拉取模型列表' }}
                </button>
              </div>
              <div class="model-select-row">
                <select
                  v-if="fetchedModels.length"
                  v-model="selectedModel"
                  class="ai-select"
                >
                  <option value="" disabled>-- 从拉取的模型中选择 --</option>
                  <option v-for="m in fetchedModels" :key="m" :value="m">{{ m }}</option>
                </select>
                <input
                  v-model="selectedModel"
                  type="text"
                  class="ai-input"
                  :placeholder="fetchedModels.length ? '或直接手动输入模型名称' : '可点击右上角拉取模型列表，或直接手动输入模型名（如 gpt-4o-mini）'"
                />
              </div>
            </section>

            <!-- 3. 整理范围与 Prompt -->
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">3</span>
                  <span>整理范围与整理要求（选填）</span>
                </div>
                <div class="scope-switch">
                  <label class="scope-option">
                    <input v-model="organizeScope" type="radio" value="all" />
                    <span>全部卡片</span>
                  </label>
                  <label class="scope-option" :class="{ disabled: !hasCurrentFilter }">
                    <input v-model="organizeScope" type="radio" value="current" :disabled="!hasCurrentFilter" />
                    <span>当前筛选栏目</span>
                  </label>
                </div>
              </div>
              <textarea
                v-model="customPrompt"
                class="ai-textarea"
                rows="3"
                placeholder="选填。留空将使用内置默认规则：自动识别现有主菜单/子菜单结构进行智能归类、补全缺失的简洁中文描述、统一网站标题大小写规范。"
              ></textarea>
            </section>
          </div>

          <!-- 阶段二：Diff 变更预览与确认 -->
          <div v-else class="ai-preview-view">
            <div class="preview-summary">
              <div class="summary-left">
                <span>已分析 <strong>{{ previewMeta.totalAnalyzed }}</strong> 张卡片</span>
                <span class="divider">·</span>
                <span>建议修改 <strong>{{ diffChanges.length }}</strong> 项</span>
                <span class="divider">·</span>
                <span>已勾选 <strong>{{ selectedDiffIds.length }}</strong> 项</span>
                <span v-if="previewMeta.model" class="model-tag">{{ previewMeta.model }}</span>
              </div>
              <button type="button" class="ai-btn ai-btn-sm ai-btn-ghost" @click="step = 'config'">
                ← 返回修改配置
              </button>
            </div>

            <div v-if="!diffChanges.length" class="empty-diff">
              <div class="empty-diff-icon">✅</div>
              <p>AI 分析完成，当前卡片的分类、标题和描述均已合理，无需调整。</p>
            </div>

            <div v-else class="diff-table-wrap">
              <table class="diff-table">
                <thead>
                  <tr>
                    <th class="col-check">
                      <input
                        type="checkbox"
                        :checked="allDiffSelected"
                        :indeterminate.prop="someDiffSelected"
                        @change="toggleAllDiffs"
                      />
                    </th>
                    <th class="col-card">卡片标题 / 网址</th>
                    <th class="col-cat">分类变更</th>
                    <th class="col-desc">描述变更</th>
                    <th class="col-reason">说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in diffChanges"
                    :key="item.id"
                    :class="{ unselected: !selectedDiffIds.includes(item.id) }"
                  >
                    <td class="col-check">
                      <input
                        type="checkbox"
                        :checked="selectedDiffIds.includes(item.id)"
                        @change="toggleDiffItem(item.id)"
                      />
                    </td>
                    <td class="col-card">
                      <div v-if="item.changed_fields.includes('title')" class="diff-inline">
                        <span class="diff-old">{{ item.old_title }}</span>
                        <span class="diff-arrow">→</span>
                        <span class="diff-new">{{ item.new_title }}</span>
                      </div>
                      <div v-else class="card-title-plain">{{ item.old_title }}</div>
                      <div class="card-url-sub" :title="item.url">{{ item.url }}</div>
                    </td>
                    <td class="col-cat">
                      <div v-if="item.changed_fields.includes('category')" class="diff-stack">
                        <span class="cat-badge old">{{ item.old_category }}</span>
                        <span class="diff-arrow">→</span>
                        <span class="cat-badge new">{{ item.new_category }}</span>
                      </div>
                      <span v-else class="unchanged-text">{{ item.old_category }}</span>
                    </td>
                    <td class="col-desc">
                      <div v-if="item.changed_fields.includes('desc')" class="diff-stack">
                        <span class="diff-old">{{ item.old_desc || '（空）' }}</span>
                        <span class="diff-arrow">→</span>
                        <span class="diff-new">{{ item.new_desc || '（空）' }}</span>
                      </div>
                      <span v-else class="unchanged-text">{{ item.old_desc || '（空）' }}</span>
                    </td>
                    <td class="col-reason">
                      <span class="reason-text">{{ item.reason || '-' }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="ai-modal-footer">
          <template v-if="step === 'config'">
            <button type="button" class="ai-btn ai-btn-ghost" @click="handleClose">关闭</button>
            <button
              type="button"
              class="ai-btn ai-btn-primary"
              :disabled="organizing || !activeConfig || !selectedModel.trim()"
              @click="handleOrganize"
            >
              <span v-if="organizing" class="spinner"></span>
              {{ organizing ? 'AI 正在分析整理中...' : '✨ 开始 AI 智能整理' }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="ai-btn ai-btn-ghost" @click="step = 'config'">重新整理</button>
            <button
              v-if="diffChanges.length"
              type="button"
              class="ai-btn ai-btn-primary"
              :disabled="applying || !selectedDiffIds.length"
              @click="handleApply"
            >
              {{ applying ? '正在写入数据库...' : `应用更改 (${selectedDiffIds.length})` }}
            </button>
            <button v-else type="button" class="ai-btn ai-btn-primary" @click="handleClose">完成</button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import {
  getAiConfigs,
  addAiConfig,
  updateAiConfig,
  activateAiConfig,
  deleteAiConfig,
  fetchAiModels,
  runAiOrganize,
  applyAiOrganize
} from '../api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  currentMenuId: { type: [Number, String], default: 'all' },
  currentSubMenuId: { type: [Number, String], default: 'all' }
});

const emit = defineEmits(['close', 'applied']);

const step = ref('config');
const configs = ref([]);
const showConfigForm = ref(false);
const editingConfigId = ref(null);
const showApiKey = ref(false);
const savingConfig = ref(false);
const configForm = ref({ name: '', base_url: 'https://api.openai.com/v1', api_key: '', model: '' });

const fetchedModels = ref([]);
const fetchingModels = ref(false);
const selectedModel = ref('');
const organizeScope = ref('all');
const customPrompt = ref('');
const organizing = ref(false);
const applying = ref(false);

const diffChanges = ref([]);
const selectedDiffIds = ref([]);
const previewMeta = ref({ totalAnalyzed: 0, model: '' });
const notice = ref({ text: '', type: 'info' });

const activeConfig = computed(() => configs.value.find(c => c.is_active) || configs.value[0] || null);
const hasCurrentFilter = computed(() => props.currentMenuId !== 'all' && props.currentMenuId !== '' && props.currentMenuId != null);

const allDiffSelected = computed(() =>
  diffChanges.value.length > 0 && selectedDiffIds.value.length === diffChanges.value.length
);
const someDiffSelected = computed(() =>
  selectedDiffIds.value.length > 0 && selectedDiffIds.value.length < diffChanges.value.length
);

function setNotice(text, type = 'info') {
  notice.value = { text, type };
}

function clearNotice() {
  notice.value = { text: '', type: 'info' };
}

watch(() => props.visible, async (val) => {
  if (val) {
    clearNotice();
    step.value = 'config';
    if (!hasCurrentFilter.value) organizeScope.value = 'all';
    await loadConfigs();
  }
});

watch(activeConfig, (cfg) => {
  if (cfg) {
    selectedModel.value = cfg.model || selectedModel.value || '';
  }
});

async function loadConfigs() {
  try {
    const { data } = await getAiConfigs();
    configs.value = data.data || [];
    const active = configs.value.find(c => c.is_active) || configs.value[0];
    if (active) {
      selectedModel.value = active.model || '';
    } else {
      selectedModel.value = '';
    }
  } catch (err) {
    setNotice(err.response?.data?.message || '读取 AI 接口配置失败', 'error');
  }
}

function openNewConfigForm() {
  clearNotice();
  editingConfigId.value = null;
  showApiKey.value = false;
  configForm.value = { name: '', base_url: 'https://api.openai.com/v1', api_key: '', model: '' };
  showConfigForm.value = true;
}

function openEditConfigForm(cfg) {
  clearNotice();
  editingConfigId.value = cfg.id;
  showApiKey.value = false;
  configForm.value = {
    name: cfg.name,
    base_url: cfg.base_url,
    api_key: cfg.api_key,
    model: cfg.model || ''
  };
  showConfigForm.value = true;
}

function cancelConfigForm() {
  showConfigForm.value = false;
  editingConfigId.value = null;
}

async function handleSaveConfig() {
  if (!configForm.value.name.trim() || !configForm.value.base_url.trim() || !configForm.value.api_key.trim()) {
    setNotice('请填写配置名称、API Base URL 和 API Key', 'error');
    return;
  }
  savingConfig.value = true;
  clearNotice();
  try {
    if (editingConfigId.value) {
      await updateAiConfig(editingConfigId.value, configForm.value);
      setNotice('AI 接口配置已更新', 'success');
    } else {
      await addAiConfig({ ...configForm.value, is_active: true });
      setNotice('AI 接口配置已添加并激活', 'success');
    }
    showConfigForm.value = false;
    editingConfigId.value = null;
    fetchedModels.value = [];
    await loadConfigs();
  } catch (err) {
    setNotice(err.response?.data?.message || '保存配置失败', 'error');
  } finally {
    savingConfig.value = false;
  }
}

async function handleActivate(cfg) {
  if (cfg.is_active) return;
  clearNotice();
  try {
    await activateAiConfig(cfg.id);
    fetchedModels.value = [];
    await loadConfigs();
  } catch (err) {
    setNotice(err.response?.data?.message || '切换接口失败', 'error');
  }
}

async function handleDeleteConfig(cfg) {
  if (!window.confirm(`确定要删除 AI 接口「${cfg.name}」吗？`)) return;
  clearNotice();
  try {
    await deleteAiConfig(cfg.id);
    if (editingConfigId.value === cfg.id) cancelConfigForm();
    fetchedModels.value = [];
    await loadConfigs();
    setNotice('配置已删除', 'success');
  } catch (err) {
    setNotice(err.response?.data?.message || '删除配置失败', 'error');
  }
}

async function handleFetchModels() {
  if (!activeConfig.value) {
    setNotice('请先添加并激活一个 AI 接口', 'error');
    return;
  }
  fetchingModels.value = true;
  clearNotice();
  try {
    const { data } = await fetchAiModels({ config_id: activeConfig.value.id });
    fetchedModels.value = data.models || [];
    if (fetchedModels.value.length) {
      if (!selectedModel.value || !fetchedModels.value.includes(selectedModel.value)) {
        const preferred = fetchedModels.value.find(m => /gpt-4o-mini|gpt-4o|deepseek-chat|claude-3-5|gemini-2/i.test(m));
        selectedModel.value = preferred || fetchedModels.value[0];
      }
      setNotice(`成功拉取 ${fetchedModels.value.length} 个可用模型`, 'success');
    } else {
      setNotice('接口返回了空的模型列表，你可以直接在右侧手动输入模型名称', 'info');
    }
  } catch (err) {
    setNotice(err.response?.data?.message || '拉取模型列表失败', 'error');
  } finally {
    fetchingModels.value = false;
  }
}

async function handleOrganize() {
  if (!activeConfig.value) {
    setNotice('请先添加并激活一个 AI 接口配置', 'error');
    return;
  }
  if (!selectedModel.value.trim()) {
    setNotice('请先选择或手动输入要使用的模型名称', 'error');
    return;
  }
  organizing.value = true;
  clearNotice();
  try {
    const payload = {
      config_id: activeConfig.value.id,
      model: selectedModel.value.trim(),
      prompt: customPrompt.value.trim()
    };
    if (organizeScope.value === 'current' && hasCurrentFilter.value) {
      payload.menu_id = props.currentMenuId;
      payload.sub_menu_id = props.currentSubMenuId;
    }
    const { data } = await runAiOrganize(payload);
    diffChanges.value = data.changes || [];
    selectedDiffIds.value = diffChanges.value.map(item => item.id);
    previewMeta.value = {
      totalAnalyzed: data.total_analyzed || 0,
      model: data.model || selectedModel.value.trim()
    };
    step.value = 'preview';
  } catch (err) {
    setNotice(err.response?.data?.message || 'AI 智能整理执行失败', 'error');
  } finally {
    organizing.value = false;
  }
}

function toggleAllDiffs(event) {
  selectedDiffIds.value = event.target.checked
    ? diffChanges.value.map(item => item.id)
    : [];
}

function toggleDiffItem(id) {
  if (selectedDiffIds.value.includes(id)) {
    selectedDiffIds.value = selectedDiffIds.value.filter(item => item !== id);
  } else {
    selectedDiffIds.value = [...selectedDiffIds.value, id];
  }
}

async function handleApply() {
  const chosen = diffChanges.value.filter(item => selectedDiffIds.value.includes(item.id));
  if (!chosen.length) {
    setNotice('请至少勾选一条要应用的更改', 'error');
    return;
  }
  applying.value = true;
  clearNotice();
  try {
    const { data } = await applyAiOrganize(chosen);
    emit('applied', data.updated || chosen.length);
    emit('close');
  } catch (err) {
    setNotice(err.response?.data?.message || '应用更改失败', 'error');
  } finally {
    applying.value = false;
  }
}

function handleClose() {
  if (organizing.value || applying.value) return;
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
  width: min(980px, 95vw);
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
  padding: 14px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.ai-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-header-title h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.ai-sparkle {
  font-size: 1.15rem;
}

.ai-step-badge {
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 10px;
  border-radius: 999px;
}

.ai-close-btn {
  background: rgba(255, 255, 255, 0.16);
  border: none;
  color: #fff;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.95rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ai-close-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.ai-modal-body {
  padding: 18px 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-notice {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.875rem;
}
.ai-notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.ai-notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.ai-notice.info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }

.ai-config-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-section {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 16px;
  background: #f8fafc;
}

.ai-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.ai-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.92rem;
  color: #1e293b;
}

.step-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #667eea;
  color: #fff;
  font-size: 0.78rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.config-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 10px;
}

.config-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}

.config-item:hover {
  border-color: #a5b4fc;
}

.config-item.active {
  border-color: #667eea;
  background: #f5f7ff;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.14);
}

.radio-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  display: inline-block;
  position: relative;
}

.radio-dot.checked {
  border-color: #667eea;
}

.radio-dot.checked::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: #667eea;
}

.config-meta {
  flex: 1;
  min-width: 0;
}

.config-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.config-name {
  font-weight: 600;
  font-size: 0.88rem;
  color: #0f172a;
}

.active-tag {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 4px;
  background: #667eea;
  color: #fff;
}

.model-tag {
  font-size: 0.72rem;
  padding: 1px 7px;
  border-radius: 4px;
  background: #e0e7ff;
  color: #4338ca;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-url {
  font-size: 0.76rem;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.config-actions {
  display: flex;
  gap: 4px;
}

.ai-icon-btn {
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
}
.ai-icon-btn:hover { background: #f1f5f9; color: #1e293b; }
.ai-icon-btn.danger:hover { background: #fee2e2; color: #dc2626; border-color: #fecaca; }

.empty-config-tip {
  text-align: center;
  padding: 16px;
  color: #64748b;
  font-size: 0.86rem;
  background: #fff;
  border-radius: 8px;
  border: 1px dashed #cbd5e1;
}

.config-form {
  margin-top: 12px;
  padding: 14px;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
}

.config-form-title {
  font-weight: 600;
  font-size: 0.88rem;
  margin-bottom: 10px;
  color: #334155;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #475569;
}

.form-field input {
  padding: 8px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font-size: 0.86rem;
  color: #1e293b;
  background: #fff;
}

.form-field input:focus,
.ai-input:focus,
.ai-select:focus,
.ai-textarea:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.15);
}

.key-input-wrap {
  display: flex;
  gap: 4px;
}

.key-input-wrap input {
  flex: 1;
  min-width: 0;
}

.toggle-key-btn {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 7px;
  padding: 0 8px;
  cursor: pointer;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.model-select-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.ai-select,
.ai-input {
  flex: 1;
  min-width: 220px;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.88rem;
  background: #fff;
  color: #1e293b;
}

.scope-switch {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 0.84rem;
}

.scope-option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}

.scope-option.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ai-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.88rem;
  font-family: inherit;
  resize: vertical;
  color: #1e293b;
  background: #fff;
  line-height: 1.5;
}

/* Diff 预览样式 */
.preview-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.86rem;
}

.summary-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.divider { color: #cbd5e1; }

.empty-diff {
  text-align: center;
  padding: 40px 20px;
  color: #475569;
}

.empty-diff-icon {
  font-size: 2.2rem;
  margin-bottom: 8px;
}

.diff-table-wrap {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: auto;
  max-height: 52vh;
}

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.diff-table th,
.diff-table td {
  padding: 9px 10px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
  vertical-align: top;
}

.diff-table th {
  position: sticky;
  top: 0;
  background: #f1f5f9;
  color: #334155;
  font-weight: 600;
  z-index: 1;
}

.diff-table tr.unselected {
  opacity: 0.5;
  background: #fafafa;
}

.col-check { width: 34px; text-align: center !important; }
.col-card { width: 24%; }
.col-cat { width: 24%; }
.col-desc { width: 34%; }
.col-reason { width: 15%; }

.card-title-plain {
  font-weight: 600;
  color: #0f172a;
}

.card-url-sub {
  font-size: 0.74rem;
  color: #64748b;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.diff-inline,
.diff-stack {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
}

.diff-old {
  color: #b91c1c;
  background: #fee2e2;
  padding: 1px 5px;
  border-radius: 4px;
  text-decoration: line-through;
}

.diff-new {
  color: #047857;
  background: #d1fae5;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.diff-arrow {
  color: #64748b;
  font-weight: 600;
}

.cat-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 0.78rem;
}

.cat-badge.old {
  background: #fee2e2;
  color: #991b1b;
  text-decoration: line-through;
}

.cat-badge.new {
  background: #dbeafe;
  color: #1d4ed8;
  font-weight: 600;
}

.unchanged-text {
  color: #94a3b8;
}

.reason-text {
  color: #475569;
  font-size: 0.78rem;
}

.ai-modal-footer {
  padding: 12px 20px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.ai-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.ai-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ai-btn-sm {
  padding: 5px 11px;
  font-size: 0.8rem;
}

.ai-btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.ai-btn-primary:hover:not(:disabled) {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.ai-btn-outline {
  background: #fff;
  color: #4f46e5;
  border: 1px solid #c7d2fe;
}

.ai-btn-outline:hover:not(:disabled) {
  background: #eef2ff;
}

.ai-btn-ghost {
  background: #e2e8f0;
  color: #334155;
}

.ai-btn-ghost:hover:not(:disabled) {
  background: #cbd5e1;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ai-spin 0.7s linear infinite;
}

@keyframes ai-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 680px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
