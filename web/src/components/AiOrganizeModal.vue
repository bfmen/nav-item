<template>
  <Teleport to="body">
    <div v-if="visible" class="ai-modal-overlay" @click.self="handleClose">
      <div class="ai-modal" role="dialog" aria-modal="true" aria-label="AI 智能整理">
        <div class="ai-modal-header">
          <div class="ai-header-title">
            <span class="ai-sparkle">✨</span>
            <h3>AI 智能整理与死链检测</h3>
            <span class="ai-step-badge">{{ step === 'preview' ? 'Diff 预览确认' : '接口配置与执行' }}</span>
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
                <select v-if="fetchedModels.length" v-model="selectedModel" class="ai-select">
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

            <!-- 3. 整理范围、后端测活与自定义 Prompt -->
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">3</span>
                  <span>整理范围与整理要求（选填）</span>
                </div>
                <label class="probe-toggle">
                  <input v-model="enableProbe" type="checkbox" />
                  <span>启用后端真实测活（含 403/CF 盾识别）</span>
                </label>
              </div>

              <div class="scope-cards">
                <label :class="['scope-card', { active: organizeScope === 'smart' }]">
                  <input v-model="organizeScope" type="radio" value="smart" />
                  <div>
                    <div class="scope-card-title">推荐：未分类/缺描述整理 + 全站死链检测</div>
                    <div class="scope-card-desc">全站测活并检测重复，仅对异常、缺描述及未分类卡片做归类整理，不打乱已有布局</div>
                  </div>
                </label>
                <label :class="['scope-card', { active: organizeScope === 'all' }]">
                  <input v-model="organizeScope" type="radio" value="all" />
                  <div>
                    <div class="scope-card-title">全站完整整理 + 全站死链检测</div>
                    <div class="scope-card-desc">全站卡片一并交给 AI 检查描述补全、名称大小写规范与死链归类</div>
                  </div>
                </label>
                <label :class="['scope-card', { active: organizeScope === 'current', disabled: !hasCurrentFilter }]">
                  <input v-model="organizeScope" type="radio" value="current" :disabled="!hasCurrentFilter" />
                  <div>
                    <div class="scope-card-title">仅当前筛选栏目</div>
                    <div class="scope-card-desc">{{ hasCurrentFilter ? '仅测活并整理当前表格选定的栏目' : '请在卡片列表选定具体主菜单后可用' }}</div>
                  </div>
                </label>
              </div>

              <textarea
                v-model="customPrompt"
                class="ai-textarea"
                rows="3"
                placeholder="自定义整理要求（选填）。留空将执行默认「防乱 + 防硬塞平衡版」规则：严禁自建/改名栏目、匹配度不足归入「待归类」或标记需人工复核、≥3 张同类新站点仅给出新增子菜单建议、补全 15 字内中文描述并规范大小写、结合后端测活标记死链/停用/重复卡片。"
              ></textarea>
            </section>
          </div>

          <!-- 阶段二：双 Tab Diff 预览 + 建议新增子菜单 -->
          <div v-else class="ai-preview-view">
            <!-- 测活统计与返回栏 -->
            <div class="preview-summary">
              <div class="summary-left">
                <span>探测 <strong>{{ previewMeta.totalProbed }}</strong></span>
                <span class="pill ok">正常 {{ probeStats.reachable }}</span>
                <span v-if="probeStats.waf_403" class="pill waf">403/WAF复核 {{ probeStats.waf_403 }}</span>
                <span v-if="probeStats.suspected_dead" class="pill dead">疑似死链 {{ probeStats.suspected_dead }}</span>
                <span v-if="probeStats.suspected_expired" class="pill expired">疑似停用 {{ probeStats.suspected_expired }}</span>
                <span v-if="previewMeta.model" class="model-tag">{{ previewMeta.model }}</span>
              </div>
              <button type="button" class="ai-btn ai-btn-sm ai-btn-ghost" @click="step = 'config'">
                ← 返回修改配置
              </button>
            </div>

            <!-- 建议新增子菜单提示区（仅作建议，需用户手动点击确认创建） -->
            <div v-if="suggestedSubMenus.length" class="suggestion-panel">
              <div class="suggestion-header">
                <strong>💡 AI 建议新增子菜单（仅作建议，点击确认创建后才生效）</strong>
              </div>
              <div class="suggestion-list">
                <div v-for="(sug, idx) in suggestedSubMenus" :key="`${sug.parent_menu_id}-${sug.name}`" class="suggestion-item">
                  <div class="suggestion-info">
                    <div class="suggestion-title">
                      <span class="cat-badge new">{{ sug.parent_menu_name }} / {{ sug.name }}</span>
                      <span class="suggestion-reason">{{ sug.reason }}</span>
                    </div>
                    <div class="suggestion-cards">
                      涉及 {{ sug.card_ids.length }} 张卡片：{{ sug.card_titles.join('、') }}
                    </div>
                  </div>
                  <div class="suggestion-action">
                    <span v-if="sug.created" class="created-tag">✓ 已创建并关联</span>
                    <button
                      v-else
                      type="button"
                      class="ai-btn ai-btn-sm ai-btn-outline"
                      :disabled="creatingSubIndex === idx"
                      @click="handleConfirmCreateSubMenu(sug, idx)"
                    >
                      {{ creatingSubIndex === idx ? '创建中...' : '确认创建并关联卡片' }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 双 Tab 切换栏 -->
            <div class="preview-tabs">
              <button
                type="button"
                :class="['preview-tab', { active: previewTab === 'updates' }]"
                @click="previewTab = 'updates'"
              >
                <span>📝 待移动 / 补全描述</span>
                <span class="tab-badge">{{ selectedUpdateIds.length }} / {{ diffUpdates.length }}</span>
              </button>
              <button
                type="button"
                :class="['preview-tab recycle-tab', { active: previewTab === 'recycles' }]"
                @click="previewTab = 'recycles'"
              >
                <span>🗑 拟移入回收站（失效 / 重复）</span>
                <span class="tab-badge danger">{{ selectedRecycleIds.length }} / {{ diffRecycles.length }}</span>
              </button>
            </div>

            <!-- Tab 1：待移动 / 补全描述 -->
            <template v-if="previewTab === 'updates'">
              <div v-if="!diffUpdates.length" class="empty-diff">
                <div class="empty-diff-icon">✅</div>
                <p>暂无需要移动分类或补全描述的卡片。</p>
              </div>
              <div v-else class="diff-table-wrap">
                <table class="diff-table">
                  <thead>
                    <tr>
                      <th class="col-check">
                        <input
                          type="checkbox"
                          :checked="allUpdatesSelected"
                          :indeterminate.prop="someUpdatesSelected"
                          @change="toggleAllUpdates"
                        />
                      </th>
                      <th class="col-card">卡片标题 / 网址</th>
                      <th class="col-cat">分类变更</th>
                      <th class="col-desc">描述变更</th>
                      <th class="col-reason">说明 / 状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in diffUpdates"
                      :key="item.id"
                      :class="{ unselected: !selectedUpdateIds.includes(item.id) }"
                    >
                      <td class="col-check">
                        <input
                          type="checkbox"
                          :checked="selectedUpdateIds.includes(item.id)"
                          @change="toggleUpdateItem(item.id)"
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
                        <span v-if="item.needs_review" class="review-badge">需人工复核</span>
                        <span class="reason-text">{{ item.reason || '-' }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>

            <!-- Tab 2：拟移入回收站 -->
            <template v-else>
              <div v-if="!diffRecycles.length" class="empty-diff">
                <div class="empty-diff-icon">🎉</div>
                <p>太棒了！本次未发现确认失效、域名停用或重复的卡片。</p>
              </div>
              <div v-else class="diff-table-wrap">
                <table class="diff-table">
                  <thead>
                    <tr>
                      <th class="col-check">
                        <input
                          type="checkbox"
                          :checked="allRecyclesSelected"
                          :indeterminate.prop="someRecyclesSelected"
                          @change="toggleAllRecycles"
                        />
                      </th>
                      <th class="col-card">卡片标题 / 网址（点击可复核）</th>
                      <th class="col-cat">原所属栏目</th>
                      <th class="col-recycle-type">归入原因</th>
                      <th class="col-desc">测活结果与判定依据</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in diffRecycles"
                      :key="item.id"
                      :class="{ unselected: !selectedRecycleIds.includes(item.id) }"
                    >
                      <td class="col-check">
                        <input
                          type="checkbox"
                          :checked="selectedRecycleIds.includes(item.id)"
                          @change="toggleRecycleItem(item.id)"
                        />
                      </td>
                      <td class="col-card">
                        <div class="card-title-plain">{{ item.title }}</div>
                        <a :href="item.url" target="_blank" rel="noopener noreferrer" class="card-url-link" :title="item.url">
                          {{ item.url }}
                        </a>
                      </td>
                      <td class="col-cat">
                        <span class="unchanged-text">{{ item.old_category }}</span>
                      </td>
                      <td class="col-recycle-type">
                        <span :class="['recycle-badge', item.recycle_reason]">
                          {{ formatRecycleReason(item.recycle_reason) }}
                        </span>
                      </td>
                      <td class="col-desc">
                        <div class="reason-text">{{ item.reason }}</div>
                        <div v-if="item.probe_summary" class="probe-sub">{{ item.probe_summary }}</div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
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
              {{ organizing ? (enableProbe ? '正在后端测活并执行 AI 分析...' : 'AI 正在分析整理中...') : '✨ 开始测活与 AI 整理' }}
            </button>
          </template>
          <template v-else>
            <button type="button" class="ai-btn ai-btn-ghost" @click="step = 'config'">重新整理</button>
            <button
              v-if="diffUpdates.length || diffRecycles.length"
              type="button"
              class="ai-btn ai-btn-primary"
              :disabled="applying || (selectedUpdateIds.length === 0 && selectedRecycleIds.length === 0)"
              @click="handleApply"
            >
              {{ applying ? '正在应用更改...' : `应用更改（更新 ${selectedUpdateIds.length} · 移入回收站 ${selectedRecycleIds.length}）` }}
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
  applyAiOrganize,
  addSubMenu
} from '../api';

const props = defineProps({
  visible: { type: Boolean, default: false },
  currentMenuId: { type: [Number, String], default: 'all' },
  currentSubMenuId: { type: [Number, String], default: 'all' }
});

const emit = defineEmits(['close', 'applied']);

const step = ref('config');
const previewTab = ref('updates');
const configs = ref([]);
const showConfigForm = ref(false);
const editingConfigId = ref(null);
const showApiKey = ref(false);
const savingConfig = ref(false);
const configForm = ref({ name: '', base_url: 'https://api.openai.com/v1', api_key: '', model: '' });

const fetchedModels = ref([]);
const fetchingModels = ref(false);
const selectedModel = ref('');
const organizeScope = ref('smart');
const enableProbe = ref(true);
const customPrompt = ref('');
const organizing = ref(false);
const applying = ref(false);

const diffUpdates = ref([]);
const selectedUpdateIds = ref([]);
const diffRecycles = ref([]);
const selectedRecycleIds = ref([]);
const suggestedSubMenus = ref([]);
const creatingSubIndex = ref(-1);
const probeStats = ref({ total: 0, reachable: 0, waf_403: 0, suspected_dead: 0, suspected_expired: 0 });
const previewMeta = ref({ totalAnalyzed: 0, totalProbed: 0, model: '' });
const notice = ref({ text: '', type: 'info' });
const createdAnySubMenu = ref(false);

const activeConfig = computed(() => configs.value.find(c => c.is_active) || configs.value[0] || null);
const hasCurrentFilter = computed(() => props.currentMenuId !== 'all' && props.currentMenuId !== '' && props.currentMenuId != null);

const allUpdatesSelected = computed(() =>
  diffUpdates.value.length > 0 && selectedUpdateIds.value.length === diffUpdates.value.length
);
const someUpdatesSelected = computed(() =>
  selectedUpdateIds.value.length > 0 && selectedUpdateIds.value.length < diffUpdates.value.length
);

const allRecyclesSelected = computed(() =>
  diffRecycles.value.length > 0 && selectedRecycleIds.value.length === diffRecycles.value.length
);
const someRecyclesSelected = computed(() =>
  selectedRecycleIds.value.length > 0 && selectedRecycleIds.value.length < diffRecycles.value.length
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
    previewTab.value = 'updates';
    createdAnySubMenu.value = false;
    if (!hasCurrentFilter.value && organizeScope.value === 'current') {
      organizeScope.value = 'smart';
    }
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
    selectedModel.value = active ? (active.model || '') : '';
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
      prompt: customPrompt.value.trim(),
      scope: organizeScope.value,
      enable_probe: enableProbe.value
    };
    if (organizeScope.value === 'current' && hasCurrentFilter.value) {
      payload.menu_id = props.currentMenuId;
      payload.sub_menu_id = props.currentSubMenuId;
    }
    const { data } = await runAiOrganize(payload);
    diffUpdates.value = data.updates || data.changes || [];
    diffRecycles.value = data.recycles || [];
    suggestedSubMenus.value = (data.suggested_sub_menus || []).map(s => ({ ...s, created: false }));
    selectedUpdateIds.value = diffUpdates.value
      .filter(item => item.changed_fields && item.changed_fields.length > 0)
      .map(item => item.id);
    selectedRecycleIds.value = diffRecycles.value.map(item => item.id);
    probeStats.value = data.probe_stats || { total: 0, reachable: 0, waf_403: 0, suspected_dead: 0, suspected_expired: 0 };
    previewMeta.value = {
      totalAnalyzed: data.total_analyzed || 0,
      totalProbed: data.total_probed || data.total_analyzed || 0,
      model: data.model || selectedModel.value.trim()
    };
    previewTab.value = !diffUpdates.value.length && diffRecycles.value.length ? 'recycles' : 'updates';
    step.value = 'preview';
  } catch (err) {
    setNotice(err.response?.data?.message || 'AI 智能整理执行失败', 'error');
  } finally {
    organizing.value = false;
  }
}

async function handleConfirmCreateSubMenu(sug, idx) {
  if (!window.confirm(`确定要在「${sug.parent_menu_name}」下新建子菜单「${sug.name}」并将涉及的 ${sug.card_ids.length} 张卡片关联到该子菜单吗？`)) {
    return;
  }
  creatingSubIndex.value = idx;
  clearNotice();
  try {
    const { data } = await addSubMenu(sug.parent_menu_id, { name: sug.name, order: 99 });
    const newSubMenuId = data.id;
    sug.created = true;
    createdAnySubMenu.value = true;

    const newCategoryLabel = `${sug.parent_menu_name} / ${sug.name}`;
    for (let i = 0; i < sug.card_ids.length; i++) {
      const cardId = sug.card_ids[i];
      const existing = diffUpdates.value.find(item => item.id === cardId);
      if (existing) {
        existing.new_menu_id = sug.parent_menu_id;
        existing.new_sub_menu_id = newSubMenuId;
        existing.new_category = newCategoryLabel;
        existing.needs_review = false;
        if (!existing.changed_fields.includes('category')) {
          existing.changed_fields = ['category', ...existing.changed_fields];
        }
        existing.reason = `归入新建子菜单「${sug.name}」`;
      } else {
        diffUpdates.value.push({
          id: cardId,
          url: '',
          old_menu_id: null,
          old_sub_menu_id: null,
          old_category: '原分类',
          new_menu_id: sug.parent_menu_id,
          new_sub_menu_id: newSubMenuId,
          new_category: newCategoryLabel,
          old_title: sug.card_titles[i] || `卡片 #${cardId}`,
          new_title: sug.card_titles[i] || `卡片 #${cardId}`,
          old_desc: '',
          new_desc: '',
          changed_fields: ['category'],
          needs_review: false,
          reason: `归入新建子菜单「${sug.name}」`
        });
      }
      if (!selectedUpdateIds.value.includes(cardId)) {
        selectedUpdateIds.value = [...selectedUpdateIds.value, cardId];
      }
    }
    setNotice(`已创建子菜单「${newCategoryLabel}」并更新预览，请点击下方「应用更改」完成归类`, 'success');
  } catch (err) {
    setNotice(err.response?.data?.error || '创建子菜单失败', 'error');
  } finally {
    creatingSubIndex.value = -1;
  }
}

function toggleAllUpdates(event) {
  selectedUpdateIds.value = event.target.checked ? diffUpdates.value.map(item => item.id) : [];
}

function toggleUpdateItem(id) {
  if (selectedUpdateIds.value.includes(id)) {
    selectedUpdateIds.value = selectedUpdateIds.value.filter(item => item !== id);
  } else {
    selectedUpdateIds.value = [...selectedUpdateIds.value, id];
  }
}

function toggleAllRecycles(event) {
  selectedRecycleIds.value = event.target.checked ? diffRecycles.value.map(item => item.id) : [];
}

function toggleRecycleItem(id) {
  if (selectedRecycleIds.value.includes(id)) {
    selectedRecycleIds.value = selectedRecycleIds.value.filter(item => item !== id);
  } else {
    selectedRecycleIds.value = [...selectedRecycleIds.value, id];
  }
}

function formatRecycleReason(reason) {
  switch (reason) {
    case 'dead_link': return '死链无法访问';
    case 'domain_expired': return '域名停用';
    case 'duplicate': return '重复链接';
    default: return '手动删除';
  }
}

async function handleApply() {
  const chosenUpdates = diffUpdates.value.filter(item => selectedUpdateIds.value.includes(item.id));
  const chosenRecycles = diffRecycles.value.filter(item => selectedRecycleIds.value.includes(item.id));
  if (!chosenUpdates.length && !chosenRecycles.length) {
    setNotice('请至少勾选一条要应用的更改', 'error');
    return;
  }
  applying.value = true;
  clearNotice();
  try {
    const { data } = await applyAiOrganize({
      updates: chosenUpdates,
      recycles: chosenRecycles
    });
    if (data.recycled > 0) {
      window.dispatchEvent(new Event('recycle:updated'));
    }
    emit('applied', {
      updated: data.updated || 0,
      recycled: data.recycled || 0,
      menusChanged: createdAnySubMenu.value
    });
    emit('close');
  } catch (err) {
    setNotice(err.response?.data?.message || '应用更改失败', 'error');
  } finally {
    applying.value = false;
  }
}

function handleClose() {
  if (organizing.value || applying.value) return;
  if (createdAnySubMenu.value) {
    emit('applied', { updated: 0, recycled: 0, menusChanged: true });
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
  width: min(1040px, 96vw);
  max-height: 92vh;
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

.ai-header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ai-header-title h3 {
  margin: 0;
  font-size: 1.06rem;
  font-weight: 600;
}

.ai-step-badge {
  font-size: 0.74rem;
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
}
.ai-close-btn:hover { background: rgba(255, 255, 255, 0.28); }

.ai-modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-notice {
  padding: 9px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
}
.ai-notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.ai-notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.ai-notice.info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }

.ai-config-view,
.ai-preview-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ai-section {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 13px 16px;
  background: #f8fafc;
}

.ai-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.ai-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 0.9rem;
}

.step-num {
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: #667eea;
  color: #fff;
  font-size: 0.76rem;
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
  padding: 9px 12px;
  border-radius: 10px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
}
.config-item:hover { border-color: #a5b4fc; }
.config-item.active {
  border-color: #667eea;
  background: #f5f7ff;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.14);
}

.radio-dot {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  display: inline-block;
  position: relative;
}
.radio-dot.checked { border-color: #667eea; }
.radio-dot.checked::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: #667eea;
}

.config-meta { flex: 1; min-width: 0; }
.config-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.config-name { font-weight: 600; font-size: 0.86rem; }
.active-tag { font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; background: #667eea; color: #fff; }
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
.config-url { font-size: 0.75rem; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.config-actions { display: flex; gap: 4px; }

.ai-icon-btn {
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
}
.ai-icon-btn:hover { background: #f1f5f9; }
.ai-icon-btn.danger:hover { background: #fee2e2; color: #dc2626; border-color: #fecaca; }

.empty-config-tip {
  text-align: center;
  padding: 14px;
  color: #64748b;
  font-size: 0.85rem;
  background: #fff;
  border-radius: 8px;
  border: 1px dashed #cbd5e1;
}

.config-form {
  margin-top: 10px;
  padding: 13px;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
}
.config-form-title { font-weight: 600; font-size: 0.86rem; margin-bottom: 10px; }
.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.form-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: #475569; }
.form-field input {
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font-size: 0.85rem;
}
.key-input-wrap { display: flex; gap: 4px; }
.key-input-wrap input { flex: 1; min-width: 0; }
.toggle-key-btn { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 7px; padding: 0 8px; cursor: pointer; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }

.model-select-row { display: flex; gap: 10px; flex-wrap: wrap; }
.ai-select,
.ai-input {
  flex: 1;
  min-width: 220px;
  padding: 8px 11px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.86rem;
  background: #fff;
}

.probe-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: #334155;
  cursor: pointer;
}

.scope-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.scope-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
}
.scope-card.active {
  border-color: #667eea;
  background: #f5f7ff;
}
.scope-card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.scope-card-title { font-size: 0.82rem; font-weight: 600; color: #0f172a; }
.scope-card-desc { font-size: 0.73rem; color: #64748b; margin-top: 2px; line-height: 1.35; }

.ai-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 0.85rem;
  font-family: inherit;
  resize: vertical;
  background: #fff;
  line-height: 1.45;
}

/* 预览区样式 */
.preview-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 13px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.84rem;
}

.summary-left { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.pill { font-size: 0.75rem; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
.pill.ok { background: #dcfce7; color: #166534; }
.pill.waf { background: #e0f2fe; color: #0369a1; }
.pill.dead { background: #fee2e2; color: #b91c1c; }
.pill.expired { background: #fef3c7; color: #b45309; }

.suggestion-panel {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 10px;
  padding: 10px 14px;
}

.suggestion-header {
  font-size: 0.84rem;
  color: #92400e;
  margin-bottom: 8px;
}

.suggestion-list { display: flex; flex-direction: column; gap: 8px; }
.suggestion-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #fff;
  border: 1px solid #fef3c7;
  border-radius: 8px;
  padding: 8px 10px;
  flex-wrap: wrap;
}
.suggestion-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.suggestion-reason { font-size: 0.8rem; color: #475569; }
.suggestion-cards { font-size: 0.76rem; color: #64748b; margin-top: 3px; }
.created-tag { font-size: 0.78rem; color: #059669; font-weight: 600; }

.preview-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 8px;
}

.preview-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #475569;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.preview-tab.active {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}
.preview-tab.recycle-tab.active {
  background: #dc2626;
  border-color: #dc2626;
}

.tab-badge {
  font-size: 0.74rem;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.08);
}
.preview-tab.active .tab-badge {
  background: rgba(255, 255, 255, 0.25);
}

.empty-diff { text-align: center; padding: 34px 20px; color: #475569; }
.empty-diff-icon { font-size: 2rem; margin-bottom: 6px; }

.diff-table-wrap {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: auto;
  max-height: 44vh;
}

.diff-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
.diff-table th,
.diff-table td {
  padding: 8px 10px;
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
.diff-table tr.unselected { opacity: 0.48; background: #fafafa; }

.col-check { width: 32px; text-align: center !important; }
.col-card { width: 25%; }
.col-cat { width: 21%; }
.col-desc { width: 33%; }
.col-reason { width: 17%; }
.col-recycle-type { width: 13%; white-space: nowrap; }

.card-title-plain { font-weight: 600; color: #0f172a; }
.card-url-sub,
.card-url-link {
  display: block;
  font-size: 0.74rem;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}
.card-url-sub { color: #64748b; }
.card-url-link { color: #2563eb; text-decoration: none; }
.card-url-link:hover { text-decoration: underline; }

.diff-inline,
.diff-stack { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.diff-old { color: #b91c1c; background: #fee2e2; padding: 1px 5px; border-radius: 4px; text-decoration: line-through; }
.diff-new { color: #047857; background: #d1fae5; padding: 1px 6px; border-radius: 4px; font-weight: 500; }
.diff-arrow { color: #64748b; font-weight: 600; }

.cat-badge { display: inline-block; padding: 2px 7px; border-radius: 5px; font-size: 0.76rem; }
.cat-badge.old { background: #fee2e2; color: #991b1b; text-decoration: line-through; }
.cat-badge.new { background: #dbeafe; color: #1d4ed8; font-weight: 600; }

.review-badge {
  display: inline-block;
  margin-bottom: 3px;
  margin-right: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 600;
  background: #ffedd5;
  color: #c2410c;
}

.recycle-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.74rem;
  font-weight: 600;
}
.recycle-badge.dead_link { background: #fee2e2; color: #b91c1c; }
.recycle-badge.domain_expired { background: #fef3c7; color: #b45309; }
.recycle-badge.duplicate { background: #ede9fe; color: #6d28d9; }

.unchanged-text { color: #94a3b8; }
.reason-text { color: #334155; font-size: 0.78rem; }
.probe-sub { font-size: 0.73rem; color: #64748b; margin-top: 2px; }

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
  padding: 8px 15px;
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ai-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ai-btn-sm { padding: 5px 11px; font-size: 0.8rem; }
.ai-btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
.ai-btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
.ai-btn-outline { background: #fff; color: #4f46e5; border: 1px solid #c7d2fe; }
.ai-btn-outline:hover:not(:disabled) { background: #eef2ff; }
.ai-btn-ghost { background: #e2e8f0; color: #334155; }

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ai-spin 0.7s linear infinite;
}
@keyframes ai-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .form-grid,
  .scope-cards {
    grid-template-columns: 1fr;
  }
}
</style>
