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
            <div>{{ notice.text }}</div>
            <div v-if="backupFailedPrompt" class="force-apply-row">
              <button
                type="button"
                class="ai-btn ai-btn-xs ai-btn-danger-outline"
                :disabled="applying"
                @click="handleForceApplyWithoutBackup"
              >
                忽略备份并强制应用更改
              </button>
            </div>
          </div>

          <!-- 异步任务进度条面板 -->
          <div v-if="organizing" class="task-progress-panel">
            <div class="progress-top">
              <div class="progress-status">
                <span class="spinner dark"></span>
                <span>{{ taskProgress.message || '正在后台执行测活与 AI 整理...' }}</span>
              </div>
              <div class="progress-right">
                <span class="progress-pct">{{ taskProgress.progress }}%</span>
                <button type="button" class="ai-btn ai-btn-xs ai-btn-danger-outline" @click="handleCancelTask">
                  取消任务
                </button>
              </div>
            </div>
            <div class="progress-track">
              <div class="progress-fill" :style="{ width: `${Math.max(4, taskProgress.progress)}%` }"></div>
            </div>
            <div class="progress-meta">
              <span v-if="taskProgress.probed_total > 0">
                测活进度：{{ taskProgress.probed_done }}/{{ taskProgress.probed_total }}
              </span>
              <span v-if="taskProgress.batch_total > 0">
                AI 整理批次：{{ taskProgress.batch_done }}/{{ taskProgress.batch_total }}
              </span>
              <span>异步任务模式 · 每 2 秒自动同步进度</span>
            </div>
          </div>

          <!-- 阶段一：配置与执行（精简为 2 步） -->
          <div v-if="step === 'config'" class="ai-config-view">
            <!-- 1. 多 API 接口配置管理（含模型拉取与持久化配置） -->
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">1</span>
                  <span>AI 接口配置（支持 OpenAI 官方与第三方中转）</span>
                </div>
                <button type="button" class="ai-btn ai-btn-sm ai-btn-outline" :disabled="organizing" @click="openNewConfigForm">
                  + 新增接口
                </button>
              </div>

              <div v-if="configs.length" class="config-list">
                <div
                  v-for="cfg in configs"
                  :key="cfg.id"
                  :class="['config-item', { active: cfg.is_active }]"
                  @click="!organizing && handleActivate(cfg)"
                >
                  <div class="config-radio">
                    <span :class="['radio-dot', { checked: cfg.is_active }]"></span>
                  </div>
                  <div class="config-meta">
                    <div class="config-name-row">
                      <span class="config-name">{{ cfg.name }}</span>
                      <span v-if="cfg.is_active" class="active-tag">当前激活</span>
                      <span v-if="cfg.model" class="model-tag" :title="`已配置模型：${cfg.model}`">{{ cfg.model }}</span>
                      <span v-else class="model-missing-tag">未配置模型</span>
                    </div>
                    <div class="config-url">{{ cfg.base_url }}</div>
                  </div>
                  <div class="config-actions" @click.stop>
                    <button type="button" class="ai-icon-btn" title="编辑配置与模型" :disabled="organizing" @click="openEditConfigForm(cfg)">✎</button>
                    <button type="button" class="ai-icon-btn danger" title="删除配置" :disabled="organizing" @click="handleDeleteConfig(cfg)">🗑</button>
                  </div>
                </div>
              </div>
              <div v-else-if="!showConfigForm" class="empty-config-tip">
                尚未配置 AI 接口，请点击右上角「+ 新增接口」添加 OpenAI 或兼容中转服务。
              </div>

              <!-- 新增 / 编辑配置表单（内置模型拉取与选择） -->
              <div v-if="showConfigForm" class="config-form">
                <div class="config-form-title">{{ editingConfigId ? '编辑 AI 接口与模型' : '新增 AI 接口与模型' }}</div>
                <div class="form-grid">
                  <label class="form-field">
                    <span>配置名称 *</span>
                    <input v-model="configForm.name" type="text" placeholder="如：OpenAI 官方 / OneAPI 中转" />
                  </label>
                  <label class="form-field">
                    <span>API Base URL *</span>
                    <input v-model="configForm.base_url" type="url" placeholder="https://api.openai.com/v1" />
                  </label>
                  <label class="form-field form-field-full">
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
                  <div class="form-field form-field-full">
                    <div class="model-field-head">
                      <span>使用模型 *（支持先拉取再选，或直接手动输入）</span>
                      <button
                        type="button"
                        class="ai-btn ai-btn-xs ai-btn-outline"
                        :disabled="fetchingModels || !configForm.base_url.trim() || !configForm.api_key.trim()"
                        @click="handleFetchFormModels"
                      >
                        {{ fetchingModels ? '拉取中...' : '🔄 拉取模型列表' }}
                      </button>
                    </div>
                    <div class="model-select-row">
                      <select
                        v-if="formModels.length"
                        :value="formModels.includes(configForm.model) ? configForm.model : ''"
                        class="ai-select"
                        @change="onFormDropdownModelChange"
                      >
                        <option value="">-- 从拉取的 {{ formModels.length }} 个模型中选择 --</option>
                        <option v-for="m in formModels" :key="m" :value="m">{{ m }}</option>
                      </select>
                      <input
                        v-model="configForm.model"
                        type="text"
                        class="ai-input"
                        :placeholder="formModels.length ? '或手动输入任意模型名称' : '可点击右上角拉取模型列表（无需先保存），或手动输入模型名如 gpt-4o-mini'"
                      />
                    </div>
                  </div>
                </div>
                <div class="form-actions">
                  <button type="button" class="ai-btn ai-btn-sm ai-btn-ghost" @click="cancelConfigForm">取消</button>
                  <button type="button" class="ai-btn ai-btn-sm ai-btn-primary" :disabled="savingConfig" @click="handleSaveConfig">
                    {{ savingConfig ? '保存中...' : '保存配置' }}
                  </button>
                </div>
              </div>
            </section>

            <!-- 2. 整理范围、后端测活与自定义 Prompt（顺延为第 2 步） -->
            <section class="ai-section">
              <div class="ai-section-head">
                <div class="ai-section-title">
                  <span class="step-num">2</span>
                  <span>整理范围与整理要求{{ organizeScope === 'custom' ? '（必填）' : '（选填）' }}</span>
                </div>
                <div class="option-toggles">
                  <label class="probe-toggle" title="开启后，AI 不会把主菜单直属（尤其是 Home）的高频卡片擅自降级移入子菜单">
                    <input v-model="protectMainDirect" type="checkbox" :disabled="organizing" />
                    <span>保护主菜单直属卡片不被移走</span>
                  </label>
                  <label class="probe-toggle">
                    <input v-model="enableProbe" type="checkbox" :disabled="organizing" />
                    <span>启用后端真实测活（含 403/CF 盾识别）</span>
                  </label>
                </div>
              </div>

              <div class="scope-cards">
                <label :class="['scope-card', { active: organizeScope === 'smart' }]">
                  <input v-model="organizeScope" type="radio" value="smart" :disabled="organizing" />
                  <div>
                    <div class="scope-card-title">推荐：未分类/缺描述整理 + 全站死链检测</div>
                    <div class="scope-card-desc">全站测活并检测重复，仅对异常、缺描述及未分类卡片做归类整理，不打乱已有布局</div>
                  </div>
                </label>
                <label :class="['scope-card', { active: organizeScope === 'all' }]">
                  <input v-model="organizeScope" type="radio" value="all" :disabled="organizing" />
                  <div>
                    <div class="scope-card-title">全站完整整理 + 全站死链检测</div>
                    <div class="scope-card-desc">全站卡片一并交给 AI 检查描述补全、名称大小写规范与死链归类</div>
                  </div>
                </label>
                <label :class="['scope-card', { active: organizeScope === 'current', disabled: !hasCurrentFilter }]">
                  <input v-model="organizeScope" type="radio" value="current" :disabled="!hasCurrentFilter || organizing" />
                  <div>
                    <div class="scope-card-title">仅当前筛选栏目</div>
                    <div class="scope-card-desc">{{ hasCurrentFilter ? '仅测活并整理当前表格选定的栏目' : '请在卡片列表选定具体主菜单后可用' }}</div>
                  </div>
                </label>
                <label :class="['scope-card custom-card', { active: organizeScope === 'custom' }]">
                  <input v-model="organizeScope" type="radio" value="custom" :disabled="organizing" />
                  <div>
                    <div class="scope-card-title">🎯 自定义 AI 整理（完全按指令执行）</div>
                    <div class="scope-card-desc">解除默认防乱保守限制，完全严格按下方指令移动分类、精简直属或批量改名</div>
                  </div>
                </label>
              </div>

              <div v-if="organizeScope === 'custom'" class="custom-prompt-label">
                自定义整理指令 <span class="required-star">*</span>（可按需取消勾选「启用后端真实测活」以极速重排）
              </div>
              <textarea
                v-model="customPrompt"
                :class="['ai-textarea', { 'custom-required': organizeScope === 'custom' }]"
                rows="3"
                :disabled="organizing"
                :placeholder="organizeScope === 'custom'
                  ? '必填。示例：“把 Home 直属只保留 8 个最常用站，其余移入对应子菜单” 或 “把所有中转站标题统一为 品牌名 - API，并补充一句话简介”'
                  : '自定义整理要求（选填）。留空将执行默认「防乱 + 防硬塞平衡版」规则：保护主菜单直属卡片、严禁自建/改名栏目、匹配度不足归入「待归类」或标记需人工复核、≥3 张同类新站点仅给出新增子菜单建议、补全 15 字内中文描述并规范大小写、结合后端测活标记死链/停用/重复卡片。'"
              ></textarea>
            </section>
          </div>

          <!-- 阶段二：双 Tab Diff 预览 + 建议新增子菜单 -->
          <div v-else class="ai-preview-view">
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

            <!-- 建议新增/调整子菜单提示区（支持多选与一键批量同意） -->
            <div v-if="suggestedSubMenus.length" class="suggestion-panel">
              <div class="suggestion-header">
                <strong>💡 AI 建议新增/调整子菜单（共 {{ suggestedSubMenus.length }} 项，须确认后才生效）</strong>
                <div class="suggestion-batch-actions" v-if="pendingSuggestions.length > 0">
                  <button
                    type="button"
                    class="ai-btn ai-btn-xs ai-btn-ghost"
                    :disabled="batchApplyingSuggestions"
                    @click="toggleAllSuggestions"
                  >
                    {{ allPendingSuggestionsSelected ? '取消全选' : '全选' }}
                  </button>
                  <button
                    type="button"
                    class="ai-btn ai-btn-xs ai-btn-primary"
                    :disabled="batchApplyingSuggestions || selectedPendingSuggestionCount === 0"
                    @click="handleBatchApproveSuggestions"
                  >
                    {{ batchApplyingSuggestions ? '批量处理中...' : `批量同意选中项 (${selectedPendingSuggestionCount})` }}
                  </button>
                </div>
              </div>
              <div class="suggestion-list">
                <div
                  v-for="(sug, idx) in suggestedSubMenus"
                  :key="sug.key || `${sug.parent_menu_id}-${sug.name}`"
                  :class="['suggestion-item', { applied: sug.created }]"
                >
                  <div class="suggestion-check">
                    <input
                      type="checkbox"
                      :disabled="sug.created || batchApplyingSuggestions"
                      :checked="sug.created || selectedSuggestionKeys.has(sug.key)"
                      @change="toggleSuggestionKey(sug.key)"
                    />
                  </div>
                  <div class="suggestion-info">
                    <div class="suggestion-title">
                      <span :class="['action-type-tag', sug.action === 'rename' ? 'rename' : 'create']">
                        {{ sug.action === 'rename' ? '重命名子菜单' : '新增子菜单' }}
                      </span>
                      <template v-if="sug.action === 'rename'">
                        <span class="cat-badge old">{{ sug.parent_menu_name }} / {{ sug.old_name }}</span>
                        <span class="diff-arrow">→</span>
                        <span class="cat-badge new">{{ sug.parent_menu_name }} / {{ sug.name }}</span>
                      </template>
                      <span v-else class="cat-badge new">{{ sug.parent_menu_name }} / {{ sug.name }}</span>
                      <span class="suggestion-reason">{{ sug.reason }}</span>
                    </div>
                    <div v-if="sug.card_ids?.length" class="suggestion-cards">
                      涉及 {{ sug.card_ids.length }} 张卡片：{{ sug.card_titles.join('、') }}
                    </div>
                  </div>
                  <div class="suggestion-action">
                    <span v-if="sug.created" class="created-tag">✓ 已生效并关联</span>
                    <button
                      v-else
                      type="button"
                      class="ai-btn ai-btn-xs ai-btn-outline"
                      :disabled="batchApplyingSuggestions || creatingSubIndex === idx"
                      @click="handleApproveSingleSuggestion(sug, idx)"
                    >
                      {{ creatingSubIndex === idx ? '处理中...' : (sug.action === 'rename' ? '同意更名' : '同意创建') }}
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
            <div class="footer-active-info" v-if="activeConfig">
              当前执行：<strong>{{ activeConfig.name }}</strong>
              <span v-if="activeConfig.model" class="model-tag">{{ activeConfig.model }}</span>
              <span v-else class="model-missing-tag">未配置模型</span>
            </div>
            <div class="footer-buttons">
              <button type="button" class="ai-btn ai-btn-ghost" @click="handleClose">
                {{ organizing ? '取消并关闭' : '关闭' }}
              </button>
              <button
                type="button"
                class="ai-btn ai-btn-primary"
                :disabled="organizing || !activeConfig"
                @click="handleOrganize"
              >
                <span v-if="organizing" class="spinner"></span>
                {{ organizing ? '后台执行中...' : '✨ 开始测活与 AI 整理' }}
              </button>
            </div>
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
                v-if="diffUpdates.length || diffRecycles.length"
                type="button"
                class="ai-btn ai-btn-primary"
                :disabled="applying || (selectedUpdateIds.length === 0 && selectedRecycleIds.length === 0)"
                @click="handleApply(false)"
              >
                {{ applying ? '正在应用更改...' : `应用更改（更新 ${selectedUpdateIds.length} · 移入回收站 ${selectedRecycleIds.length}）` }}
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
  addAiConfig,
  updateAiConfig,
  activateAiConfig,
  deleteAiConfig,
  fetchAiModels,
  startAiOrganize,
  getAiOrganizeStatus,
  cancelAiOrganize,
  applyAiOrganize,
  applyAiSuggestions,
  getWebdavConfig
} from '../api';

const POLL_INTERVAL_MS = 2000;

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
const formModels = ref([]);
const fetchingModels = ref(false);

const organizeScope = ref('smart');
const enableProbe = ref(true);
const protectMainDirect = ref(true);
const customPrompt = ref('');
const organizing = ref(false);
const applying = ref(false);
const webdavConfigured = ref(false);
const autoBackupWebdav = ref(false);
const backupFailedPrompt = ref(false);

// 异步任务与轮询状态
const currentTaskId = ref('');
let pollTimer = null;
const taskProgress = ref({
  progress: 0,
  message: '',
  probed_done: 0,
  probed_total: 0,
  batch_done: 0,
  batch_total: 0
});

const diffUpdates = ref([]);
const selectedUpdateIds = ref([]);
const diffRecycles = ref([]);
const selectedRecycleIds = ref([]);
const suggestedSubMenus = ref([]);
const selectedSuggestionKeys = ref(new Set());
const batchApplyingSuggestions = ref(false);
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

const pendingSuggestions = computed(() => suggestedSubMenus.value.filter(s => !s.created));
const selectedPendingSuggestionCount = computed(() =>
  pendingSuggestions.value.filter(s => selectedSuggestionKeys.value.has(s.key)).length
);
const allPendingSuggestionsSelected = computed(() =>
  pendingSuggestions.value.length > 0 && selectedPendingSuggestionCount.value === pendingSuggestions.value.length
);

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

function formatRequestError(err, fallback) {
  const status = err?.response?.status;
  const data = err?.response?.data;

  let detail = '';
  if (data && typeof data === 'object') {
    detail = data.message || data.error?.message || (typeof data.error === 'string' ? data.error : '') || data.detail || '';
  } else if (typeof data === 'string' && data.trim()) {
    const plain = data
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) detail = plain.slice(0, 220);
  }

  if (detail) {
    return status && !detail.includes(String(status)) ? `[HTTP ${status}] ${detail}` : detail;
  }
  if (status === 504 || status === 502) {
    return `${fallback}（HTTP ${status} 网关超时/代理断开）`;
  }
  if (status) {
    return `${fallback}（HTTP ${status}${err?.response?.statusText ? ` ${err.response.statusText}` : ''}）`;
  }
  if (err?.code === 'ECONNABORTED' || /timeout/i.test(err?.message || '')) {
    return `${fallback}（请求超时）`;
  }
  if (err?.message) {
    return `${fallback}（${err.message}${err.code ? ` / ${err.code}` : ''}）`;
  }
  return fallback;
}

watch(organizeScope, (nextScope) => {
  if (nextScope === 'custom') {
    protectMainDirect.value = false;
  } else {
    protectMainDirect.value = true;
  }
});

watch(() => props.visible, async (val) => {
  if (val) {
    clearNotice();
    stopPolling();
    organizing.value = false;
    currentTaskId.value = '';
    step.value = 'config';
    previewTab.value = 'updates';
    createdAnySubMenu.value = false;
    if (!hasCurrentFilter.value && organizeScope.value === 'current') {
      organizeScope.value = 'smart';
    }
    await Promise.all([loadConfigs(), loadWebdavStatus()]);
  } else {
    stopPolling();
  }
});

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
    setNotice(formatRequestError(err, '读取 AI 接口配置失败'), 'error');
  }
}

function openNewConfigForm() {
  clearNotice();
  editingConfigId.value = null;
  showApiKey.value = false;
  formModels.value = [];
  configForm.value = { name: '', base_url: 'https://api.openai.com/v1', api_key: '', model: '' };
  showConfigForm.value = true;
}

function openEditConfigForm(cfg) {
  clearNotice();
  editingConfigId.value = cfg.id;
  showApiKey.value = false;
  formModels.value = [];
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
  formModels.value = [];
}

function onFormDropdownModelChange(event) {
  const val = event.target.value;
  if (val) {
    configForm.value.model = val;
  }
}

async function handleFetchFormModels() {
  const baseUrl = configForm.value.base_url.trim();
  const apiKey = configForm.value.api_key.trim();
  if (!baseUrl || !apiKey) {
    setNotice('请先在表单中填写 API Base URL 和 API Key', 'error');
    return;
  }
  fetchingModels.value = true;
  clearNotice();
  try {
    const { data } = await fetchAiModels({ base_url: baseUrl, api_key: apiKey });
    formModels.value = data.models || [];
    if (formModels.value.length) {
      if (!configForm.value.model.trim()) {
        const preferredChat = formModels.value.find(
          m => !/embedding|bge-|rerank|image|dall-e|whisper|tts|audio|moderation/i.test(m)
        );
        configForm.value.model = preferredChat || formModels.value[0];
      }
      setNotice(`成功拉取 ${formModels.value.length} 个模型，请选择后点击「保存配置」`, 'success');
    } else {
      setNotice('接口返回了空的模型列表，请直接在右侧手动输入模型名称', 'info');
    }
  } catch (err) {
    setNotice(formatRequestError(err, '拉取模型列表失败'), 'error');
  } finally {
    fetchingModels.value = false;
  }
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
      setNotice('AI 接口与模型配置已更新', 'success');
    } else {
      await addAiConfig({ ...configForm.value, is_active: true });
      setNotice('AI 接口与模型配置已添加并激活', 'success');
    }
    showConfigForm.value = false;
    editingConfigId.value = null;
    formModels.value = [];
    await loadConfigs();
  } catch (err) {
    setNotice(formatRequestError(err, '保存配置失败'), 'error');
  } finally {
    savingConfig.value = false;
  }
}

async function handleActivate(cfg) {
  if (cfg.is_active) return;
  clearNotice();
  try {
    await activateAiConfig(cfg.id);
    await loadConfigs();
  } catch (err) {
    setNotice(formatRequestError(err, '切换接口失败'), 'error');
  }
}

async function handleDeleteConfig(cfg) {
  if (!window.confirm(`确定要删除 AI 接口「${cfg.name}」吗？`)) return;
  clearNotice();
  try {
    await deleteAiConfig(cfg.id);
    if (editingConfigId.value === cfg.id) cancelConfigForm();
    await loadConfigs();
    setNotice('配置已删除', 'success');
  } catch (err) {
    setNotice(formatRequestError(err, '删除配置失败'), 'error');
  }
}

function applyOrganizeResult(data) {
  diffUpdates.value = data.updates || data.changes || [];
  diffRecycles.value = data.recycles || [];
  suggestedSubMenus.value = (data.suggested_sub_menus || []).map((s, idx) => ({
    ...s,
    key: s.key || `${s.action || 'create'}:${s.target_sub_menu_id || s.parent_menu_id}:${s.name}:${idx}`,
    action: s.action || (s.target_sub_menu_id ? 'rename' : 'create'),
    created: false
  }));
  selectedSuggestionKeys.value = new Set(suggestedSubMenus.value.map(s => s.key));
  selectedUpdateIds.value = diffUpdates.value
    .filter(item => item.changed_fields && item.changed_fields.length > 0)
    .map(item => item.id);
  selectedRecycleIds.value = diffRecycles.value.map(item => item.id);
  probeStats.value = data.probe_stats || { total: 0, reachable: 0, waf_403: 0, suspected_dead: 0, suspected_expired: 0 };
  previewMeta.value = {
    totalAnalyzed: data.total_analyzed || 0,
    totalProbed: data.total_probed || data.total_analyzed || 0,
    model: data.model || activeConfig.value?.model || ''
  };
  previewTab.value = !diffUpdates.value.length && diffRecycles.value.length ? 'recycles' : 'updates';
  step.value = 'preview';
}

async function pollTaskOnce(taskId) {
  if (!organizing.value || currentTaskId.value !== taskId) return;
  try {
    const { data } = await getAiOrganizeStatus(taskId);
    if (!organizing.value || currentTaskId.value !== taskId) return;

    taskProgress.value = {
      progress: Number(data.progress || 0),
      message: data.message || '正在后台处理...',
      probed_done: Number(data.probed_done || 0),
      probed_total: Number(data.probed_total || 0),
      batch_done: Number(data.batch_done || 0),
      batch_total: Number(data.batch_total || 0)
    };

    if (data.status === 'completed') {
      stopPolling();
      organizing.value = false;
      currentTaskId.value = '';
      applyOrganizeResult(data.result || {});
      return;
    }

    if (data.status === 'failed') {
      stopPolling();
      organizing.value = false;
      currentTaskId.value = '';
      setNotice(data.message || `AI 智能整理失败：${data.error || '未知错误'}`, 'error');
      return;
    }

    if (data.status === 'cancelled') {
      stopPolling();
      organizing.value = false;
      currentTaskId.value = '';
      setNotice('整理任务已取消', 'info');
      return;
    }

    pollTimer = setTimeout(() => pollTaskOnce(taskId), POLL_INTERVAL_MS);
  } catch (err) {
    stopPolling();
    organizing.value = false;
    currentTaskId.value = '';
    setNotice(formatRequestError(err, '查询整理进度失败'), 'error');
  }
}

async function handleOrganize() {
  if (!activeConfig.value) {
    setNotice('请先在步骤 1 添加并激活一个 AI 接口配置', 'error');
    return;
  }
  const activeModel = String(activeConfig.value.model || '').trim();
  if (!activeModel) {
    setNotice(`当前激活的接口「${activeConfig.value.name}」尚未配置模型，请点击其右侧 ✎ 编辑，拉取或填写模型并保存`, 'error');
    openEditConfigForm(activeConfig.value);
    return;
  }
  if (organizeScope.value === 'custom' && !customPrompt.value.trim()) {
    setNotice('已选择「自定义 AI 整理」模式，请在下方输入框中填写具体的整理指令后再开始执行', 'error');
    return;
  }

  organizing.value = true;
  clearNotice();
  taskProgress.value = {
    progress: 2,
    message: '正在创建后台整理任务...',
    probed_done: 0,
    probed_total: 0,
    batch_done: 0,
    batch_total: 0
  };

  try {
    const payload = {
      config_id: activeConfig.value.id,
      model: activeModel,
      prompt: customPrompt.value.trim(),
      scope: organizeScope.value,
      enable_probe: enableProbe.value,
      protect_main_direct: protectMainDirect.value
    };
    if (organizeScope.value === 'current' && hasCurrentFilter.value) {
      payload.menu_id = props.currentMenuId;
      payload.sub_menu_id = props.currentSubMenuId;
    }
    const { data } = await startAiOrganize(payload);
    currentTaskId.value = data.taskId;
    taskProgress.value.message = data.message || '后台任务已启动，正在测活与整理...';
    pollTimer = setTimeout(() => pollTaskOnce(data.taskId), POLL_INTERVAL_MS);
  } catch (err) {
    organizing.value = false;
    currentTaskId.value = '';
    setNotice(formatRequestError(err, '启动 AI 整理任务失败'), 'error');
  }
}

async function handleCancelTask() {
  const taskId = currentTaskId.value;
  stopPolling();
  organizing.value = false;
  currentTaskId.value = '';
  if (taskId) {
    await cancelAiOrganize(taskId).catch(() => {});
  }
  setNotice('整理任务已取消', 'info');
}

function toggleSuggestionKey(key) {
  const next = new Set(selectedSuggestionKeys.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  selectedSuggestionKeys.value = next;
}

function toggleAllSuggestions() {
  if (allPendingSuggestionsSelected.value) {
    selectedSuggestionKeys.value = new Set();
  } else {
    selectedSuggestionKeys.value = new Set(pendingSuggestions.value.map(s => s.key));
  }
}

function syncAppliedSuggestionsToDiff(appliedList) {
  for (const res of appliedList) {
    const targetSug = suggestedSubMenus.value.find(s => s.key === res.key);
    if (targetSug) targetSug.created = true;
    const newCategoryLabel = `${res.parent_menu_name} / ${res.name}`;
    const cardIds = Array.isArray(res.card_ids) ? res.card_ids : [];
    const cardTitles = Array.isArray(res.card_titles) ? res.card_titles : [];

    for (let i = 0; i < cardIds.length; i++) {
      const cardId = cardIds[i];
      const existing = diffUpdates.value.find(item => item.id === cardId);
      if (existing) {
        existing.new_menu_id = res.parent_menu_id;
        existing.new_sub_menu_id = res.sub_menu_id;
        existing.new_category = newCategoryLabel;
        existing.needs_review = false;
        if (!existing.changed_fields.includes('category')) {
          existing.changed_fields = ['category', ...existing.changed_fields];
        }
        existing.reason = res.action === 'rename'
          ? `子菜单已更名为「${res.name}」`
          : `归入新建子菜单「${res.name}」`;
      } else if (res.action === 'create') {
        diffUpdates.value.push({
          id: cardId,
          url: '',
          old_menu_id: null,
          old_sub_menu_id: null,
          old_category: '原分类',
          new_menu_id: res.parent_menu_id,
          new_sub_menu_id: res.sub_menu_id,
          new_category: newCategoryLabel,
          old_title: cardTitles[i] || `卡片 #${cardId}`,
          new_title: cardTitles[i] || `卡片 #${cardId}`,
          old_desc: '',
          new_desc: '',
          changed_fields: ['category'],
          needs_review: false,
          reason: `归入新建子菜单「${res.name}」`
        });
      }
      if (!selectedUpdateIds.value.includes(cardId) && diffUpdates.value.some(item => item.id === cardId)) {
        selectedUpdateIds.value = [...selectedUpdateIds.value, cardId];
      }
    }
  }
}

async function handleBatchApproveSuggestions() {
  const chosen = pendingSuggestions.value.filter(s => selectedSuggestionKeys.value.has(s.key));
  if (!chosen.length) {
    setNotice('请至少勾选一条子菜单建议', 'error');
    return;
  }
  if (!window.confirm(`确定要批量同意选中的 ${chosen.length} 条子菜单建议并自动关联涉及卡片吗？`)) return;
  batchApplyingSuggestions.value = true;
  clearNotice();
  try {
    const { data } = await applyAiSuggestions(chosen);
    createdAnySubMenu.value = true;
    syncAppliedSuggestionsToDiff(data.applied || []);
    selectedSuggestionKeys.value = new Set(pendingSuggestions.value.map(s => s.key));
    setNotice(`已批量同意 ${data.applied?.length || chosen.length} 条子菜单建议并更新预览，请点击下方「应用更改」落库卡片归属`, 'success');
  } catch (err) {
    setNotice(formatRequestError(err, '批量同意子菜单建议失败'), 'error');
  } finally {
    batchApplyingSuggestions.value = false;
  }
}

async function handleApproveSingleSuggestion(sug, idx) {
  const actionText = sug.action === 'rename'
    ? `将「${sug.parent_menu_name} / ${sug.old_name}」更名为「${sug.name}」`
    : `在「${sug.parent_menu_name}」下新建子菜单「${sug.name}」并关联 ${sug.card_ids.length} 张卡片`;
  if (!window.confirm(`确定要${actionText}吗？`)) return;
  creatingSubIndex.value = idx;
  clearNotice();
  try {
    const { data } = await applyAiSuggestions([sug]);
    createdAnySubMenu.value = true;
    syncAppliedSuggestionsToDiff(data.applied || []);
    setNotice(`已生效「${sug.parent_menu_name} / ${sug.name}」并更新预览`, 'success');
  } catch (err) {
    setNotice(formatRequestError(err, '处理子菜单建议失败'), 'error');
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

async function handleApply(forceIgnoreBackup = false) {
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
      recycles: chosenRecycles,
      auto_backup: forceIgnoreBackup ? false : Boolean(webdavConfigured.value && autoBackupWebdav.value)
    });
    if (data.recycled > 0) {
      window.dispatchEvent(new Event('recycle:updated'));
    }
    emit('applied', {
      updated: data.updated || 0,
      recycled: data.recycled || 0,
      backup: data.backup || null,
      menusChanged: createdAnySubMenu.value
    });
    emit('close');
  } catch (err) {
    if (err?.response?.data?.backup_failed) {
      backupFailedPrompt.value = true;
    }
    setNotice(formatRequestError(err, '应用更改失败'), 'error');
  } finally {
    applying.value = false;
  }
}

function handleForceApplyWithoutBackup() {
  if (!window.confirm('确定忽略 WebDAV 云端备份并直接将整理更改写入数据库吗？')) return;
  return handleApply(true);
}

async function handleClose() {
  if (applying.value) return;
  if (organizing.value) {
    const taskId = currentTaskId.value;
    stopPolling();
    organizing.value = false;
    currentTaskId.value = '';
    if (taskId) {
      await cancelAiOrganize(taskId).catch(() => {});
    }
  }
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
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.85rem;
  line-height: 1.5;
  word-break: break-word;
}
.ai-notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.ai-notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.ai-notice.info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }

/* 异步任务进度条面板 */
.task-progress-panel {
  padding: 12px 15px;
  border-radius: 11px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
  font-weight: 600;
  color: #312e81;
}

.progress-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-pct {
  font-size: 0.85rem;
  font-weight: 700;
  color: #4f46e5;
}

.progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #dbeafe;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
  transition: width 0.35s ease;
}

.progress-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 0.76rem;
  color: #4338ca;
}

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
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-missing-tag {
  font-size: 0.72rem;
  padding: 1px 7px;
  border-radius: 4px;
  background: #ffedd5;
  color: #c2410c;
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
.ai-icon-btn:hover:not(:disabled) { background: #f1f5f9; }
.ai-icon-btn.danger:hover:not(:disabled) { background: #fee2e2; color: #dc2626; border-color: #fecaca; }

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
.form-field { display: flex; flex-direction: column; gap: 5px; font-size: 0.78rem; color: #475569; }
.form-field-full { grid-column: 1 / -1; }
.form-field input {
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font-size: 0.85rem;
}
.key-input-wrap { display: flex; gap: 4px; }
.key-input-wrap input { flex: 1; min-width: 0; }
.toggle-key-btn { border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 7px; padding: 0 8px; cursor: pointer; }
.model-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.model-select-row { display: flex; gap: 8px; flex-wrap: wrap; }
.ai-select,
.ai-input {
  flex: 1;
  min-width: 210px;
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  font-size: 0.85rem;
  background: #fff;
}
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

.option-toggles {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.probe-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.81rem;
  color: #334155;
  cursor: pointer;
}

.scope-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}

.scope-card.custom-card.active {
  border-color: #ec4899;
  background: #fdf2f8;
}

.custom-prompt-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: #9d174d;
  margin-bottom: 6px;
}

.required-star {
  color: #dc2626;
}

.ai-textarea.custom-required {
  border-color: #f472b6;
}

.force-apply-row {
  margin-top: 8px;
}

.webdav-backup-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: #334155;
  cursor: pointer;
}

.webdav-backup-toggle.disabled {
  color: #94a3b8;
  cursor: not-allowed;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 0.84rem;
  color: #92400e;
  margin-bottom: 8px;
}
.suggestion-batch-actions { display: flex; align-items: center; gap: 6px; }
.suggestion-list { display: flex; flex-direction: column; gap: 8px; }
.suggestion-item {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid #fef3c7;
  border-radius: 8px;
  padding: 8px 10px;
  flex-wrap: wrap;
}
.suggestion-item.applied { opacity: 0.72; background: #f8fafc; }
.suggestion-check { display: flex; align-items: center; }
.suggestion-info { flex: 1; min-width: 200px; }
.action-type-tag {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.action-type-tag.create { background: #dcfce7; color: #166534; }
.action-type-tag.rename { background: #fef3c7; color: #92400e; }
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
.preview-tab.active { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.preview-tab.recycle-tab.active { background: #dc2626; border-color: #dc2626; }

.tab-badge { font-size: 0.74rem; padding: 1px 7px; border-radius: 999px; background: rgba(15, 23, 42, 0.08); }
.preview-tab.active .tab-badge { background: rgba(255, 255, 255, 0.25); }

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
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.footer-active-info {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 0.82rem;
  color: #475569;
  flex-wrap: wrap;
}

.footer-buttons {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
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
.ai-btn-xs { padding: 3px 9px; font-size: 0.76rem; }
.ai-btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; }
.ai-btn-primary:hover:not(:disabled) { filter: brightness(1.06); }
.ai-btn-outline { background: #fff; color: #4f46e5; border: 1px solid #c7d2fe; }
.ai-btn-outline:hover:not(:disabled) { background: #eef2ff; }
.ai-btn-danger-outline { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
.ai-btn-danger-outline:hover:not(:disabled) { background: #fef2f2; }
.ai-btn-ghost { background: #e2e8f0; color: #334155; }

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ai-spin 0.7s linear infinite;
}
.spinner.dark {
  border-color: rgba(79, 70, 229, 0.25);
  border-top-color: #4f46e5;
}
@keyframes ai-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .form-grid,
  .scope-cards {
    grid-template-columns: 1fr;
  }
}
</style>
