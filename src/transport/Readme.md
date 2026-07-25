# Telegram & WhatsApp адаптеры для ботов

## 📦 Установка

```bash
# Установите зависимости для обоих адаптеров
npm install grammy whatsapp-web.js
npm install -D @types/node
```

## 📁 Структура файлов

```
src/
├── transport/
│   ├── index.ts                    # Модульный вход (реэкспорт)
│   ├── types.ts                    # Общие типы и интерфейсы
│   ├── Message.ts                  # Головной класс сообщения
│   ├── WhatsappWebPollingAdaptor/
│   │   ├── WhatsappWebPollingAdaptor.ts  # WhatsApp адаптер
│   │   └── test.ts
│   └── TelegramBotPollingAdaptor/
│       ├── TelegramBotPollingAdaptor.ts  # Telegram адаптер
│       └── test.ts
```

Примечание: для обратной совместимости в подпапках (`WhatsappWebPollingAdaptor`, `TelegramBotPollingAdaptor`) добавлены "shim"-файлы, поэтому старые глубокие импорты по пути `./transport/WhatsappWebPollingAdaptor` или `./transport/TelegramBotPollingAdaptor` продолжат работать и экспортируют адаптер и `Message`. Общие типы следует импортировать из корня модуля: `import { AnyMessage, IMessageAdapter } from './transport'`.

## 🎯 Основные компоненты

### 1. **Типы (`types.ts`)**
Общие типы для всех платформ:
- `Platform` - поддерживаемые платформы ('telegram' | 'whatsapp' | 'test')
- `AnyMessage` - унифицированный формат сообщения
- `IMessageAdapter` - интерфейс адаптера
- `Capabilities` - возможности платформы

### 2. **Класс `Message`**
Головной класс, который гуляет по коду. Содержит:
- Данные сообщения
- Методы для действий (reply, edit, delete)
- Ссылку на адаптер

```typescript
const message = new Message(
    { id, chatId, from, timestamp, platform, adapter },
    'text',
    { text: 'Hello' }
);

// Использование
if (message.isText()) {
    const text = message.getText();
    await message.reply(`Вы сказали: ${text}`);
    await message.sendTyping();
}
```

### 3. **Адаптеры**
Реализуют интерфейс `IMessageAdapter` для конкретной платформы.

---

## 🤖 WhatsApp адаптер

### Создание экземпляра

```typescript
import { WhatsappWebPollingAdaptor } from './transport';

const whatsappBot = new WhatsappWebPollingAdaptor(
    "bot_id_1",                    // ID бота
    "./sessions",                   // папка для сессий
    // onStart
    async () => { console.log('Starting...'); },
    // onStop
    async () => { console.log('Stopping...'); },
    // onMessage - ОСНОВНОЙ ОБРАБОТЧИК
    async (message: AnyMessage) => {
        // обработка сообщения
    },
    // onReady
    async () => { console.log('WhatsApp ready!'); },
    // onSessionCancel
    async (reason) => { console.log('Session closed:', reason); },
    // onError
    async (error) => { console.log('Error:', error); },
    // onQr (опционально)
    async (qr) => { console.log('Scan QR:', qr); }
);
```

### Параметры конструктора (WhatsApp)

```ts
new WhatsappWebPollingAdaptor(
    ID: string,
    sessionDir: string,
    onStart: () => Promise<any>,
    onStop: () => Promise<any>,
    onMessage: (message: AnyMessage) => Promise<any>,
    onReady: () => Promise<any>,
    onSessionCancel: (reason: any) => Promise<any>,
    onError: (error: any) => Promise<any>,
    onQr?: (qr: string) => Promise<any>
)
```

Коротко:
- `ID` — идентификатор бота (используется в путях сессии);
- `sessionDir` — директория для хранения сессий (например `./sessions`);
- `onMessage` — главный обработчик входящих сообщений (принимает `AnyMessage`);
- `onQr` — опциональный колбэк для получения QR при первом входе;


### Особенности WhatsApp

| Характеристика | Значение |
|----------------|----------|
| **Авторизация** | QR-код (нужно сканировать) |
| **Редактирование** | ✅ (ограниченно) |
| **Удаление** | ✅ |
| **Макс. длина** | 65536 символов |
| **Markdown/HTML** | ❌ |
| **Таймаут сессии** | Неограничен (пока не разлогинят) |
| **Папка сессий** | `./sessions/bot-ID` |

### Важно для WhatsApp
- При первом запуске нужно отсканировать QR-код
- Сессии сохраняются в папку `./sessions`
- Редактирование может работать нестабильно (требует подтверждения)

---

## 📱 Telegram адаптер

### Создание экземпляра

```typescript
import { TelegramBotPollingAdaptor } from './transport';

const telegramBot = new TelegramBotPollingAdaptor(
    "bot_id_1",                     // ID бота
    "YOUR_BOT_TOKEN",                // токен от @BotFather
    // onStart
    async () => { console.log('Starting...'); },
    // onStop
    async () => { console.log('Stopping...'); },
    // onMessage
    async (message: AnyMessage) => {
        // обработка сообщения
    },
    // onReady
    async () => { console.log('Telegram ready!'); },
    // onError
    async (error) => { console.log('Error:', error); }
);
```

### Параметры конструктора (Telegram)

```ts
new TelegramBotPollingAdaptor(
    ID: string,
    token: string,
    onStart: () => Promise<any>,
    onStop: () => Promise<any>,
    onMessage: (message: AnyMessage) => Promise<any>,
    onReady: () => Promise<any>,
    onError: (error: any) => Promise<any>
)
```

Коротко:
- `token` — токен бота от @BotFather;
- `onMessage` — главный обработчик входящих сообщений;
- `onReady`/`onError` — хуки жизненного цикла.


### Особенности Telegram

| Характеристика | Значение |
|----------------|----------|
| **Авторизация** | Токен (от @BotFather) |
| **Редактирование** | ✅ (48 часов) |
| **Удаление** | ✅ |
| **Закрепление** | ✅ |
| **Макс. длина** | 4096 символов |
| **Markdown/HTML** | ✅ |
| **Callback кнопки** | ✅ (через /callback команды) |

---

## 🔄 Единая обработка сообщений

### Пример универсального обработчика

```typescript
import { Message, AnyMessage, isTextMessage, isLocationMessage } from './transport';

// Один обработчик для обоих адаптеров
async function handleMessage(
    anyMessage: AnyMessage, 
    adapter: IMessageAdapter
) {
    // Превращаем в наш головной класс
    let message: Message;
    
    if (anyMessage.type === 'text') {
        message = Message.createText(
            adapter,
            anyMessage.id,
            anyMessage.chatId,
            anyMessage.from,
            anyMessage.timestamp,
            anyMessage.text
        );
    } else if (anyMessage.type === 'location') {
        message = Message.createLocation(
            adapter,
            anyMessage.id,
            anyMessage.chatId,
            anyMessage.from,
            anyMessage.timestamp,
            anyMessage.location.latitude,
            anyMessage.location.longitude,
            anyMessage.location.live
        );
    } else {
        message = Message.createUnsupported(
            adapter,
            anyMessage.id,
            anyMessage.chatId,
            anyMessage.from,
            anyMessage.timestamp,
            anyMessage.reason
        );
    }

    // Единая логика для всех платформ
    if (message.isText()) {
        const text = message.getText();
        
        if (text === '/start') {
            await message.reply('Добро пожаловать!');
        } else if (text === '/edit' && adapter.capabilities.canEdit) {
            const sent = await message.reply('Отредактирую...');
            setTimeout(async () => {
                await sent.edit('✨ Отредактировано!');
            }, 3000);
        } else {
            await message.reply(`Вы написали: ${text}`);
        }
    } else if (message.isLocation()) {
        const loc = message.getLocation();
        await message.reply(`Ваши координаты: ${loc.latitude}, ${loc.longitude}`);
    }
}

// Подключаем к обоим адаптерам
whatsappBot.on('message', (msg) => handleMessage(msg, whatsappBot));
telegramBot.on('message', (msg) => handleMessage(msg, telegramBot));
```

## Быстрый старт

Ниже минимальный пример, показывающий использование единого модуля `./transport` и запуска двух ботов.

```ts
import { WhatsappWebPollingAdaptor, TelegramBotPollingAdaptor, Message, AnyMessage, IMessageAdapter } from './transport';

const handler = async (anyMessage: AnyMessage, adapter: IMessageAdapter) => {
    const msg = new Message({ ...anyMessage, adapter }, anyMessage.type, 
        anyMessage.type === 'text' ? { text: (anyMessage as any).text } :
        anyMessage.type === 'location' ? { location: (anyMessage as any).location } :
        { reason: (anyMessage as any).reason }
    );

    if (msg.isText()) await msg.reply(`Echo: ${msg.getText()}`);
};

const wa = new WhatsappWebPollingAdaptor('bot1', './sessions', async () => {}, async () => {}, handler, async () => {}, async () => {}, async () => {}, async (qr) => console.log('QR', qr));
const tg = new TelegramBotPollingAdaptor('bot2', process.env.TG_TOKEN || '', async () => {}, async () => {}, handler, async () => {}, async (e) => console.error(e));

(async () => {
    await Promise.all([wa.init(), tg.init()]);
    console.log('Bots started');
})();
```

---

## 🎮 Методы класса Message

| Метод | Описание | Доступность |
|-------|----------|-------------|
| `reply(text)` | Ответить на сообщение | ✅ Всегда |
| `edit(newText)` | Отредактировать | ✅ Где поддерживается |
| `delete(forEveryone)` | Удалить | ✅ Где поддерживается |
| `sendTyping()` | Показать "печатает" | ✅ Всегда |
| `replyWithLocation(lat, lng)` | Ответить локацией | ✅ Всегда |
| `isText()` | Проверка на текст | ✅ |
| `isLocation()` | Проверка на локацию | ✅ |
| `getText()` | Получить текст | ✅ |
| `getLocation()` | Получить координаты | ✅ |

---

## 📊 Capabilities (возможности платформы)

У каждого адаптера есть свойство `capabilities`:

```typescript
// Проверка перед использованием
if (adapter.capabilities.canEdit) {
    await message.edit('Новый текст');
} else {
    await message.reply('Редактирование не поддерживается');
}

// Полный список
console.log(adapter.capabilities);
{
    canEdit: boolean,        // можно редактировать
    canDelete: boolean,       // можно удалять
    canPin: boolean,          // можно закреплять
    editTimeLimit: number,    // лимит времени на редактирование (ms)
    maxMessageLength: number, // макс. длина сообщения
    supportsMarkdown: boolean,
    supportsHTML: boolean
}
```

---

## 🚀 Запуск нескольких ботов

```typescript
// WhatsApp боты
const whatsapp1 = new WhatsappWebPollingAdaptor(/* params */);
const whatsapp2 = new WhatsappWebPollingAdaptor(/* params */);

// Telegram боты (разные токены)
const telegram1 = new TelegramBotPollingAdaptor(..., "TOKEN_1", ...);
const telegram2 = new TelegramBotPollingAdaptor(..., "TOKEN_2", ...);

// Запускаем всех
await Promise.all([
    whatsapp1.init(),
    whatsapp2.init(),
    telegram1.init(),
    telegram2.init()
]);
```

---

## 🧪 Тестирование

### WhatsApp тест
```bash
# Запуск WhatsApp адаптера (в папке адаптера есть тестовый скрипт `test.ts`)
npx ts-node src/transport/WhatsappWebPollingAdaptor/test.ts
```

### Telegram тест
```bash
# Запуск Telegram адаптера (в папке адаптера есть тестовый скрипт `test.ts`)
npx ts-node src/transport/TelegramBotPollingAdaptor/test.ts
```

Тестовые команды в Telegram:
- `/start` - приветствие
- `/edit` - тест редактирования
- `/delete` - тест удаления
- любой текст - эхо

---

## ⚠️ Важные моменты

### WhatsApp
1. **QR-код** - при первом запуске нужно сканировать
2. **Сессии** - хранятся в папке, можно переиспользовать
3. **Редактирование** - может требовать `needsVerification: true`
4. **Медиа** - не поддерживается в текущей версии (будет добавлено)

### Telegram
1. **Токен** - получать у @BotFather
2. **Webhook** - не поддерживается (только polling)
3. **Callback кнопки** - преобразуются в `/callback data`
4. **Редактирование** - работает надежно, 48 часов

### Общее
1. **Все сообщения** проходят через `Message` класс
2. **Проверяйте `capabilities`** перед использованием специфичных функций
3. **Обрабатывайте ошибки** - адаптеры кидают `AdapterError`
4. **Не создавайте много ботов** в одном процессе без необходимости

---

## 🔧 Расширение

### Добавление новой платформы

```typescript
class ViberAdapter implements IMessageAdapter {
    getPlatform(): Platform { return 'viber'; }
    
    // реализовать все обязательные методы
    async sendMessage(chatId: string, text: string) { ... }
    async sendLocation(chatId: string, lat: string, lng: string) { ... }
    async sendAction(chatId: string, action: 'typing' | 'uploading') { ... }
    
    // опционально
    editMessage?(messageId: string, newText: string) { ... }
    
    // capabilities
    readonly capabilities: Capabilities = {
        canEdit: false,  // Viber не поддерживает
        canDelete: true,
        // ...
    };
}
```

### Добавление нового типа сообщения

В `types.ts`:
```typescript
export type AnyMessage = 
    | TextMessage 
    | LocationMessage 
    | UnsupportedMessage
    | NewTypeMessage;  // добавить

export interface NewTypeMessage extends BaseMessage {
    type: 'new_type';
    // специфичные поля
}
```

---

## 📝 Пример полного бота

```typescript
import { WhatsappWebPollingAdaptor, TelegramBotPollingAdaptor, Message } from './transport';

async function startBots() {
    // Создаем ботов
    const whatsapp = new WhatsappWebPollingAdaptor(/* ... */);
    const telegram = new TelegramBotPollingAdaptor(/* ... */);

    // Единый обработчик
    const handler = async (anyMessage: AnyMessage, adapter: IMessageAdapter) => {
        const msg = new Message(
            { ...anyMessage, adapter },
            anyMessage.type,
            anyMessage.type === 'text' ? { text: anyMessage.text } :
            anyMessage.type === 'location' ? { location: anyMessage.location } :
            { reason: anyMessage.reason }
        );

        if (msg.isText()) {
            const text = msg.getText();
            
            // Команды
            if (text === '/help') {
                await msg.reply('Доступные команды: /start, /help');
            } else if (text.startsWith('/')) {
                await msg.reply(`Неизвестная команда: ${text}`);
            } else {
                await msg.reply(`Эхо: ${text}`);
            }
        }
    };

    whatsapp.on('message', (m) => handler(m, whatsapp));
    telegram.on('message', (m) => handler(m, telegram));

    // Запуск
    await Promise.all([whatsapp.init(), telegram.init()]);
    console.log('Все боты запущены!');
}

startBots().catch(console.error);
```