import {APIData, APIDataResponse} from "../types/data";
import {APIManager} from "../APIManager";
import {IAPIDataManager} from "./types";

class APIDataManager implements IAPIDataManager {
    public data: APIData
    public isLoaded: boolean = false;
    private _APIManager: APIManager
    constructor(_APIManager: APIManager) {
        this._APIManager = _APIManager
        this.data = {} as APIData
    }

    /**
     * Загружает данные API
     * @returns {Promise<void>}
     */
    async load() {
        let response = await this._APIManager.data()
        const overrides = (data: APIDataResponse) => {
            let new_data = data
            const bot_legal_docs = JSON.parse(data.data?.data?.site_constants.bot_legal_docs.value)
            if(new_data.data?.data.site_constants.bot_legal_docs) new_data.data.data.site_constants.bot_legal_docs.value = bot_legal_docs

            const gfp_taxi_bot_sttings = JSON.parse(data.data?.data?.site_constants.gfp_taxi_bot_settings.value)
            if(new_data.data?.data.site_constants.gfp_taxi_bot_settings) new_data.data.data.site_constants.gfp_taxi_bot_settings.value = gfp_taxi_bot_sttings
            return data
        }
        response = overrides(response)
        if(response.status === "success") {
            if (response.data) {
                this.data = response.data
            }
            this.isLoaded = true;
        }
        else throw new Error(response.message)
    }

    /**
     * Получает значение языкового значения
     * @param key
     * @param lang_id
     * @returns {string} Значение языкового значения
     * @throws {Error} Если значение не найдено
     * @throws {Error} Если менеджер не загружен
     */
    async getLangValueItem(key: string, lang_id: string) {
        if(!this.isLoaded) throw new Error('APIDataManager is not loaded')
        const item = this.data.data.lang_vls[key]
        if(!item) throw new Error(`Lang value item not found: ${key} ${lang_id}`)
        return item[lang_id];
    }

    /**
     * Проверяет, является ли текущая версия API самой новой
     * @returns {boolean} true, если текущая версия самая новая
     */
    async isNewestVersion() {
        const api_version = await this._APIManager.getCacheVersion()
        const my_version = this.data.version
        return api_version["cache version"] === my_version
    }

}

export {
    APIDataManager
}