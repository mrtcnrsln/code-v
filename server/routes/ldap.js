/**
 * CodeV — LDAP / Active Directory Integration
 * 
 * Desteklenen:
 *  - OpenLDAP
 *  - Microsoft Active Directory
 *  - FreeIPA
 *  - Samba 4 AD DC
 *  - Azure AD (LDAP proxy ile)
 * 
 * Kurulum: npm install ldapts
 */

const express = require('express');

// LDAP config şablonu
const DEFAULT_CONFIG = {
  enabled:       false,
  url:           'ldap://localhost:389',    // ldaps:// for SSL
  baseDN:        'dc=company,dc=com',
  bindDN:        'cn=service,dc=company,dc=com',
  bindPassword:  '',
  userFilter:    '(sAMAccountName={{username}})',  // AD: sAMAccountName, OpenLDAP: uid
  groupFilter:   '(memberOf=cn=codev-users,ou=groups,dc=company,dc=com)',
  adminGroup:    'cn=codev-admins,ou=groups,dc=company,dc=com',
  displayNameAttr: 'displayName',   // veya 'cn'
  emailAttr:       'mail',
  tlsVerify:     true,
  timeout:       5000,
};

class LDAPProvider {
  constructor(config) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this._client = null;
  }

  async getClient() {
    let LdapClient;
    try {
      const { Client } = require('ldapts');
      LdapClient = Client;
    } catch {
      throw new Error('ldapts paketi kurulu değil. "npm install ldapts" çalıştırın.');
    }

    const client = new LdapClient({
      url:                this.config.url,
      timeout:            this.config.timeout,
      connectTimeout:     this.config.timeout,
      strictDN:           false,
      tlsOptions: this.config.url.startsWith('ldaps') ? {
        rejectUnauthorized: this.config.tlsVerify
      } : undefined,
    });

    await client.bind(this.config.bindDN, this.config.bindPassword);
    return client;
  }

  /**
   * Kullanıcı adı + şifre ile LDAP auth
   * Başarılı → { username, displayName, email, groups, isAdmin }
   * Başarısız → null
   */
  async authenticate(username, password) {
    if (!this.config.enabled) return null;

    let client;
    try {
      client = await this.getClient();

      // 1. Kullanıcıyı bul
      const filter = this.config.userFilter.replace('{{username}}', escapeLDAP(username));
      const { searchEntries } = await client.search(this.config.baseDN, {
        scope:  'sub',
        filter,
        attributes: [
          'dn',
          this.config.displayNameAttr,
          this.config.emailAttr,
          'memberOf',
          'sAMAccountName',
          'uid',
          'cn',
        ],
      });

      if (!searchEntries.length) {
        return null; // Kullanıcı bulunamadı
      }

      const entry = searchEntries[0];
      const userDN = entry.dn;

      // 2. Kullanıcı şifresiyle bind (doğrulama)
      let userClient;
      try {
        const { Client } = require('ldapts');
        userClient = new Client({ url: this.config.url, timeout: this.config.timeout });
        await userClient.bind(userDN, password);
      } catch (bindErr) {
        return null; // Yanlış şifre
      } finally {
        await userClient?.unbind().catch(() => {});
      }

      // 3. Grup üyeliklerini al
      const memberOf = entry.memberOf
        ? (Array.isArray(entry.memberOf) ? entry.memberOf : [entry.memberOf])
        : [];

      // 4. Group filter varsa kontrol et
      if (this.config.groupFilter) {
        const gFilter = this.config.groupFilter
          .replace('{{username}}', escapeLDAP(username))
          .replace('{{dn}}', escapeLDAP(userDN));

        // memberOf kontrolü — basit string match
        const requiredGroup = this.config.groupFilter.match(/cn=([^,]+)/i)?.[1];
        if (requiredGroup) {
          const inGroup = memberOf.some(g => g.toLowerCase().includes(requiredGroup.toLowerCase()));
          if (!inGroup) {
            return null; // Grup üyesi değil
          }
        }
      }

      // 5. Admin mi?
      const isAdmin = this.config.adminGroup
        ? memberOf.some(g => g.toLowerCase() === this.config.adminGroup.toLowerCase())
        : false;

      const displayName = entry[this.config.displayNameAttr] || entry.cn || username;
      const email = entry[this.config.emailAttr] || '';

      return {
        username,
        displayName: Array.isArray(displayName) ? displayName[0] : displayName,
        email:       Array.isArray(email) ? email[0] : email,
        groups:      memberOf,
        isAdmin,
        source:      'ldap',
      };

    } catch (e) {
      console.error('[LDAP] Auth error:', e.message);
      return null;
    } finally {
      await client?.unbind().catch(() => {});
    }
  }

  /**
   * Bağlantı testi
   */
  async testConnection() {
    let client;
    try {
      client = await this.getClient();
      const { searchEntries } = await client.search(this.config.baseDN, {
        scope: 'base', filter: '(objectClass=*)', attributes: ['dn'], sizeLimit: 1
      });
      return { ok: true, message: 'Connection successful', entriesFound: searchEntries.length };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      await client?.unbind().catch(() => {});
    }
  }

  /**
   * Kullanıcı arama (admin paneli için)
   */
  async searchUsers(query, limit = 20) {
    let client;
    try {
      client = await this.getClient();
      const filter = `(|(cn=*${escapeLDAP(query)}*)(sAMAccountName=*${escapeLDAP(query)}*)(mail=*${escapeLDAP(query)}*))`;
      const { searchEntries } = await client.search(this.config.baseDN, {
        scope: 'sub', filter, sizeLimit: limit,
        attributes: ['cn', 'sAMAccountName', 'uid', 'mail', 'displayName', 'memberOf'],
      });
      return { ok: true, users: searchEntries.map(e => ({
        dn:          e.dn,
        username:    e.sAMAccountName || e.uid || e.cn,
        displayName: e.displayName || e.cn,
        email:       e.mail || '',
        groups:      e.memberOf ? (Array.isArray(e.memberOf) ? e.memberOf : [e.memberOf]).length : 0,
      }))};
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      await client?.unbind().catch(() => {});
    }
  }
}

// LDAP injection önleme
function escapeLDAP(str) {
  return String(str)
    .replace(/\\/g, '\\5c')
    .replace(/\*/g, '\\2a')
    .replace(/\(/g, '\\28')
    .replace(/\)/g, '\\29')
    .replace(/\0/g, '\\00');
}

// OpenLDAP / FreeIPA / Samba presets
const PRESETS = {
  openldap: { userFilter: '(uid={{username}})', displayNameAttr: 'cn',          emailAttr: 'mail' },
  ad:        { userFilter: '(sAMAccountName={{username}})', displayNameAttr: 'displayName', emailAttr: 'mail' },
  freeipa:   { userFilter: '(uid={{username}})', displayNameAttr: 'displayName', emailAttr: 'mail' },
  samba:     { userFilter: '(sAMAccountName={{username}})', displayNameAttr: 'cn', emailAttr: 'mail' },
};

// Singleton provider
let _provider = null;

function getProvider(wsConfig) {
  const cfg = wsConfig.get('ldap') || {};
  if (!_provider || JSON.stringify(cfg) !== _provider._cfgHash) {
    _provider = new LDAPProvider(cfg);
    _provider._cfgHash = JSON.stringify(cfg);
  }
  return _provider;
}

// ── Express routes ─────────────────────────────
module.exports = function(wsConfig) {
  const router = express.Router();

  // GET /api/ldap/config
  router.get('/config', (req, res) => {
    const cfg = { ...(wsConfig.get('ldap') || DEFAULT_CONFIG) };
    delete cfg.bindPassword; // Şifreyi gönderme
    res.json({ ok: true, config: cfg, defaults: DEFAULT_CONFIG });
  });

  // POST /api/ldap/config  — save LDAP config (admin only)
  router.post('/config', (req, res) => {
    const current = wsConfig.get('ldap') || {};
    const update  = { ...DEFAULT_CONFIG, ...current, ...req.body };
    // Şifre boş gelirse eskiyi koru
    if (!req.body.bindPassword) delete update.bindPassword;
    wsConfig.set('ldap', update);
    _provider = null; // Reset provider
    res.json({ ok: true });
  });

  // POST /api/ldap/test  — bağlantı testi
  router.post('/test', async (req, res) => {
    try {
      const provider = getProvider(wsConfig);
      const result   = await provider.testConnection();
      res.json(result);
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // POST /api/ldap/search  — kullanıcı arama
  router.post('/search', async (req, res) => {
    try {
      const provider = getProvider(wsConfig);
      const result   = await provider.searchUsers(req.body.query || '', req.body.limit || 20);
      res.json(result);
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  // POST /api/ldap/verify  — tek kullanıcıyı doğrula (test için)
  router.post('/verify', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    try {
      const provider = getProvider(wsConfig);
      const user     = await provider.authenticate(username, password);
      if (user) res.json({ ok: true, user });
      else      res.json({ ok: false, error: 'Authentication failed' });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  });

  return router;
};

module.exports.LDAPProvider  = LDAPProvider;
module.exports.getProvider   = getProvider;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;

module.exports.PRESETS = PRESETS;
