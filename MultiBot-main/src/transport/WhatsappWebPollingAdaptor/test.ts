import { WhatsappWebPollingAdaptor } from './WhatsappWebPollingAdaptor';
import {
    AnyMessage,
    isTextMessage,
    isLocationMessage,
    PlatformIcons
} from '../types';
import { Message } from '../Message';

// ==================== ТЕСТ ====================

/**
 * Тестовая функция для проверки адаптера WhatsApp
 */
async function testWhatsAppAdapter() {
    console.log('\n🧪 Запуск теста WhatsApp адаптера...\n');

    // Создаем адаптер
    const bot = new WhatsappWebPollingAdaptor(
        "test_bot_1",
        "./sessions",
        // onStart
        async () => {
            console.log('✅ [Test] onStart: Бот запускается');
        },
        // onStop
        async () => {
            console.log('✅ [Test] onStop: Бот останавливается');
        },
        // onMessage - ОСНОВНОЙ ОБРАБОТЧИК
        async (anyMessage: AnyMessage) => {
            // Оборачиваем AnyMessage в наш класс Message для получения методов
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
                anyMessage.type === 'text' ? { text: anyMessage.text } :
                    anyMessage.type === 'location' ? { location: anyMessage.location } :
                        { reason: anyMessage.reason }
            );

            console.log(`\n📨 [Test] Получено сообщение:`);
            console.log(`   └─ Платформа: ${message.platform}`);
            console.log(`   └─ От: ${message.from.id} (${message.from.firstName || 'без имени'})`);
            console.log(`   └─ Чат: ${message.chatId}`);
            console.log(`   └─ Тип: ${message.getType()}`);

            // Обработка разных типов сообщений
            if (message.isText()) {
                const text = message.getText();
                console.log(`   └─ Текст: "${text}"`);

                // Тест 1: Ответ на сообщение
                if (text === '/start') {
                    console.log(`   └─ 🤖 Отвечаю на /start`);
                    const reply = await message.reply('Привет! Я тестовый бот. Доступные команды:\n/edit - тест редактирования\n/delete - тест удаления\n/location - тест локации');
                    console.log(`   └─ 🤖 Ответ отправлен: ${reply.id}`);
                }

                // Тест 2: Редактирование сообщения
                else if (text === '/edit') {
                    console.log(`   └─ 🤖 Тест редактирования`);
                    const sent = await message.reply('Это сообщение будет отредактировано через 3 секунды...');
                    console.log(`   └─ 🤖 Сообщение отправлено: ${sent.id}`);

                    setTimeout(async () => {
                        const success = await sent.edit('✨ Сообщение успешно отредактировано!');
                        console.log(`   └─ 🤖 Редактирование ${success ? 'успешно' : 'не удалось'}`);
                    }, 3000);
                }

                // Тест 3: Удаление сообщения
                else if (text === '/delete') {
                    console.log(`   └─ 🤖 Тест удаления`);
                    const sent = await message.reply('Это сообщение будет удалено через 3 секунды...');
                    console.log(`   └─ 🤖 Сообщение отправлено: ${sent.id}`);

                    setTimeout(async () => {
                        const success = await sent.delete(true);
                        console.log(`   └─ 🤖 Удаление ${success ? 'успешно' : 'не удалось'}`);
                    }, 3000);
                }

                // Тест 4: Обычный эхо-ответ
                else {
                    const reply = await message.reply(`Эхо: ${text}`);
                    console.log(`   └─ 🤖 Эхо отправлено: ${reply.id}`);
                }
            }

            else if (message.isLocation()) {
                const location = message.getLocation();
                console.log(`   └─ Координаты: ${location.latitude}, ${location.longitude}`);
                console.log(`   └─ Live: ${location.live ? 'да' : 'нет'}`);

                const reply = await message.reply(`Получил вашу локацию: ${location.latitude}, ${location.longitude}`);
                console.log(`   └─ 🤖 Ответ отправлен: ${reply.id}`);

                // Ответить локацией (тест)
                if (location.live) {
                    const locationReply = await message.replyWithLocation("40.4168", "-3.7038");
                    console.log(`   └─ 🤖 Локация отправлена: ${locationReply.id}`);
                }
            }

            else {
                const reason = message.getUnsupportedReason();
                console.log(`   └─ Причина: ${reason}`);
                const reply = await message.reply(`Извините, я пока не умею обрабатывать этот тип сообщений (${reason})`);
                console.log(`   └─ 🤖 Ответ отправлен: ${reply.id}`);
            }
        },
        // onReady
        async () => {
            console.log('✅ [Test] onReady: Бот готов к работе');
            console.log('\n📱 Отсканируйте QR-код в приложении WhatsApp\n');
        },
        // onSessionCancel
        async (reason) => {
            console.log('❌ [Test] onSessionCancel: Сессия прервана', reason);
        },
        // onError
        async (error) => {
            console.log('❌ [Test] onError:', error.message);
        },
        // onQr (опционально)
        async (qr: string) => {
            console.log('\n🔐 [Test] onQr: Новый QR-код получен');
            console.log('   └─ Отсканируйте этот QR-код в WhatsApp:');

            // Выводим QR в консоль
            console.log('\n' + qr + '\n');
        }
    );

    // Проверка статуса
    console.log('\n📊 Статус до инициализации:', bot.getStatus());

    // Проверка возможностей
    console.log('\n📊 Возможности платформы:');
    console.log(`   └─ Редактирование: ${bot.capabilities.canEdit ? '✅' : '❌'}`);
    console.log(`   └─ Удаление: ${bot.capabilities.canDelete ? '✅' : '❌'}`);
    console.log(`   └─ Закрепление: ${bot.capabilities.canPin ? '✅' : '❌'}`);
    console.log(`   └─ Лимит редактирования: ${bot.capabilities.editTimeLimit}ms`);
    console.log(`   └─ Макс. длина: ${bot.capabilities.maxMessageLength}`);

    // Обработка сигналов завершения
    const shutdown = async () => {
        console.log('\n\n🛑 Получен сигнал завершения, останавливаем бота...');
        await bot.stop();
        console.log('👋 Бот остановлен');
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Запуск
    try {
        await bot.init();

        // Периодическая проверка статуса
        setInterval(() => {
            const status = bot.getStatus();
            console.log(`\n📊 [${new Date().toLocaleTimeString()}] Статус:`, status);
        }, 30000); // Каждые 30 секунд

    } catch (error) {
        console.log('❌ [Test] Ошибка при запуске:', error);
    }
}

// ==================== УПРОЩЕННЫЙ ТЕСТ ====================

/**
 * Упрощенный тест без класса Message
 */
export async function quickTest() {
    console.log('🚀 Быстрый тест WhatsApp адаптера...');

    const bot = new WhatsappWebPollingAdaptor(
        "quick_test",
        "./sessions",
        () => Promise.resolve(),
        () => Promise.resolve(),
        async (message: AnyMessage) => {
            console.log(`📨 Сообщение: ${message.type}`);

            if (isTextMessage(message)) {
                console.log(`   Текст: ${message.text}`);
                // В быстром тесте используем sendMessage напрямую
                await bot.sendMessage(message.chatId, `Получил: ${message.text}`);
            } else if (isLocationMessage(message)) {
                console.log(`   Локация: ${message.location.latitude}, ${message.location.longitude}`);
                await bot.sendMessage(message.chatId, 'Локация получена!');
            } else {
                console.log(`   Неподдерживаемо: ${message.reason}`);
            }
        },
        async () => {
            console.log('✅ Бот готов!');
        },
        async (reason) => {
            console.log('❌ Отключен:', reason);
        },
        async (error) => {
            console.log('❌ Ошибка:', error);
        }
    );

    await bot.init();
}

// ==================== ЗАПУСК ====================

// Автоматический запуск теста, если файл выполняется напрямую
if (require.main === module) {
    console.log('🚀 Запуск WhatsApp адаптера в тестовом режиме');
    console.log('   └─ Убедитесь, что папка ./sessions существует и доступна для записи');

    // Раскомментируйте нужный тест:
    testWhatsAppAdapter().catch(error => {
        console.error('❌ Необработанная ошибка в тесте:', error);
        process.exit(1);
    });

    // Для быстрого теста:
    // quickTest().catch(console.error);
}

// Экспортируем тестовые функции
export { testWhatsAppAdapter };