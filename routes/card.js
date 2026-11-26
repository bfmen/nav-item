const express = require('express');
const db = require('../db');
const auth = require('./authMiddleware');
const router = express.Router();
const DEFAULT_LOGO = '/uploads/default-favicon.png';
const RECYCLE_REASONS = new Set(['dead_link', 'domain_expired', 'duplicate', 'manual']);

const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

function normalizeRecycleReason(reason) {
  return RECYCLE_REASONS.has(reason) ? reason : 'manual';
}

function getLogoProxyUrl(card) {
  const custom = (card.logo || card.logo_url || '').trim();
  if (custom) return custom;
  if (!card.url) return DEFAULT_LOGO;
  return `/api/favicon?url=${encodeURIComponent(card.url)}`;
}

function attachDisplayLogo(rows) {
  rows.forEach(card => {
    const customLogo = (card.logo || card.logo_url || '').trim();
    if (customLogo) {
      card.display_logo = customLogo;
    } else if (card.custom_logo_path) {
      card.display_logo = '/uploads/' + card.custom_logo_path.replace(/^\/+/, '');
    } else {
      card.display_logo = getLogoProxyUrl(card);
    }
    card.order = Number(card.order || 0);
    card.sort = card.order;
    card.desc = card.desc || '';
  });
  return rows;
}

const BASE_CARD_SELECT = `
  SELECT
    c.*,
    COALESCE(c.menu_id, sm.parent_id) AS effective_menu_id,
    m.name AS menu_name,
    sm.name AS sub_menu_name
  FROM cards c
  LEFT JOIN sub_menus sm ON c.sub_menu_id = sm.id
  LEFT JOIN menus m ON COALESCE(c.menu_id, sm.parent_id) = m.id
`;

// 获取正常卡片列表（支持全部、按主菜单、按主菜单直属、按子菜单筛选，自动过滤已软删除卡片）
router.get('/', async (req, res) => {
  try {
    const menuId = req.query.menu_id ?? req.query.menuId;
    const subMenuId = req.query.sub_menu_id ?? req.query.subMenuId;
    let query = '';
    let params = [];

    if (subMenuId && subMenuId !== 'all' && subMenuId !== 'main') {
      query = `${BASE_CARD_SELECT} WHERE COALESCE(c.is_deleted, 0) = 0 AND c.sub_menu_id = ? ORDER BY c."order" ASC, c.id ASC`;
      params = [Number(subMenuId)];
    } else if (menuId && menuId !== 'all') {
      if (subMenuId === 'main') {
        query = `${BASE_CARD_SELECT} WHERE COALESCE(c.is_deleted, 0) = 0 AND c.menu_id = ? AND c.sub_menu_id IS NULL ORDER BY c."order" ASC, c.id ASC`;
        params = [Number(menuId)];
      } else {
        query = `${BASE_CARD_SELECT} WHERE COALESCE(c.is_deleted, 0) = 0 AND COALESCE(c.menu_id, sm.parent_id) = ? ORDER BY COALESCE(sm."order", -1) ASC, c."order" ASC, c.id ASC`;
        params = [Number(menuId)];
      }
    } else {
      query = `${BASE_CARD_SELECT} WHERE COALESCE(c.is_deleted, 0) = 0 ORDER BY COALESCE(m."order", 999999) ASC, COALESCE(sm."order", -1) ASC, c."order" ASC, c.id ASC`;
    }

    const rows = await all(query, params);
    res.json(attachDisplayLogo(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取回收站数量（供侧边栏角标展示，必须在 /:menuId 之前注册）
router.get('/recycle/count', auth, async (req, res) => {
  try {
    const row = await get('SELECT COUNT(*) AS count FROM cards WHERE COALESCE(is_deleted, 0) = 1');
    res.json({ count: Number(row?.count || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取回收站列表（支持按失效原因 + 原主菜单/子菜单双维度筛选）
router.get('/recycle', auth, async (req, res) => {
  try {
    const { reason, menuId, subMenuId } = req.query;
    const conditions = ['COALESCE(c.is_deleted, 0) = 1'];
    const params = [];

    if (reason && reason !== 'all' && RECYCLE_REASONS.has(reason)) {
      conditions.push("COALESCE(c.recycle_reason, 'manual') = ?");
      params.push(reason);
    }

    if (subMenuId && subMenuId !== 'all' && subMenuId !== 'main') {
      conditions.push('c.sub_menu_id = ?');
      params.push(Number(subMenuId));
    } else if (menuId && menuId !== 'all') {
      if (subMenuId === 'main') {
        conditions.push('c.menu_id = ? AND c.sub_menu_id IS NULL');
        params.push(Number(menuId));
      } else {
        conditions.push('COALESCE(c.menu_id, sm.parent_id) = ?');
        params.push(Number(menuId));
      }
    }

    const rows = await all(
      `${BASE_CARD_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY c.deleted_at DESC, c.id DESC`,
      params
    );

    const countRows = await all(`
      SELECT COALESCE(recycle_reason, 'manual') AS reason, COUNT(*) AS cnt
      FROM cards
      WHERE COALESCE(is_deleted, 0) = 1
      GROUP BY COALESCE(recycle_reason, 'manual')
    `);

    const counts = { total: 0, dead_link: 0, domain_expired: 0, duplicate: 0, manual: 0 };
    countRows.forEach(r => {
      const cnt = Number(r.cnt || 0);
      counts.total += cnt;
      if (Object.prototype.hasOwnProperty.call(counts, r.reason)) {
        counts[r.reason] = cnt;
      } else {
        counts.manual += cnt;
      }
    });

    res.json({ data: attachDisplayLogo(rows), counts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 从回收站还原卡片（恢复至原栏目；若原栏目已不存在则兜底恢复至首个主菜单）
router.post('/recycle/restore', auth, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: '请选择要还原的卡片' });

  try {
    const menus = await all('SELECT id FROM menus ORDER BY "order" ASC, id ASC');
    const subMenus = await all('SELECT id, parent_id FROM sub_menus');
    const menuIdSet = new Set(menus.map(m => Number(m.id)));
    const subMenuById = new Map(subMenus.map(sm => [Number(sm.id), Number(sm.parent_id)]));
    const fallbackMenuId = menus[0]?.id ?? null;

    await run('BEGIN TRANSACTION');
    let restored = 0;
    for (const id of ids) {
      const card = await get('SELECT id, menu_id, sub_menu_id FROM cards WHERE id = ? AND COALESCE(is_deleted, 0) = 1', [id]);
      if (!card) continue;

      let targetSubMenuId = card.sub_menu_id ? Number(card.sub_menu_id) : null;
      let targetMenuId = card.menu_id ? Number(card.menu_id) : null;

      if (targetSubMenuId && subMenuById.has(targetSubMenuId)) {
        targetMenuId = subMenuById.get(targetSubMenuId);
      } else {
        targetSubMenuId = null;
        if (!targetMenuId || !menuIdSet.has(targetMenuId)) {
          targetMenuId = fallbackMenuId;
        }
      }

      const result = await run(
        'UPDATE cards SET is_deleted = 0, deleted_at = NULL, recycle_reason = NULL, menu_id = ?, sub_menu_id = ? WHERE id = ?',
        [targetMenuId, targetSubMenuId, id]
      );
      restored += result.changes;
    }
    await run('COMMIT');
    res.json({ restored });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// 从回收站彻底物理删除
router.post('/recycle/permanent-delete', auth, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: '请选择要彻底删除的卡片' });

  try {
    await run('BEGIN TRANSACTION');
    const placeholders = ids.map(() => '?').join(',');
    const result = await run(
      `DELETE FROM cards WHERE COALESCE(is_deleted, 0) = 1 AND id IN (${placeholders})`,
      ids
    );
    await run('COMMIT');
    res.json({ deleted: result.changes });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// 一键清空回收站（支持清空全部或按当前筛选原因清空）
router.delete('/recycle/empty', auth, async (req, res) => {
  try {
    const { reason } = req.query;
    await run('BEGIN TRANSACTION');
    let result;
    if (reason && reason !== 'all' && RECYCLE_REASONS.has(reason)) {
      result = await run(
        "DELETE FROM cards WHERE COALESCE(is_deleted, 0) = 1 AND COALESCE(recycle_reason, 'manual') = ?",
        [reason]
      );
    } else {
      result = await run('DELETE FROM cards WHERE COALESCE(is_deleted, 0) = 1');
    }
    await run('COMMIT');
    res.json({ deleted: result.changes });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// 批量更新卡片排序（必须在 /:id 之前注册）
router.put('/reorder', auth, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: '缺少排序数据' });

  try {
    await run('BEGIN TRANSACTION');
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = Number(item?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const orderVal = Number.isFinite(Number(item?.order ?? item?.sort))
        ? Number(item.order ?? item.sort)
        : i + 1;
      await run('UPDATE cards SET "order" = ? WHERE id = ?', [orderVal, id]);
    }
    await run('COMMIT');
    res.json({ updated: items.length });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

async function handleBatchRecycle(req, res) {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: '请选择要移入回收站的卡片' });

  const reason = normalizeRecycleReason(req.body?.reason || 'manual');
  try {
    await run('BEGIN TRANSACTION');
    const placeholders = ids.map(() => '?').join(',');
    const result = await run(
      `UPDATE cards SET is_deleted = 1, deleted_at = datetime('now'), recycle_reason = ? WHERE COALESCE(is_deleted, 0) = 0 AND id IN (${placeholders})`,
      [reason, ...ids]
    );
    await run('COMMIT');
    res.json({ deleted: result.changes, recycled: result.changes });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
}

// 批量移入回收站（兼容 batch-delete 路由名）
router.post('/batch-delete', auth, handleBatchRecycle);
router.post('/batch-recycle', auth, handleBatchRecycle);

// 批量移动卡片分类
router.post('/batch-move', auth, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: '请选择要移动的卡片' });

  let targetMenuId = req.body?.menu_id != null && req.body?.menu_id !== '' ? Number(req.body.menu_id) : null;
  const targetSubMenuId = req.body?.sub_menu_id != null && req.body?.sub_menu_id !== '' ? Number(req.body.sub_menu_id) : null;

  try {
    if (targetSubMenuId) {
      const subMenu = await get('SELECT id, parent_id FROM sub_menus WHERE id = ?', [targetSubMenuId]);
      if (!subMenu) return res.status(400).json({ error: '目标子菜单不存在' });
      targetMenuId = subMenu.parent_id;
    } else {
      if (!targetMenuId) return res.status(400).json({ error: '请选择目标主菜单' });
      const menu = await get('SELECT id FROM menus WHERE id = ?', [targetMenuId]);
      if (!menu) return res.status(400).json({ error: '目标主菜单不存在' });
    }

    const maxOrderRow = targetSubMenuId
      ? await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND sub_menu_id = ?', [targetSubMenuId])
      : await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND menu_id = ? AND sub_menu_id IS NULL', [targetMenuId]);
    let nextOrder = Number(maxOrderRow?.maxOrder || 0);

    await run('BEGIN TRANSACTION');
    let moved = 0;
    for (const id of ids) {
      nextOrder += 1;
      const result = await run(
        'UPDATE cards SET menu_id = ?, sub_menu_id = ?, "order" = ? WHERE id = ?',
        [targetMenuId, targetSubMenuId, nextOrder, id]
      );
      moved += result.changes;
    }
    await run('COMMIT');
    res.json({ moved, menu_id: targetMenuId, sub_menu_id: targetSubMenuId });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// 获取指定菜单的卡片（前台导航页使用，自动过滤已软删除卡片）
router.get('/:menuId', (req, res) => {
  const { subMenuId } = req.query;
  let query, params;

  if (subMenuId) {
    query = 'SELECT * FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND sub_menu_id = ? ORDER BY "order" ASC, id ASC';
    params = [subMenuId];
  } else {
    query = 'SELECT * FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND menu_id = ? AND sub_menu_id IS NULL ORDER BY "order" ASC, id ASC';
    params = [req.params.menuId];
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(attachDisplayLogo(rows));
  });
});

// 新增、修改、软删除卡片需认证
router.post('/', auth, async (req, res) => {
  try {
    const { menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, description, order } = req.body;
    const resolvedDesc = desc !== undefined ? desc : (description !== undefined ? description : '');
    const resolvedSubMenuId = sub_menu_id || null;
    let resolvedMenuId = menu_id || null;
    if (resolvedSubMenuId && !resolvedMenuId) {
      const subMenu = await get('SELECT parent_id FROM sub_menus WHERE id = ?', [resolvedSubMenuId]);
      if (subMenu) resolvedMenuId = subMenu.parent_id;
    }
    let resolvedOrder = order;
    if (resolvedOrder === undefined || resolvedOrder === null || resolvedOrder === '') {
      const row = resolvedSubMenuId
        ? await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND sub_menu_id = ?', [resolvedSubMenuId])
        : await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE COALESCE(is_deleted, 0) = 0 AND menu_id = ? AND sub_menu_id IS NULL', [resolvedMenuId]);
      resolvedOrder = Number(row?.maxOrder || 0) + 1;
    }
    const result = await run(
      'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order", is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [resolvedMenuId, resolvedSubMenuId, title, url, logo_url || '', custom_logo_path || null, resolvedDesc || '', Number(resolvedOrder) || 0]
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, description, order } = req.body;
    const resolvedDesc = desc !== undefined ? desc : (description !== undefined ? description : '');
    const resolvedSubMenuId = sub_menu_id || null;
    let resolvedMenuId = menu_id || null;
    if (resolvedSubMenuId) {
      const subMenu = await get('SELECT parent_id FROM sub_menus WHERE id = ?', [resolvedSubMenuId]);
      if (subMenu) resolvedMenuId = subMenu.parent_id;
    }
    const existing = await get('SELECT custom_logo_path FROM cards WHERE id = ?', [req.params.id]);
    const finalCustomLogoPath = custom_logo_path !== undefined ? custom_logo_path : (existing?.custom_logo_path ?? null);

    const result = await run(
      'UPDATE cards SET menu_id=?, sub_menu_id=?, title=?, url=?, logo_url=?, custom_logo_path=?, desc=?, "order"=? WHERE id=?',
      [resolvedMenuId, resolvedSubMenuId, title, url, logo_url ?? '', finalCustomLogoPath, resolvedDesc ?? '', Number(order) || 0, req.params.id]
    );
    res.json({ changed: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除卡片默认软删除移入回收站；传入 ?permanent=1 时彻底物理删除
router.delete('/:id', auth, (req, res) => {
  if (req.query.permanent === '1' || req.query.permanent === 'true') {
    db.run('DELETE FROM cards WHERE id = ?', [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes, permanent: true });
    });
    return;
  }
  const reason = normalizeRecycleReason(req.query.reason || req.body?.reason || 'manual');
  db.run(
    "UPDATE cards SET is_deleted = 1, deleted_at = datetime('now'), recycle_reason = ? WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
    [reason, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes, recycled: this.changes });
    }
  );
});

module.exports = router;
