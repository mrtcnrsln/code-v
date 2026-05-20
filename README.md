# ⬡ CodeV — Collaborative Code Editor

Gerçek zamanlı, tarayıcı tabanlı, ekip kod editörü.  
Merkezi sunucu gerektirmez — biri host olur, diğerleri bağlanır.

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
- **Node.js** 16 veya üzeri → [nodejs.org](https://nodejs.org)
- Modern bir tarayıcı (Chrome, Firefox, Edge, Safari)

### Kurulum

```bash
# 1. Bağımlılıkları yükle
npm install

# 2. Editörü başlat (çalışma klasörüyle)
./start.sh /path/to/your/project        # Linux / macOS
start.bat C:\path\to\your\project       # Windows

# Varsayılan port: 3030
# Farklı port için:
./start.sh /path/to/project 8080
```

### Ekibinizle Paylaş

Sunucu başladığında terminalde şunu görürsünüz:

```
╔════════════════════════════════════════╗
║         CodeV - Collaborative IDE      ║
╠════════════════════════════════════════╣
║  Local:   http://localhost:3030        ║
║  Network: http://192.168.1.42:3030     ║  ← Bu URL'i paylaş
╚════════════════════════════════════════╝
```

**Aynı ağdaki** ekip üyeleri `http://192.168.1.42:3030` adresine tarayıcıdan girerek katılabilir.

> **İnternet üzerinden erişim** için `ngrok`, `cloudflare tunnel` veya router port-forward kullanın.

---

## ✨ Özellikler

### Editör
- 🎨 **Monaco Editor** — VS Code'un motoru, tam syntax highlighting
- 📁 Dosya gezgini (tıkla aç, sağ tık menüsü)
- 🗂 Çoklu sekme desteği
- 💾 `Ctrl+S` ile kayıt
- 🔍 Otomatik dil algılama (50+ dil)
- 🎯 Bracket matching, auto-indent, kod tamamlama

### Gerçek Zamanlı İşbirliği
- ⚡ **Anlık senkronizasyon** — yazarken iletilir
- 🎯 **Uzak imleç takibi** — her kullanıcının farklı rengi
- 🖌 **Seçim görselleştirme** — kim neyi seçiyor
- 🟢 **Diff işaretleri** — eklemeler yeşil, silmeler kırmızı
- 📋 Kimin hangi dosyada çalıştığını gösterme

### İletişim
- 💬 **Anlık sohbet** — ekip mesajlaşması
- 👥 Bağlı kullanıcı listesi (renk coded)
- 🔔 Katılma/ayrılma bildirimleri

### Teknik Altyapı
- 🌐 **Tarayıcı tabanlı** — uygulama kurulumu yok
- 🖥 **Cross-platform** — Linux, Windows, macOS
- 🔌 WebSocket üzerinden gerçek zamanlı iletişim
- 📡 Host kişinin makinesinde çalışır, merkezi sunucu masrafı yok
- 🔄 OT (Operational Transform) tabanlı çakışma çözümü

---

## ⌨️ Kısayollar

| Kısayol | Eylem |
|---------|-------|
| `Ctrl+S` | Dosyayı kaydet |
| `Ctrl+W` | Sekmeyi kapat |
| `Ctrl+P` | (Monaco) Dosya ara |
| `Ctrl+Shift+P` | (Monaco) Komut paleti |
| `Alt+Z` | Satır kaydırma |
| `Ctrl+/` | Yorum satırı |

---

## 🔧 Yapılandırma

```bash
# Farklı çalışma klasörü
WORKSPACE=/home/user/myproject node server/index.js

# Farklı port
PORT=8080 node server/index.js

# Her ikisi
WORKSPACE=/projects PORT=8080 node server/index.js
```

---

## 🌍 İnternet Üzerinden Erişim

### ngrok (Önerilen)
```bash
# 1. ngrok kur: https://ngrok.com
ngrok http 3030
# Verilen URL'i paylaş: https://abc123.ngrok.io
```

### Cloudflare Tunnel (Ücretsiz)
```bash
cloudflared tunnel --url http://localhost:3030
```

### Router Port Forwarding
Router ayarlarından 3030 portunu host makineye yönlendir, public IP'yi paylaş.

---

## 🏗 Mimari

```
Host Makinesi
├── server/index.js     — Express + WebSocket sunucusu
│   ├── Dosya sistemi yönetimi
│   ├── Operational Transform engine
│   ├── Kullanıcı session yönetimi
│   └── Chat sistemi
└── client/public/
    ├── index.html      — Ana UI
    └── app.js          — Monaco entegrasyonu + WS client
```

**Veri akışı:**
```
Kullanıcı A yazar → WebSocket → Sunucu (OT) → Tüm bağlı kullanıcılara ilet
```

---

## 📦 Bağımlılıklar

| Paket | Amaç |
|-------|-------|
| `express` | HTTP sunucusu |
| `ws` | WebSocket |
| `uuid` | Benzersiz ID üretimi |
| `chokidar` | Dosya değişiklik izleme |
| Monaco Editor (CDN) | Kod editörü motoru |

---

Herhangi bir sorun için GitHub Issues açabilirsiniz.
