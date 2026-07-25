interface Lang {
    native: string
    iso: string
    [ key: string]: string
}
interface LangsDict {
    [key:string]: Lang
}

interface LangValueItem {
    [ key:string ]: string
}

interface LangValuesDict {
    [ key: string]: LangValueItem
}

interface APIData {
    version: string;
    default_lang: number;
    default_currency: string;
    default_country: string;
    default_profile: string;
    data: {
        langs: LangsDict,
        lang_vls: LangValuesDict,
        site_constants: any,

        car_classes: any,
        car_models: any,
        car_makes: any,
        car_colors: any,

        cities: any,

        currencies: any,

        booking_comments: any,
        [key: string]: any,
    }
}

interface APIDataResponse {
    status: string,
    message?: string,
    data?: APIData
}

export {
    Lang,
    LangsDict,

    LangValueItem,
    LangValuesDict,

    APIData,
    APIDataResponse
}