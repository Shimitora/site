const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { PORT, gmail } = require('./config');

const app = express();
app.set('trust proxy', true);

const USERS_FILE = path.join(__dirname, 'users.json');
let users = [];

if (fs.existsSync(USERS_FILE)) {
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch (e) { users = []; }
}

function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8'); }

function ensureUser(username, obj) {
  const i = users.findIndex(u => (u.username || '').toLowerCase() === username.toLowerCase());
  if (i === -1) users.push(obj);
  else users[i] = Object.assign({}, users[i], obj);
}
ensureUser('JASPERO', { username: 'JASPERO', password: '666', email: '', rank: 'Админ', confirmed: true });
ensureUser('FIRST',   { username: 'FIRST',   password: '111', email: '', rank: 'Пользователь', confirmed: true });

// simple in-memory storage for pending verifications: { username: { code, email, password, meta } }
const pending = {};

app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'supersecret', resave: false, saveUninitialized: true }));
app.use(express.static(path.join(__dirname, 'public')));

// mailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: gmail.user, pass: gmail.pass }
});

function sendVerificationEmail(to, code) {
  return transporter.sendMail({
    from: '"ESPADA Auth" <' + gmail.user + '>',
    to,
    subject: 'Подтверждение регистрации',
    text: 'Ваш код подтверждения: ' + code
  });
}

// -------- render helpers (ASCII only, no backticks) --------
function layoutPage(bodyHtml, extraStyle) {
  return [
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>ESPADA</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<style>',
    '*,*::before,*::after{box-sizing:border-box}',
    'html,body{height:100%}',
    'body{margin:0;background:#000;color:#fff;font-family:Arial,Helvetica,sans-serif}',
    '.page{position:relative;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden}',
    '.bg-video{position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;filter:brightness(.35) saturate(1.1)}',
    '.card{width:100%;max-width:420px;background:rgba(20,16,38,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
    '  border:1px solid #7c3aed;padding:24px;border-radius:14px;box-shadow:0 0 16px rgba(124,58,237,.45)}',
    '.row{display:flex;flex-direction:column;gap:10px}',
    'input,button,.btn{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #7c3aed;background:#0b0b12;color:#fff;font-size:16px}',
    'button,.btn{border:none;background:linear-gradient(45deg,#9b5cf7,#c084fc);font-weight:800;cursor:pointer;text-align:center;text-decoration:none;display:inline-block}',
    'button:hover,.btn:hover{filter:brightness(1.06)}',
    '.muted{opacity:.75;font-size:13px;text-align:center}',
    '.split{display:flex;gap:10px}',
    '.split .btn{flex:1}',
    (extraStyle || ''),
    '</style></head><body>',
    '<div class="page">',
    '<video class="bg-video" autoplay muted loop playsinline>',
    '<source src="/bg.mp4" type="video/mp4">',
    '</video>',
    bodyHtml,
    '</div>',
    '</body></html>'
  ].join('\n');
}

function renderLogin() {
  const inner = [
    '<form class="card" action="/login" method="POST">',
    '<div class="row">',
    '<input name="username" placeholder="Логин" required>',
    '<input name="password" type="password" placeholder="Пароль" required>',
    '<div class="split">',
    '<button type="submit">Войти</button>',
    '<a class="btn" href="/register">Регистрация</a>',
    '</div>',
    '</div>',
    '</form>'
  ].join('\n');
  return layoutPage(inner);
}

function renderRegister() {
  const inner = [
    '<form class="card" action="/register" method="POST">',
    '<div class="row">',
    '<input name="username" placeholder="Придумайте логин" required>',
    '<input name="password" type="password" placeholder="Придумайте пароль" required>',
    '<input name="email" type="email" placeholder="Ваша почта (Gmail желательно)" required>',
    '<div class="split">',
    '<a class="btn" href="/">Назад</a>',
    '<button type="submit">Зарегистрироваться</button>',
    '</div>',
    '<div class="muted">Мы отправим код подтверждения на вашу почту</div>',
    '</div>',
    '</form>'
  ].join('\n');
  return layoutPage(inner);
}

function renderVerify(email) {
  const inner = [
    '<form class="card" action="/verify" method="POST">',
    '<div class="row">',
    '<input name="email" type="email" value="' + (email || '') + '" placeholder="Ваша почта" required>',
    '<input name="code" placeholder="Код подтверждения" required>',
    '<div class="split">',
    '<a class="btn" href="/">Войти</a>',
    '<button type="submit">Подтвердить</button>',
    '</div>',
    '<div class="muted">Если письма нет, проверьте Спам. Код действителен 10 минут.</div>',
    '</div>',
    '</form>'
  ].join('\n');
  return layoutPage(inner);
}

function renderAdmin(username) {
  const head = [
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Admin</title>',
    '<style>',
    'html,body{margin:0;height:100%;background:#08060E;color:#fff;font-family:Arial}',
    '.wrap{min-height:100%;display:flex;flex-direction:column;align-items:center;gap:22px;padding:40px 20px 80px}',
    '.admin-welcome{font-size:clamp(28px,4vw,54px);color:#ff3b3b;text-shadow:0 0 16px #9a0000,0 0 32px #ff3b3b;animation:glow 1.2s ease-in-out infinite alternate}',
    '@keyframes glow{from{text-shadow:0 0 12px #9a0000,0 0 24px #ff3b3b}to{text-shadow:0 0 24px #ff3b3b,0 0 48px #ff5c5c}}',
    '.card{width:min(1100px,96vw);background:rgba(12,10,20,.96);border-radius:18px;padding:16px 18px;border:1px solid rgba(160,100,255,.5);',
    '  box-shadow:0 0 8px rgba(160,100,255,.35),0 0 22px rgba(124,58,237,.35),inset 0 0 12px rgba(124,58,237,.22)}',
    'table{width:100%;border-collapse:collapse}',
    'th,td{padding:10px;border-bottom:1px solid rgba(160,100,255,.35);text-align:left;vertical-align:top}',
    'thead th{position:sticky;top:0;background:#120c1f}',
    'th{color:#d6b4fe}',
    'tr:hover{background:rgba(30,20,50,.35)}',
    'td.device{max-width:380px;word-break:break-word}',
    'a.btn{margin-top:10px;display:inline-block;padding:10px 16px;border-radius:12px;color:#e6d6ff;text-decoration:none;',
    '  border:1px solid rgba(160,100,255,.5);background:rgba(20,16,36,.85);box-shadow:0 0 10px rgba(160,100,255,.35)}',
    'a.btn:hover{filter:brightness(1.12)}',
    '</style></head><body>',
    '<div class="wrap">',
    '<div class="admin-welcome">ДОБРО ПОЖАЛОВАТЬ, ' + (username || 'ADMIN') + '</div>',
    '<div class="card">',
    '<table>',
    '<thead><tr><th>Ник</th><th>Email</th><th>Пароль</th><th>Ранг</th><th>IP</th><th>Устройство</th><th>Время регистрации</th></tr></thead>',
    '<tbody>'
  ].join('\n');

  const rows = users.map(u => {
    const dev = (u.device || '').toString().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return [
      '<tr>',
      '<td>' + (u.username || '') + '</td>',
      '<td>' + (u.email || '') + '</td>',
      '<td>' + (u.password || '') + '</td>',
      '<td>' + (u.rank || '') + '</td>',
      '<td>' + (u.ip || '') + '</td>',
      '<td class="device">' + dev + '</td>',
      '<td>' + (u.registeredAt || '') + '</td>',
      '</tr>'
    ].join('');
  }).join('');

  const tail = [
    '</tbody></table>',
    '</div>',
    '<div>',
    '<a class="btn" href="/logout">Выйти</a>',
    '</div>',
    '</div>',
    '</body></html>'
  ].join('\n');

  return head + rows + tail;
}

// routes
app.get('/', (req, res) => res.send(renderLogin()));
app.get('/register', (req, res) => res.send(renderRegister()));
app.get('/verify', (req, res) => res.send(renderVerify('')));

app.post('/register', async (req, res) => {
  try {
    const username = (req.body && req.body.username || '').trim();
    const password = (req.body && req.body.password || '').trim();
    const email = (req.body && req.body.email || '').trim();
    if (!username || !password || !email) return res.send('Заполните все поля');

    // deny duplicate username
    const exists = users.find(u => (u.username || '').toLowerCase() === username.toLowerCase());
    if (exists) return res.send('Такой логин уже занят');

    // generate and store pending
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const meta = {
      ip: (req.headers['x-forwarded-for'] || req.ip || '').toString(),
      device: (req.headers['user-agent'] || 'Unknown').toString(),
      time: new Date().toISOString()
    };
    pending[email] = { username, password, email, code, meta, createdAt: Date.now() };

    await sendVerificationEmail(email, code);

    return res.redirect('/verify?email=' + encodeURIComponent(email));
  } catch (e) {
    console.error('register error', e);
    return res.send('Ошибка при регистрации');
  }
});

app.post('/verify', (req, res) => {
  const email = (req.body && req.body.email || '').trim();
  const code = (req.body && req.body.code || '').trim();
  const p = pending[email];
  if (!p) return res.send('Неверная почта или код уже использован');
  if (Date.now() - (p.createdAt || 0) > 10 * 60 * 1000) { delete pending[email]; return res.send('Срок кода истёк'); }
  if (p.code !== code) return res.send('Неверный код');

  // finalize user
  const { username, password } = p;
  users.push({
    username, password, email,
    rank: 'Пользователь',
    confirmed: true,
    ip: p.meta.ip,
    device: p.meta.device,
    registeredAt: p.meta.time
  });
  saveUsers();
  delete pending[email];

  res.send([
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>Успех</title>',
    '<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#000;color:#9b5cf7;font-family:Arial}</style>',
    '</head><body>',
    '<div>Регистрация подтверждена. <a href="/" style="color:#c084fc">Войти</a></div>',
    '</body></html>'
  ].join('\n'));
});

app.post('/login', (req, res) => {
  const username = (req.body && req.body.username) || '';
  const password = (req.body && req.body.password) || '';
  const user = users.find(u => (u.username || '').toLowerCase() === username.toLowerCase());
  if (!user || user.password !== password) return res.redirect('/error');
  if (!user.confirmed) return res.send('Аккаунт не подтверждён');

  user.ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();
  user.device = (req.headers['user-agent'] || 'Unknown').toString();
  if (!user.registeredAt) o = new Date().toISOString();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');

  req.session.user = { username: user.username, rank: user.rank };
  return (user.rank === 'Админ') ? res.redirect('/admin') : res.redirect('/dashboard');
});

app.get('/error', (req, res) => {
  const html = [
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Access Denied</title>',
    '<style>',
    'html,body{margin:0;height:100%;background:#000;overflow:hidden}',
    '.smoke{position:absolute;width:200%;height:200%;background:repeating-linear-gradient(-45deg,rgba(255,0,0,0.2) 0,rgba(255,0,0,0.2) 20px,transparent 20px,transparent 40px);animation:move 6s linear infinite;filter:blur(20px)}',
    '@keyframes move{from{transform:translate(0,0)}to{transform:translate(-200px,-200px)}}',
    'h1{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font:700 80px Arial;color:red;text-shadow:0 0 20px darkred,0 0 40px red;animation:flash 1s infinite alternate}',
    '@keyframes flash{from{opacity:1}to{opacity:.4}}',
    '</style></head><body><div class="smoke"></div><h1>ACCESS DENIED</h1></body></html>'
  ].join('\n');
  res.send(html);
});

// simple user dashboard with ESPADA + file link
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  const html = [
    '<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><title>ESPADA</title>',
    '<style>',
    'html,body{margin:0;height:100%;background:#000;display:grid;place-items:center}',
    '.wrap{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:24px}',
    '.espada{font-family:Arial,Helvetica,sans-serif;font-weight:900;letter-spacing:.12em;text-transform:uppercase;font-size:clamp(48px,14vw,200px);line-height:1;background:linear-gradient(90deg,#d6b4fe,#9b5cf7,#c084fc,#7c3aed,#d6b4fe);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shift 5s linear infinite, glowPulse 4s ease-in-out infinite;text-shadow:0 0 10px rgba(155,92,247,.35),0 0 20px rgba(155,92,247,.25);text-align:center}',
    '@keyframes shift{0%{background-position:0% 50%}100%{background-position:250% 50%}}',
    '@keyframes glowPulse{0%,100%{text-shadow:0 0 10px rgba(155,92,247,.35),0 0 20px rgba(155,92,247,.25)}50%{text-shadow:0 0 16px rgba(155,92,247,.6),0 0 32px rgba(155,92,247,.45)}}',
    'a.file-link{font:600 clamp(16px,3vw,28px)/1.2 Arial,sans-serif;color:#9b5cf7;text-decoration:none;padding:12px 24px;border:2px solid #9b5cf7;border-radius:10px;transition:.3s;text-shadow:0 0 6px rgba(155,92,247,0.7)}',
    'a.file-link:hover{background:#9b5cf7;color:#000;text-shadow:none}',
    '</style></head><body>',
    '<div class="wrap">',
    '<div class="espada">ESPADA</div>',
    '<a class="file-link" href="https://example.com" target="_blank" rel="noopener">Ваш файл готов</a>',
    '</div>',
    '</body></html>'
  ].join('\n');
  res.send(html);
});

app.get('/admin', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  if (req.session.user.rank !== 'Админ') return res.redirect('/dashboard');
  res.send(renderAdmin(req.session.user.username));
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

app.listen(PORT, () => console.log('Server running at http://localhost:' + PORT));
