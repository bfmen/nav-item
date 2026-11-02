const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const menuRoutes = require('./routes/menu');
const cardRoutes = require('./routes/card');
const uploadRoutes = require('./routes/upload');
const authRoutes = require('./routes/auth');
const friendRoutes = require('./routes/friend');
const userRoutes = require('./routes/user');
const faviconRoutes = require('./routes/favicon').createFaviconRouter();
const compression = require('compression');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(compression());
// Docker uploads 为空挂载时仍通过同一路径提供随前端构建携带的原始柴犬图。
app.get('/uploads/default-favicon.png', (req, res) => {
  const candidates = [
    path.join(__dirname, 'uploads/default-favicon.png'),
    path.join(__dirname, 'web/dist/default-favicon.png'),
    path.join(__dirname, 'web/public/default-favicon.png')
  ];
  const filename = candidates.find(candidate => fs.existsSync(candidate));
  if (!filename) return res.sendStatus(404);
  return res.sendFile(filename);
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'web/dist')));

app.use((req, res, next) => {
  if (
    req.method === 'GET' &&
    !req.path.startsWith('/api') &&
    !req.path.startsWith('/uploads') &&
    !fs.existsSync(path.join(__dirname, 'web/dist', req.path))
  ) {
    res.sendFile(path.join(__dirname, 'web/dist', 'index.html'));
  } else {
    next();
  }
});

app.use('/api/menus', menuRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/favicon', faviconRoutes);
app.use('/api', authRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/users', userRoutes);

const db = require('./db');
if (require.main === module) {
  db.ready.then(() => {
    app.listen(PORT, () => console.log(`server is running at http://localhost:${PORT}`));
  }).catch(error => {
    console.error('数据库初始化失败:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
