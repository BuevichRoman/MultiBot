import { WhatsappWebPollingAdaptor } from '../WhatsappWebPollingAdaptor/WhatsappWebPollingAdaptor';
import { TelegramBotPollingAdaptor } from '../TelegramBotPollingAdaptor/TelegramBotPollingAdaptor';
import { Message } from '../Message';
import { AnyMessage, IMessageAdapter } from "../types";

// ==================== КОНФИГУРАЦИЯ ====================

const config = {
    whatsapp: {
        botId: "my_whatsapp_bot",
        sessionDir: "./sessions",
    },
    telegram: {
        botId: "my_telegram_bot",
        // 🔥 ВАЖНО: Получите свой токен у @BotFather в Telegram
        token: "7806336871:AAH8NV7D32IcD97whIoStEHowKMzl9JcHyU", // ЗАМЕНИТЕ НА СВОЙ!
    }
};

// ==================== СОЗДАНИЕ БОТОВ ====================

/**
 * Создает экземпляр WhatsApp бота
 */
function createWhatsAppBot() {
    return new WhatsappWebPollingAdaptor(
        config.whatsapp.botId,
        config.whatsapp.sessionDir,
        // onStart
        async () => {
            console.log('🟢 WhatsApp: Запуск...');
        },
        // onStop
        async () => {
            console.log('🔴 WhatsApp: Остановка...');
        },
        // onMessage - будет установлен позже
        async () => {},
        // onReady
        async () => {
            console.log('✅ WhatsApp: Бот готов!');
        },
        // onSessionCancel
        async (reason) => {
            console.log('⚠️ WhatsApp: Сессия закрыта:', reason);
        },
        // onError
        async (error) => {
            console.error('❌ WhatsApp: Ошибка:', error);
        },
        // onQr (опционально)
        async (qr) => {
            console.log('\n📱 WhatsApp: Отсканируйте QR-код:\n');
            console.log(qr);
            console.log('\n');
        }
    );
}

/**
 * Создает экземпляр Telegram бота
 */
function createTelegramBot() {
    return new TelegramBotPollingAdaptor(
        config.telegram.botId,
        config.telegram.token,
        // onStart
        async () => {
            console.log('🟢 Telegram: Запуск...');
        },
        // onStop
        async () => {
            console.log('🔴 Telegram: Остановка...');
        },
        // onMessage - будет установлен позже
        async () => {},
        // onReady
        async () => {
            console.log('✅ Telegram: Бот готов!');
        },
        // onError
        async (error) => {
            console.error('❌ Telegram: Ошибка:', error);
        }
    );
}

// ==================== ЕДИНЫЙ ОБРАБОТЧИК ====================

/**
 * Универсальный обработчик сообщений для всех платформ
 */
async function handleMessage(anyMessage: AnyMessage, adapter: IMessageAdapter) {
    try {
        // Создаем объект Message с методами
        let msg: Message;

        if (anyMessage.type === 'text') {
            msg = Message.createText(
                adapter,
                anyMessage.id,
                anyMessage.chatId,
                anyMessage.from,
                anyMessage.timestamp,
                (anyMessage as any).text
            );
            console.log(`📝 [${adapter.getPlatform()}] Текст: ${msg.getText()}`);
        }
        else if (anyMessage.type === 'location') {
            const loc = (anyMessage as any).location;
            msg = Message.createLocation(
                adapter,
                anyMessage.id,
                anyMessage.chatId,
                anyMessage.from,
                anyMessage.timestamp,
                loc.latitude,
                loc.longitude,
                loc.live
            );
            console.log(`📍 [${adapter.getPlatform()}] Локация: ${loc.latitude}, ${loc.longitude}`);
        }
        else {
            msg = Message.createUnsupported(
                adapter,
                anyMessage.id,
                anyMessage.chatId,
                anyMessage.from,
                anyMessage.timestamp,
                (anyMessage as any).reason || 'unknown'
            );
            console.log(`❓ [${adapter.getPlatform()}] Неподдерживаемый тип: ${msg.getUnsupportedReason()}`);
        }

        // Обрабатываем текстовые сообщения
        if (msg.isText()) {
            const text = msg.getText().toLowerCase().trim();

            // Команда /start
            if (text === '/start') {
                await msg.sendTyping(); // Показываем "печатает"
                await new Promise(r => setTimeout(r, 1000)); // Пауза для реализма

                await msg.reply(
                    '👋 Привет! Я универсальный бот.\n\n' +
                    'Доступные команды:\n' +
                    '/help - помощь\n' +
                    '/ping - проверка связи\n' +
                    '/info - информация о боте\n' +
                    '/caps - возможности платформы'
                );
            }

            // Команда /help
            else if (text === '/help') {
                await msg.reply(
                    '📚 Помощь:\n' +
                    '• Отправьте любой текст - я отвечу эхом\n' +
                    '• Отправьте геолокацию - я покажу координаты\n' +
                    '• /ping - проверка связи\n' +
                    '• /info - информация о боте\n' +
                    '• /caps - что умеет эта платформа'
                );
            }

            // Команда /ping
            else if (text === '/ping') {
                const start = Date.now();
                const reply = await msg.reply('🏓 Понг...');
                const latency = Date.now() - start;
                await reply.edit(`🏓 Понг! Задержка: ${latency}ms`);
            }

            // Команда /info
            else if (text === '/info') {
                await msg.reply(
                    `🤖 Информация:\n` +
                    `• Платформа: ${adapter.getPlatform()}\n` +
                    `• ID чата: ${msg.chatId}\n` +
                    `• Ваш ID: ${msg.from.id}\n` +
                    `• Имя: ${msg.from.firstName || 'не указано'} ${msg.from.lastName || ''}`.trim()
                );
            }

            // Команда /caps - показать возможности платформы
            else if (text === '/caps') {
                const caps = adapter.capabilities;
                await msg.reply(
                    `📊 Возможности ${adapter.getPlatform()}:\n` +
                    `• Редактирование: ${caps.canEdit ? '✅' : '❌'}\n` +
                    `• Удаление: ${caps.canDelete ? '✅' : '❌'}\n` +
                    `• Закрепление: ${caps.canPin ? '✅' : '❌'}\n` +
                    `• Макс. длина: ${caps.maxMessageLength}\n` +
                    `• Markdown: ${caps.supportsMarkdown ? '✅' : '❌'}\n` +
                    `• HTML: ${caps.supportsHTML ? '✅' : '❌'}`
                );
            }

            // Тест редактирования (если поддерживается)
            else if (text === '/test_edit' && adapter.capabilities.canEdit) {
                const sent = await msg.reply('⏳ Это сообщение будет отредактировано...');

                setTimeout(async () => {
                    const success = await sent.edit('✅ Сообщение отредактировано!');
                    if (success) {
                        console.log('✅ Редактирование успешно');
                    }
                }, 3000);
            }

            // Тест удаления (если поддерживается)
            else if (text === '/test_delete' && adapter.capabilities.canDelete) {
                const sent = await msg.reply('⏳ Это сообщение будет удалено...');

                setTimeout(async () => {
                    const success = await sent.delete(true);
                    if (success) {
                        console.log('✅ Удаление успешно');
                        await msg.reply('✅ Сообщение удалено!');
                    }
                }, 3000);
            }

            // Эхо для всех остальных сообщений
            else if (!text.startsWith('/')) {
                await msg.sendTyping();
                await new Promise(r => setTimeout(r, 500)); // Маленькая пауза

                // Используем разные ответы для разнообразия
                const responses = [
                    `Эхо: ${msg.getText()}`,
                    `Вы написали: ${msg.getText()}`,
                    `Получил: ${msg.getText()}`,
                    `👂 ${msg.getText()}`
                ];
                const randomResponse = responses[Math.floor(Math.random() * responses.length)];
                await msg.reply(randomResponse);
            }
        }

        // Обрабатываем локации
        else if (msg.isLocation()) {
            const loc = msg.getLocation();
            await msg.reply(
                `📍 Получил вашу локацию!\n` +
                `Координаты: ${loc.latitude}, ${loc.longitude}\n` +
                `Трансляция: ${loc.live ? 'да' : 'нет'}`
            );

            // Отвечаем локацией (например, Москва)
            if (!loc.live) {
                await msg.replyWithLocation("55.7558", "37.6173");
            }
        }

        // Неподдерживаемые типы
        else {
            await msg.reply(
                `❌ Извините, я пока не умею обрабатывать этот тип сообщений.\n` +
                `Причина: ${msg.getUnsupportedReason()}`
            );
        }

    } catch (error) {
        console.error('❌ Ошибка в обработчике:', error);
    }
}

// ==================== ЗАПУСК ====================

async function startBots() {
    console.log('🚀 Запуск ботов...\n');

    // Создаем ботов
    //const whatsapp = createWhatsAppBot();
    const telegram = createTelegramBot();

    // Подключаем обработчики
    //whatsapp.on('message', (m) => handleMessage(m, whatsapp));
    telegram.on('message', (m) => handleMessage(m, telegram));

    // Добавляем обработчики ошибок
    //whatsapp.on('error', (error) => console.error('WhatsApp error:', error));
    telegram.on('error', (error) => console.error('Telegram error:', error));

    try {
        // Запускаем ботов параллельно
        await Promise.all([
            //whatsapp.init(),
            telegram.init()
        ]);

        console.log('\n✅ Все боты успешно запущены!\n');
        console.log('📱 WhatsApp: ожидайте QR-код для сканирования');
        console.log('📱 Telegram: найдите своего бота и отправьте /start\n');

        // Выводим статус каждые 30 секунд
        setInterval(() => {
            console.log(`\n📊 [${new Date().toLocaleTimeString()}] Статус:`);
            //console.log(`   WhatsApp: ${whatsapp.getStatus().ready ? '✅' : '❌'}`);
            console.log(`   Telegram: ${telegram.getStatus().ready ? '✅' : '❌'}`);
        }, 30000);

    } catch (error) {
        console.error('❌ Ошибка при запуске ботов:', error);
        process.exit(1);
    }

    // Обработка завершения
    const shutdown = async () => {
        console.log('\n\n🛑 Получен сигнал завершения, останавливаем ботов...');
        await Promise.all([
            //whatsapp.stop(),
            telegram.stop()
        ]);
        console.log('👋 Все боты остановлены');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// ==================== ТЕСТОВЫЙ РЕЖИМ ====================

/**
 * Запуск только Telegram для тестирования
 */
async function testTelegramOnly() {
    console.log('🧪 Тестовый режим: только Telegram\n');

    const telegram = createTelegramBot();
    telegram.on('message', (m) => handleMessage(m, telegram));

    await telegram.init();
    console.log('✅ Telegram бот запущен в тестовом режиме');
}

/**
 * Запуск только WhatsApp для тестирования
 */
async function testWhatsAppOnly() {
    console.log('🧪 Тестовый режим: только WhatsApp\n');

    const whatsapp = createWhatsAppBot();
    whatsapp.on('message', (m) => handleMessage(m, whatsapp));

    await whatsapp.init();
    console.log('✅ WhatsApp бот запущен в тестовом режиме');
}

// ==================== ВЫБОР РЕЖИМА ====================

// Раскомментируйте нужный режим:
startBots();                    // Запуск обоих ботов
// testTelegramOnly();          // Только Telegram
// testWhatsAppOnly();          // Только WhatsApp

// Экспортируем для использования в других файлах
export { startBots, testTelegramOnly, testWhatsAppOnly };