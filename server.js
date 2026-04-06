const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const fs      = require('fs');

const app        = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fittrack-secret-change-in-production';
const SALT_ROUNDS = 10;
const DB_FILE    = path.join(__dirname, 'db.json');

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: [] }; }
}
function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}
if (!fs.existsSync(DB_FILE)) writeDB({ users: [] });

app.use(express.json({ limit: '2mb' }));

function authRequired(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Нет токена' });
  const token = header.split(' ')[1];
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Токен недействителен или истёк' }); }
}

// POST /api/register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  if (username.length < 3)    return res.status(400).json({ error: 'Логин минимум 3 символа' });
  if (password.length < 4)    return res.status(400).json({ error: 'Пароль минимум 4 символа' });
  const db = readDB();
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Такой логин уже занят' });
  const id   = Date.now();
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.users.push({ id, username, password: hash,
    data: { programs: [], schedule: [], theme: 'purple', profile: {}, history: [] } });
  writeDB(db);
  const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username });
});

// POST /api/login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const db   = readDB();
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

// GET /api/data
app.get('/api/data', authRequired, (req, res) => {
  const db   = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const d = user.data || {};
  res.json({
    programs: d.programs || [],
    schedule: d.schedule || [],
    theme:    d.theme    || 'purple',
    profile:  d.profile  || {},
    history:  d.history  || []
  });
});

// PUT /api/data
app.put('/api/data', authRequired, (req, res) => {
  const { programs, schedule, theme, profile, history } = req.body;
  const db   = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  user.data = {
    programs: programs ?? [],
    schedule: schedule ?? [],
    theme:    theme    ?? 'purple',
    profile:  profile  ?? {},
    history:  history  ?? []
  };
  writeDB(db);
  res.json({ ok: true });
});

// DELETE /api/account
app.delete('/api/account', authRequired, (req, res) => {
  const db = readDB();
  db.users = db.users.filter(u => u.id !== req.user.id);
  writeDB(db);
  res.json({ ok: true });
});

// GET /api/programs/export - Export user's programs as JSON
app.get('/api/programs/export', authRequired, (req, res) => {
  const db   = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  
  const programs = (user.data && user.data.programs) ? user.data.programs : [];
  
  // Create export object with metadata
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    username: user.username,
    programsCount: programs.length,
    programs: programs.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      exercises: p.exercises.map(ex => ({
        name: ex.name,
        type: ex.type || 'strength',
        sets: ex.sets
      }))
    }))
  };
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="fittrack_programs_${user.username}_${Date.now()}.json"`);
  res.json(exportData);
});

// POST /api/programs/import - Import programs from JSON
app.post('/api/programs/import', authRequired, (req, res) => {
  console.log('Import request received');
  console.log('Request body:', req.body);
  
  const { programs } = req.body;
  
  if (!programs || !Array.isArray(programs)) {
    console.error('Invalid format:', programs);
    return res.status(400).json({ error: 'Неверный формат данных' });
  }
  
  // Validate programs structure
  for (const prog of programs) {
    if (!prog.name || !prog.exercises || !Array.isArray(prog.exercises)) {
      console.error('Invalid program structure:', prog);
      return res.status(400).json({ error: 'Неверная структура программы: ' + (prog.name || 'без названия') });
    }
    for (const ex of prog.exercises) {
      if (!ex.name || !ex.sets || !Array.isArray(ex.sets)) {
        console.error('Invalid exercise structure in program:', prog.name, ex);
        return res.status(400).json({ error: 'Неверная структура упражнения в программе: ' + prog.name });
      }
    }
  }
  
  const db   = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) {
    console.error('User not found:', req.user.id);
    return res.status(404).json({ error: 'Пользователь не найден' });
  }
  
  console.log('User found:', user.username);
  console.log('Current programs count:', user.data?.programs?.length || 0);
  
  // Add new programs with fresh IDs to avoid conflicts
  const importedPrograms = programs.map(p => ({
    ...p,
    id: Date.now() + Math.floor(Math.random() * 100000)
  }));
  
  if (!user.data) user.data = {};
  if (!user.data.programs) user.data.programs = [];
  
  user.data.programs = [...user.data.programs, ...importedPrograms];
  writeDB(db);
  
  console.log('Imported', importedPrograms.length, 'programs');
  
  res.json({ 
    ok: true, 
    importedCount: importedPrograms.length,
    message: `Импортировано ${importedPrograms.length} программ`
  });
});

// Serve static files (must be after all API routes)
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`✅  FitTrack сервер запущен: http://localhost:${PORT}`);
});
