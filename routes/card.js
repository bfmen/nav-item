const express = require('express');
const db = require('../db');
const auth = require('./authMiddleware');
const router = express.Router();
const DEFAULT_LOGO = '/uploads/default-favicon.png';

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
  });
  return rows;
}

// 获取卡片列表（支持全部、按主菜单、按主菜单直属、按子菜单筛选）
router.get('/', async (req, res) => {
  try {
    const { menuId, subMenuId } = req.query;
    const baseSelect = `
      SELECT
        c.*,
        COALESCE(c.menu_id, sm.parent_id) AS effective_menu_id,
        m.name AS menu_name,
        sm.name AS sub_menu_name
      FROM cards c
      LEFT JOIN sub_menus sm ON c.sub_menu_id = sm.id
      LEFT JOIN menus m ON COALESCE(c.menu_id, sm.parent_id) = m.id
    `;

    let query = '';
    let params = [];

    if (subMenuId && subMenuId !== 'all' && subMenuId !== 'main') {
      query = `${baseSelect} WHERE c.sub_menu_id = ? ORDER BY c."order" ASC, c.id ASC`;
      params = [Number(subMenuId)];
    } else if (menuId && menuId !== 'all') {
      if (subMenuId === 'main') {
        query = `${baseSelect} WHERE c.menu_id = ? AND c.sub_menu_id IS NULL ORDER BY c."order" ASC, c.id ASC`;
        params = [Number(menuId)];
      } else {
        query = `${baseSelect} WHERE COALESCE(c.menu_id, sm.parent_id) = ? ORDER BY COALESCE(sm."order", -1) ASC, c."order" ASC, c.id ASC`;
        params = [Number(menuId)];
      }
    } else {
      query = `${baseSelect} ORDER BY COALESCE(m."order", 999999) ASC, COALESCE(sm."order", -1) ASC, c."order" ASC, c.id ASC`;
    }

    const rows = await all(query, params);
    res.json(attachDisplayLogo(rows));
  } catch (err) {
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

// 批量删除卡片
router.post('/batch-delete', auth, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: '请选择要删除的卡片' });

  try {
    await run('BEGIN TRANSACTION');
    const placeholders = ids.map(() => '?').join(',');
    const result = await run(`DELETE FROM cards WHERE id IN (${placeholders})`, ids);
    await run('COMMIT');
    res.json({ deleted: result.changes });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

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
      ? await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE sub_menu_id = ?', [targetSubMenuId])
      : await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE menu_id = ? AND sub_menu_id IS NULL', [targetMenuId]);
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

// 获取指定菜单的卡片（兼容前端首页与既有调用）
router.get('/:menuId', (req, res) => {
  const { subMenuId } = req.query;
  let query, params;

  if (subMenuId) {
    query = 'SELECT * FROM cards WHERE sub_menu_id = ? ORDER BY "order" ASC, id ASC';
    params = [subMenuId];
  } else {
    query = 'SELECT * FROM cards WHERE menu_id = ? AND sub_menu_id IS NULL ORDER BY "order" ASC, id ASC';
    params = [req.params.menuId];
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(attachDisplayLogo(rows));
  });
});

// 新增、修改、删除卡片需认证
router.post('/', auth, async (req, res) => {
  try {
    const { menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, order } = req.body;
    const resolvedSubMenuId = sub_menu_id || null;
    let resolvedMenuId = menu_id || null;
    if (resolvedSubMenuId && !resolvedMenuId) {
      const subMenu = await get('SELECT parent_id FROM sub_menus WHERE id = ?', [resolvedSubMenuId]);
      if (subMenu) resolvedMenuId = subMenu.parent_id;
    }
    let resolvedOrder = order;
    if (resolvedOrder === undefined || resolvedOrder === null || resolvedOrder === '') {
      const row = resolvedSubMenuId
        ? await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE sub_menu_id = ?', [resolvedSubMenuId])
        : await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM cards WHERE menu_id = ? AND sub_menu_id IS NULL', [resolvedMenuId]);
      resolvedOrder = Number(row?.maxOrder || 0) + 1;
    }
    const result = await run(
      'INSERT INTO cards (menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, "order") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [resolvedMenuId, resolvedSubMenuId, title, url, logo_url || '', custom_logo_path || null, desc || '', Number(resolvedOrder) || 0]
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const { menu_id, sub_menu_id, title, url, logo_url, custom_logo_path, desc, order } = req.body;
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
      [resolvedMenuId, resolvedSubMenuId, title, url, logo_url ?? '', finalCustomLogoPath, desc ?? '', Number(order) || 0, req.params.id]
    );
    res.json({ changed: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, (req, res) => {
  db.run('DELETE FROM cards WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

module.exports = router;
