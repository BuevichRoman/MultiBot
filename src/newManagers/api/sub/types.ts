// types/data-manager.interface.ts


import {APIData} from "../types/data";

export interface IAPIDataManager {
    // Свойства
    data: APIData;
    isLoaded: boolean;

    // Основные методы
    load(force?: boolean): Promise<void>;
}