# LanzoRouter — Upstream Sync Guide

Panduan lengkap untuk sync update dari **9router** (`decolua/9router`) ke **LanzoRouter** (`jonni31/lanzorouter`).

---

## Arsitektur & Sejarah

LanzoRouter dibuat dari **zevairouter** (fork 9router), tapi sebagai repo baru — bukan GitHub fork. Artinya:
- **Tidak ada shared git history** → `git merge` langsung dari 9router tidak mungkin (304 dari 406 file conflict).
- Update harus dilakukan **selective copy** — pilih file mana yang aman, mana yang harus di-review manual.

### Chain:
```
decolua/9router (upstream, active development)
    ↓
Verifiedlabs/zevairouter (patch)
    ↓
jonni31/lanzorouter (custom features: auto-fix, auto-clean, quota tracking)
```

### Perbedaan Arsitektur Utama

9router baru-baru ini melakukan **refactor besar**: memindahkan semua provider config dari file flat (`open-sse/config/providers.js`, `providerModels.js`) ke sistem **modular registry** (`open-sse/providers/registry/{provider}.js`). LanzoRouter masih menggunakan **arsitektur lama** (flat config files). Ini perbedaan paling fundamental — hampir semua file "risky" terkait dengan ini.

---

## Kategori File

### ✅ KATEGORI 1: AMAN — Langsung Copy

File-file ini **self-contained** (berdiri sendiri), tidak mengubah logic yang sudah ada, dan tinggal di-drop ke folder yang tepat. **Langsung copy tanpa tanya.**

#### Direktori yang Aman:

| Direktori | Isi | Kenapa Aman |
|-----------|-----|-------------|
| `open-sse/executors/` | Executor per-provider (cara kirim request ke API) | Tiap file handle 1 provider. File baru = provider baru. Tidak mengubah file lain. |
| `open-sse/translator/request/` | Translator format request (e.g. Claude → Kiro format) | Self-contained converter, 1 file per format pair. |
| `open-sse/translator/response/` | Translator format response | Sama — self-contained. |
| `open-sse/handlers/imageProviders/` | Image generation handler per-provider | Self-contained, 1 file per provider. |
| `open-sse/handlers/ttsProviders/` | Text-to-Speech handler per-provider | Self-contained. |
| `open-sse/handlers/embeddingProviders/` | Embedding handler per-provider | Self-contained. |
| `src/lib/oauth/services/` | OAuth service per-provider | Self-contained auth flow per provider. |
| `src/app/api/oauth/` | OAuth API routes | Self-contained route handlers. |

#### Aturan Copy:

1. **Hanya file BARU** — file yang belum ada di LanzoRouter.
2. Jangan pernah **overwrite** file yang sudah ada di direktori ini — bisa jadi sudah di-modify untuk LanzoRouter.
3. Setelah copy, **cek import** — file baru mungkin import modul yang belum ada di LanzoRouter (lihat Kategori 2).

#### Cara Cek Dependencies:

Setelah copy file baru, grep semua import-nya:

```bash
# Contoh: cek file executor baru
grep "from " open-sse/executors/namafile.js

# Yang perlu dicek:
# 1. Import relative (../) — pastikan file yang di-import ada
# 2. Import @/ — pastikan module path ada di src/
# 3. Import dari ../config/ — hati-hati, ini bisa bermasalah (lihat Kategori 3)
```

Jika ada import yang missing, cek apakah file itu juga bisa di-copy dari 9router (biasanya aman kalau file itu juga self-contained).

---

### ⚠️ KATEGORI 2: PERLU DICEK — Copy Setelah Verifikasi

File-file ini **biasanya aman** tapi perlu verifikasi singkat sebelum copy.

| File | Kenapa Perlu Dicek |
|------|-------------------|
| `open-sse/services/kimchiModels.js` | Data models untuk Kimchi executor. Aman selama format sama. |
| `open-sse/translator/schema/*.js` | Schema untuk translator. Aman kalau tidak ada breaking changes di format. |
| `src/lib/oauth/kiroExternalIdp.js` | Helper untuk Kiro OAuth. Self-contained tapi cek import paths. |
| File di `open-sse/services/` (baru) | Service files baru biasanya aman, tapi cek apakah import dari config yang sudah di-refactor 9router. |

#### Cara Verifikasi:

```bash
# 1. Cek import — pastikan semua module yang di-import ada di LanzoRouter
grep "from " nine-router/path/to/file.js

# 2. Kalau import dari providers/registry/ atau providers/models/ → STOP
#    Ini pakai arsitektur baru 9router yang LanzoRouter belum punya.

# 3. Kalau import dari ../config/ → cek apakah function yang di-import
#    masih ada dan sama di LanzoRouter version
```

---

### 🚫 KATEGORI 3: TIDAK BOLEH LANGSUNG APPLY — Harus Tanya Dulu

File-file ini mengandung **custom logic LanzoRouter** atau punya **perbedaan arsitektur fundamental**. Overwrite = rusak.

#### 3A. File dengan Custom LanzoRouter Logic

| File | Custom Logic | Efek Kalau Di-Overwrite |
|------|-------------|----------------------|
| `src/sse/handlers/chat.js` | **Auto-fix system** — import dan panggil `detectErrorPattern()`, `applyAutoFix()`, `logAutoFix()` dari `@/lib/autoFix.js`. Logic retry transient errors (rate limit, timeout, 500, network error). | Auto-fix hilang total. Error yang tadinya auto-retry jadi langsung fail. User harus manually reconnect setiap kali ada rate limit atau timeout. |
| `src/sse/services/auth.js` | **`most-quota` strategy** — fallback strategy tambahan yang pilih connection dengan quota paling banyak. Baca dari quota cache (`getQuotaSnapshot`). Juga ada **auto-clean integration** — deteksi `quota_exhausted` error dan trigger auto-clean (disable/delete key). LanzoRouter version 432 baris vs 9router 312 baris — 120 baris custom code. | Quota-based routing hilang. Auto-clean tidak bisa detect exhausted keys. Semua key dipakai merata tanpa peduli sisa quota → key habis lebih cepat, error rate naik. |
| `open-sse/services/usage.js` | **Seluruh quota tracking system** — 2322 baris di LanzoRouter vs 58 baris di 9router. Ini jantung quota fetcher: ambil usage data dari API GitHub, GLM, MiniMax, Gemini, Codex, dll. | SELURUH QUOTA TRACKING HILANG. Dashboard usage kosong. `most-quota` strategy tidak berfungsi. Fitur paling penting LanzoRouter lenyap. |

#### 3B. File yang Beda Arsitektur (9router Sudah Refactor)

| File | Perbedaan | Efek Kalau Di-Overwrite |
|------|-----------|----------------------|
| `open-sse/config/providerModels.js` | 9router: 106 baris, import dari `providers/registry/` (arsitektur baru). LanzoRouter: 959 baris, semua model di-define langsung di file ini (arsitektur lama). | **Build langsung error.** 9router version import dari `providers/registry/` yang tidak ada di LanzoRouter. Bahkan kalau build berhasil, semua model list hilang — chat tidak bisa route ke provider manapun. |
| `open-sse/config/providers.js` | 9router: 19 baris (barrel export dari registry). LanzoRouter: 474 baris (semua provider config inline — URL, headers, format, auth method). | **Build error** karena `providers/registry/` folder tidak ada. Semua provider config hilang → tidak ada single provider yang bisa dipakai. Router mati total. |
| `open-sse/config/appConstants.js` | 9router punya constant baru dan beberapa value berbeda. LanzoRouter punya custom constants (e.g. `antigravityUserAgent`). | Beberapa provider mungkin error karena missing constants. Custom config LanzoRouter hilang. |
| `open-sse/config/kiroConstants.js` | Model list dan config untuk Kiro/Claude endpoints. 9router: 277 baris, LanzoRouter: 322 baris. | Model list berubah — beberapa model mungkin hilang atau bertambah. Biasanya aman tapi perlu review mana yang baru vs mana yang sengaja beda. |
| `src/shared/constants/providers.js` | Frontend provider metadata (nama, icon, color, website, deskripsi). 9router: 165 baris (referensi ke registry), LanzoRouter: 333 baris (inline). | **Dashboard rusak.** Provider cards di UI tidak tampil atau tampil tanpa info. Build mungkin error. |
| `src/shared/constants/models.js` | 9router punya `getModelKind()` dan `CAPACITY_META` baru. LanzoRouter belum. | Biasanya aman ditambahkan (additive), tapi cek apakah ada yang bergantung pada yang dihapus. |
| `open-sse/index.js` | Perbedaan kecil: LanzoRouter export `getProviderConfig`, `buildProviderUrl`, `buildProviderHeaders` tambahan. | Function yang dipakai quota system hilang → quota tracking error. |

#### 3C. File yang Perlu Review Case-by-Case

| File | Kenapa | Cara Handle |
|------|--------|-------------|
| `src/sse/services/model.js` | Logic routing model ke provider. 9router: 94 baris, LanzoRouter: 99 baris. Bedanya kecil tapi krusial untuk model resolution. | Diff dulu, apply perubahan spesifik yang berguna saja. |
| `src/sse/services/tokenRefresh.js` | OAuth token refresh logic. 9router: 325 baris, LanzoRouter: 319 baris. | Diff dulu, biasanya 9router punya fix baru yang bisa di-cherry-pick. |
| `package.json` | Dependency versions berbeda. 9router mungkin tambah dep baru yang dibutuhkan file baru. | **Jangan overwrite.** Cek dep baru yang ditambahkan 9router, `npm install` satu-satu kalau dibutuhkan. |

---

## Yang Boleh Langsung Dilakukan (Tanpa Tanya)

1. **Copy file baru** dari Kategori 1 (safe directories)
2. **Copy dependency files** yang dibutuhkan file baru (Kategori 2), setelah verifikasi import
3. **Update `package.json`** — hanya **tambah dependency baru**, jangan ubah version yang sudah ada
4. **Commit, push, deploy** kalau hanya ada perubahan Kategori 1 & 2
5. **Laporkan** file Kategori 3 yang berubah di upstream — apa yang baru, apa yang di-fix

## Yang Harus Tanya Dulu

1. **Semua file Kategori 3** — terutama yang ada custom LanzoRouter logic
2. **Perubahan di file yang sudah ada** (bukan file baru) di direktori manapun
3. **Breaking changes** di 9router yang mengubah format data atau API internal
4. **Dependency version upgrades** di `package.json` — bisa break compatibility

---

## Workflow Auto-Sync

### Step 1: Fetch & Compare
```bash
cd /path/to/nine-router
git fetch --depth=1 origin master
git reset --hard origin/master
```

Cek version di `package.json` — bandingkan dengan version terakhir yang di-sync.

### Step 2: Identifikasi Perubahan
```bash
# File baru di safe directories
for dir in open-sse/executors open-sse/translator/request open-sse/translator/response open-sse/handlers/imageProviders open-sse/handlers/ttsProviders open-sse/handlers/embeddingProviders src/lib/oauth/services src/app/api/oauth; do
    for f in nine-router/$dir/*.js; do
        name=$(basename "$f")
        [ ! -f "lanzorouter/$dir/$name" ] && echo "NEW: $dir/$name"
    done
done

# Risky files yang berubah
for f in open-sse/config/providerModels.js open-sse/config/providers.js ...; do
    diff --brief nine-router/$f lanzorouter/$f 2>/dev/null && echo "SAME: $f" || echo "CHANGED: $f"
done
```

### Step 3: Apply Safe Changes
```bash
# Copy new files
cp nine-router/open-sse/executors/newfile.js lanzorouter/open-sse/executors/

# Check imports
grep "from " lanzorouter/open-sse/executors/newfile.js

# If missing deps, copy those too (after verification)
```

### Step 4: Build & Test
```bash
cd lanzorouter
npm run build
# Kalau error → cek missing imports → fix → rebuild
```

### Step 5: Deploy
```bash
# SSH ke VPS
ssh ubuntu@43.156.83.237
cd /home/ubuntu/lanzorouter
git pull
npm run build
ln -sfn .next/static .next/standalone/.next/static
ln -sfn $(pwd)/public .next/standalone/public
pm2 restart lanzorouter
```

### Step 6: Report
Laporkan ke owner:
- Version yang di-sync
- File baru yang di-copy
- File risky yang berubah di upstream (summary perubahan)
- Status deploy (sukses/gagal)

---

## File Custom LanzoRouter (JANGAN PERNAH HAPUS/OVERWRITE)

File-file ini **hanya ada di LanzoRouter**, bukan dari 9router. Ini custom features:

| File | Fungsi |
|------|--------|
| `src/lib/autoFix.js` | Auto-fix transient errors (rate limit, timeout, 500, network). Retry otomatis. |
| `src/lib/autoClean.js` | Auto-clean dead keys (exhausted quota). Bisa disable atau delete. |
| `src/lib/usage/quotaService.js` | Quota tracking service — cache dan serve quota data. |
| `src/lib/usage/quotaRefresh.js` | Background loop refresh quota dari provider APIs. |
| `open-sse/utils/quotaParser.js` | Parser response quota dari berbagai provider API formats. |
| `src/lib/db/repos/usageRepo.js` | Database repo untuk usage/quota data. |
| `src/app/api/version/restart/route.js` | Restart router dari dashboard (PM2 auto-restart). |
| `src/app/api/usage/aggregate/route.js` | API endpoint untuk aggregated usage data. |

---

## Cara Porting Fitur Spesifik dari Kategori 3

Kadang 9router menambah fitur baru di file risky (misal model baru di `providerModels.js`, provider baru di `providers.js`). Cara porting yang aman:

### Tambah Model Baru:
```javascript
// Di lanzorouter/open-sse/config/providerModels.js
// Cari provider yang relevan (e.g. "gc" untuk Gemini)
// Tambahkan model baru ke array:
gc: [
    // ... existing models ...
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }, // ← tambah ini
]
```

### Tambah Provider Baru:
Perlu edit **3 file** secara konsisten:
1. `open-sse/config/providers.js` — transport config (URL, headers, format)
2. `open-sse/config/providerModels.js` — model list
3. `src/shared/constants/providers.js` — UI metadata (nama, icon, warna)

Plus biasanya:
4. `open-sse/executors/{provider}.js` — executor (Kategori 1, langsung copy)
5. `src/lib/oauth/services/{provider}.js` — OAuth service kalau ada (Kategori 1)

### Tambah Constants/Config Baru:
Cek diff `appConstants.js` dan `kiroConstants.js`. Kalau ada constant baru yang dibutuhkan file baru, tambahkan manual — jangan overwrite seluruh file.

---

## Ringkasan Cepat

| Aksi | Tanpa Izin | Tanya Dulu |
|------|------------|------------|
| Copy file baru di safe dirs | ✅ | — |
| Copy dependency file baru | ✅ (setelah cek import) | — |
| Tambah npm dependency baru | ✅ | — |
| Overwrite file yang sudah ada | — | ✅ SELALU |
| Edit file custom LanzoRouter | — | ✅ SELALU |
| Update version npm dependency | — | ✅ |
| Port model/provider baru ke config | — | ✅ |
| Apply patch/bugfix dari 9router | — | ✅ (share diff dulu) |
