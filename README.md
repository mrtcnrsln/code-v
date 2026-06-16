# ⬡ CodeV v2 — Collaborative Code Editor

Gerçek zamanlı, tarayıcı tabanlı ekip kod editörü.  
P2P host modu veya Enterprise server olarak çalışır.

---

## 🚀 Hızlı Başlangıç

### Linux / macOS
```bash
chmod +x install.sh
./install.sh /path/to/your/project
```

### Windows
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

### Windows — Node bulunamazsa
```powershell
powershell -ExecutionPolicy Bypass -File fix-path.ps1
```

Tarayıcı otomatik açılır. Ekibinle **Network URL'ini** paylaş.

---

## ⚙️ Çalıştırma Modları

```bash
# P2P Host (varsayılan) — kendi makinende çalışır, ekip URL ile bağlanır
node server/index.js --mode client

# Enterprise Server — Docker/VPS'e kurulur, merkezi auth, admin panel
node server/index.js --mode server
```

### Ortam değişkenleri
```bash
PORT=3030              # Dinleme portu
WORKSPACE=/path        # Varsayılan çalışma dizini
MODE=server            # server | client
AUTH_ENABLED=true      # Kullanıcı girişi zorunlu mu
ROOM_PASSWORD=secret   # Oturuma katılmak için şifre
JWT_SECRET=random64    # JWT imzalama anahtarı (üretimde değiştir)
SERVER_NAME=CodeV      # Arayüzde görünen sunucu adı
```

---

## 🏢 Enterprise / Docker

```bash
# 1. Konfigürasyon
cp .env.example .env
# .env içini düzenle

# 2. Docker ile başlat
docker-compose up -d

# 3. Admin paneli
http://localhost:3030/admin
# İlk kayıt olan kullanıcı otomatik admin olur
```

### HTTPS (production)
```bash
# SSL sertifikalarını ssl/ klasörüne koy
# docker-compose.yml içinde nginx profilini aktif et
docker-compose --profile production up -d
```

---

## ⚡ Electron Desktop App

```bash
npm install
npm install electron electron-builder   # geliştirme bağımlılıkları

# Çalıştır
npm run electron

# Native paket üret (.exe / .dmg / .AppImage)
npm run electron:build
```

Çıktılar `dist/` klasörüne gelir.

---

## 🔐 Kimlik Doğrulama

### Lokal Kullanıcılar
- İlk kayıt olan kullanıcı **admin** olur
- Admin panel → Kullanıcılar → Ekle / Sil / Rol değiştir
- Şifre sıfırlama admin panelden yapılır

### LDAP / Active Directory
```
Admin Panel → LDAP / AD sekmesi
```

| Sistem | User Filter |
|--------|-------------|
| Active Directory | `(sAMAccountName={{username}})` |
| OpenLDAP | `(uid={{username}})` |
| FreeIPA | `(uid={{username}})` |
| Samba 4 | `(sAMAccountName={{username}})` |

Hazır preset butonları mevcuttur. Bağlantı testi ve login testi admin panelden yapılabilir.  
LDAP başarısız olursa lokal kimlik doğrulamaya düşer.

### Oda Şifresi
Admin Panel → Security → Room Password  
veya `.env` → `ROOM_PASSWORD=sifre`

---

## ✨ Editör Özellikleri

| Özellik | Detay |
|---------|-------|
| Monaco Editor | VS Code motoru, 50+ dil |
| 7 Tema | Dark, Light, Monokai, Dracula, Solarized, GitHub, Nord |
| Split Editor | `Ctrl+\` veya sağ tık → Open in Split |
| Çoklu sekme | Bağımsız tab yönetimi |
| Snippet sistemi | 30+ hazır + `.codevrc.json` ile özel |
| Emmet | HTML/CSS kısayolları aktif |
| Prettier | Format on save, `Shift+Alt+F` |
| LSP/Diagnostics | JS, TS, JSON, CSS hata işaretleme |
| Minimap | Toggle edilebilir |
| Sticky scroll | Fonksiyon başlığı sabit |
| Multi-cursor | `Alt+Click` |
| Kod katlama | Fonksiyon/blok fold/unfold |

---

## 👥 İşbirliği Özellikleri

| Özellik | Detay |
|---------|-------|
| Anlık senkronizasyon | Yazarken iletilir, cursor sıfırlanmaz |
| Uzak imleç | Her kullanıcı farklı renk |
| Seçim görselleştirme | Anlık |
| Diff işaretleri | Eklemeler yeşil, silmeler kırmızı |
| Follow mode | Avatar'a tıkla, birini takip et |
| Host yönetimi | Host ayrılınca sıradaki otomatik terfi eder |
| Per-client workspace | Her kullanıcı kendi dizinini açar |
| Satır yorumları | `Ctrl+G`, sidebar Notes sekmesi |
| Anlık chat | Sidebar sağ panel |

---

## 🔀 Git Entegrasyonu

Sidebar → Git sekmesi

- Commits / Branches / Tags / Authors istatistikleri
- Branch seçici (dropdown ile checkout)
- Stage / Unstage / Discard (dosya bazında)
- Commit + Push tek buton
- Stash / Stash Pop
- Pull / Push / Fetch
- Commit log arama
- Commit diff görünümü
- File diff (değişen dosyada `±` butonu)
- Clone (GitHub, GitLab, Gitea, özel)

> Git kurulu değilse panel kurulum linki gösterir.

---

## 📜 Versiyon Geçmişi

Her `Ctrl+S` otomatik snapshot alır.  
Sidebar → Hist sekmesi

- Preview: Eski versiyon vs mevcut — yan yana diff
- Restore: Tek tıkla geri dön
- Son 50 versiyon saklanır

---

## 🔍 Arama & Değiştir

`Ctrl+Shift+F` veya header 🔍 butonu

- Proje geneli arama
- Regex / Case-sensitive / Whole word
- Include pattern (`**/*.js`)
- Replace All

---

## 🗂 Dosya Sistemi

- Open Folder: Yerel, NFS, SMB, Docker volume, SSH-FUSE
- Gitignore filtresi: `node_modules`, `.git`, `dist` otomatik gizlenir
- Image viewer: PNG, JPG, GIF, WEBP, SVG önizleme
- File watcher: Dışarıdan değiştirilen dosya otomatik yenilenir
- Windows drive listesi: C:, D: seçimi

---

## ▶️ Task Runner

Header → **Tasks** butonu

- `package.json` scripts otomatik listelenir
- `Makefile` targets otomatik listelenir
- `.codevrc.json` ile özel görevler

---

## 🖥 Terminal

Sağ panel → Terminal sekmesi

- Host makinesinde çalışır (güvenlik: misafirler çalıştıramaz)
- Streaming output — gerçek zamanlı
- Komut geçmişi: ↑↓
- `Ctrl+L` temizle
- Windows: `cmd /c` | Linux/macOS: `sh -c`

---

## 🏛 Admin Panel

`http://localhost:3030/admin` — sadece server modunda

| Sekme | İçerik |
|-------|--------|
| Overview | RAM, CPU, uptime, bağlı kullanıcı sayısı |
| Sessions | Aktif bağlantılar, kick butonu |
| Users | Kullanıcı listesi, rol atama, silme |
| Add User | Yeni kullanıcı oluştur |
| Settings | Sunucu adı, guest erişim, auth zorunluluğu |
| Security | Oda şifresi, şifre sıfırlama |
| LDAP / AD | LDAP yapılandırma, test, kullanıcı arama |

---

## ⌨️ Kısayollar

| Kısayol | Eylem |
|---------|-------|
| `Ctrl+S` | Kaydet + snapshot al |
| `Ctrl+W` | Sekmeyi kapat |
| `Ctrl+\` | Split editor aç/kapat |
| `Ctrl+Shift+F` | Proje geneli arama |
| `Shift+Alt+F` | Dosyayı formatla (Prettier) |
| `Ctrl+G` | Satıra yorum ekle |
| `Alt+Click` | Multi-cursor |
| `Ctrl+/` | Satır yorum toggle |
| `Ctrl+L` | Terminal temizle |
| `↑↓` (Terminal) | Komut geçmişi |
| `Esc` | Modal kapat |

---

## 🌍 İnternetten Erişim

```bash
# ngrok (en kolay)
ngrok http 3030

# Cloudflare Tunnel (ücretsiz)
cloudflared tunnel --url http://localhost:3030
```

---

## 🏗 Proje Yapısı

```
codev2/
├── server/
│   ├── index.js                 # Ana sunucu (mode: server|client)
│   ├── routes/
│   │   ├── auth.js              # JWT + bcrypt + LDAP fallback
│   │   ├── admin.js             # Admin API (metrics, users, sessions)
│   │   ├── ldap.js              # LDAP/AD entegrasyonu
│   │   ├── files.js             # Dosya sistemi API
│   │   ├── git.js               # Git API (simple-git)
│   │   ├── search.js            # Proje geneli arama
│   │   ├── formatter.js         # Prettier entegrasyonu
│   │   └── tasks.js             # Task runner
│   ├── ws/
│   │   └── collaboration.js     # WebSocket: OT, chat, cursor, versiyon
│   └── store/
│       ├── config.js            # Workspace config + snippets
│       └── watcher.js           # File system watcher
├── client/public/
│   ├── index.html               # Ana uygulama
│   ├── app.js                   # Client logic (1000+ satır)
│   ├── themes.css               # 7 tema
│   └── admin.html               # Admin paneli
├── electron/
│   ├── main.js                  # Electron ana süreç
│   └── preload.js               # Context bridge
├── Dockerfile                   # Production container
├── docker-compose.yml           # Tek komut deploy
├── nginx.conf                   # HTTPS reverse proxy
├── .env.example                 # Konfigürasyon şablonu
├── install.sh                   # Linux/macOS kurulum
├── install.ps1                  # Windows kurulum
└── fix-path.ps1                 # Windows Node PATH düzeltici
```

---

## 📦 Bağımlılıklar

| Paket | Versiyon | Amaç |
|-------|----------|------|
| express | ^4.18 | HTTP sunucusu |
| ws | ^8.16 | WebSocket |
| simple-git | ^3.22 | Git işlemleri |
| bcryptjs | ^2.4 | Şifre hash |
| jsonwebtoken | ^9.0 | JWT auth |
| prettier | ^3.2 | Kod formatlama |
| glob | ^10.3 | Dosya arama |
| chokidar | ^3.6 | Dosya izleme |
| mime-types | ^2.1 | MIME tipleri |
| ldapts | ^4.2 | LDAP (opsiyonel) |
| electron | ^29 | Desktop app (dev) |
| electron-builder | ^24 | Paketleme (dev) |
| Monaco Editor | 0.44 (CDN) | Kod editörü |
