/**
 * Константы и вспомогательные данные для настроек children tenant.
 */

export const CHILDREN_LANGUAGES =
    '--------------------------------------------------\n  _*1*_ English ........... 🇺🇸 (en)\n  _*2*_ Español ........... 🇪🇸 (es)\n  _*3*_ Italiano .......... 🇮🇹 (it)\n  _*4*_ Deutsch ........... 🇩🇪 (de)\n  _*5*_ Français .......... 🇫🇷 (fr)\n  _*6*_ Norsk ............. 🇳🇴 (nb)\n  _*7*_ Dansk ............. 🇩🇰 (da)\n  _*8*_ Русский ........... 🇷🇺 (ru)\n  _*9*_ Svenska ........... 🇸🇪 (sv)\n  _*10*_ Suomi ............. 🇫🇮 (fi)';

export const LANG_MENU_TO_API_ID: Record<string, string> = {
    '1': '2', '2': '3', '3': '5', '4': '6', '5': '4', '6': '7', '7': '8', '8': '1', '9': '9', '10': '10',
};

export const API_LANG_ID_TO_ISO: Record<string, string> = {
    '1': 'ru', '2': 'en', '3': 'es', '4': 'fr', '5': 'it', '6': 'de', '7': 'nb', '8': 'da', '9': 'sv', '10': 'fi',
};

export const CANCEL_REASON_KEYS: Record<string, string> = {
    '1': 'mistakenly_ordered',
    '2': 'waiting_for_long',
    '3': 'conflict_with_rider',
    '4': 'very_expensive',
};
