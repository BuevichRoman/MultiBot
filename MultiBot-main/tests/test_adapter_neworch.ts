// test.ts

import path from 'path';
import assert from 'assert';
import {Orchestrator} from '../src/newManagers/orchestrator/Orchestrator'; // новый
import type { RootConfig } from '../src/newManagers/orchestrator/types'; // только тип
import Engine from '../src/engine';
import { localizationNames } from '../src/l10n'
import { MegaLogger } from '../src/addons/logger';
import { makeChildrenHandler } from '../src/engine/handlers/children';
import {IMessageAdapter} from "../src/transport";
import {APIManager} from "../src/newManagers/api/APIManager";
import { formatString } from '../src/engine/utils/formatString';
import {
    calculateOrderPriceChildren,
    formatOrderConfirmationChildren,
} from '../src/engine/children/order/orderConfirmation';

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }
process.env.DRIVER_SEARCH_LOG = '1';
process.env.WHATSAPP_DEBUG = '1';
async function runTest() {
    const config: RootConfig = {
        api: {
            'default-api': {
                url: 'https://ibronevik.ru/taxi/c/children/api/v1/',
                adminCredentials: { login: 'redacted@example.invalid', password: 'REDACTED-ADMIN-PASSWORD', type: 'e-mail' },
                adminAuthFile: 'data/default-api.json'
            }
        },
        tenantOverrides: {
            children: { testRefCode: '666' }
        },
        bots: {
            'test-adapter-bot': {
                api: 'default-api',
                transport: { type: 'test' },
                core: { name: 'children' }
            },
            'test-bot': {
                api: 'default-api',
                transport: {
                    type: 'telegram-bot-polling',
                    token: 'REDACTED-TELEGRAM-TOKEN'
                },
                core: { name: 'children' }
            },
            /** WhatsApp Web: сессия в отдельной папке; init идёт в фоне в Orchestrator.start() */
            'test-whatsapp-bot': {
                api: 'default-api',
                transport: {
                    type: 'whatsapp-web-polling',
                    sessionDir: path.join(process.cwd(), 'data', 'wwebjs_test_adapter_neworch'),
                },
                core: { name: 'children' }
            },
        }
    };

    const logger = new MegaLogger({ serviceName: 'TestBOTA' });
    const engine = new Engine({ redis: { host: '127.0.0.1', port: 6379, password: 'REDACTED-REDIS-PASSWORD' } });

    // Очистка Redis
    const IORedis = require('ioredis');
    const redis = new IORedis({ host: '127.0.0.1', port: 6379, password: 'REDACTED-REDIS-PASSWORD' });
    try {
        const keys = await redis.keys('engine:*:state:*');
        const keys2 = await redis.keys('engine:*:stateData:*');
        const all = Array.from(new Set([...(keys||[]), ...(keys2||[])]));
        if (all.length > 0) {
            await redis.del(...all);
        }
    } catch (e) {
        logger.warn(`Failed to clear engine keys in Redis:${e}`);
    } finally {
        try { await redis.quit(); } catch {}
    }

    // Создаем оркестратор
    const orchestrator = new Orchestrator({
        configSource: config,
        handlers: {}, // пустые handlers
        autoStart: false,
        skipApiLogin: false,
        engine: engine
    });

    // Регистрируем фабрику хендлеров (одну для всех тенантов)
    await orchestrator.registerTenantHandler('children', (orch, eng, apiManager) => {
        const handlerFn = makeChildrenHandler(orch, eng, apiManager);
        return async (ctx: any) => {
            await handlerFn(ctx);
        };
    });

    // Запускаем оркестратор (Telegram / Test / WhatsApp — init в фоне где применимо)
    await orchestrator.start();

    const waAdapter = orchestrator.getAdapter('test-whatsapp-bot');
    assert(waAdapter, 'WhatsApp adapter should be created');
    logger.info(`[test] WhatsApp adapter started: ${(waAdapter as { constructor?: { name?: string } })?.constructor?.name ?? 'unknown'}`);

    // Получаем адаптер и API менеджер для тестов
    const adapter = orchestrator.getAdapter('test-adapter-bot') as any;
    assert(adapter, 'Test adapter should be created');

    const apiMgr = orchestrator.getApiManagerForBot('test-adapter-bot');
    assert(apiMgr, 'API manager should be available');

    // Загружаем данные API если нужно
    if (apiMgr.api_data_manager && !apiMgr.api_data_manager.isLoaded) {
        await apiMgr.api_data_manager.load();
    }

    //await run_tests_registration(orchestrator,adapter,apiMgr,logger);
    //await run_tests_main(orchestrator,adapter,apiMgr,logger)


}

runTest().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});

async function run_tests_registration(orchestrator:Orchestrator,
                         adapter: any,
                         apiMgr: APIManager,
                         logger: MegaLogger,
){
    // capture sent messages sequence from TestAdapter
    const sentEvents: any[] = [];
    //await waitForMessages(2);
    if (typeof adapter.on === 'function') adapter.on('sent', (r: any) => sentEvents.push(r));

    // Вспомогательные функции
    async function waitForMessages(count: number, timeoutMs = 5000): Promise<void> {
        const startMs = Date.now();

        while (sentEvents.length < count && (Date.now() - startMs) < timeoutMs) {
            await delay(10);
        }

        if (sentEvents.length < count) {
            console.log(sentEvents[0])
            throw new Error(`Expected ${count} messages, got ${sentEvents.length}`);
        }
    }

    async function expectMessage(index: number, expectedKey: string, lang: string) {
        if (!apiMgr) throw new Error('apiMgr is undefined');
        const expected = await apiMgr.api_data_manager.getLangValueItem(expectedKey, lang);
        assert.strictEqual(
            sentEvents[index]?.finalText,
            expected,
            `❌ Message ${index}: expected "${expected}", got "${sentEvents[index]?.finalText}"`
        );
        logger.info(`✅ ${index + 1} PASSED: "${expected.substring(0, 50)}..."`);
    }

    async function expectMessageText(index: number, expected: string, waitTimeoutMs = 500) {
        const startMs = Date.now();
        while (sentEvents.length <= index && (Date.now() - startMs) < waitTimeoutMs) {
            await delay(10);
        }
        assert.strictEqual(
            sentEvents[index]?.finalText,
            expected,
            `❌ Message ${index}: expected "${expected}", got "${sentEvents[index]?.finalText}"`
        );
        logger.info(`✅ ${index + 1} PASSED: "${expected.substring(0, 50)}..."`);
    }

    async function sendAndExpect(msg: any, expectedKey: string, lang: string, stepName: string) {
        if (!apiMgr) throw new Error('apiMgr is undefined');

        const beforeCount = sentEvents.length;
        logger.debug(`📤 Sending: "${msg.text || msg.location}"`);

        adapter.receiveMessage(msg).catch((e:string) => {
            if (adapter.handlers?.error) adapter.handlers.error(e);
        });
        await waitForMessages(beforeCount + 1);

        const expected = await apiMgr.api_data_manager.getLangValueItem(expectedKey, lang);
        assert.strictEqual(
            sentEvents[beforeCount]?.finalText,
            expected,
            `❌ ${stepName}: expected "${expected}", got "${sentEvents[beforeCount]?.finalText}"`
        );
        logger.info(`✅ ${stepName} PASSED`);
    }

    async function sendAndExpectText(msg: any, expectedText: string, stepName: string) {
        const beforeCount = sentEvents.length;
        logger.debug(`📤 Sending: "${msg.text}"`);

        adapter.receiveMessage(msg).catch((e:string) => logger.error(e));

        await waitForMessages(beforeCount + 1);

        assert.strictEqual(
            sentEvents[beforeCount]?.finalText,
            expectedText,
            `❌ ${stepName}: expected "${expectedText}", got "${sentEvents[beforeCount]?.finalText}"`
        );
        logger.info(`✅ ${stepName} PASSED`);
    }

    async function getBotLegalDocs(name: 'public_offer'|'privacy_policy'|'legal_information', lang: string){
        if (!apiMgr) throw new Error('apiMgr is undefined');

        function getValueSafe(obj: any, path: string, defaultValue = undefined) {
            try {
                return path.split('.').reduce((acc, key) => acc?.[key], obj) ?? defaultValue;
            } catch {
                return defaultValue;
            }
        }
        const path = 'data.site_constants.bot_legal_docs.value.'+name
        if(!getValueSafe(apiMgr.api_data_manager.data,path)){ throw 'Can\'t find bot_legal_doc'}
        const bot_legal_docs = getValueSafe(apiMgr.api_data_manager.data,path)
        let texts: string[] = []

        let max_version = 0;
        for(let i of bot_legal_docs.content) {
            if(Number(i.version) > max_version) {
                max_version = Number(i.version)
            }
        }
        const max_version_block = bot_legal_docs.content
            .find((x:{version:number,parts:[{[key:string]:string}]}) => Number(x.version)===max_version)?.parts

        if(max_version_block){
            texts = max_version_block.map((x : {[key:string]:string}) => x[lang])
        }
        return texts
    }

    // Тест

    // 1) user sends first message
    const msg1 = {
        id: Date.now().toString(),
        chatId: 'chat-2',
        from: { id: 'user-11' },
        timestamp: Date.now(),
        platform: 'test',
        type: 'text',
        text: '/start'
    };
    await adapter.receiveMessage(msg1);
    await waitForMessages(2);

    await expectMessage(0, localizationNames.selectLanguage, '2');
    await expectMessage(1, localizationNames.languagesList, '1');

    sentEvents.length = 0;



    // Язык - неверный выбор
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '7' },
        localizationNames.commandNotFound,
        '1',
        'Language selection'
    );
    sentEvents.length = 0;

    // Язык - верный выбор
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '8' },
        localizationNames.welcome,
        '1',
        'Language selection'
    );

    sentEvents.length = 0;

    // Проверка ошибки
    await sendAndExpect(
        { ...msg1, id: (Date.now()+2).toString(), text: '3' },
        localizationNames.commandNotFound,
        '1',
        'Language error check'
    );

    sentEvents.length = 0;

    // Публичная оферта
    const publicOffer = await getBotLegalDocs('public_offer','1');
    await sendAndExpectText(
        { ...msg1, id: (Date.now()+3).toString(), text: '1' },
        publicOffer[0],
        'Public offer'
    );
    await expectMessageText(1, publicOffer[1]);
    await expectMessageText(2, publicOffer[2]);
    await expectMessageText(3, publicOffer[3]);
    await expectMessageText(4, publicOffer[4]);


    sentEvents.length = 0;

    // Ошибка в оферте
    await sendAndExpect(
        { ...msg1, id: (Date.now()+4).toString(), text: '3' },
        localizationNames.commandNotFound,
        '1',
        'Public offer error check'
    );

    sentEvents.length = 0;

    // Отказ от оферты
    await sendAndExpect(
        { ...msg1, id: (Date.now()+5).toString(), text: '2' },
        localizationNames.docsDeclinedCanNotUseRegistration,
        '1',
        'Public offer decline check'
    );

    sentEvents.length = 0;

    // Политика конфиденциальности
    const privacyPolicy = await getBotLegalDocs('privacy_policy','1');
    await sendAndExpectText(
        { ...msg1, id: (Date.now()+6).toString(), text: '1' },
        privacyPolicy[0],
        'Privacy policy'
    );

    await expectMessageText(1, privacyPolicy[1]);
    await expectMessageText(2, privacyPolicy[2]);
    await expectMessageText(3, privacyPolicy[3]);

    sentEvents.length = 0;

    // Ошибка в политике
    await sendAndExpect(
        { ...msg1, id: (Date.now()+7).toString(), text: '3' },
        localizationNames.commandNotFound,
        '1',
        'Privacy policy error check'
    );

    sentEvents.length = 0;

    // Отказ от политики
    await sendAndExpect(
        { ...msg1, id: (Date.now()+8).toString(), text: '2' },
        localizationNames.docsDeclinedCanNotUseRegistration,
        '1',
        'Privacy policy decline check'
    );

    sentEvents.length = 0;

    // Юридическая информация
    const legalInfo = await getBotLegalDocs('legal_information','1');
    const actionText = await apiMgr.api_data_manager.getLangValueItem(localizationNames.childrenDocsActionContinueRegistration, '1');

    await sendAndExpectText(
        { ...msg1, id: (Date.now()+9).toString(), text: '1' },
        legalInfo[0],
        'Legal information'
    );
    await expectMessageText(1, legalInfo[1]);
    await expectMessageText(2, legalInfo[2]);
    await expectMessageText(3, legalInfo[3].replace('%action%', actionText), 400);

    sentEvents.length = 0;

    // Ошибка в юр.информации
    await sendAndExpect(
        { ...msg1, id: (Date.now()+10).toString(), text: '3' },
        localizationNames.commandNotFound,
        '1',
        'Legal information error check'
    );

    sentEvents.length = 0;

    // Отказ от юр.информации
    await sendAndExpect(
        { ...msg1, id: (Date.now()+11).toString(), text: '2' },
        localizationNames.docsDeclinedCanNotUseRegistration,
        '1',
        'Legal information decline check'
    );

    sentEvents.length = 0;

    // Запрос ФИО
    await sendAndExpect(
        { ...msg1, id: (Date.now()+12).toString(), text: '1' },
        localizationNames.enterFirstNameLastNameAndBirthYear,
        '1',
        'Full name prompt'
    );

    sentEvents.length = 0;

    // ФИО - неверный год
    await sendAndExpect(
        { ...msg1, id: (Date.now()+13).toString(), text: 'John Doe 2026' },
        localizationNames.enterFirstNameLastNameAndBirthYearError,
        '1',
        'Full name incorrect year'
    );

    sentEvents.length = 0;

    // ФИО - неверный формат
    await sendAndExpect(
        { ...msg1, id: (Date.now()+13).toString(), text: 'Jodsgfdgsdgsd' },
        localizationNames.enterFirstNameLastNameAndBirthYearError,
        '1',
        'Full name incorrect value'
    );

    sentEvents.length = 0;

    // ФИО - верный ввод
    await sendAndExpect(
        { ...msg1, id: (Date.now()+14).toString(), text: 'John Doe 1990' },
        localizationNames.enterPhoneNumber,
        '1',
        'Full name input'
    );

    sentEvents.length = 0;

    // Телефон
    await sendAndExpect(
        { ...msg1, id: (Date.now()+15).toString(), text: '+1234567890' },
        localizationNames.enterCity,
        '1',
        'Phone input'
    );

    sentEvents.length = 0;



    // Город - завершение
    await sendAndExpect(
        { ...msg1, id: (Date.now()+16).toString(), text: 'Malaga' },
        localizationNames.registrationSuccessful,
        '1',
        'City input'
    );


    logger.success('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!');
}

async function run_tests_main(orchestrator:Orchestrator,
                              adapter: any,
                              apiMgr: APIManager,
                              logger: MegaLogger) {
    const sentEvents: any[] = [];
    //await waitForMessages(2);
    if (typeof adapter.on === 'function') adapter.on('sent', (r: any) => sentEvents.push(r));

    // Вспомогательные функции
    async function waitForMessages(count: number, timeoutMs = 5000): Promise<void> {
        const startMs = Date.now();

        while (sentEvents.length < count && (Date.now() - startMs) < timeoutMs) {
            await delay(10);
        }

        if (sentEvents.length < count) {
            console.log(sentEvents[0])
            throw new Error(`Expected ${count} messages, got ${sentEvents.length}`);
        }
    }

    async function expectMessage(index: number, expectedKey: string, lang: string) {
        if (!apiMgr) throw new Error('apiMgr is undefined');
        const expected = await apiMgr.api_data_manager.getLangValueItem(expectedKey, lang);
        assert.strictEqual(
            sentEvents[index]?.finalText,
            expected,
            `❌ Message ${index}: expected "${expected}", got "${sentEvents[index]?.finalText}"`
        );
        logger.info(`✅ ${index + 1} PASSED: "${expected.substring(0, 50)}..."`);
    }

    async function expectMessageText(index: number, expected: string, waitTimeoutMs = 500) {
        const startMs = Date.now();
        while (sentEvents.length <= index && (Date.now() - startMs) < waitTimeoutMs) {
            await delay(10);
        }
        assert.strictEqual(
            sentEvents[index]?.finalText,
            expected,
            `❌ Message ${index}: expected "${expected}", got "${sentEvents[index]?.finalText}"`
        );
        logger.info(`✅ ${index + 1} PASSED: "${expected.substring(0, 50)}..."`);
    }

    async function sendAndExpect(
        msg: any,
        expectedKey: string,
        lang: string,
        stepName: string,
        placeholders?: Record<string, string>
    ) {
        if (!apiMgr) throw new Error('apiMgr is undefined');

        const beforeCount = sentEvents.length;
        logger.debug(`📤 Sending: "${msg.text || JSON.stringify(msg.location)}"`);

        adapter.receiveMessage(msg).catch((e:string) => {
            if (adapter.handlers?.error) adapter.handlers.error(e);
        });
        await waitForMessages(beforeCount + 1);

        let expected = await apiMgr.api_data_manager.getLangValueItem(expectedKey, lang);
        if (placeholders && Object.keys(placeholders).length > 0) {
            expected = formatString(expected, placeholders);
        }
        assert.strictEqual(
            sentEvents[beforeCount]?.finalText,
            expected,
            `❌ ${stepName}: expected "${expected}", got "${sentEvents[beforeCount]?.finalText}"`
        );
        logger.info(`✅ ${stepName} PASSED`);
    }

    /** Снимок полей заказа как в FSM `data` перед показом подтверждения (when: null = «сейчас»). */
    type OrderConfirmFormSnapshot = {
        latitude: string;
        longitude: string;
        hoursCount?: number;
        childrenCount?: number;
        childrenInfo?: string | string[];
        additionalOptions?: number[];
        when: null | Date;
    };

    async function sendAndExpectOrderConfirm(
        msg: any,
        stepName: string,
        form: OrderConfirmFormSnapshot
    ) {
        if (!apiMgr) throw new Error('apiMgr is undefined');
        const beforeCount = sentEvents.length;
        logger.debug(`📤 Sending: "${msg.text}"`);
        adapter.receiveMessage(msg).catch((e: string) => {
            if (adapter.handlers?.error) adapter.handlers.error(e);
        });
        await waitForMessages(beforeCount + 1);

        let isTestMode = false;
        try {
            const uid = String(msg.from?.id ?? msg.chatId ?? '');
            const profileRes = await apiMgr.getProfile({ u_a_tg: uid });
            if (profileRes?.status === 'success' && profileRes?.data?.user) {
                const keys = Object.keys(profileRes.data.user);
                const u = keys.length ? profileRes.data.user[keys[0]] : null;
                const testCode = orchestrator.getTenantOverrides('children')?.testRefCode ?? '666';
                isTestMode = u?.referrer_u_id === testCode;
            }
        } catch {
            /* ignore */
        }

        const fromLoc = {
            latitude: parseFloat(form.latitude),
            longitude: parseFloat(form.longitude),
        };
        const priceModel = await calculateOrderPriceChildren(
            apiMgr,
            fromLoc,
            fromLoc,
            form.additionalOptions ?? [],
            false
        );
        const fsmData: Record<string, unknown> = {
            latitude: form.latitude,
            longitude: form.longitude,
            hoursCount: form.hoursCount,
            childrenCount: form.childrenCount,
            childrenInfo: form.childrenInfo,
            additionalOptions: form.additionalOptions ?? [],
            when: form.when,
        };
        const user = { settings: { lang: { api_id: '1', iso: 'en' } } };
        const expected = await formatOrderConfirmationChildren(
            apiMgr,
            user,
            fsmData,
            priceModel,
            '1',
            isTestMode
        );
        assert.strictEqual(
            sentEvents[beforeCount]?.finalText,
            expected,
            `❌ ${stepName}: expected order confirm, got "${sentEvents[beforeCount]?.finalText}"`
        );
        logger.info(`✅ ${stepName} PASSED`);
    }

    async function sendAndExpectText(msg: any, expectedText: string, stepName: string) {
        const beforeCount = sentEvents.length;
        logger.debug(`📤 Sending: "${msg.text}"`);

        adapter.receiveMessage(msg).catch((e:string) => logger.error(e));

        await waitForMessages(beforeCount + 1);

        assert.strictEqual(
            sentEvents[beforeCount]?.finalText,
            expectedText,
            `❌ ${stepName}: expected "${expectedText}", got "${sentEvents[beforeCount]?.finalText}"`
        );
        logger.info(`✅ ${stepName} PASSED`);
    }

    async function getBotLegalDocs(name: 'public_offer'|'privacy_policy'|'legal_information', lang: string){
        if (!apiMgr) throw new Error('apiMgr is undefined');

        function getValueSafe(obj: any, path: string, defaultValue = undefined) {
            try {
                return path.split('.').reduce((acc, key) => acc?.[key], obj) ?? defaultValue;
            } catch {
                return defaultValue;
            }
        }
        const path = 'data.site_constants.bot_legal_docs.value.'+name
        if(!getValueSafe(apiMgr.api_data_manager.data,path)){ throw 'Can\'t find bot_legal_doc'}
        const bot_legal_docs = getValueSafe(apiMgr.api_data_manager.data,path)
        let texts: string[] = []

        let max_version = 0;
        for(let i of bot_legal_docs.content) {
            if(Number(i.version) > max_version) {
                max_version = Number(i.version)
            }
        }
        const max_version_block = bot_legal_docs.content
            .find((x:{version:number,parts:[{[key:string]:string}]}) => Number(x.version)===max_version)?.parts

        if(max_version_block){
            texts = max_version_block.map((x : {[key:string]:string}) => x[lang])
        }
        return texts
    }

    // Тест

    // 1) user sends first message
    const msg1 = {
        id: Date.now().toString(),
        chatId: '9638908545',
        from: { id: '9638908545' },
        timestamp: Date.now(),
        platform: 'test',
        type: 'text',
        text: '/start'
    };
    await adapter.receiveMessage(msg1);
    await waitForMessages(1);

    await expectMessage(0, localizationNames.commandNotFound, '1');


    sentEvents.length = 0;



    // Язык - неверный выбор
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '0' },
        localizationNames.enterStartPoint,
        '1',
        'To From passed'
    );
    sentEvents.length = 0;

    // Язык - верный выбор
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), location: {latitude: '2.2342',longitude: '2.43564', live: false}, text: undefined },
        localizationNames.enterHoursCount,
        '1',
        'From passed'
    );

    sentEvents.length = 0;

    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '2' },
        localizationNames.enterChildrenCount,
        '1',
        'Hours count passed'
    );

    sentEvents.length = 0;

    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '2' },
        localizationNames.childrenInfoShortedVariant,
        '1',
        'Children count passed'
    );

    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '2' },
        localizationNames.needAdditionalOptionsQuestion,
        '1',
        'Children info passed'
    );

    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '1' },
        localizationNames.selectAdditionalOptions,
        '1',
        'Show options yes -> main.options'
    );

    // main.options: "0" -> skip (без доп. опций)
    // sendAndExpect(..., placeholders?: { key: value }) — подстановка %key% в шаблон из l10n, если понадобится
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '0' },
        localizationNames.collectionWhen,
        '1',
        'Options skip (2) -> when'
    );

    // main.when: "2" или "сейчас" -> сейчас (ожидаемый текст = как у бота: formatOrderConfirmationChildren)
    sentEvents.length = 0;
    await sendAndExpectOrderConfirm(
        { ...msg1, id: (Date.now()+1).toString(), text: '2' },
        'When "2" (now) -> confirm',
        {
            latitude: '2.2342',
            longitude: '2.43564',
            hoursCount: 2,
            childrenCount: 2,
            childrenInfo: '2',
            additionalOptions: [],
            when: null,
        }
    );

    // main.confirm: "2" -> отмена
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '2' },
        localizationNames.orderCanceled,
        '1',
        'Confirm cancel (2) -> main.start'
    );
    // После отмены должно прийти sendDefaultMenu
    await expectMessage(1, localizationNames.defaultPrompt, '1');

    // --- Повторный проход до main.confirm и подтверждение ---
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+1).toString(), text: '0' },
        localizationNames.enterStartPoint,
        '1',
        'Restart order'
    );
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+2).toString(), location: { latitude: '36.7', longitude: '-4.4', live: false }, text: undefined },
        localizationNames.enterHoursCount,
        '1',
        'From location'
    );
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+3).toString(), text: '1' }, localizationNames.enterChildrenCount, '1', 'Hours');
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+4).toString(), text: '1' }, localizationNames.childrenInfoShortedVariant, '1', 'Children count');
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+5).toString(), text: 'info' }, localizationNames.needAdditionalOptionsQuestion, '1', 'Children info');
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+6).toString(), text: '2' }, localizationNames.collectionWhen, '1', 'No add options');
    sentEvents.length = 0;
    // "2" на showOptions сразу ведёт в main.when, следующий шаг — указать время ("сейчас")
    await sendAndExpectOrderConfirm(
        { ...msg1, id: (Date.now()+7).toString(), text: 'сейчас' },
        'When сейчас',
        {
            latitude: '36.7',
            longitude: '-4.4',
            hoursCount: 1,
            childrenCount: 1,
            childrenInfo: 'info',
            additionalOptions: [],
            when: null,
        }
    );
    sentEvents.length = 0;
    // confirm "1" -> main.driverSearch, send "Ищем водителей..."
    await sendAndExpect(
        { ...msg1, id: (Date.now()+8).toString(), text: '1' },
        localizationNames.searchingForDrivers,
        '1',
        'Confirm (1) -> driverSearch'
    );
    // После «Ищем…»: либо одно новое sendMessage (список нянь), либо при no_drivers ещё sendDefaultMenu.
    // Редактирование «Ищем…» в sentEvents тестового адаптера обычно не попадает, поэтому ждём +1, затем короткую паузу на второе сообщение.
    await waitForMessages(sentEvents.length + 1, 10000);
    await delay(1500);
    sentEvents.length = 0;

    // После поиска: при drivers_found — main.driverList («0» = отмена + меню, затем «0» = новый заказ).
    // При no_drivers пользователь уже в main.start — одна «0» сразу даёт запрос локации.
    sentEvents.length = 0;
    const msgZero = { ...msg1, id: (Date.now()+50).toString(), text: '0' };
    adapter.receiveMessage(msgZero).catch((e: string) => {
        if (adapter.handlers?.error) adapter.handlers.error(e);
    });
    await waitForMessages(1, 10000);
    const orderCanceledText = await apiMgr.api_data_manager.getLangValueItem(localizationNames.orderCanceled, '1');
    const enterStartText = await apiMgr.api_data_manager.getLangValueItem(localizationNames.enterStartPoint, '1');
    const firstReply = sentEvents[0]?.finalText;
    if (firstReply === orderCanceledText) {
        await waitForMessages(2, 5000);
        await expectMessage(1, localizationNames.defaultPrompt, '1');
        sentEvents.length = 0;
        await sendAndExpect(
            { ...msg1, id: (Date.now()+51).toString(), text: '0' },
            localizationNames.enterStartPoint,
            '1',
            'main.start: 0 -> new order, To from'
        );
    } else {
        assert.strictEqual(
            firstReply,
            enterStartText,
            'После поиска: либо отмена со списка нянь, либо сразу запрос точки (no_drivers → main.start)'
        );
        sentEvents.length = 0;
    }

    // --- main.options error: неверный ID ---
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+2).toString(), location: { latitude: '36.7', longitude: '-4.4', live: false }, text: undefined },
        localizationNames.enterHoursCount, '1', 'From'
    );
    sentEvents.length = 0;
    for (const [msg, key] of [
        [ '1', localizationNames.enterChildrenCount ],
        [ '1', localizationNames.childrenInfoShortedVariant ],
        [ '2', localizationNames.needAdditionalOptionsQuestion ],
        [ '1', localizationNames.selectAdditionalOptions ],
    ] as const) {
        await sendAndExpect({ ...msg1, id: (Date.now()+3).toString(), text: msg }, key, '1', `Step`);
        sentEvents.length = 0;
    }
    await sendAndExpect(
        { ...msg1, id: (Date.now()+4).toString(), text: '999' },
        localizationNames.collectionAdditionalOptionsError,
        '1',
        'Options invalid ID error'
    );
    // После 999 остаёмся в main.options. "0" → skip → main.when
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+5).toString(), text: '0' }, localizationNames.collectionWhen, '1', 'Options skip after error');
    // "2" → сейчас → main.confirm; "2" → отмена → main.start
    sentEvents.length = 0;
    await sendAndExpectOrderConfirm(
        { ...msg1, id: (Date.now()+6).toString(), text: '2' },
        'When now',
        {
            latitude: '36.7',
            longitude: '-4.4',
            hoursCount: 1,
            childrenCount: 1,
            childrenInfo: '2',
            additionalOptions: [],
            when: null,
        }
    );
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+7).toString(), text: '2' }, localizationNames.orderCanceled, '1', 'Cancel to start');

    // --- main.when error: неверный формат ---
    sentEvents.length = 0;
    await sendAndExpect({ ...msg1, id: (Date.now()+1).toString(), text: '0' }, localizationNames.enterStartPoint, '1', 'To from');
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+2).toString(), location: { latitude: '36.7', longitude: '-4.4', live: false }, text: undefined },
        localizationNames.enterHoursCount, '1', 'From'
    );
    sentEvents.length = 0;
    for (const [msg, key] of [
        [ '1', localizationNames.enterChildrenCount ],
        [ '1', localizationNames.childrenInfoShortedVariant ],
        [ '2', localizationNames.needAdditionalOptionsQuestion ],
        [ '1', localizationNames.selectAdditionalOptions ],
        [ '0', localizationNames.collectionWhen ],
    ] as const) {
        await sendAndExpect({ ...msg1, id: (Date.now()+3).toString(), text: msg }, key, '1', 'Step');
        sentEvents.length = 0;
    }
    await sendAndExpect(
        { ...msg1, id: (Date.now()+4).toString(), text: 'invalid' },
        localizationNames.getTimestampError,
        '1',
        'When invalid format error'
    );
    // --- main.confirm error: продолжаем из main.when. "2" → сейчас → main.confirm, "3" → ошибка
    sentEvents.length = 0;
    await sendAndExpectOrderConfirm(
        { ...msg1, id: (Date.now()+5).toString(), text: '2' },
        'When now -> confirm',
        {
            latitude: '36.7',
            longitude: '-4.4',
            hoursCount: 1,
            childrenCount: 1,
            childrenInfo: '2',
            additionalOptions: [],
            when: null,
        }
    );
    sentEvents.length = 0;
    await sendAndExpect(
        { ...msg1, id: (Date.now()+6).toString(), text: '3' },
        localizationNames.confirmPrompt,
        '1',
        'Confirm invalid choice error'
    );

    logger.success('\n🎉 ВСЕ ТЕСТЫ MAIN FLOW ПРОЙДЕНЫ УСПЕШНО!');
}