/** Параметры подстановки в формулу цены из API. */
export interface PriceCalculationParams {
    [key: string]: number | string | null | undefined;
}

export interface PriceModel {
    formula: string;
    price: string;
    options: PriceCalculationParams;
    calculationType?: string;
}
