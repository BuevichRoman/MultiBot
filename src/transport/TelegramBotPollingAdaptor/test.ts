import { TelegramBotPollingAdaptor } from './TelegramBotPollingAdaptor';
import {
    AnyMessage,
    isTextMessage,
    isLocationMessage,
    PlatformIcons
} from '../types';
import { Message } from '../Message';

// ==================== ТЕСТ ====================

/**
 * Тестовая функция для проверки адаптера Telegram
 */
async function testTelegramAdapter() {
    console.log('\n🧪 Запуск теста Telegram адаптера...\n');

    // 👇 ТОКЕН ОТ @BotFather — через переменную окружения, не в коде:
    // репозиторий публичный. Проверка ниже сработает, если не задан
    const token: string = process.env.MULTIBOT_TELEGRAM_TOKEN ?? "";

    if (!token || token === "token") {
        console.error(`
❌ ОШИБКА: Токен не указан или используется токен по умолчанию!

   Получите реальный токен:
   1. Откройте Telegram
   2. Найдите @BotFather
   3. Отправьте /newbot
   4. Следуйте инструкциям
   5. Скопируйте полученный токен
   6. Вставьте его в переменную token в этом файле
        `);
        process.exit(1);
    }

    console.log(`🔑 Используется токен: ${token.substring(0, 8)}...`);

    // Создаем адаптер с токеном в параметрах
    const bot = new TelegramBotPollingAdaptor(
        "test_telegram_bot",
        token,
        // onStart
        async () => {
            console.log('✅ [Test] onStart: Бот запускается');
            return Promise.resolve();
        },
        // onStop
        async () => {
            console.log('✅ [Test] onStop: Бот останавливается');
            return Promise.resolve();
        },
        // onMessage
        async (anyMessage: AnyMessage) => {
            try {
                const message = new Message(
                    {
                        id: anyMessage.id,
                        chatId: anyMessage.chatId,
                        from: anyMessage.from,
                        timestamp: anyMessage.timestamp,
                        platform: anyMessage.platform,
                        adapter: bot
                    },
                    anyMessage.type,
                    anyMessage.type === 'text' ? { text: (anyMessage as any).text } :
                        anyMessage.type === 'location' ? { location: (anyMessage as any).location } :
                            { reason: (anyMessage as any).reason }
                );

                console.log(`\n📨 [Test] Получено сообщение:`);
                console.log(`   └─ Платформа: ${message.platform}`);
                console.log(`   └─ От: ${message.from.id} (${message.from.firstName || 'без имени'})`);
                console.log(`   └─ Чат: ${message.chatId}`);
                console.log(`   └─ Тип: ${message.getType()}`);

                if (message.isText()) {
                    const text = message.getText();
                    console.log(`   └─ Текст: "${text}"`);

                    if (text === '/start') {
                        const reply = await message.reply('Привет! Я тестовый Telegram бот. Доступные команды:\n/edit - тест редактирования\n/delete - тест удаления');
                        console.log(`   └─ 🤖 Ответ отправлен: ${reply.id}`);
                    } else if (text === '/edit') {
                        const sent = await message.reply('Это сообщение будет отредактировано через 3 секунды...');
                        console.log(`   └─ 🤖 Сообщение отправлено: ${sent.id}`);

                        setTimeout(async () => {
                            const success = await sent.edit('✨ Сообщение успешно отредактировано!');
                            console.log(`   └─ 🤖 Редактирование ${success ? 'успешно' : 'не удалось'}`);
                        }, 3000);
                    } else if (text === '/delete') {
                        const sent = await message.reply('Это сообщение будет удалено через 3 секунды...');
                        console.log(`   └─ 🤖 Сообщение отправлено: ${sent.id}`);

                        setTimeout(async () => {
                            const success = await sent.delete(true);
                            console.log(`   └─ 🤖 Удаление ${success ? 'успешно' : 'не удалось'}`);
                        }, 3000);
                    } else {
                        const reply = await message.reply(`Эхо: ${text}`);
                        console.log(`   └─ 🤖 Эхо отправлено: ${reply.id}`);
                    }
                } else if (message.isLocation()) {
                    const location = message.getLocation();
                    console.log(`   └─ Координаты: ${location.latitude}, ${location.longitude}`);

                    const reply = await message.reply(`Получил вашу локацию: ${location.latitude}, ${location.longitude}`);
                    console.log(`   └─ 🤖 Ответ отправлен: ${reply.id}`);

                    const locationReply = await message.replyWithLocation("55.7558", "37.6173");
                    console.log(`   └─ 🤖 Локация отправлена: ${locationReply.id}`);
                } else {
                    const reason = message.getUnsupportedReason();
                    console.log(`   └─ Причина: ${reason}`);
                    const reply = await message.reply(`Извините, я пока не умею обрабатывать этот тип сообщений (${reason})`);
                    console.log(`   └─ 🤖 Ответ отправлен: ${reply.id}`);
                }
            } catch (error) {
                console.error('❌ Ошибка при обработке сообщения:', error);
            }

            return Promise.resolve();
        },
        // onReady
        async () => {
            console.log('✅ [Test] onReady: Бот готов к работе');
            console.log(`\n📱 Бот запущен! Найдите его в Telegram и отправьте /start\n`);
            return Promise.resolve();
        },
        // onError
        async (error: any) => {
            console.log('❌ [Test] onError:', error?.message || error);
            return Promise.resolve();
        }
    );

    console.log('\n📊 Статус до инициализации:', bot.getStatus());
    console.log('\n📊 Возможности платформы:');
    console.log(`   └─ Редактирование: ${bot.capabilities.canEdit ? '✅' : '❌'}`);
    console.log(`   └─ Удаление: ${bot.capabilities.canDelete ? '✅' : '❌'}`);
    console.log(`   └─ Закрепление: ${bot.capabilities.canPin ? '✅' : '❌'}`);
    console.log(`   └─ Лимит редактирования: ${bot.capabilities.editTimeLimit}ms`);
    console.log(`   └─ Макс. длина: ${bot.capabilities.maxMessageLength}`);

    const shutdown = async () => {
        console.log('\n\n🛑 Получен сигнал завершения, останавливаем бота...');
        await bot.stop();
        console.log('👋 Бот остановлен');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
        await bot.init();

        setInterval(() => {
            const status = bot.getStatus();
            console.log(`\n📊 [${new Date().toLocaleTimeString()}] Статус:`, status);
        }, 30000);

    } catch (error) {
        console.log('❌ [Test] Ошибка при запуске:', error);
    }
}

// ==================== ТЕСТ С ПРОВЕРКОЙ ТОКЕНА ====================

/**
 * Тест для проверки токена без запуска бота
 */
export async function testTokenOnly() {
    console.log('\n🧪 Проверка токена...\n');

    const token = "REDACTED-TELEGRAM-TOKEN";

    try {
        const bot = new TelegramBotPollingAdaptor(
            "test_token",
            token,
            async () => { return Promise.resolve(); },
            async () => { return Promise.resolve(); },
            async () => { return Promise.resolve(); },
            async () => { return Promise.resolve(); },
            async () => { return Promise.resolve(); }
        );

        // Вызываем validateToken через init
        await bot.init();

    } catch (error: any) {
        if (error.error_code === 401) {
            console.error('❌ Токен недействителен!');
        } else {
            console.error('❌ Другая ошибка:', error);
        }
    }
}

// ==================== ЗАПУСК ====================

if (require.main === module) {
    console.log('🚀 Запуск Telegram адаптера в тестовом режиме');

    // Раскомментируйте нужный тест:
    testTelegramAdapter().catch(error => {
        console.error('❌ Необработанная ошибка в тесте:', error);
        process.exit(1);
    });

    // Для проверки токена:
    // testTokenOnly().catch(console.error);
}

export { testTelegramAdapter };