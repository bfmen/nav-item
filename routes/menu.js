const express = require('express');
const db = require('../db');
const auth = require('./authMiddleware');
const router = express.Router();

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

// 获取所有菜单（包含子菜单）
router.get('/', (req, res) => {
  const { page, pageSize } = req.query;
  if (!page && !pageSize) {
    db.all('SELECT * FROM menus ORDER BY "order" ASC, id ASC', [], (err, menus) => {
      if (err) return res.status(500).json({ error: err.message });

      const getSubMenus = (menu) => {
        return new Promise((resolve, reject) => {
          db.all('SELECT * FROM sub_menus WHERE parent_id = ? ORDER BY "order" ASC, id ASC', [menu.id], (err, subMenus) => {
            if (err) reject(err);
            else resolve(subMenus);
          });
        });
      };

      Promise.all(menus.map(async (menu) => {
        try {
          const subMenus = await getSubMenus(menu);
          return { ...menu, subMenus };
        } catch (err) {
          console.error('获取子菜单失败:', err);
          return { ...menu, subMenus: [] };
        }
      })).then(menusWithSubMenus => {
        res.json(menusWithSubMenus);
      }).catch(err => {
        res.status(500).json({ error: err.message });
      });
    });
  } else {
    const pageNum = parseInt(page) || 1;
    const size = parseInt(pageSize) || 10;
    const offset = (pageNum - 1) * size;
    db.get('SELECT COUNT(*) as total FROM menus', [], (err, countRow) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all('SELECT * FROM menus ORDER BY "order" ASC, id ASC LIMIT ? OFFSET ?', [size, offset], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          total: countRow.total,
          page: pageNum,
          pageSize: size,
          data: rows
        });
      });
    });
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
  db.all('SELECT * FROM sub_menus WHERE parent_id = ? ORDER BY "order" ASC, id ASC', [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 新增、修改、删除菜单需认证
router.post('/', auth, (req, res) => {
  const { name, order } = req.body;
  db.run('INSERT INTO menus (name, "order") VALUES (?, ?)', [name, order || 0], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

router.put('/:id', auth, (req, res) => {
  const { name, order } = req.body;
  db.run('UPDATE menus SET name=?, "order"=? WHERE id=?', [name, order || 0, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changed: this.changes });
  });
});

router.delete('/:id', auth, (req, res) => {
  db.run('DELETE FROM menus WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// 子菜单相关API
router.post('/:id/submenus', auth, (req, res) => {
  const { name, order } = req.body;
  db.run('INSERT INTO sub_menus (parent_id, name, "order") VALUES (?, ?, ?)',
    [req.params.id, name, order || 0], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

router.put('/submenus/:id', auth, (req, res) => {
  const { name, order } = req.body;
  db.run('UPDATE sub_menus SET name=?, "order"=? WHERE id=?', [name, order || 0, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changed: this.changes });
  });
});

router.delete('/submenus/:id', auth, (req, res) => {
  db.run('DELETE FROM sub_menus WHERE id=?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

module.exports = router;
