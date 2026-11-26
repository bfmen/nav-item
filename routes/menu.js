const express = require('express');
const db = require('../db');
const auth = require('./authMiddleware');
const router = express.Router();

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

// 获取所有菜单（包含子菜单及各栏目未删除卡片计数）
router.get('/', async (req, res) => {
  const { page, pageSize } = req.query;
  try {
    if (!page && !pageSize) {
      const [menus, subMenus, directCounts, subCounts] = await Promise.all([
        all('SELECT id, name, "order" FROM menus ORDER BY "order" ASC, id ASC'),
        all('SELECT id, parent_id, name, "order" FROM sub_menus ORDER BY "order" ASC, id ASC'),
        all(`
          SELECT menu_id, COUNT(*) AS cnt
          FROM cards
          WHERE COALESCE(is_deleted, 0) = 0 AND sub_menu_id IS NULL AND menu_id IS NOT NULL
          GROUP BY menu_id
        `),
        all(`
          SELECT sub_menu_id, COUNT(*) AS cnt
          FROM cards
          WHERE COALESCE(is_deleted, 0) = 0 AND sub_menu_id IS NOT NULL
          GROUP BY sub_menu_id
        `)
      ]);

      const directMap = new Map(directCounts.map(r => [Number(r.menu_id), Number(r.cnt || 0)]));
      const subCountMap = new Map(subCounts.map(r => [Number(r.sub_menu_id), Number(r.cnt || 0)]));
      const subsByParent = new Map();

      for (const sm of subMenus) {
        const pid = Number(sm.parent_id);
        const normalized = {
          id: sm.id,
          parent_id: sm.parent_id,
          name: sm.name,
          order: Number(sm.order || 0),
          sort: Number(sm.order || 0),
          card_count: subCountMap.get(Number(sm.id)) || 0
        };
        if (!subsByParent.has(pid)) subsByParent.set(pid, []);
        subsByParent.get(pid).push(normalized);
      }

      const menusWithSubMenus = menus.map(menu => {
        const children = subsByParent.get(Number(menu.id)) || [];
        const directCount = directMap.get(Number(menu.id)) || 0;
        const subTotal = children.reduce((sum, sm) => sum + sm.card_count, 0);
        return {
          id: menu.id,
          name: menu.name,
          order: Number(menu.order || 0),
          sort: Number(menu.order || 0),
          direct_card_count: directCount,
          total_card_count: directCount + subTotal,
          subMenus: children
        };
      });

      return res.json(menusWithSubMenus);
    }

    const pageNum = parseInt(page, 10) || 1;
    const size = parseInt(pageSize, 10) || 10;
    const offset = (pageNum - 1) * size;
    const countRow = await get('SELECT COUNT(*) as total FROM menus');
    const rows = await all('SELECT id, name, "order" FROM menus ORDER BY "order" ASC, id ASC LIMIT ? OFFSET ?', [size, offset]);
    return res.json({
      total: countRow.total,
      page: pageNum,
      pageSize: size,
      data: rows.map(r => ({ ...r, order: Number(r.order || 0), sort: Number(r.order || 0) }))
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 批量更新主菜单排序（必须在 /:id 之前注册）
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
      await run('UPDATE menus SET "order" = ? WHERE id = ?', [orderVal, id]);
    }
    await run('COMMIT');
    res.json({ updated: items.length });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// 批量更新子菜单排序（必须在 /submenus/:id 之前注册）
router.put('/submenus/reorder', auth, async (req, res) => {
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
      await run('UPDATE sub_menus SET "order" = ? WHERE id = ?', [orderVal, id]);
    }
    await run('COMMIT');
    res.json({ updated: items.length });
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// 获取指定菜单的子菜单
router.get('/:id/submenus', (req, res) => {
  db.all('SELECT id, parent_id, name, "order" FROM sub_menus WHERE parent_id = ? ORDER BY "order" ASC, id ASC', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({ ...r, order: Number(r.order || 0), sort: Number(r.order || 0) })));
  });
});

// 新增、修改、删除主菜单需认证
router.post('/', auth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: '主菜单名称不能为空' });
    let resolvedOrder = req.body?.order ?? req.body?.sort;
    if (resolvedOrder === undefined || resolvedOrder === null || resolvedOrder === '') {
      const row = await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM menus');
      resolvedOrder = Number(row?.maxOrder || 0) + 1;
    }
    const result = await run('INSERT INTO menus (name, "order") VALUES (?, ?)', [name, Number(resolvedOrder) || 0]);
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', auth, async (req, res) => {
  try {
    const existing = await get('SELECT id, name, "order" FROM menus WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '主菜单不存在' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) return res.status(400).json({ error: '主菜单名称不能为空' });
    const rawOrder = req.body?.order ?? req.body?.sort;
    const finalOrder = rawOrder !== undefined && rawOrder !== null && rawOrder !== '' ? Number(rawOrder) : Number(existing.order || 0);
    const result = await run('UPDATE menus SET name = ?, "order" = ? WHERE id = ?', [name, finalOrder, req.params.id]);
    res.json({ changed: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, (req, res) => {
  db.run('DELETE FROM menus WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// 子菜单相关API
router.post('/:id/submenus', auth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: '子菜单名称不能为空' });
    let resolvedOrder = req.body?.order ?? req.body?.sort;
    if (resolvedOrder === undefined || resolvedOrder === null || resolvedOrder === '') {
      const row = await get('SELECT COALESCE(MAX("order"), 0) AS maxOrder FROM sub_menus WHERE parent_id = ?', [req.params.id]);
      resolvedOrder = Number(row?.maxOrder || 0) + 1;
    }
    const result = await run(
      'INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)',
      [req.params.id, name, Number(resolvedOrder) || 0]
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/submenus/:id', auth, async (req, res) => {
  try {
    const existing = await get('SELECT id, parent_id, name, "order" FROM sub_menus WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '子菜单不存在' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) return res.status(400).json({ error: '子菜单名称不能为空' });
    const rawOrder = req.body?.order ?? req.body?.sort;
    const finalOrder = rawOrder !== undefined && rawOrder !== null && rawOrder !== '' ? Number(rawOrder) : Number(existing.order || 0);
    const result = await run('UPDATE sub_menus SET name = ?, "order" = ? WHERE id = ?', [name, finalOrder, req.params.id]);
    res.json({ changed: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/submenus/:id', auth, (req, res) => {
  db.run('DELETE FROM sub_menus WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

module.exports = router;
