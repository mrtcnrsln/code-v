#!/bin/sh
# CodeV v2 - Universal Installer
# sh (POSIX) ile yazildi - bash/zsh/ash/dash hepsinde calisir
# Linux (Ubuntu/Debian/Fedora/Arch/Alpine) + macOS (Intel/ARM)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${1:-$SCRIPT_DIR}"
PORT="${2:-3030}"
LOG="$SCRIPT_DIR/codev-install.log"
MIN_NODE=18

# --- Renkler (POSIX uyumlu) ---
if [ -t 1 ]; then
  G='\033[0;32m' R='\033[0;31m' Y='\033[1;33m'
  C='\033[0;36m' W='\033[1;37m' N='\033[0m'
else
  G='' R='' Y='' C='' W='' N=''
fi

ok()   { printf "  ${G}v${N}  %s\n" "$*"; }
err()  { printf "  ${R}x${N}  %s\n" "$*"; }
info() { printf "  ${C}>  ${N}%s\n" "$*"; }
warn() { printf "  ${Y}!  ${N}%s\n" "$*"; }
step() { printf "\n${W}  -- %s --${N}\n" "$*"; }
log()  { printf "[%s] %s\n" "$(date '+%H:%M:%S')" "$*" >> "$LOG"; }

header() {
  printf "\n"
  printf "  +----------------------------------------------+\n"
  printf "  |   CodeV v2 -- Collaborative Editor          |\n"
  printf "  |   Universal Installer (Linux + macOS)       |\n"
  printf "  +----------------------------------------------+\n"
  printf "\n"
  printf "  Log: %s\n" "$LOG"
  printf "  OS : %s %s\n" "$(uname -s)" "$(uname -m)"
  printf "\n"
}

# --- OS tespiti ---
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)
      if   [ -f /etc/debian_version ]; then echo "debian"
      elif [ -f /etc/fedora-release  ]; then echo "fedora"
      elif [ -f /etc/arch-release    ]; then echo "arch"
      elif [ -f /etc/alpine-release  ]; then echo "alpine"
      elif [ -f /etc/os-release ]; then
        ID=$(grep '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
        ID_LIKE=$(grep '^ID_LIKE=' /etc/os-release | cut -d= -f2 | tr -d '"')
        case "$ID_LIKE $ID" in
          *debian*|*ubuntu*) echo "debian" ;;
          *fedora*|*rhel*|*centos*) echo "fedora" ;;
          *arch*) echo "arch" ;;
          *) echo "linux" ;;
        esac
      else echo "linux"
      fi ;;
    *) echo "unknown" ;;
  esac
}

# --- Node.js major versiyonu ---
node_major() {
  command -v node >/dev/null 2>&1 || { echo "0"; return; }
  node -e "process.stdout.write(String(process.versions.node.split('.')[0]))" 2>/dev/null || echo "0"
}

# --- NVM kurulum ---
install_via_nvm() {
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  export NVM_DIR
  if [ ! -d "$NVM_DIR" ]; then
    info "nvm indiriliyor..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh 2>/dev/null | sh >> "$LOG" 2>&1 || {
      err "nvm indirilemedi. curl/internet kontrol edin."
      return 1
    }
  fi
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  info "Node.js $MIN_NODE kuruluyor (nvm)..."
  nvm install "$MIN_NODE" >> "$LOG" 2>&1
  nvm use "$MIN_NODE" >> "$LOG" 2>&1
  nvm alias default "$MIN_NODE" >> "$LOG" 2>&1
  ok "nvm ile Node.js kuruldu"
}

# --- Platform kurulum fonksiyonlari ---
install_node_macos() {
  # 1) Homebrew
  if command -v brew >/dev/null 2>&1; then
    info "Homebrew ile Node.js kuruluyor..."
    brew install node >> "$LOG" 2>&1 || brew upgrade node >> "$LOG" 2>&1 || true
    BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
    export PATH="$BREW_PREFIX/bin:$PATH"
    ok "Homebrew ile Node.js kuruldu"
    return 0
  fi
  # 2) nvm
  install_via_nvm
}

install_node_debian() {
  if ! command -v sudo >/dev/null 2>&1; then
    warn "sudo bulunamadi, nvm kullaniliyor..."
    install_via_nvm; return
  fi
  if ! command -v curl >/dev/null 2>&1; then
    sudo apt-get install -y curl >> "$LOG" 2>&1
  fi
  info "NodeSource repo ekleniyor..."
  curl -fsSL "https://deb.nodesource.com/setup_${MIN_NODE}.x" 2>/dev/null | sudo -E bash - >> "$LOG" 2>&1 || {
    warn "NodeSource basarisiz, nvm fallback..."
    install_via_nvm; return
  }
  sudo apt-get install -y nodejs >> "$LOG" 2>&1
  ok "apt ile Node.js kuruldu"
}

install_node_fedora() {
  if ! command -v sudo >/dev/null 2>&1; then
    install_via_nvm; return
  fi
  curl -fsSL "https://rpm.nodesource.com/setup_${MIN_NODE}.x" 2>/dev/null | sudo bash - >> "$LOG" 2>&1 || {
    install_via_nvm; return
  }
  sudo dnf install -y nodejs >> "$LOG" 2>&1 || sudo yum install -y nodejs >> "$LOG" 2>&1
  ok "dnf ile Node.js kuruldu"
}

install_node_arch() {
  command -v sudo >/dev/null 2>&1 || { install_via_nvm; return; }
  sudo pacman -Sy --noconfirm nodejs npm >> "$LOG" 2>&1
  ok "pacman ile Node.js kuruldu"
}

install_node_alpine() {
  command -v sudo >/dev/null 2>&1 && SUDO=sudo || SUDO=""
  $SUDO apk add --no-cache nodejs npm >> "$LOG" 2>&1
  ok "apk ile Node.js kuruldu"
}

# --- Adim 1: Node.js ---
step_node() {
  step "1/3  Node.js"

  # nvm varsa yukle
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true

  ver=$(node_major)
  if [ "$ver" -ge "$MIN_NODE" ] 2>/dev/null; then
    ok "Node.js $(node -v) hazir"
    return 0
  fi

  OS=$(detect_os)
  log "Node.js kuruluyor, OS=$OS, mevcut_ver=$ver"

  if [ "$ver" -gt 0 ] 2>/dev/null; then
    warn "Node.js v$ver eski — v${MIN_NODE}+ gerekli"
  else
    info "Node.js bulunamadi"
  fi

  case "$OS" in
    macos)   install_node_macos   ;;
    debian)  install_node_debian  ;;
    fedora)  install_node_fedora  ;;
    arch)    install_node_arch    ;;
    alpine)  install_node_alpine  ;;
    *)       install_via_nvm      ;;
  esac

  # PATH yenile
  export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/v${MIN_NODE}*/bin:$PATH"
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" 2>/dev/null || true

  ver=$(node_major)
  if [ "$ver" -ge "$MIN_NODE" ] 2>/dev/null; then
    ok "Node.js $(node -v) hazir"
  else
    err "Node.js kurulamadi."
    printf "\n  Manuel kurulum: https://nodejs.org\n"
    printf "  Sonra: WORKSPACE=\"%s\" PORT=%s node server/index.js\n\n" "$WORKSPACE" "$PORT"
    exit 1
  fi
}

# --- Adim 2: Bagimliliklar ---
step_deps() {
  step "2/3  Bagimliliklar"
  cd "$SCRIPT_DIR"

  CHECK="node_modules/.install-ok"
  if [ -f "$CHECK" ] && [ "package.json" -ot "$CHECK" ]; then
    ok "Bagimliliklar zaten yuklu"
    return 0
  fi

  info "npm install calistiriliyor..."
  npm install --silent >> "$LOG" 2>&1 || {
    err "npm install basarisiz. Detay: $LOG"
    exit 1
  }
  touch "$CHECK"
  ok "Bagimliliklar hazir"
}

# --- Adim 3: Baslatma ---
step_launch() {
  step "3/3  Baslatiliyor"
  cd "$SCRIPT_DIR"

  info "Workspace : $WORKSPACE"
  info "Port      : $PORT"

  # Port kontrolu
  if command -v lsof >/dev/null 2>&1; then
    if lsof -i ":$PORT" >/dev/null 2>&1; then
      PORT=$((PORT + 1))
      warn "Port mesgul, $PORT kullaniliyor"
    fi
  fi

  # IP listesi - POSIX uyumlu (grep -P yok, mapfile yok)
  IPS=""
  if command -v ifconfig >/dev/null 2>&1; then
    IPS=$(ifconfig 2>/dev/null | awk '/inet / {ip=$2; gsub("addr:","",ip)} ip!="" && ip!="127.0.0.1" && ip~/^[0-9]/{print ip; ip=""}')
  elif command -v ip >/dev/null 2>&1; then
    IPS=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {split($2,a,"/"); print a[1]}')
  fi

  printf "\n"
  printf "  +----------------------------------------------+\n"
  printf "  |  CodeV v2 basladi!                          |\n"
  printf "  +----------------------------------------------+\n"
  printf "  |  Yerel  : http://localhost:%s\n" "$PORT"
  for ip in $IPS; do
    printf "  |  Ekip   : http://%s:%s\n" "$ip" "$PORT"
  done
  printf "  |  Ctrl+C ile durdur\n"
  printf "  +----------------------------------------------+\n\n"

  # Tarayici ac
  sleep 1
  URL="http://localhost:$PORT"
  if command -v open >/dev/null 2>&1; then
    open "$URL" 2>/dev/null &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >> "$LOG" 2>&1 &
  fi

  # Sunucu
  WORKSPACE="$WORKSPACE" PORT="$PORT" exec node server/index.js
}

# --- Main ---
> "$LOG"
log "CodeV v2 started - OS=$(uname -s) ARCH=$(uname -m)"

header
step_node
step_deps
step_launch
