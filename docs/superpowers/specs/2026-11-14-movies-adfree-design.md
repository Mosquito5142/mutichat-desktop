# แท็บ "หนัง": เบราว์เซอร์ไม่มีโฆษณา + จอลอย

วันที่: 2026-11-14
สถานะ: อนุมัติดีไซน์แล้ว รอเขียนแผน

## เป้าหมาย

เปิดเว็บดูวิดีโอ/หนังเว็บไหนก็ได้ในแอป โดยบล็อกโฆษณาได้ใกล้เคียง Brave และดึงวิดีโอออกมาเป็นจอลอยได้เหมือน YouTube/TikTok (PiP เหนือทุกแอป, ปุ่มกรอ, mini player ในแอปเป็นทางสำรอง)

ไม่ทำ: ตัวดึง/ดาวน์โหลดวิดีโอ, โค้ดเฉพาะเว็บใดเว็บหนึ่ง, หลายแท็บพร้อมกัน, ซิงก์เว็บโปรดข้ามเครื่อง

## 1. ภาพรวมและ UI

หนังเป็น site ที่ 3 ใน `MEDIA_SITES` (`renderer.js`) ต่อจาก `youtube` และ `tiktok` จึงได้ mode full / pip / mini / hidden / closed, ปุ่ม pop-out, mini player ที่ลากและย่อขยายได้ และการปิดเพื่อคืน RAM โดยไม่ต้องเขียนใหม่

- **ปุ่ม "หนัง"** บนแถบบนถัดจาก TikTok คีย์ลัด `Ctrl+Shift+M` เพิ่มใน `main.js` ที่ map คีย์ลัดอยู่แล้ว ส่ง `toggle-movies`
- **site config:** `movies` partition `persist:movies` แยกจากแชทและ YouTube มี `lastUrlKey` ให้จำหน้าล่าสุดเหมือน site อื่น
- **แถบ URL ในหัว media view:** แสดงเฉพาะตอน `activeSite === 'movies'` ประกอบด้วย ← → 🏠 ช่อง URL และ ⭐
  - Enter ในช่อง URL → `normalizeInput()`: เป็นโดเมนหรือ URL → เปิด (เติม `https://` ถ้าไม่มี scheme), เป็นข้อความทั่วไป → ค้นหา Google
  - อัปเดตช่อง URL จาก event `did-navigate` และ `did-navigate-in-page` ของ webview (เฉพาะ top frame)
- **เว็บโปรด:** ⭐ บันทึก/ลบหน้าปัจจุบัน (ชื่อจาก `page-title-updated`) เก็บใน `localStorage` คีย์ `mc-movie-favorites` เป็น `[{url, title}]`
  - 🏠 เปิดหน้าเว็บโปรดเป็นการ์ด ใช้ไฟล์ HTML ในแอป (`movies-home.html`) ไม่โหลดจากเน็ต รายการเว็บส่งผ่าน query string ทุกการ์ดมีปุ่มลบ
  - ถ้ายังไม่มีเว็บโปรด หน้านี้จะบอกวิธีเพิ่ม
- **ไฟล์:** แยกโค้ดแถบ URL และเว็บโปรดไปไว้ที่ `movies.js` (โหลดใน `index.html`) ไม่ยัดเพิ่มใน `renderer.js` เชื่อมกับ media view ผ่าน `MEDIA_SITES` และ hook ไม่กี่จุด (เช่น callback ตอน `activeSite` เปลี่ยน) แก้ `index.html` และ `styles.css` เพิ่มปุ่มกับแถบ URL

## 2. การบล็อกโฆษณา

ไฟล์ main process ใหม่ `movie-adblock.js` ผูกกับ session `persist:movies` เท่านั้น แชท, YouTube และ TikTok ไม่ได้รับผลกระทบ

### ชั้นที่ 1–2: filter engine

- dependency ใหม่: `@ghostery/adblocker-electron` (และ `cross-fetch` ถ้าเวอร์ชันนั้นต้องใช้)
- filter list: uBlock filters, EasyList, EasyPrivacy, Peter Lowe และ EasyList Thailand
- ได้ทั้ง network filter (บล็อก request) และ cosmetic filter/scriptlet (ซ่อนกล่องโฆษณา, แก้ anti-adblock)
- **lazy init:** `ipcMain.handle('movies-init')` สร้าง engine และเรียก `enableBlockingInSession` ตอนกดปุ่มหนังครั้งแรก renderer รอให้เสร็จก่อนสร้าง webview ถ้าเรียกซ้ำจะได้ promise เดิม
- **cache:** engine ที่ serialize แล้วเก็บไว้ที่ `app.getPath('userData')/adblock-engine.bin` ถ้ามีจะโหลดจาก cache ทันที และถ้าไฟล์เก่ากว่า 7 วันจะโหลด list ใหม่อยู่เบื้องหลังแล้วเขียน cache ทับ (engine ใหม่ใช้ตั้งแต่เปิดครั้งถัดไป)
- ไฟล์ cache อ่านไม่ได้หรือเสีย → ลบทิ้งแล้วโหลดจาก list ใหม่
- **ความเสี่ยงที่ต้องตรวจก่อน:** ghostery ต้องรองรับ preload API ของ Electron 44 ถ้าไม่รองรับให้ใช้เฉพาะ network filter (`blocker.match` ใน `webRequest.onBeforeRequest`) และฉีด cosmetic CSS (`blocker.getCosmeticsFilters`) ผ่าน `media-preload.js` เอง

### ชั้นที่ 3: ดักป๊อปอัปและ redirect (เขียนเอง)

ใช้กับ webview guest ที่ session เป็น `persist:movies` (เช็กใน `web-contents-created` ของ `main.js`)

- `setWindowOpenHandler`: ปฏิเสธทุกหน้าต่างใหม่ ถ้า URL เป็นเว็บเดียวกับหน้าปัจจุบัน (`isSameSite`) ให้โหลดในหน้าเดิม ถ้าไม่ใช่ทิ้งเงียบๆ
- `will-navigate` (top frame เท่านั้น): ถ้าปลายทางเป็นคนละเว็บกับหน้าปัจจุบัน และไม่ได้มาจากแถบ URL / เว็บโปรด / ← → ให้ `preventDefault()` แล้วส่ง `movies-nav-blocked` (URL ปลายทาง) ไปที่ renderer
  - renderer แสดงแถบ "เว็บพยายามพาไป xxx.com" พร้อมปุ่ม [ไปต่อ] (อนุญาตครั้งเดียว: main เก็บ URL นั้นไว้ใน allow-once set แล้ว renderer สั่ง `loadURL`) และ [ปิด] แถบหายเองใน 8 วินาที
  - การ navigate ที่แอปสั่งเอง (แถบ URL, เว็บโปรด, ← →, 🏠) renderer ส่ง `movies-allow-nav` ก่อนทุกครั้ง
- การเปลี่ยนหน้าภายใน iframe ไม่บล็อก (ตัวเล่นเปลี่ยน source ของตัวเองบ่อย)

## 3. จอลอยจาก iframe

### main process เลือกเฟรมให้

`ipcMain.handle('media-frame', (e, webContentsId, action))`:

1. `webContents.fromId(id).mainFrame.framesInSubtree` → รันสคริปต์ probe ในทุกเฟรม (`frame.executeJavaScript`) คืน `{hasVideo, playing, area}` เฟรมที่ error หรือ timeout (500ms) ถือว่าไม่มีวิดีโอ
2. `pickBestFrame(probes)`: เลือกเฟรมที่กำลังเล่นก่อน (ถ้ามีหลายเฟรม เอาอันที่ใหญ่สุด) ถ้าไม่มีเลือกเฟรมที่วิดีโอใหญ่สุด ถ้าไม่มีวิดีโอเลยคืน `null`
3. รัน action ในเฟรมนั้นด้วย `userGesture = true`: `playing?` | `pip-enter` | `pip-exit` | `pause` | `toggle-play` คืนผลลัพธ์ให้ renderer (`pip-enter` คืน `true`/`false`)

ใน renderer ให้ `enterPip`, `exitPip`, `isPlayingVideo` และปุ่มเล่น/หยุดใน mini player เปลี่ยนมาเรียก `ipcRenderer.invoke('media-frame', wv.getWebContentsId(), action)` **ทุก site** ได้โค้ดชุดเดียว YouTube/TikTok ทำงานเหมือนเดิมเพราะวิดีโออยู่ใน top frame และ probe ใช้ `__mcMainVideo()` ตามเดิม

### preload ใน iframe

- webview หนังตั้ง `webpreferences="nodeIntegrationInSubFrames"` ให้ `media-preload.js` รันในทุกเฟรม iframe ตัวเล่นจึงได้ปุ่มกรอ ±10 วินาที และ "กลับไปที่แท็บ" ใน PiP เหมือน YouTube
- preload ยังรันใน isolated world และไม่ส่ง `ipcRenderer` ให้สคริปต์ของเว็บ
- ข้อความจาก iframe (`mc-pip-return`, `mc-pip-closed`) ส่งด้วย `ipcRenderer.sendToHost` เหมือนเดิม

### mini player เห็นแค่วิดีโอ

`mc-mini` สำหรับหน้าที่ไม่ใช่ YouTube/TikTok:

- top frame: `<video>` หรือ `<iframe>` ที่ใหญ่ที่สุดบนจอ → `position: fixed; inset: 0; width/height: 100%; z-index: max` และซ่อน scrollbar
- iframe ที่มี `<video>`: ขยายวิดีโอที่ใหญ่ที่สุดให้เต็มเฟรมแบบเดียวกัน
- ถ้าเดาผิด ก็แค่เห็นทั้งหน้าใน mini player การเล่นไม่พัง

เต็มจอ: `enter-html-full-screen` / `leave-html-full-screen` ทำงานกับ iframe อยู่แล้ว ไม่ต้องแก้

## 4. Error handling

| กรณี | แอปทำอะไร |
|---|---|
| โหลด filter list ไม่ได้และไม่มี cache | เปิดเว็บได้ ชั้นที่ 3 ยังทำงาน toast "ยังโหลดตัวบล็อกโฆษณาไม่ได้ จะลองใหม่รอบหน้า" |
| ไฟล์ cache เสีย | ลบทิ้งแล้วโหลด list ใหม่ |
| กดลอยแต่ไม่เจอวิดีโอ | toast "ยังไม่เจอวิดีโอ กดเล่นก่อนแล้วลองใหม่" |
| เว็บปิด PiP (`disablePictureInPicture`) หรือ `pip-enter` คืน false | ใช้ mini player ในแอปแทน (พฤติกรรมเดิม) |
| เฟรมหายระหว่างสั่ง | จับ error ถือว่าไม่เจอวิดีโอ ไม่ crash |
| URL ผิดหรือเว็บเข้าไม่ได้ | หน้า error ของ Chromium ตามปกติ แถบ URL ยังแก้ได้ |

## 5. โค้ดที่เทสต์ได้โดยไม่ต้องใช้ Electron

`movies-util.js` (ใช้ได้ทั้ง main และ renderer ไม่มี dependency ของ Electron):

- `normalizeInput(text)` → URL ที่จะเปิด
- `isSameSite(urlA, urlB)` ใช้ `tldts.getDomain` (มากับ ghostery อยู่แล้ว) ไม่ใช่ http(s) → `false`
- `pickBestFrame(probes)` → index ของเฟรม หรือ `null`

## 6. การทดสอบ

**Unit test** ด้วย `node:test` (มากับ Node) เพิ่มสคริปต์ `"test": "node --test"` ไฟล์ `test/movies-util.test.js`:

- `normalizeInput`: `example.com` → `https://example.com/`, `http://x.com/a` ไม่เปลี่ยน, `หนังใหม่` → URL ค้นหา Google, `localhost:3000` → `http://localhost:3000/`
- `isSameSite`: `a.example.co.th` กับ `b.example.co.th` → true, `example.com` กับ `example.net` → false, `about:blank` → false
- `pickBestFrame`: เลือกเฟรมที่เล่นอยู่แม้จะเล็กกว่า, ไม่มีที่เล่นเลือกใหญ่สุด, ไม่มีวิดีโอ → `null`

**ทดสอบในแอปจริง (checklist):**

- [ ] เปิดเว็บหนังที่มีโฆษณาเยอะ 2–3 เว็บ: ไม่มีกล่องโฆษณาและป๊อปอัป กดเล่นแล้วไม่โดนพาไปเว็บอื่น
- [ ] เว็บพาไปโดเมนอื่น: แถบแจ้งเตือนขึ้น [ไปต่อ] ใช้ได้
- [ ] วิดีโอใน iframe: ลอย PiP, กรอ ±10 วินาที, กลับไปที่แท็บ, mini player เห็นแค่วิดีโอ, เต็มจอ
- [ ] แถบ URL, ← →, เว็บโปรด (เพิ่ม/ลบ/เปิด), ปิดแล้วเปิดกลับมาหน้าเดิม
- [ ] YouTube และ TikTok ยังลอย กรอ และ mini player ได้เหมือนเดิม
- [ ] แชทปกติ, RAM ตอนยังไม่เปิดแท็บหนังไม่เพิ่ม
- [ ] build ด้วย `npm run dist` แล้วแอปที่ติดตั้งเปิดแท็บหนังได้ `build.files` เป็นรายการระบุชื่อ จึงต้องเพิ่ม `movies.js`, `movies-util.js`, `movie-adblock.js`, `movies-home.html` และ `@ghostery/adblocker-electron` พร้อม dependency ทุกตัวของมัน (ไล่ด้วย `npm ls --all @ghostery/adblocker-electron`)
