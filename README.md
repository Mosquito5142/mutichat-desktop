# Multi-Chat Messenger - Lightweight Desktop Application 🚀

โปรแกรมจัดการหลายบัญชี Facebook Messenger, เพจร้านค้า, Instagram Direct และ TikTok Messages แบบแยกเซสชันอิสระในโปรแกรมเดียว ออกแบบมาประหยัด RAM/CPU พร้อมเครื่องมือตอบด่วนสำหรับพ่อค้าแม่ค้าออนไลน์

---

## ✨ ฟีเจอร์เด่น (Key Features)

- 🔒 **Multi-Account Session Isolation:** แยกกล่องเก็บข้อมูล Cookie/Session ของแต่ละบัญชีเด็ดขาด เปิดกี่บัญชีก็ไม่หลุดล็อกอิน
- ⚡ **Smart DOM Preservation:** เพิ่มหรือลบบัญชีโดยไม่ล้างเซสชันของบัญชีอื่น ไม่ต้องล็อกอินใหม่ให้เสียเวลา
- 🛡️ **Bypass Facebook Security Block:** ถอดลายเซ็น Electron และจำลองตัวตนเป็น Google Chrome 100% ป้องกันหน้าต่าง "Your request couldn't be processed"
- ↔️ **Dynamic Side-by-Side Columns:** แสดงทุกบัญชีเรียงเป็นคอลัมน์กว้างเท่าๆ กันข้างกันโดยไม่ขึ้นแถวใหม่
- ⠿ **Drag & Drop Reorder:** ลากสลับตำแหน่งบัญชีบนหน้าจอได้ทันทีตามต้องการ
- ⚡ **Quick Reply Snippets (ข้อความตอบด่วน):** เมนูป๊อปอัพบันทึกเลขบัญชี, ทักทาย, ขอที่อยู่ กดก๊อปปี้แล้ววาง `Ctrl+V` ในแชทได้ทันที
- 🔔 **Taskbar Flashing Notification:** แจ้งเตือนไอคอนกระพริบที่แถบงานบน Windows เมื่อมีแชทใหม่เข้า

---

## 🛠️ สิ่งที่ต้องติดตั้งก่อน Build (Prerequisites & Download Links)

ก่อนรันหรือ Build โปรแกรม ต้องติดตั้งโปรแกรมล่วงหน้าดังนี้:

1. 🟢 **Node.js (v18 ขึ้นไป):** [ดาวน์โหลดที่ nodejs.org](https://nodejs.org/) *(เลือกเวอร์ชัน LTS)*
2. 🐙 **Git:** [ดาวน์โหลดที่ git-scm.com](https://git-scm.com/)

---

## 🚀 วิธีติดตั้งและรันใช้งาน (Getting Started)

### 1. โคลนคลังโค้ด (Clone Repository)
```bash
git clone https://github.com/Mosquito5142/mutichat-desktop.git
cd mutichat-desktop
```

### 2. ติดตั้งแพ็กเกจ (Install Dependencies)
```bash
npm install
```

### 3. รันโปรแกรมในโหมดพัฒนา (Run App)
```bash
npm start
```

---

## 📦 วิธีทำแพ็กเกจติดตั้งเป็นไฟล์ `.exe` (Build Executable)

หากต้องการสร้างไฟล์ `.exe` สำหรับส่งให้ลูกค้าใช้งานโดยไม่ต้องลง Node.js ให้รันคำสั่ง:

```bash
npm run build
```

ไฟล์โปรแกรมจะถูกสร้างไว้ที่โฟลเดอร์:
`dist/Multi-Chat-Messenger-win32-x64/Multi-Chat Messenger.exe`

---

## 📄 ใบอนุญาต (License)
MIT License © 2026 Multi-Chat Team
