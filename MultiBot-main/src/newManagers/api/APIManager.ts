import axios, { AxiosInstance, AxiosError } from 'axios';
import { MegaLogger } from "../../addons/logger";
import {
    getCitiesByDriveStartLoc,
    getDriversForCity,
    getDriversForCityNight,
    isNightTime,
} from "./utils/sql_templates";
import {LoginResponse, TokenResponse} from "./types/auth";

import {APIDataManager} from "./sub/APIDataManager";
import {APIData, APIDataResponse} from "./types/data";
import {CacheVersion} from "./types/cacheVersion";
import fs from "fs";
import path from "path";

interface AdminCredentials {
    login: string;
    password: string;
    type: "e-mail" | "token" | "basic";
}

interface RequestOptions {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
}

const API_DATA_VERSION_CHECK_INTERVAL_MS = 30_000;

/** Логи таймера сравнения cache version / перезагрузки `api_data`: `API_DATA_CACHE_LOG=1` */
function apiDataCacheLogEnabled(): boolean {
    return process.env.API_DATA_CACHE_LOG === '1';
}

class APIManager {
    private client: AxiosInstance;
    private token?: string;
    private logger: MegaLogger;
    private readonly tag: string;

    public api_data_manager: APIDataManager

    public adminAuth: {token:string,u_hash:string} = {token:'',u_hash:''}

    public adminAuthFile: string = ''

    private apiDataVersionTimer: ReturnType<typeof setInterval> | null = null;
    private apiDataRefreshInFlight = false;

    constructor(
        public url: string,
        private adminCredentials: AdminCredentials,
        adminAuthFile: string,
        logger: MegaLogger,
        tag: string
    ) {
        this.api_data_manager = new APIDataManager(this)
        this.adminAuthFile = adminAuthFile
        this.tag = tag;
        this.logger = logger;

        // 1. Настраиваем клиент с таймаутами
        this.client = axios.create({
            baseURL: url,
            timeout: 10000, // 10 секунд максимум
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        // 2. Добавляем интерсепторы для логирования
        this.setupInterceptors();
    }

    private setupInterceptors() {
        // Логируем запросы
        this.client.interceptors.request.use(request => {
            //this.logger.debug(`${this.tag} API Request:`, {method: request.method, url: request.url,});
            return request;
        });

        // Логируем ответы
        this.client.interceptors.response.use(
            response => {
                //this.logger.debug(`${this.tag} API Response:`, {status: response.status,});
                return response;
            },
            error => {
                //this.logger.error(`${this.tag} API Error:`, {message: error.message, code: error.code, response: error.response?.data});
                return Promise.reject(error);
            }
        );
    }

    // 3. Универсальный метод с retry
    private async request<T>(
        method: 'get' | 'post' | 'put' | 'delete',
        path: string,
        data?: any,
        options: RequestOptions = {}
    ): Promise<T> {
        const {
            timeout = 10000,
            retries = 3,
            retryDelay = 1000
        } = options;

        let lastError: Error;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                // Устанавливаем таймаут для конкретного запроса
                const response = await this.client.request({
                    method,
                    url: path,
                    data: method === 'get' ? undefined : data,
                    params: method === 'get' ? data : undefined,
                    timeout
                });

                return response.data;

            } catch (error: any) {
                lastError = error as Error;

                // Логируем ошибку
                this.logger.warn(`${this.tag} Request failed (attempt ${attempt}/${retries}):`, {
                    path,
                    error: error instanceof AxiosError ? error.code : error.message
                });

                // Если это не последняя попытка - ждем и повторяем
                if (attempt < retries) {
                    await this.delay(retryDelay * attempt); // exponential backoff
                }
            }
        }

        throw new Error(`Request failed after ${retries} attempts: ${lastError!.message}`);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============ ПУБЛИЧНЫЕ МЕТОДЫ ============

    /**
     * Регистрация пользователя.
     * Телефон только внутри data: register_data.u_details.phone (поле u_phone в форму не передаётся).
     */
    async register(userData: {
        /** Не уходит в FormData; номер — в register_data.u_details.phone */
        u_phone?: string;
        phone?: string;
        u_role?: number;
        u_name?: string;
        name?: string;
        ref_code?: string;
        lang?: string;
        u_details?: { birthYear?: string; city?: string; cityString?: string; [key: string]: any };
        register_data?: {
            u_details: {
                birthYear?: string;
                phone?: string;
                cityString?: string;
                docs: Record<string, { version: string; accepted: string }>;
            };
        };
        [k: string]: any;
    }): Promise<any> {
        const { createForm } = await import('./utils/general');
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const phone =
            userData.register_data?.u_details?.phone ??
            userData.u_phone ??
            userData.phone ??
            '';
        const name = userData.u_name ?? userData.name ?? '';
        const lang = userData.lang ?? '1';
        const dataStr =
            userData.register_data && typeof userData.register_data === 'object'
                ? JSON.stringify(userData.register_data)
                : JSON.stringify({});
        const form = createForm(
            {
                u_role: String(userData.u_role ?? 1),
                u_name: name,
                ref_code: userData.ref_code ?? '',
                data: dataStr,
                ...(userData.u_a_tg && { u_tg: userData.u_a_tg }),
                ...(userData.u_a_wa && { u_wa: userData.u_a_wa }),
                ...(userData.chatId && { chatId: userData.chatId }),
            },
            auth,
        );
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');
        const res = await axios.post(`${this.url}register/`, form, {
            headers: postHeaders,
            timeout: 5000,
        });
        if (res.data?.status !== 'success') {
            throw new Error(res.data?.message ?? 'Register failed');
        }
        const idField = (userData.u_a_tg && { u_a_tg: userData.u_a_tg }) ||
            (userData.u_a_wa && { u_a_wa: userData.u_a_wa }) ||
            (userData.chatId && { chatId: userData.chatId }) ||
            (phone && { u_a_phone: phone });
        if (idField && Object.keys(idField).length) {
            await this.changeUserLang(idField as any, lang);
        }
        return res.data;
    }

    /**
     * Выполняет авторизацию администратора и получение токена
     * @returns {Promise<string>} Токен авторизации
     * @throws {Error} Если авторизация не удалась
     */
    async loginAdmin(): Promise<string> {
        // 1. Пробуем прочитать из файла
        if(this.adminAuthFile){
            try {
                const fileExists = await fs.promises.access(this.adminAuthFile).then(() => true).catch(() => false);

                if (fileExists) {
                    const authFileContent = await fs.promises.readFile(this.adminAuthFile, 'utf-8');
                    try {
                        const authFileData = JSON.parse(authFileContent);
                        if (authFileData.token && authFileData.u_hash) {
                            this.adminAuth = authFileData;
                            this.token = authFileData.token;



                            return this.token || '';
                        }
                    } catch (e: any) {
                        this.logger.warn('Failed to parse auth file, will re-authorize', { error: e.message });
                    }
                }
            } catch (e: any) {
                this.logger.warn('Failed to read auth file, will re-authorize', { error: e.message });
            }
        }


        // 2. Если нет файла или данные некорректны - авторизуемся
        try {
            // Шаг 1: Логин с получением auth_hash
            const loginData = await this.request<LoginResponse>(
                'post',
                '/auth/login',
                this.adminCredentials,
                { timeout: 5000, retries: 2 }
            );

            if (loginData.status !== 'success') {
                throw new Error(`Login failed: ${loginData.code}`);
            }

            this.logger.debug('Login successful', {
                userId: loginData.auth_user?.u_id,
                email: loginData.auth_user?.u_email
            });

            // Шаг 2: Получение токена по auth_hash
            if (!loginData.auth_hash) {
                throw new Error('Auth hash not received');
            }

            const tokenData = await this.request<TokenResponse>(
                'post',
                '/token',
                { auth_hash: loginData.auth_hash },
                { timeout: 5000, retries: 2 }
            );

            if (tokenData.status !== 'success' || !tokenData.data) {
                throw new Error(`Token acquisition failed: ${tokenData.code}`);
            }

            // Сохраняем данные авторизации
            this.adminAuth = {
                token: tokenData.data.token,
                u_hash: tokenData.data.u_hash
            };
            this.token = tokenData.data.token;

            // Устанавливаем токен в заголовки
            this.client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;

            // 3. Записываем в файл для будущих запусков

            if(this.adminAuthFile) {
                const dir = path.dirname(this.adminAuthFile);
                await fs.promises.mkdir(dir, { recursive: true });
                try {
                    await fs.promises.writeFile(
                        this.adminAuthFile,
                        JSON.stringify(this.adminAuth, null, 2),
                        'utf-8'
                    );
                    this.logger.info('Auth data saved to file', { path: this.adminAuthFile });
                } catch (e: any) {
                    this.logger.warn('Failed to save auth data to file', { error: e.message });
                }
            }



            this.logger.info('Admin authorization completed', {
                userId: loginData.auth_user?.u_id,
                hasToken: !!this.token,
                tokenPrefix: this.token.substring(0, 10) + '...'
            });

            return this.token;

        } catch (error) {
            this.logger.error('Authorization failed', {
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                credentials: {
                    login: this.adminCredentials.login,
                    type: this.adminCredentials.type
                }
            });

            throw new Error(`Admin authorization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Запрашивает константы, переменные с api
     * @returns {Promise<APIDataResponse>} Данные апи
     */
    async data(): Promise<APIDataResponse> {
        const data_response = await this.request<APIDataResponse>(
            'post',
            '/data',
            {
                ...this.adminAuth,
                json_like:JSON.stringify({
                    langs:"",
                    lang_vls:"",

                    car_models:"",
                    car_colors:"",
                    car_makes:"",
                    car_classes:"",

                    currencies:"",
                    cities:"",

                    booking_comments:"",

                    site_constants:"",
                })
            },
            { timeout: 5000, retries: 2 }
        );
        return data_response
    }

    async getCacheVersion(): Promise<CacheVersion> {
        const cv_response = await this.request<CacheVersion>(
            'get',
            '/?cv=',
            {
              cv: null
            },
            { timeout: 5000, retries: 2 }
        );
        return cv_response
    }

    /**
     * Каждые 30 с сравнивает `api_data_manager` с `getCacheVersion()`; при устаревании — `api_data_manager.load()`.
     */
    startApiDataVersionWatch(intervalMs: number = API_DATA_VERSION_CHECK_INTERVAL_MS): void {
        if (this.apiDataVersionTimer != null) return;
        this.apiDataVersionTimer = setInterval(() => {
            void this.refreshApiDataIfCacheStale();
        }, intervalMs);
    }

    stopApiDataVersionWatch(): void {
        if (this.apiDataVersionTimer != null) {
            clearInterval(this.apiDataVersionTimer);
            this.apiDataVersionTimer = null;
        }
    }

    private async refreshApiDataIfCacheStale(): Promise<void> {
        if (this.apiDataRefreshInFlight) return;
        const adm = this.api_data_manager;
        if (!adm.isLoaded) return;
        try {
            const upToDate = await adm.isNewestVersion();
            if (upToDate) return;
        } catch (e: any) {
            if (apiDataCacheLogEnabled()) {
                this.logger.warn(`${this.tag} api_data cache version check failed`, { error: e?.message });
            }
            return;
        }
        this.apiDataRefreshInFlight = true;
        try {
            await adm.load();
            if (apiDataCacheLogEnabled()) {
                this.logger.info(`${this.tag} api_data reloaded (stale cache version)`);
            }
        } catch (e: any) {
            if (apiDataCacheLogEnabled()) {
                this.logger.warn(`${this.tag} api_data reload failed`, { error: e?.message });
            }
        } finally {
            this.apiDataRefreshInFlight = false;
        }
    }

    async getProfile(field: {[key: string]: string}): Promise<any> {
        return this.request('post', `/user`, {
            token:this.adminAuth.token,
            u_hash: this.adminAuth.u_hash,
            ...field
        }, {
            timeout: 5000,
            retries: 2
        });
    }

    /**
     * Сменить язык пользователя.
     * @param idField - { u_a_tg } | { u_a_wa } | { u_a_phone }
     * @param langId - id языка (1, 2, ...)
     */
    async changeUserLang(idField: Record<string, string>, langId: string): Promise<{ status: string; message?: string }> {
        try {
            const res = await this.request<{ status: string; message?: string }>('post', '/user', {
                token: this.adminAuth.token,
                u_hash: this.adminAuth.u_hash,
                data: JSON.stringify({ u_lang: langId }),
                ...idField,
            }, { timeout: 5000, retries: 2 });
            return res ?? { status: 'success' };
        } catch (e: any) {
            this.logger.warn(`${this.tag} [changeUserLang] failed`, { error: e?.message });
            return { status: 'error', message: e?.message };
        }
    }

    /**
     * Сменить рефкод (тестовый режим и т.д.).
     * @param uId - внутренний u_id пользователя из getProfile
     * @param newCode - новый рефкод (напр. "666")
     * @param prevCode - предыдущий рефкод (для backup в u_details)
     */
    async changeUserReferralCode(uId: string, newCode: string, prevCode: string): Promise<{ status: string;data?:any; message?: string }> {
        try {
            const data = prevCode ? { referrer_u_id: newCode, u_details: [['=', ['refCodeBackup'], prevCode]] } : { referrer_u_id: newCode };
            const res = await this.request<{ status: string;data?:any; message?: string }>('post', `/user/${uId}`, {
                token: this.adminAuth.token,
                u_hash: this.adminAuth.u_hash,
                data: JSON.stringify(data),
            }, { timeout: 5000, retries: 2 });
            return res ?? { status: 'success' };
        } catch (e: any) {
            this.logger.warn(`${this.tag} [changeUserReferralCode] failed`, { error: e?.message });
            return { status: 'error', message: e?.message };
        }
    }

    /**
     * Обновить профиль пользователя (u_name, u_details).
     * @param idField - { u_a_tg } | { u_a_wa } | { u_a_phone }
     * @param payload - { u_name?, u_details? } — u_details массив операций [['=', ['birthYear'], '1990'], ...]
     */
    async editUserProfile(idField: Record<string, string>, payload: { u_name?: string; u_details?: unknown[] }): Promise<{ status: string; message?: string }> {
        try {
            const res = await this.request<{ status: string;data?:any; message?: string }>('post', '/user', {
                token: this.adminAuth.token,
                u_hash: this.adminAuth.u_hash,
                data: JSON.stringify(payload),
                ...idField,
            }, { timeout: 5000, retries: 2 });
            return res ?? { status: 'success' };
        } catch (e: any) {
            this.logger.warn(`${this.tag} [editUserProfile] failed`, { error: e?.message });
            return { status: 'error', message: e?.message };
        }
    }

    /**
     * Обновить u_details пользователя (например docs после акцептации документов).
     * @param idField - { u_a_tg } | { u_a_wa } | { u_a_phone } для идентификации пользователя
     * @param u_details - массив операций вида [['=', ['docs','public_offer','version'], '1'], ...]
     */
    async editUserDetails(idField: Record<string, string>, u_details: unknown[]): Promise<{ status: string; message?: string }> {
        try {
            const res = await this.request<{ status: string;data?: any; message?: string }>('post', '/user', {
                token: this.adminAuth.token,
                u_hash: this.adminAuth.u_hash,
                data: JSON.stringify({ u_details }),
                ...idField,
            }, { timeout: 5000, retries: 2 });
            return res ?? { status: 'success' };
        } catch (e: any) {
            this.logger.warn(`${this.tag} [editUserDetails] failed`, { error: e?.message });
            return { status: 'error', message: e?.message };
        }
    }

    /**
     * Получить данные заказа через drive/get/:id (для OrderManager).
     * @param orderId - id заказа
     * @param _idField - не используется для чтения (admin auth достаточно)
     */
    async getOrderState(orderId: string, _idField?: Record<string, string>): Promise<import('../OrderManager/types').RawOrderData | null> {
        const { createForm } = await import('./utils/general');
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const form = createForm({}, auth as any);
        try {
            const response = await axios.post(
                `${this.url}/drive/get/${orderId}?fields=000000002`,
                form,
                { headers: postHeaders, timeout: 15000 }
            );
            if (response.status !== 200 || response.data?.status !== 'success') {
                this.logger.warn(`${this.tag} [getOrderState] failed`, { orderId, status: response.status });
                return null;
            }
            const booking = response.data?.data?.booking?.[String(orderId)];
            if (!booking) {
                this.logger.warn(`${this.tag} [getOrderState] no booking for orderId`, { orderId });
                return null;
            }
            return {
                b_state: Number(booking.b_state),
                b_start_datetime: booking.b_start_datetime,
                b_max_waiting_list: booking.b_max_waiting_list,
                drivers: booking.drivers,
            };
        } catch (e: any) {
            this.logger.warn(`${this.tag} [getOrderState] error`, { orderId, error: e?.message });
            return null;
        }
    }

    /**
     * Получить данные водителя и машины для заказа (для wab_stateApproved).
     * Возвращает name, color, model, plate, phone.
     */
    async getDriverAndCar(
        orderId: string,
        langId: string = '1'
    ): Promise<{ name: string; color: string; model: string; plate: string; phone: string } | null> {
        const { createForm } = await import('./utils/general');
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const form = createForm({}, auth as any);
        try {
            const orderData = await this.getOrderState(orderId);
            if (!orderData?.drivers?.length) return null;
            const suitable = orderData.drivers.find((d: any) => d.c_canceled == null);
            if (!suitable) return null;
            const driverUid = suitable.u_id;
            const carUid = suitable.c_id;
            if (!driverUid || !carUid) return null;

            const driverRes = await axios.post(`${this.url}/user/${driverUid}`, form, {
                headers: postHeaders,
                timeout: 10000,
            });
            if (driverRes.status !== 200 || driverRes.data?.status !== 'success') return null;

            const carRes = await axios.post(`${this.url}/user/${driverUid}/car/${carUid}`, form, {
                headers: postHeaders,
                timeout: 10000,
            });
            if (carRes.status !== 200 || carRes.data?.status !== 'success') return null;

            const userData = driverRes.data?.data?.user?.[driverUid];
            const carData = carRes.data?.data?.car?.[carUid];
            if (!userData || !carData) return null;

            const dm = this.api_data_manager;
            const iso = (dm?.data?.data?.langs as any)?.[langId]?.iso ?? 'en';
            let rootLang: string | undefined;
            if (dm?.data?.data?.langs) {
                for (const key of Object.keys(dm.data.data.langs as any)) {
                    if ((dm.data.data.langs as any)[key]?.iso === 'en') {
                        rootLang = key;
                        break;
                    }
                }
            }
            rootLang = rootLang ?? '2';

            const carMakes = dm?.data?.data?.car_makes ?? {};
            const carModels = dm?.data?.data?.car_models ?? {};
            const carColors = dm?.data?.data?.car_colors ?? {};
            const carMark = userData.u_details?.carMark;
            const carModel = userData.u_details?.carModel;
            const carColorId = userData.u_details?.carColor;

            let makeAndModel = '-';
            try {
                if (dm?.isLoaded) makeAndModel = await dm.getLangValueItem('wab_carmodelnotspecified', langId) ?? '-';
            } catch {
                /* ignore */
            }
            if (carMark) {
                const make = (carMakes as any)[carMark]?.[iso] ?? (carMakes as any)[carMark]?.[rootLang] ?? '';
                const model = carModel
                    ? ((carModels as any)[carModel]?.[iso] ?? (carModels as any)[carModel]?.[rootLang] ?? '')
                    : '';
                makeAndModel = `${make}${model ? ' ' + model : ''}`.trim() || makeAndModel;
            }

            let color = '-';
            try {
                if (dm?.isLoaded) color = await dm.getLangValueItem('wab_carcolornotspecified', langId) ?? '-';
            } catch {
                /* ignore */
            }
            if (carColorId) {
                const cc = (carColors as any)[String(carColorId)];
                color = (cc && (typeof cc === 'object' ? cc[langId] ?? cc.ru ?? cc.en : String(cc))) || color;
            }

            let phone = userData.u_phone ?? '-';
            if (phone && phone !== '-') {
                if (phone.startsWith('+11')) phone = phone.replace('+11', '+34');
                else if (!phone.startsWith('+')) phone = '+' + phone;
            }

            return {
                name: `${userData.u_family || ''} ${userData.u_name || ''}`.trim(),
                color,
                model: makeAndModel,
                plate: carData.registration_plate ?? '-',
                phone,
            };
        } catch (e: any) {
            this.logger.warn(`${this.tag} [getDriverAndCar] error`, { orderId, error: e?.message });
            return null;
        }
    }

    /**
     * Отменить заказ через drive/get/:id + action set_cancel_state.
     * @param idField - { u_a_tg } | { u_a_wa } | { chatId } для авторизации
     */
    async cancelOrder(orderId: string, reason: string, idField?: Record<string, string>): Promise<void> {
        const { createForm } = await import('./utils/general');
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const formData = idField
            ? createForm({ action: 'set_cancel_state', reason, ...idField, u_a_role: '1' }, auth as any)
            : createForm({ action: 'set_cancel_state', reason, u_a_role: '1' }, auth as any);
        try {
            const response = await axios.post(
                `${this.url}/drive/get/${orderId}`,
                formData,
                { headers: postHeaders, timeout: 10000 }
            );
            if (response.status !== 200 || response.data?.status !== 'success') {
                this.logger.warn(`${this.tag} [cancelOrder] failed`, { orderId, status: response.status });
            }
        } catch (e: any) {
            this.logger.warn(`${this.tag} [cancelOrder] error`, { orderId, error: e?.message });
        }
    }

    /**
     * Оценка поездки 1–5 (action set_rate).
     */
    async setRate(orderId: string, value: number, idField?: Record<string, string>): Promise<void> {
        if (value < 1 || value > 5 || !Number.isInteger(value)) return;
        const { createForm } = await import('./utils/general');
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const formData = idField
            ? createForm({ action: 'set_rate', value: String(value), ...idField, u_a_role: '1' }, auth as any)
            : createForm({ action: 'set_rate', value: String(value), u_a_role: '1' }, auth as any);
        try {
            const response = await axios.post(
                `${this.url}/drive/get/${orderId}`,
                formData,
                { headers: postHeaders, timeout: 10000 }
            );
            if (response.status !== 200 || response.data?.status !== 'success') {
                this.logger.warn(`${this.tag} [setRate] failed`, { orderId, status: response.status });
            }
        } catch (e: any) {
            this.logger.warn(`${this.tag} [setRate] error`, { orderId, error: e?.message });
        }
    }

    /**
     * Отзыв по поездке (action set_review / set_comment).
     */
    async setReview(orderId: string, text: string, idField?: Record<string, string>): Promise<void> {
        if (!text?.trim()) return;
        const { createForm } = await import('./utils/general');
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const formData = idField
            ? createForm({ action: 'set_review', text: String(text).trim(), ...idField, u_a_role: '1' }, auth as any)
            : createForm({ action: 'set_review', text: String(text).trim(), u_a_role: '1' }, auth as any);
        try {
            const response = await axios.post(
                `${this.url}/drive/get/${orderId}`,
                formData,
                { headers: postHeaders, timeout: 10000 }
            );
            if (response.status !== 200 || response.data?.status !== 'success') {
                this.logger.warn(`${this.tag} [setReview] failed`, { orderId, status: response.status });
            }
        } catch (e: any) {
            this.logger.warn(`${this.tag} [setReview] error`, { orderId, error: e?.message });
        }
    }

    /**
     * Получить список водителей по координатам (для DriverSearchManager).
     * Использует query/template/1 (города) и 2 или 3 (водители).
     */
    async getDrivers(lat: number, lng: number, userId?: string): Promise<Array<{ id_user: string; phone?: string; name?: string; family?: string; distance?: string; json?: string; [key: string]: unknown }>> {
        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash } as { token: string; hash: string };
        const city = await getCitiesByDriveStartLoc(auth, this.url, { latitude: lat, longitude: lng });
        if (!city?.data?.length) return [];
        const cityIds = city.data.map((c: any) => c.id_city);
        let drivers: { data?: any[] };
        if (await isNightTime(lat, lng)) {
            drivers = await getDriversForCityNight(auth, this.url, cityIds, userId || '');
        } else {
            drivers = await getDriversForCity(auth, this.url, cityIds);
        }
        if (!drivers?.data?.length) return [];
        drivers.data.forEach((item: any) => {
            const c = city?.data?.find((ci: any) => ci.id_city === item.id_city);
            if (c) item.distance = c.distance_km;
        });
        return drivers.data;
    }

    /**
     * Создание заказа через API /drive (по примеру api/order.ts Order.new).
     * @param orderDraft - черновик заказа: from, to, when, hoursCount/childrenCount, additionalOptions, preferredDriversList
     * @param idField - идентификатор клиента: { u_a_tg } | { u_a_wa } | { chatId } (как в children/index.ts)
     * @returns { orderId: number } при успехе или { error: string } при ошибке
     */
    async createDrive(
        orderDraft: {
            from: { latitude: string; longitude: string };
            to: { latitude: string; longitude: string };
            when: Date | null;
            hoursCount?: number;
            childrenCount?: number;
            additionalOptions?: number[];
            preferredDriversList?: string[];
        },
        idField: Record<string, string>,
    ): Promise<{ orderId: number } | { error: string }> {
        const { createForm } = await import('./utils/general');
        const axios = (await import('axios')).default;
        const { postHeaders } = await import('./utils/general');

        const pad = (n: number) => n.toString().padStart(2, '0');
        /** Дата в UTC для API: '2026-03-18 13:03:46+03:00' → '2026-03-18 10:03:46+00:00' */
        const formatDateAPI = (d: Date) =>
            `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;

        const peopleCount = orderDraft.childrenCount ?? orderDraft.hoursCount ?? 1;
        const maxWaiting = 3600;

        const data: Record<string, any> = {
            b_start_latitude: orderDraft.from.latitude,
            b_start_longitude: orderDraft.from.longitude,
            b_start_datetime: orderDraft.when ? formatDateAPI(orderDraft.when) : 'now',
            b_passengers_count: peopleCount,
            b_max_waiting: maxWaiting,
            b_payment_way: 1,
            b_services: [],
            b_comments: orderDraft.additionalOptions ?? [],
            b_options: {
                "submitPrice": 0,
                "createdBy": "whatsapp",
                "pricingModel": {
                    "formula": "(base_price+distance*price_per_km+duration*price_per_minute)*time_ratio*car_class_ratio+options_sum+submit_price",
                    "price": "200",
                    "options": {
                        "base_price": 200,
                        "distance": 0,
                        "price_per_km": 10,
                        "duration": 0,
                        "price_per_minute": 5,
                        "time_ratio": 1,
                        "options_sum": 0,
                        "submit_price": 0,
                        "car_class_ratio": 1
                    },
                    "calculationType": "incomplete"
                },
                "childrenProfiles": "2"
            },
        };
        if (orderDraft.preferredDriversList?.length) {
            data.b_only_offer = 1;
        }

        this.logger.info(`${this.tag} [createDrive] start`, {
            idField,
            from: orderDraft.from,
            when: orderDraft.when ? orderDraft.when.toISOString() : 'now',
            peopleCount,
            preferredDriversCount: orderDraft.preferredDriversList?.length ?? 0,
        });

        const auth = { token: this.adminAuth.token, hash: this.adminAuth.u_hash };
        const form = createForm(
            { data: JSON.stringify(data), ...idField, u_a_role: '1' },
            auth as any,
        );

        try {
            const response = await axios.post(`${this.url}/drive`, form, {
                headers: postHeaders,
                timeout: 15000,
            });
            if (response.status !== 200 || response.data?.status !== 'success') {
                const errMsg = response.data?.message?.error || response.data?.message || JSON.stringify(response.data);
                this.logger.warn(`${this.tag} [createDrive] failed`, { status: response.status, error: errMsg });
                return { error: String(errMsg) };
            }
            const orderId = Number(response.data?.data?.b_id);
            if (isNaN(orderId)) {
                this.logger.warn(`${this.tag} [createDrive] invalid order id in response`, response.data);
                return { error: 'Invalid order id in response' };
            }

            this.logger.info(`${this.tag} [createDrive] success`, { orderId, idField });

            if (orderDraft.preferredDriversList?.length) {
                for (const driverId of orderDraft.preferredDriversList) {
                    try {
                        const offerForm = createForm(
                            { action: 'set_offer', u_id: driverId, u_a_role: '1', ...idField },
                            auth as any,
                        );
                        await axios.post(`${this.url}/drive/get/${orderId}`, offerForm, {
                            headers: postHeaders,
                            timeout: 10000,
                        });
                        this.logger.info(`${this.tag} [createDrive] addOffer ok`, { orderId, driverId });
                    } catch (e: any) {
                        this.logger.warn(`${this.tag} [createDrive] addOffer failed`, { orderId, driverId, error: e?.message });
                    }
                }
            }

            return { orderId };
        } catch (e: any) {
            this.logger.error(`${this.tag} [createDrive] error`, { idField, error: e?.message || e });
            return { error: e?.message || 'Network error' };
        }
    }

    /*
        async editProfile(userId: string, profileData: any): Promise<any> {
            if (!this.token) {
                await this.login();
            }

            return this.request('put', `/profile/${userId}`, profileData, {
                timeout: 5000,
                retries: 2
            });
        }

        async createOrder(orderData: any): Promise<any> {
            if (!this.token) {
                await this.login();
            }

            // Для создания заказа можно увеличить таймаут
            return this.request('post', '/orders', orderData, {
                timeout: 15000, // 15 секунд
                retries: 3
            });
        }

        async getOrder(orderId: string): Promise<any> {
            if (!this.token) {
                await this.login();
            }

            return this.request('get', `/orders/${orderId}`, undefined, {
                timeout: 5000,
                retries: 2
            });
        }

        async getData(endpoint: string, params?: any): Promise<any> {
            if (!this.token) {
                await this.login();
            }

            return this.request('get', endpoint, params, {
                timeout: 5000,
                retries: 2
            });
        }

        // Метод для проверки здоровья API
        async healthCheck(): Promise<boolean> {
            try {
                await this.request('get', '/health', undefined, {
                    timeout: 2000,
                    retries: 1
                });
                return true;
            } catch {
                return false;
            }
        }

        */

}

abstract class APIManagerAbstract {

}

export {
    APIManager
}